/**
 * Booster handlers (port of src/mapping.ts).
 *
 * MAJOR DEVIATION — call handlers -> event-driven (see MIGRATION.md):
 * The subgraph used `callHandlers` for addPool / shutdownPool / earmarkFees,
 * which HyperIndex does not support (it is event-only). The Booster emits only
 * `Deposited` and `Withdrawn`. We therefore:
 *
 *  - drive pool *creation* ("addPool") lazily from Booster events: on each
 *    Deposited/Withdrawn we read `poolLength()` (block-pinned) and materialize
 *    every pool id in [platform.poolCount, poolLength) that does not exist yet,
 *    reconstructing the pool from `poolInfo(pid)` (lptoken/token/gauge/
 *    crvRewards/stash). Pids are assigned sequentially exactly as the original
 *    did (`pid = platform.poolCount`).
 *  - cannot port `shutdownPool` (no event) -> pools are never marked inactive.
 *  - cannot port `earmarkFees` (no event) -> FeeRevenue snapshots are not taken.
 *
 * `_stashVersion` is not in `poolInfo`; it is reconstructed by probing the
 * stash contract interface (getName -> v3; tokenCount -> v2; tokenInfo() -> v1).
 *
 * contractRegister: BaseRewardPool (subgraph PoolCrvRewards template) is
 * registered from the same Deposited/Withdrawn events by reading
 * `poolInfo(poolid).crvRewards` via the raw (uncached) eth_call path.
 */
import {
  BigDecimal,
  indexer,
  type EffectCaller,
  type EvmContractRegisterContext,
  type EvmOnEventContext,
} from "envio";
import {
  ADDRESS_ZERO,
  BIG_DECIMAL_1E18,
  BIG_DECIMAL_ONE,
  BIG_INT_MINUS_ONE,
  BIG_INT_ONE,
  BIG_INT_ZERO,
  BOOSTER_ADDRESS,
  CURVE_REGISTRY,
  CURVE_REGISTRY_V2,
  CURVE_TRICRYPTO_FACTORY,
  ONE_WAY_LENDING_FACTORY,
  TRICRYPTO_LP_ADDRESSES,
  V2_SWAPS,
} from "../constants";
import { bytesToAddress, inferAssetType } from "../utils";
import { createNewPool, getLpTokenSupply, getPool, getPoolCoins, getPoolExtras } from "../services/pools";
import { getPlatform } from "../services/platform";
import { getUser } from "../services/user";
import { getDailyPoolSnapshot, takePoolSnapshots } from "../services/snapshots";
import {
  boosterPoolInfo,
  boosterPoolLength,
  curveTokenMinter,
  erc20Name,
  erc20Symbol,
  lendingFactoryAmms,
  lendingFactoryVaultsIndex,
  lendingVaultBorrowedToken,
  lendingVaultCollateralToken,
  registryGetPoolFromLpToken,
  registryGetPoolName,
  stashGetName,
  stashTokenCount,
  stashV1TokenInfo,
  triCryptoPoolFactory,
} from "../effects/contracts";

type EC = EffectCaller | null;

/**
 * Reconstruct the subgraph `_stashVersion` (1/2/3) by probing the stash
 * interface. Returns 0n if no stash / unrecognized (matches createNewPool's
 * default and the `stash == ADDRESS_ZERO` guard that skips extras).
 */
async function inferStashVersion(ec: EC, stash: string, block: number): Promise<bigint> {
  if (stash == ADDRESS_ZERO) {
    return BIG_INT_ZERO;
  }
  if ((await stashGetName(ec, stash)) !== null) {
    return 3n;
  }
  if ((await stashTokenCount(ec, stash, block)) !== null) {
    return 2n;
  }
  if ((await stashV1TokenInfo(ec, stash)) !== null) {
    return BIG_INT_ONE;
  }
  return BIG_INT_ZERO;
}

/**
 * Port of `handleAddPool`. Reconstructs the pool for `pid` from poolInfo and
 * the Curve registry / factory resolution, then persists it.
 */
