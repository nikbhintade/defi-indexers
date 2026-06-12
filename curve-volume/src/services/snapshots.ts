/** Port of src/services/snapshots.ts */
import {
  BigDecimal,
  type DailyPoolSnapshot,
  type EvmOnEventContext,
  type Pool,
  type SwapVolumeSnapshot,
  type TokenSnapshot,
} from "envio";
import { DAY, getIntervalFromTimestamp, HOUR } from "../utils/time";
import { getForexUsdRate, getUsdRate } from "../utils/pricing";
import {
  ADDRESS_ZERO,
  BENCHMARK_STABLE_ASSETS,
  BIG_DECIMAL_1E18,
  BIG_DECIMAL_ONE,
  BIG_DECIMAL_TWO,
  BIG_DECIMAL_ZERO,
  BIG_INT_ZERO,
  CTOKENS,
  CURVE_ONLY_TOKENS,
  DEPRECATED_POOLS,
  FEE_PRECISION,
  FOREX_ORACLES,
  FOREX_TOKENS,
  METATOKEN_TO_METAPOOL_MAPPING,
  SCAM_POOLS,
  USDN_POOL,
  USDT_ADDRESS,
  WBTC_ADDRESS,
  WETH_ADDRESS,
  YC_LENDING_TOKENS,
} from "../constants";
import { bigDecimalToBigInt, bytesToAddress, exponentToBigDecimal, toBigDecimal } from "../utils";
import { getPlatform } from "./platform";
import { getBasePool } from "./pools";
import { getDeductibleApr } from "./rebase/mainnet";
import { fillV2PoolParamsSnapshot } from "./multicall";
import {
  erc20BalanceOf,
  erc20TotalSupply,
  poolA,
  poolAdminFee,
  poolAdminFeeNg,
  poolBalances,
  poolBalances128,
  poolFee,
  poolOffPegFeeMultiplier,
  poolPriceOracle,
  poolVirtualPrice,
  poolXcpProfit,
  poolXcpProfitA,
} from "../effects/contracts";

const BASE_APR_OUTLIER_THRESHOLD = new BigDecimal("0.0005");

export async function getTokenSnapshot(
  context: EvmOnEventContext,
  block: number,
  token: string,
  timestamp: bigint,
  forex: boolean,
): Promise<TokenSnapshot> {
  const hour = getIntervalFromTimestamp(timestamp, HOUR);
  const snapshotId = token + "-" + hour.toString();
  let snapshot = await context.TokenSnapshot.get(snapshotId);
  if (!snapshot) {
    let price: BigDecimal;
    if (forex) {
      price = await getForexUsdRate(context.effect, block, token);
    } else {
      price = await getUsdRate(context.effect, block, token);
    }
    snapshot = {
      id: snapshotId,
      price,
      token,
      timestamp,
    };
    context.TokenSnapshot.set(snapshot);
  }
  return snapshot;
}

export async function getStableCryptoTokenSnapshot(
  context: EvmOnEventContext,
  block: number,
  pool: Pool,
  timestamp: bigint,
): Promise<TokenSnapshot> {
  // we use this for stable crypto pools where one assets may not be traded
  // outside of curve. we just try to get a price out of one of the assets traded
  // and use that
  const hour = getIntervalFromTimestamp(timestamp, HOUR);
  const snapshotId = pool.id + "-" + hour.toString();
  let snapshot = await context.TokenSnapshot.get(snapshotId);
  if (!snapshot) {
    let price = BIG_DECIMAL_ZERO;
    let token = ADDRESS_ZERO;
    for (let i = 0; i < pool.coins.length; ++i) {
      price = await getUsdRate(context.effect, block, bytesToAddress(pool.coins[i]!));
      if (!price.eq(BIG_DECIMAL_ZERO)) {
        token = pool.coins[i]!;
        break;
      }
    }
    snapshot = {
      id: snapshotId,
      token,
      timestamp: hour,
      price,
    };
    context.TokenSnapshot.set(snapshot);
  }
  return snapshot;
}

