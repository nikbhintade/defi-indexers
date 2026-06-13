/**
 * Offline test of the "addPool" flow.
 *
 * The subgraph created pools via an `addPool` callHandler. HyperIndex is
 * event-only, so pool creation is driven from the Booster `Deposited` event:
 * on the first event for a not-yet-known pid, `ensurePoolsUpTo` reads
 * `poolLength()` and materializes every missing pool from `poolInfo(pid)`.
 * The BaseRewardPool (PoolCrvRewards) template is registered in the matching
 * contractRegister hook from the same `poolInfo(pid).crvRewards`.
 *
 * All eth_calls are mocked via setCallMock (no RPC). We assert the Pool entity
 * is created with the reconstructed fields and that the deposit is recorded.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTestIndexer } from "envio";
import { setCallMock, type CallMockRule, type MockResult } from "../src/effects/calls";

const BOOSTER = "0xf403c135812408bfbe8713b5a23a04b3d48aae31";
const REGISTRY = "0x90e00ace148ca3b23ac1bc8c240c2a7dd9c2d7f5";

// A simple USD pool (3pool); assetType from ASSET_TYPES map -> 0 (no extra
// pricing calls needed for the LP USD price beyond the virtual price).
const SWAP = "0xbebc44782c7db0a1a60cb6fe97d0b483032ff1c7"; // 3pool
const LP = "0x6c3f90f043a72fa612cbac8115ee7e52bde6e490"; // 3Crv
const TOKEN = "0x30d9410ed1d5da1f6c8391af5338c93ab8d4035c"; // convex receipt
const GAUGE = "0xc5cfada84e902ad92dd40194f0883ad49639b023";
const CRV_REWARDS = "0x689440f2ff927e1f24c72f1087e1faf471ece1c8";
const STASH = "0x0000000000000000000000000000000000000000"; // no stash -> no extras
const DAI = "0x6b175474e89094c44da98b954eedeac495271d0f";
const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const USDT = "0xdac17f958d2ee523a2206206994597c13d831ec7";
const USER = "0xabcdabcdabcdabcdabcdabcdabcdabcdabcdabcd";
const TX = "0x" + "aa".repeat(32);

const str = (value: string): MockResult => ({ kind: "string", value });
const big = (value: bigint): MockResult => ({ kind: "bigint", value: value.toString() });
const bool = (value: boolean): MockResult => ({ kind: "bool", value });
const tuple = (value: MockResult[]): MockResult => ({ kind: "tuple", value });

afterEach(() => setCallMock(undefined));

describe("addPool flow (Deposited-driven)", () => {
  it("Deposited on a new pid creates the Pool and records the deposit", async () => {
    const rules: CallMockRule[] = [
      // ---- addPool catch-up ----
      { fn: "poolLength", to: BOOSTER, result: big(1n) },
      // poolInfo(0) -> (lptoken, token, gauge, crvRewards, stash, shutdown)
      {
        fn: "poolInfo",
        to: BOOSTER,
        args: ["0"],
        result: tuple([str(LP), str(TOKEN), str(GAUGE), str(CRV_REWARDS), str(STASH), bool(false)]),
      },
      // swap resolution: present in the v1 registry
      { fn: "get_pool_from_lp_token", to: REGISTRY, args: [LP], result: str(SWAP) },
      // pool name from registry
      { fn: "get_pool_name", to: REGISTRY, args: [SWAP], result: str("3pool") },
      // coins(0..) until revert
      { fn: "coins", to: SWAP, args: ["0"], result: str(DAI) },
      { fn: "coins", to: SWAP, args: ["1"], result: str(USDC) },
      { fn: "coins", to: SWAP, args: ["2"], result: str(USDT) },
      // coins(3) -> revert (default)

      // ---- deposit accounting / snapshot pricing ----
      // getLpTokenSupply (ERC20.totalSupply on LP)
      { fn: "totalSupply", to: LP, result: big(1000n * 10n ** 18n) },
      // getLpTokenVirtualPrice: registry virtual price -> 1.0
      { fn: "get_virtual_price_from_lp_token", to: REGISTRY, args: [LP], result: big(10n ** 18n) },
      // getPoolApr: periodFinish / totalSupply / rewardRate on the reward pool
      { fn: "periodFinish", to: CRV_REWARDS, result: big(0n) }, // <= timestamp -> crv/cvx apr 0
      { fn: "totalSupply", to: CRV_REWARDS, result: big(0n) },
      { fn: "rewardRate", to: CRV_REWARDS, result: big(0n) },
      // getUsdRate(CRV) / getUsdRate(CVX) -> no sushi/uni pairs -> price 1 fallback
      // (getTokenAValueInTokenB returns 1 when ethRateB == 0; all pair lookups revert)
      // getCvxMintAmount: CVX totalSupply
      { fn: "totalSupply", to: "0x4e3fbd56cd56c3e72c1403e103b45db9da5b9d2b", result: big(50000000n * 10n ** 18n) },
    ];
    // not strict: getUsdRate's pair/oracle lookups intentionally fall through to
    // the revert default (mirrors "no pool found" -> price fallback)
    setCallMock({ rules });

    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "Booster",
              event: "Deposited",
              srcAddress: BOOSTER as `0x${string}`,
              logIndex: 1,
              params: { user: USER as `0x${string}`, poolid: 0n, amount: 100n * 10n ** 18n },
              block: { number: 12500000, timestamp: 1620000000 },
              transaction: { hash: TX },
            },
          ],
        },
      },
    });

    // ---- Pool entity created by ensurePoolsUpTo -> processAddPool ----
    const pool = await indexer.Pool.getOrThrow("0");
    expect(pool.poolid).toBe(0n);
    expect(pool.platform_id).toBe("Convex");
    expect(pool.name).toBe("3pool");
    expect(pool.lpToken).toBe(LP);
    expect(pool.token).toBe(TOKEN);
    expect(pool.gauge).toBe(GAUGE);
    expect(pool.crvRewardsPool).toBe(CRV_REWARDS);
    expect(pool.swap).toBe(SWAP);
    expect(pool.stash).toBe(STASH);
    expect(pool.isV2).toBe(false);
    expect(pool.isLending).toBe(false);
    expect(pool.active).toBe(true);
    expect(pool.assetType).toBe(0); // 3pool swap is in ASSET_TYPES -> 0
    expect([...pool.coins]).toEqual([DAI, USDC, USDT]);
    expect(pool.creationBlock).toBe(12500000n);
    expect(pool.creationDate).toBe(1620000000n);
    // deposit increased the balance
    expect(pool.lpTokenBalance).toBe(100n * 10n ** 18n);
    // curveTvlRatio = lpTokenBalance / totalSupply = 100/1000 = 0.1
    expect(pool.curveTvlRatio.toString()).toBe("0.1");

    // ---- Platform poolCount incremented ----
    const platform = await indexer.Platform.getOrThrow("Convex");
    expect(platform.poolCount).toBe(1n);

    // ---- Deposit recorded (id = txhash-logIndex) ----
    const deposit = await indexer.Deposit.getOrThrow(`${TX}-1`);
    expect(deposit.poolid_id).toBe("0");
    expect(deposit.user_id).toBe(USER);
    expect(deposit.amount).toBe(100n * 10n ** 18n);
    expect(deposit.timestamp).toBe(1620000000n);

    // ---- User created ----
    const user = await indexer.User.getOrThrow(USER);
    expect(user.address).toBe(USER);

    // ---- DailyPoolSnapshot created (id = name-pid-dayBucket) ----
    const dayBucket = (1620000000n / 86400n) * 86400n;
    const snap = await indexer.DailyPoolSnapshot.getOrThrow(`3pool-0-${dayBucket.toString()}`);
    expect(snap.poolid_id).toBe("0");
    expect(snap.lpTokenVirtualPrice.toString()).toBe("1");
    expect(snap.depositCount).toBe(1n);
    expect(snap.depositVolume).toBe(100n * 10n ** 18n);
  });
});