async function processAddPool(
  context: EvmOnEventContext,
  ec: EC,
  block: number,
  blockNumber: bigint,
  timestamp: bigint,
  pid: bigint,
): Promise<void> {
  const poolInfo = await boosterPoolInfo(ec, BOOSTER_ADDRESS, pid, block);
  let pool = createNewPool(context, pid);
  pool = { ...pool, lpToken: ADDRESS_ZERO };
  let stash = ADDRESS_ZERO;
  let lpTokenFromInfo: string | null = null;
  let gaugeFromInfo: string | null = null;
  if (poolInfo !== null) {
    lpTokenFromInfo = poolInfo[0].toLowerCase();
    gaugeFromInfo = poolInfo[2].toLowerCase();
    pool = {
      ...pool,
      token: poolInfo[1].toLowerCase(),
      crvRewardsPool: poolInfo[3].toLowerCase(),
    };
    // PoolCrvRewards template instantiation -> handled in contractRegister
    stash = poolInfo[4].toLowerCase();
    pool = { ...pool, stash };
  }
  // call.inputs._lptoken (recovered from poolInfo)
  const lpToken = lpTokenFromInfo ?? ADDRESS_ZERO;
  pool = { ...pool, lpToken, isLending: false };

  let swap = lpToken;
  let swapResult = await registryGetPoolFromLpToken(ec, CURVE_REGISTRY, lpToken);
  if (!(swapResult === null || swapResult == ADDRESS_ZERO)) {
    swap = swapResult;
  } else {
    swapResult = await registryGetPoolFromLpToken(ec, CURVE_REGISTRY_V2, lpToken);
    if (!(swapResult === null || swapResult == ADDRESS_ZERO)) {
      swap = swapResult;
      pool = { ...pool, isV2: true };
    }
    // these pools predate the v2 registry
    else if (V2_SWAPS.has(lpToken)) {
      swap = V2_SWAPS.get(lpToken)!.toLowerCase();
      pool = { ...pool, isV2: true };
    } else {
      const factoryResult = await triCryptoPoolFactory(ec, lpToken);
      if (factoryResult !== null && factoryResult == CURVE_TRICRYPTO_FACTORY) {
        pool = { ...pool, isV2: true };
      } else {
        // if still nothing try to get the minter from the LP Token
        const minterResult = await curveTokenMinter(ec, lpToken);
        if (!(minterResult === null || minterResult == ADDRESS_ZERO)) {
          swap = minterResult;
          pool = { ...pool, isV2: true };
        } else {
          // could be a lending market
          const lendingRes = await lendingFactoryVaultsIndex(ec, ONE_WAY_LENDING_FACTORY, lpToken);
          if (lendingRes !== null) {
            pool = { ...pool, isLending: true };
            const amm = await lendingFactoryAmms(ec, ONE_WAY_LENDING_FACTORY, lendingRes);
            if (amm !== null) {
              swap = amm;
            }
          } else {
            context.log.warn(`Could not find pool for lp token ${lpToken}`);
          }
        }
      }
    }
  }
  // tricrypto is in old registry but still v2
  if (TRICRYPTO_LP_ADDRESSES.includes(lpToken)) {
    pool = { ...pool, isV2: true };
  }

  pool = { ...pool, swap };

  let name = (await registryGetPoolName(ec, CURVE_REGISTRY, swap)) ?? "";
  if (name == "") {
    const lpTokenNameResult = await erc20Name(ec, lpToken);
    name = lpTokenNameResult === null ? "" : lpTokenNameResult;
  }
  pool = { ...pool, name };

  if (pool.isLending) {
    const coin1 = await lendingVaultCollateralToken(ec, lpToken);
    const coin2 = await lendingVaultBorrowedToken(ec, lpToken);
    const coins = [...pool.coins];
    if (coin1 !== null) {
      coins.push(coin1);
    }
    if (coin2 !== null) {
      coins.push(coin2);
    }
    pool = { ...pool, coins };

    const name1 = coin1 === null ? null : await erc20Symbol(ec, coin1);
    const name2 = coin2 === null ? null : await erc20Symbol(ec, coin2);
    if (name1 !== null && name2 !== null) {
      pool = { ...pool, name: pool.name + " " + name1 + "/" + name2 };
    }
  } else {
    pool = await getPoolCoins(context, ec, pool);
  }
  context.log.info(`New pool added ${pool.name} at block ${blockNumber.toString()}`);

  pool = { ...pool, assetType: pool.isV2 ? 4 : inferAssetType(swap, pool.name) };
  pool = {
    ...pool,
    gauge: gaugeFromInfo ?? ADDRESS_ZERO,
    stashVersion: await inferStashVersion(ec, stash, block),
    // Initialize minor version at -1
    stashMinorVersion: BIG_INT_MINUS_ONE,
  };
  // If there is a stash contract, get the reward tokens
  if (stash != ADDRESS_ZERO) {
    pool = await getPoolExtras(context, ec, block, pool);
  }
  pool = { ...pool, active: true, creationBlock: blockNumber, creationDate: timestamp };
  context.Pool.set(pool);
}