export async function getCryptoTokenSnapshot(
  context: EvmOnEventContext,
  block: number,
  asset: string,
  timestamp: bigint,
  pool: Pool,
): Promise<TokenSnapshot> {
  const hour = getIntervalFromTimestamp(timestamp, HOUR);
  const snapshotId = asset + "-" + hour.toString();
  let snapshot = await context.TokenSnapshot.get(snapshotId);
  if (!snapshot) {
    let price = FOREX_TOKENS.includes(asset)
      ? await getForexUsdRate(context.effect, block, asset)
      : await getUsdRate(context.effect, block, asset);
    // for synths and tokens that only trade on curve we use a mapping
    // get the price of the original asset and multiply that by the pool's price oracle
    const oracleInfo = CURVE_ONLY_TOKENS[asset];
    if (price.eq(BIG_DECIMAL_ZERO) && oracleInfo) {
      context.log.warn(`Invalid price found for ${asset}`);
      price = await getUsdRate(context.effect, block, oracleInfo.pricingToken);
      const priceOracleResult = await poolPriceOracle(context.effect, pool.id, block);
      let priceOracle =
        priceOracleResult === null ? BIG_DECIMAL_ONE : toBigDecimal(priceOracleResult).div(BIG_DECIMAL_1E18);
      priceOracle =
        oracleInfo.tokenIndex == 1 && !priceOracle.eq(BIG_DECIMAL_ZERO)
          ? priceOracle
          : BIG_DECIMAL_ONE.div(priceOracle);
      price = price.times(priceOracle);
    }
    snapshot = {
      id: snapshotId,
      timestamp: hour,
      token: asset,
      price,
    };
    context.TokenSnapshot.set(snapshot);
  }
  return snapshot;
}

export async function getTokenSnapshotByAssetType(
  context: EvmOnEventContext,
  block: number,
  pool: Pool,
  timestamp: bigint,
): Promise<TokenSnapshot> {
  if (FOREX_ORACLES[pool.id]) {
    return getTokenSnapshot(context, block, bytesToAddress(pool.address), timestamp, true);
  } else if (pool.assetType == 1) {
    return getTokenSnapshot(context, block, WETH_ADDRESS, timestamp, false);
  } else if (pool.assetType == 2) {
    return getTokenSnapshot(context, block, WBTC_ADDRESS, timestamp, false);
  } else if (pool.assetType == 0) {
    return getTokenSnapshot(context, block, USDT_ADDRESS, timestamp, false);
  } else {
    return getStableCryptoTokenSnapshot(context, block, pool, timestamp);
  }
}

export async function getSwapSnapshot(
  context: EvmOnEventContext,
  pool: Pool,
  timestamp: bigint,
  period: bigint,
): Promise<SwapVolumeSnapshot> {
  const interval = getIntervalFromTimestamp(timestamp, period);
  const snapshotId = pool.id + "-" + period.toString() + "-" + interval.toString();
  let snapshot = await context.SwapVolumeSnapshot.get(snapshotId);
  if (!snapshot) {
    snapshot = {
      id: snapshotId,
      pool_id: pool.id,
      period,
      timestamp: interval,
      amountSold: BIG_DECIMAL_ZERO,
      amountBought: BIG_DECIMAL_ZERO,
      amountSoldUSD: BIG_DECIMAL_ZERO,
      amountBoughtUSD: BIG_DECIMAL_ZERO,
      volume: BIG_DECIMAL_ZERO,
      volumeUSD: BIG_DECIMAL_ZERO,
      count: BIG_INT_ZERO,
    };
    context.SwapVolumeSnapshot.set(snapshot);
  }
  return snapshot;
}

async function getPreviousDaySnapshot(
  context: EvmOnEventContext,
  pool: Pool,
  timestamp: bigint,
): Promise<DailyPoolSnapshot | undefined> {
  const yesterday = getIntervalFromTimestamp(timestamp - DAY, DAY);
  return context.DailyPoolSnapshot.get(pool.id + "-" + yesterday.toString());
}

export async function getPoolBaseApr(
  context: EvmOnEventContext,
  pool: Pool,
  currentVirtualPrice: BigDecimal,
  timestamp: bigint,
): Promise<BigDecimal> {
  const previousSnapshot = await getPreviousDaySnapshot(context, pool, timestamp);
  const previousSnapshotVPrice = previousSnapshot ? previousSnapshot.virtualPrice : BIG_DECIMAL_ZERO;
  const rate = previousSnapshotVPrice.eq(BIG_DECIMAL_ZERO)
    ? BIG_DECIMAL_ZERO
    : currentVirtualPrice.minus(previousSnapshotVPrice).div(previousSnapshotVPrice);
  return rate;
}

