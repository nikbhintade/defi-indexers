/**
 * Port of src/services/snapshots.ts.
 *
 * `getDailyPoolSnapshot` mutates the pool in the original (sets lpTokenUSDPrice
 * and the three aprs) and saves it. Here it returns both the created/loaded
 * snapshot AND the (possibly updated) pool so the caller keeps the latest copy.
 */
import { BigDecimal, type DailyPoolSnapshot, type EffectCaller, type EvmOnEventContext, type Pool } from "envio";
import { getIntervalFromTimestamp, DAY, bigDecimalExponential } from "../utils";
import { BIG_DECIMAL_ZERO } from "../constants";
import { getPoolApr, getXcpProfitResult } from "./pools";
import { getLendingApr, getLpTokenPriceUSD, getLpTokenVirtualPrice, getPoolBaseApr, getV2PoolBaseApr } from "./apr";
import { getPlatform } from "./platform";

type EC = EffectCaller | null;

export function createNewSnapsot(context: EvmOnEventContext, snapId: string): DailyPoolSnapshot {
  const snapshot: DailyPoolSnapshot = {
    id: snapId,
    poolid_id: "",
    poolName: "",
    withdrawalCount: 0n,
    depositCount: 0n,
    withdrawalVolume: 0n,
    depositVolume: 0n,
    withdrawalValue: BIG_DECIMAL_ZERO,
    depositValue: BIG_DECIMAL_ZERO,
    lpTokenBalance: 0n,
    lpTokenVirtualPrice: BIG_DECIMAL_ZERO,
    lpTokenUSDPrice: BIG_DECIMAL_ZERO,
    xcpProfit: BIG_DECIMAL_ZERO,
    xcpProfitA: BIG_DECIMAL_ZERO,
    tvl: BIG_DECIMAL_ZERO,
    curveTvlRatio: BIG_DECIMAL_ZERO,
    crvApr: BIG_DECIMAL_ZERO,
    cvxApr: BIG_DECIMAL_ZERO,
    extraRewardsApr: BIG_DECIMAL_ZERO,
    baseApr: BIG_DECIMAL_ZERO,
    rawBaseApr: BIG_DECIMAL_ZERO,
    timestamp: 0n,
    block: 0n,
  };
  context.DailyPoolSnapshot.set(snapshot);
  return snapshot;
}

export async function getDailyPoolSnapshot(
  context: EvmOnEventContext,
  ec: EC,
  blockNumber: number,
  pool: Pool,
  timestamp: bigint,
  block: bigint,
): Promise<{ snapshot: DailyPoolSnapshot; pool: Pool }> {
  const time = getIntervalFromTimestamp(timestamp, DAY);
  const snapId = pool.name + "-" + pool.poolid.toString() + "-" + time.toString();
  let snapshot = await context.DailyPoolSnapshot.get(snapId);
  let current = pool;
  if (!snapshot) {
    context.log.info(`Taking pool snapshot for pool ${pool.name} (${pool.swap}), block: ${block.toString()}`);
    snapshot = createNewSnapsot(context, snapId);
    snapshot = {
      ...snapshot,
      poolid_id: current.poolid.toString(),
      poolName: current.name,
      timestamp,
      lpTokenVirtualPrice: await getLpTokenVirtualPrice(ec, blockNumber, current),
    };

    const lpPrice = await getLpTokenPriceUSD(context, ec, blockNumber, current);
    current = { ...current, lpTokenUSDPrice: lpPrice };
    snapshot = { ...snapshot, lpTokenUSDPrice: current.lpTokenUSDPrice };

    const result = await getPoolApr(context, ec, blockNumber, current, timestamp, lpPrice);
    const aprs = result.aprs;
    current = { ...result.pool, crvApr: aprs[0], cvxApr: aprs[1], extraRewardsApr: aprs[2] };
    snapshot = { ...snapshot, crvApr: aprs[0], cvxApr: aprs[1], extraRewardsApr: aprs[2] };
    context.Pool.set(current);

    snapshot = {
      ...snapshot,
      lpTokenBalance: current.lpTokenBalance,
      tvl: current.tvl,
      curveTvlRatio: current.curveTvlRatio,
    };

    let baseApr = BIG_DECIMAL_ZERO;
    if (current.isV2) {
      const xcpProfits = await getXcpProfitResult(ec, current, blockNumber);
      snapshot = { ...snapshot, xcpProfit: xcpProfits[0], xcpProfitA: xcpProfits[1] };
      baseApr = await getV2PoolBaseApr(context, current, snapshot.xcpProfit, snapshot.xcpProfitA, timestamp);
    } else if (current.isLending) {
      baseApr = await getLendingApr(ec, blockNumber, current);
    } else {
      baseApr = await getPoolBaseApr(context, current, snapshot.lpTokenVirtualPrice, timestamp);
    }
    // annualize Apr
    const annualizedApr = bigDecimalExponential(baseApr, new BigDecimal("365"));
    snapshot = { ...snapshot, baseApr: annualizedApr, rawBaseApr: baseApr, block };
    context.DailyPoolSnapshot.set(snapshot);
  }
  return { snapshot, pool: current };
}

export async function takePoolSnapshots(
  context: EvmOnEventContext,
  ec: EC,
  blockNumber: number,
  timestamp: bigint,
  block: bigint,
): Promise<void> {
  const platform = await getPlatform(context);
  for (let i = 0; i < Number(platform.poolCount); ++i) {
    const pool = await context.Pool.get(i.toString());
    if (pool && pool.active) {
      await getDailyPoolSnapshot(context, ec, blockNumber, pool, timestamp, block);
    }
  }
}