/**
 * AddPool catch-up: materialize all pool ids in [poolCount, poolLength). This
 * replaces the addPool callHandler, assigning pids sequentially (pid = current
 * poolCount), exactly like the original's `pid = platform.poolCount`.
 *
 * The pool counter is threaded locally and persisted once at the end, so the
 * loop never depends on reading back its own Platform writes (which would be
 * unsafe under preload double-execution).
 */
async function ensurePoolsUpTo(
  context: EvmOnEventContext,
  ec: EC,
  block: number,
  blockNumber: bigint,
  timestamp: bigint,
): Promise<void> {
  const poolLengthResult = await boosterPoolLength(ec, BOOSTER_ADDRESS, block);
  if (poolLengthResult === null) {
    return;
  }
  const poolLength = poolLengthResult;
  const platform = await getPlatform(context);
  let poolCount = platform.poolCount;
  if (poolCount >= poolLength) {
    // ensure the Platform entity exists even when there's nothing to add
    context.Platform.set(platform);
    return;
  }
  while (poolCount < poolLength) {
    await processAddPool(context, ec, block, blockNumber, timestamp, poolCount);
    poolCount += BIG_INT_ONE;
  }
  context.Platform.set({ ...platform, poolCount });
}

// ---- contractRegister: PoolCrvRewards template (BaseRewardPool) ----
async function registerCrvRewards(context: EvmContractRegisterContext, poolid: bigint, block: number): Promise<void> {
  // contractRegister has no context.effect -> raw (mock-aware) eth_call.
  const poolInfo = await boosterPoolInfo(null, BOOSTER_ADDRESS, poolid, block);
  if (poolInfo === null) {
    return;
  }
  const crvRewards = poolInfo[3];
  if (crvRewards.toLowerCase() != ADDRESS_ZERO) {
    context.chain.BaseRewardPool.add(crvRewards as `0x${string}`);
  }
}

indexer.contractRegister({ contract: "Booster", event: "Deposited" }, async ({ event, context }) => {
  await registerCrvRewards(context, event.params.poolid, event.block.number);
});

indexer.contractRegister({ contract: "Booster", event: "Withdrawn" }, async ({ event, context }) => {
  await registerCrvRewards(context, event.params.poolid, event.block.number);
});