export async function getV2PoolBaseApr(
  context: EvmOnEventContext,
  pool: Pool,
  currentXcpProfit: BigDecimal,
  currentXcpProfitA: BigDecimal,
  timestamp: bigint,
): Promise<BigDecimal> {
  const yesterday = getIntervalFromTimestamp(timestamp - DAY, DAY);
  const previousSnapshot = await context.DailyPoolSnapshot.get(pool.id + "-" + yesterday.toString());
  if (!previousSnapshot) {
    return BIG_DECIMAL_ZERO;
  }
  const previousSnapshotXcpProfit = previousSnapshot.xcpProfit;
  // avoid creating an artificial apr jump if pool was just created
  if (previousSnapshotXcpProfit.eq(BIG_DECIMAL_ZERO)) {
    return BIG_DECIMAL_ZERO;
  }
  const previousSnapshotXcpProfitA = previousSnapshot.xcpProfitA;
  const currentProfit = currentXcpProfit
    .div(BIG_DECIMAL_TWO)
    .plus(currentXcpProfitA.div(BIG_DECIMAL_TWO))
    .plus(BIG_DECIMAL_1E18)
    .div(BIG_DECIMAL_TWO);
  const previousProfit = previousSnapshotXcpProfit
    .div(BIG_DECIMAL_TWO)
    .plus(previousSnapshotXcpProfitA.div(BIG_DECIMAL_TWO))
    .plus(BIG_DECIMAL_1E18)
    .div(BIG_DECIMAL_TWO);
  const rate = previousProfit.eq(BIG_DECIMAL_ZERO)
    ? BIG_DECIMAL_ZERO
    : currentProfit.minus(previousProfit).div(previousProfit);
  return rate;
}

export async function getCryptoSwapTokenPriceFromSnapshot(
  context: EvmOnEventContext,
  block: number,
  pool: Pool,
  token: string,
  timestamp: bigint,
): Promise<BigDecimal> {
  if (SCAM_POOLS.includes(pool.id)) {
    return BIG_DECIMAL_ZERO;
  }
  const snapshot = await getCryptoTokenSnapshot(context, block, token, timestamp, pool);
  return snapshot.price;
}

export async function getStableSwapTokenPriceFromSnapshot(
  context: EvmOnEventContext,
  block: number,
  pool: Pool,
  token: string,
  timestamp: bigint,
): Promise<BigDecimal> {
  if (SCAM_POOLS.includes(pool.id)) {
    return BIG_DECIMAL_ZERO;
  }
  const isLendingToken = YC_LENDING_TOKENS.includes(token);
  const snapshot = isLendingToken
    ? await getTokenSnapshot(context, block, bytesToAddress(token), timestamp, false)
    : await getTokenSnapshotByAssetType(context, block, pool, timestamp);
  let price = snapshot.price;
  if (isLendingToken) {
    return price;
  }
  // multiply by virtual price for metatokens
  const metapoolAddress = METATOKEN_TO_METAPOOL_MAPPING[token];
  if (metapoolAddress !== undefined) {
    const metapool = await context.Pool.get(metapoolAddress);
    if (metapool) {
      price = price.times(metapool.virtualPrice).div(BIG_DECIMAL_1E18);
    }
    return price;
  }
  // return if it's an asset we assume won't seriously depeg
  if (BENCHMARK_STABLE_ASSETS.includes(token)) {
    return price;
  }
  // now account for depegs by querying price feed entities
  let relativePrice = await estimateDepegFromPair(context, pool.coins, token, pool.id);
  if (relativePrice) {
    return price.times(relativePrice);
  }
  // if no price feed we query underlying coins
  if (pool.metapool) {
    const basePool = await getBasePool(context, bytesToAddress(pool.basePool));
    relativePrice = await estimateDepegFromPair(context, basePool.coins, token, pool.id);
    if (relativePrice) {
      return price.times(relativePrice);
    }
  }
  return price;
}

async function estimateDepegFromPair(
  context: EvmOnEventContext,
  coins: readonly string[],
  token: string,
  poolId: string,
): Promise<BigDecimal | null> {
  for (let i = 0; i < coins.length; i++) {
    const currentCoin = coins[i]!;
    if (currentCoin != token) {
      const pricefeed = await context.PriceFeed.get(poolId + "-" + token + "-" + currentCoin);
      if (pricefeed) {
        return pricefeed.price;
      }
    }
  }
  return null;
}

async function getPoolLpTokenTotalSupply(context: EvmOnEventContext, block: number, pool: Pool): Promise<BigDecimal> {
  const lpToken = bytesToAddress(pool.lpToken);
  const supplyResult = await erc20TotalSupply(context.effect, lpToken, block);
  return supplyResult === null ? BIG_DECIMAL_ZERO : toBigDecimal(supplyResult).div(BIG_DECIMAL_1E18);
}