// ---- onEvent: Deposited ----
indexer.onEvent({ contract: "Booster", event: "Deposited" }, async ({ event, context }) => {
  const ec = context.effect;
  const block = event.block.number;
  const blockNumber = BigInt(event.block.number);
  const timestamp = BigInt(event.block.timestamp);

  // addPool catch-up (deviation: see file header)
  await ensurePoolsUpTo(context, ec, block, blockNumber, timestamp);

  const user = await getUser(context, event.params.user);
  const poolid = event.params.poolid.toString();
  context.Deposit.set({
    id: event.transaction.hash + "-" + event.logIndex.toString(),
    user_id: user.id,
    poolid_id: poolid,
    amount: event.params.amount,
    timestamp,
  });

  let pool = await getPool(context, poolid);
  // Original deposit guard is `pool.lpToken == Bytes.empty()` (a zero-LENGTH
  // byte array), which is NOT the 20-zero-byte Address.zero() a fresh pool
  // carries — so in practice it never returns early. We reproduce that by
  // comparing against "" (the empty-bytes analog), never ADDRESS_ZERO.
  if (pool.lpToken == "") {
    return;
  }
  pool = { ...pool, lpTokenBalance: pool.lpTokenBalance + event.params.amount };
  context.Pool.set(pool);
  await takePoolSnapshots(context, ec, block, timestamp, blockNumber);

  const lpSupply = await getLpTokenSupply(context, ec, pool.lpToken, block);
  pool = {
    ...pool,
    curveTvlRatio:
      lpSupply == BIG_INT_ZERO
        ? BIG_DECIMAL_ONE
        : new BigDecimal(pool.lpTokenBalance.toString()).div(lpSupply.toString()),
  };

  const snapResult = await getDailyPoolSnapshot(context, ec, block, pool, timestamp, blockNumber);
  pool = snapResult.pool;
  let snapshot = snapResult.snapshot;
  pool = {
    ...pool,
    tvl: new BigDecimal(pool.lpTokenBalance.toString()).div(BIG_DECIMAL_1E18).times(snapshot.lpTokenUSDPrice),
    baseApr: snapshot.baseApr,
    rawBaseApr: snapshot.rawBaseApr,
  };
  snapshot = {
    ...snapshot,
    tvl: pool.tvl,
    depositCount: snapshot.depositCount + BIG_INT_ONE,
    depositVolume: snapshot.depositVolume + event.params.amount,
    depositValue: snapshot.depositValue.plus(
      new BigDecimal(event.params.amount.toString()).times(snapshot.lpTokenUSDPrice),
    ),
  };

  context.Pool.set(pool);
  context.DailyPoolSnapshot.set(snapshot);
});

// ---- onEvent: Withdrawn ----
indexer.onEvent({ contract: "Booster", event: "Withdrawn" }, async ({ event, context }) => {
  const ec = context.effect;
  const block = event.block.number;
  const blockNumber = BigInt(event.block.number);
  const timestamp = BigInt(event.block.timestamp);

  await ensurePoolsUpTo(context, ec, block, blockNumber, timestamp);

  const user = await getUser(context, event.params.user);
  const poolid = event.params.poolid.toString();
  context.Withdrawal.set({
    id: event.transaction.hash + "-" + event.logIndex.toString(),
    user_id: user.id,
    poolid_id: poolid,
    amount: event.params.amount,
    timestamp,
  });

  let pool = await getPool(context, poolid);
  // original guard: lpToken == Bytes.empty() || == Address.zero()
  if (pool.lpToken == ADDRESS_ZERO) {
    return;
  }
  pool = { ...pool, lpTokenBalance: pool.lpTokenBalance - event.params.amount };
  context.Pool.set(pool);
  await takePoolSnapshots(context, ec, block, timestamp, blockNumber);

  const lpSupply = await getLpTokenSupply(context, ec, pool.lpToken, block);
  pool = {
    ...pool,
    curveTvlRatio:
      lpSupply == BIG_INT_ZERO
        ? BIG_DECIMAL_ONE
        : new BigDecimal(pool.lpTokenBalance.toString()).div(lpSupply.toString()),
  };

  const snapResult = await getDailyPoolSnapshot(context, ec, block, pool, timestamp, blockNumber);
  pool = snapResult.pool;
  let snapshot = snapResult.snapshot;
  pool = {
    ...pool,
    tvl: new BigDecimal(pool.lpTokenBalance.toString()).div(BIG_DECIMAL_1E18).times(snapshot.lpTokenUSDPrice),
    baseApr: snapshot.baseApr,
    rawBaseApr: snapshot.rawBaseApr,
  };
  snapshot = {
    ...snapshot,
    tvl: pool.tvl,
    withdrawalCount: snapshot.withdrawalCount + BIG_INT_ONE,
    withdrawalVolume: snapshot.withdrawalVolume + event.params.amount,
    withdrawalValue: snapshot.withdrawalValue.plus(
      new BigDecimal(event.params.amount.toString()).times(snapshot.lpTokenUSDPrice),
    ),
  };

  context.Pool.set(pool);
  context.DailyPoolSnapshot.set(snapshot);
});