async function getPreviousDayTvl(context: EvmOnEventContext, pool: Pool, timestamp: bigint): Promise<BigDecimal> {
  const previousDaySnapshot = await getPreviousDaySnapshot(context, pool, timestamp);
  if (!previousDaySnapshot) {
    return BIG_DECIMAL_ZERO;
  }
  return previousDaySnapshot.tvl;
}

async function getReserves(
  context: EvmOnEventContext,
  block: number,
  pool: Pool,
  dailySnapshot: DailyPoolSnapshot,
  timestamp: bigint,
): Promise<DailyPoolSnapshot> {
  const reserves: bigint[] = [...dailySnapshot.reserves];
  const normalizedReserves: bigint[] = [...dailySnapshot.normalizedReserves];
  const reservesUsd: BigDecimal[] = [...dailySnapshot.reservesUSD];
  let tvl = BIG_DECIMAL_ZERO;
  for (let j = 0; j < pool.coins.length; j++) {
    let balance = BIG_INT_ZERO;
    let balanceResult = await poolBalances(context.effect, pool.id, j, block);
    if (balanceResult === null) {
      context.log.warn(`Unable to fetch balances for ${pool.id}, trying with int128 ABI`);
      balanceResult = await poolBalances128(context.effect, pool.id, j, block);
      if (balanceResult !== null) {
        balance = balanceResult;
      }
    } else {
      balance = balanceResult;
    }
    reserves.push(balance);
    const currentCoin = bytesToAddress(pool.coins[j]!);
    // need to handle the fact that balances doesn't actually return token balance
    // for cTokens
    const isCToken = CTOKENS.includes(currentCoin);
    if (isCToken) {
      const balanceOfResult = await erc20BalanceOf(context.effect, currentCoin, pool.id, block);
      balance = balanceOfResult === null ? balance : balanceOfResult;
    }
    const price = pool.isV2
      ? await getCryptoSwapTokenPriceFromSnapshot(context, block, pool, currentCoin, timestamp)
      : await getStableSwapTokenPriceFromSnapshot(context, block, pool, currentCoin, timestamp);
    const reserveUsdValue = toBigDecimal(balance).div(exponentToBigDecimal(pool.coinDecimals[j]!)).times(price);
    reservesUsd.push(reserveUsdValue);
    tvl = tvl.plus(reserveUsdValue);
    // handle "normalized" reserves: all balances normalized to 1e18
    // and including exchange rate for c tokens
    normalizedReserves.push(
      isCToken
        ? bigDecimalToBigInt(reserveUsdValue.times(BIG_DECIMAL_1E18))
        : bigDecimalToBigInt(toBigDecimal(balance).div(exponentToBigDecimal(pool.coinDecimals[j]!)).times(BIG_DECIMAL_1E18)),
    );
  }
  return {
    ...dailySnapshot,
    tvl,
    reserves,
    normalizedReserves,
    reservesUSD: reservesUsd,
  };
}

function createNewSnapshot(snapId: string, poolId: string): DailyPoolSnapshot {
  return {
    id: snapId,
    pool_id: poolId,
    virtualPrice: BIG_DECIMAL_ZERO,
    lpPriceUSD: BIG_DECIMAL_ZERO,
    tvl: BIG_DECIMAL_ZERO,
    fee: BIG_DECIMAL_ZERO,
    adminFee: BIG_DECIMAL_ZERO,
    offPegFeeMultiplier: undefined,
    adminFeesUSD: BIG_DECIMAL_ZERO,
    lpFeesUSD: BIG_DECIMAL_ZERO,
    totalDailyFeesUSD: BIG_DECIMAL_ZERO,
    reserves: [],
    reservesUSD: [],
    normalizedReserves: [],
    A: BIG_INT_ZERO,
    xcpProfit: BIG_DECIMAL_ZERO,
    xcpProfitA: BIG_DECIMAL_ZERO,
    baseApr: BIG_DECIMAL_ZERO,
    rebaseApr: BIG_DECIMAL_ZERO,
    gamma: undefined,
    midFee: undefined,
    outFee: undefined,
    feeGamma: undefined,
    allowedExtraProfit: undefined,
    adjustmentStep: undefined,
    maHalfTime: undefined,
    priceScale: [],
    priceOracle: [],
    lastPrices: [],
    lastPricesTimestamp: undefined,
    timestamp: BIG_INT_ZERO,
  };
}

export async function getOffPegFeeMultiplierResult(
  context: EvmOnEventContext,
  block: number,
  pool: string,
): Promise<bigint | null> {
  return poolOffPegFeeMultiplier(context.effect, pool, block);
}

export async function takePoolSnapshots(context: EvmOnEventContext, block: number, timestamp: bigint): Promise<void> {
  const platform = await getPlatform(context);
  const time = getIntervalFromTimestamp(timestamp, DAY);
  if (platform.latestPoolSnapshot == time) {
    return;
  }

  // NOTE: like the original, this is re-created (zeroed) on every invocation
  // and only accumulates fees for pools snapshotted in this call.
  let protocolAdminFeesUSD = BIG_DECIMAL_ZERO;
  let protocolLpFeesUSD = BIG_DECIMAL_ZERO;
  let protocolTotalDailyFeesUSD = BIG_DECIMAL_ZERO;

  for (let i = 0; i < platform.poolAddresses.length; ++i) {
    const poolAddress = platform.poolAddresses[i]!;
    const pool = await context.Pool.get(poolAddress);
    if (!pool) {
      // original returns (not continues) here, without saving the platform snapshot
      return;
    }
    const snapId = pool.id + "-" + time.toString();
    if (!(await context.DailyPoolSnapshot.get(snapId))) {
      let dailySnapshot = createNewSnapshot(snapId, pool.id);
      const previousDaySnapshot = await getPreviousDaySnapshot(context, pool, timestamp);
      dailySnapshot = { ...dailySnapshot, timestamp: time };
      const virtualPriceResult = await poolVirtualPrice(context.effect, pool.id, block);
      let vPrice = BIG_DECIMAL_ZERO;
      if (virtualPriceResult === null) {
        context.log.warn(`Unable to fetch virtual price for pool ${pool.id}`);
      } else {
        vPrice = toBigDecimal(virtualPriceResult);
      }
      dailySnapshot = { ...dailySnapshot, virtualPrice: vPrice };
      // we stop recording snapshots for those
      const deprecatedAt = DEPRECATED_POOLS[pool.id];
      if (deprecatedAt !== undefined && timestamp > deprecatedAt) {
        context.DailyPoolSnapshot.set(dailySnapshot);
        continue;
      }

      dailySnapshot = await getReserves(context, block, pool, dailySnapshot, timestamp);

      // fetch params
      const aResult = await poolA(context.effect, pool.id, block);
      dailySnapshot = { ...dailySnapshot, A: aResult === null ? BIG_INT_ZERO : aResult };
      // we avoid calling the offPegFeeMultiplier function for pools that don't need it
      if (previousDaySnapshot && previousDaySnapshot.offPegFeeMultiplier !== undefined) {
        const offPegFeeResult = await getOffPegFeeMultiplierResult(context, block, bytesToAddress(poolAddress));
        dailySnapshot = {
          ...dailySnapshot,
          offPegFeeMultiplier:
            offPegFeeResult === null ? undefined : toBigDecimal(offPegFeeResult).div(FEE_PRECISION),
        };
      }

      // compute base APR
      let baseApr = BIG_DECIMAL_ZERO;
      if (pool.isV2) {
        const xcpProfitResult = await poolXcpProfit(context.effect, pool.id, block);
        const xcpProfitAResult = await poolXcpProfitA(context.effect, pool.id, block);
        dailySnapshot = {
          ...dailySnapshot,
          xcpProfit: xcpProfitResult === null ? BIG_DECIMAL_ZERO : toBigDecimal(xcpProfitResult),
          xcpProfitA: xcpProfitAResult === null ? BIG_DECIMAL_ZERO : toBigDecimal(xcpProfitAResult),
        };
        baseApr = await getV2PoolBaseApr(context, pool, dailySnapshot.xcpProfit, dailySnapshot.xcpProfitA, timestamp);
        dailySnapshot = await fillV2PoolParamsSnapshot(context, block, dailySnapshot, pool);
      } else {
        baseApr = await getPoolBaseApr(context, pool, dailySnapshot.virtualPrice, timestamp);
      }
      // handle rebasing pools
      const deductibleApr = await getDeductibleApr(context, block, pool, dailySnapshot.reservesUSD, timestamp);
      if (deductibleApr.gt(BIG_DECIMAL_ZERO)) {
        context.log.info(`Deductible APR for pool ${pool.id}: ${deductibleApr.toString()} (from base APR ${baseApr.toString()})`);
      }
      // Discard spikes in base APR as outliers
      // We replace outlier value with previous day value
      if (baseApr.gt(BASE_APR_OUTLIER_THRESHOLD)) {
        const prevSnapshot = await getPreviousDaySnapshot(context, pool, timestamp);
        baseApr = prevSnapshot ? prevSnapshot.baseApr : BIG_DECIMAL_ZERO;
      }
      dailySnapshot = { ...dailySnapshot, baseApr };
      baseApr =
        baseApr.gt(deductibleApr) && deductibleApr.gte(BIG_DECIMAL_ZERO)
          ? baseApr.minus(deductibleApr)
          : BIG_DECIMAL_ZERO;
      dailySnapshot = { ...dailySnapshot, rebaseApr: deductibleApr };

      // compute lpUsdPrice from reserves & lp supply
      const supply = await getPoolLpTokenTotalSupply(context, block, pool);
      dailySnapshot = {
        ...dailySnapshot,
        lpPriceUSD: supply.eq(BIG_DECIMAL_ZERO) ? BIG_DECIMAL_ZERO : dailySnapshot.tvl.div(supply),
      };

      const feeResult = await poolFee(context.effect, pool.id, block);
      const fee = feeResult === null ? BIG_DECIMAL_ZERO : toBigDecimal(feeResult).div(FEE_PRECISION);
      dailySnapshot = { ...dailySnapshot, fee };

      // NOTE: the original checked `if (adminFeeResult)` (always true for a
      // CallResult) and would have trapped on a reverted call; we mirror the
      // *intent*: fall back to the tricrypto-ng ADMIN_FEE getter on revert.
      let adminFee = BIG_DECIMAL_ZERO;
      const adminFeeResult = await poolAdminFee(context.effect, pool.id, block);
      if (adminFeeResult !== null) {
        adminFee = toBigDecimal(adminFeeResult).div(FEE_PRECISION);
      } else {
        // tricrypto factory pools have a different admin fee method
        const ngAdminFeeResult = await poolAdminFeeNg(context.effect, pool.id, block);
        if (ngAdminFeeResult !== null) {
          adminFee = toBigDecimal(ngAdminFeeResult).div(FEE_PRECISION);
        }
      }

      let lpFees = BIG_DECIMAL_ZERO;
      let adminFees = BIG_DECIMAL_ZERO;
      let totalFees = BIG_DECIMAL_ZERO;
      // we use the previous day's tvl because this is what the apr applies to
      const previousDayTvl = await getPreviousDayTvl(context, pool, timestamp);
      // handle edge cases
      // USDN fees are not split by the pool but by the burner with a 50/50 ratio
      if (pool.id == USDN_POOL) {
        totalFees = baseApr.times(previousDayTvl);
        lpFees = totalFees.div(BIG_DECIMAL_TWO);
        adminFees = lpFees;
      } else {
        lpFees = baseApr.times(previousDayTvl);
        totalFees = adminFee.eq(BIG_DECIMAL_ONE) ? BIG_DECIMAL_ZERO : lpFees.div(BIG_DECIMAL_ONE.minus(adminFee));
        adminFees = totalFees.minus(lpFees);
      }
      dailySnapshot = {
        ...dailySnapshot,
        adminFee,
        adminFeesUSD: adminFees,
        lpFeesUSD: lpFees,
        totalDailyFeesUSD: totalFees,
      };

      protocolAdminFeesUSD = protocolAdminFeesUSD.plus(adminFees);
      protocolLpFeesUSD = protocolLpFeesUSD.plus(lpFees);
      protocolTotalDailyFeesUSD = protocolTotalDailyFeesUSD.plus(totalFees);

      context.Pool.set({
        ...pool,
        cumulativeFeesUSD: pool.cumulativeFeesUSD.plus(dailySnapshot.totalDailyFeesUSD),
        virtualPrice: vPrice,
        baseApr: dailySnapshot.baseApr,
      });
      context.DailyPoolSnapshot.set(dailySnapshot);
    }
  }

  context.DailyPlatformSnapshot.set({
    id: time.toString(),
    adminFeesUSD: protocolAdminFeesUSD,
    lpFeesUSD: protocolLpFeesUSD,
    totalDailyFeesUSD: protocolTotalDailyFeesUSD,
    timestamp,
  });
}
