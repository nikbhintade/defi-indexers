/** Port of src/services/rebase/mainnet.ts */
import { BigDecimal, type EvmOnEventContext, type Pool } from "envio";
import { getAethSnapshotPrice, getATokenSnapshotPrice, getLidoSnapshotPrice, getUsdnSnapshotPrice } from "./snapshots";
import {
  AETH_POOL,
  ATOKEN_POOLS,
  BIG_DECIMAL_ONE,
  BIG_DECIMAL_ZERO,
  LIDO_ORACLE_ADDRESS,
  STETH_POOLS,
  USDN_POOL,
  YC_LENDING_TOKENS,
  Y_AND_C_POOLS,
} from "../../constants";
import { bytesToAddress, growthRate } from "../../utils";
import { DAY } from "../../utils/time";
import { lidoGetLastCompletedReportDelta } from "../../effects/contracts";
import { toBigDecimal } from "../../utils";
import { getTokenSnapshot } from "../snapshots";

const LIDO_V2_TIMESTAMP = 1682899200n;

async function getLidoApr(
  context: EvmOnEventContext,
  block: number,
  pool: Pool,
  reserves: readonly BigDecimal[],
  timestamp: bigint,
  tvl: BigDecimal,
): Promise<BigDecimal> {
  // rebase only applies to steth part of the pool
  const stEthRatio = reserves[1]!.div(tvl);

  if (timestamp < LIDO_V2_TIMESTAMP) {
    // V2 launched may 2nd
    const reportResult = await lidoGetLastCompletedReportDelta(context.effect, LIDO_ORACLE_ADDRESS, block);
    if (reportResult === null) {
      context.log.warn("LIDO oracle call reverted");
      return BIG_DECIMAL_ZERO;
    }
    const baseApr = toBigDecimal(reportResult[0] - reportResult[1]).div(toBigDecimal(reportResult[1]));
    const feeResult = new BigDecimal("1000").div(new BigDecimal("10000"));
    const userApr = baseApr.times(BIG_DECIMAL_ONE.minus(feeResult));
    return userApr.times(stEthRatio);
  } else {
    const apr = await getLidoSnapshotPrice(context, timestamp - DAY);
    return apr.times(stEthRatio);
  }
}

/** Port of rebase/rebase.template.ts getATokenDailyApr */
async function getATokenDailyApr(
  context: EvmOnEventContext,
  block: number,
  token: string,
  timestamp: bigint,
): Promise<BigDecimal> {
  const previousScale = await getATokenSnapshotPrice(context, block, token, timestamp - DAY);
  const currentScale = await getATokenSnapshotPrice(context, block, token, timestamp);
  return growthRate(currentScale, previousScale);
}

async function getAavePoolApr(
  context: EvmOnEventContext,
  block: number,
  pool: Pool,
  reserves: readonly BigDecimal[],
  timestamp: bigint,
  tvl: BigDecimal,
): Promise<BigDecimal> {
  let totalApr = BIG_DECIMAL_ZERO;
  for (let i = 0; i < pool.coins.length; i++) {
    const currentCoinApr = await getATokenDailyApr(context, block, bytesToAddress(pool.coins[i]!), timestamp);
    const aprRatio = tvl.eq(BIG_DECIMAL_ZERO) ? BIG_DECIMAL_ZERO : reserves[i]!.div(tvl);
    totalApr = totalApr.plus(currentCoinApr.times(aprRatio));
  }
  return totalApr;
}

/** Port of rebase/rebase.template.ts getCompOrYPoolApr */
export async function getCompOrYPoolApr(
  context: EvmOnEventContext,
  block: number,
  pool: Pool,
  reserves: readonly BigDecimal[],
  timestamp: bigint,
  tvl: BigDecimal,
): Promise<BigDecimal> {
  let totalApr = BIG_DECIMAL_ZERO;
  for (let i = 0; i < pool.coins.length; i++) {
    if (!YC_LENDING_TOKENS.includes(pool.coins[i]!)) {
      continue;
    }
    const previousSnapshot = await getTokenSnapshot(context, block, bytesToAddress(pool.coins[i]!), timestamp - DAY, false);
    const currentSnapshot = await getTokenSnapshot(context, block, bytesToAddress(pool.coins[i]!), timestamp, false);
    const currentCoinApr = growthRate(currentSnapshot.price, previousSnapshot.price);
    const aprRatio = tvl.eq(BIG_DECIMAL_ZERO) ? BIG_DECIMAL_ZERO : reserves[i]!.div(tvl);
    totalApr = totalApr.plus(currentCoinApr.times(aprRatio));
  }
  return totalApr;
}

async function getUsdnPoolApr(
  context: EvmOnEventContext,
  pool: Pool,
  reserves: readonly BigDecimal[],
  timestamp: bigint,
  tvl: BigDecimal,
): Promise<BigDecimal> {
  // we take the previous day's snapshot as reward distribution may not have happened yet
  const rate = await getUsdnSnapshotPrice(context, timestamp - DAY);
  const usdnRatio = reserves[0]!.div(tvl);
  return rate.times(usdnRatio);
}

async function getAethPoolApr(
  context: EvmOnEventContext,
  pool: Pool,
  reserves: readonly BigDecimal[],
  timestamp: bigint,
  tvl: BigDecimal,
): Promise<BigDecimal> {
  // NOTE: faithfully ported original behaviour — both ratios are read from
  // the same (previous day) snapshot so the growth rate is always zero
  const lastRatio = await getAethSnapshotPrice(context, timestamp - DAY);
  const prevRatio = await getAethSnapshotPrice(context, timestamp - DAY);
  const rate = lastRatio.eq(BIG_DECIMAL_ZERO) ? BIG_DECIMAL_ZERO : prevRatio.minus(lastRatio).div(lastRatio);
  const aethRatio = reserves[0]!.div(tvl);
  return rate.times(aethRatio);
}

export async function getMainnetPoolApr(
  context: EvmOnEventContext,
  block: number,
  pool: Pool,
  reserves: readonly BigDecimal[],
  timestamp: bigint,
  tvl: BigDecimal,
): Promise<BigDecimal> {
  if (STETH_POOLS.includes(pool.id)) {
    return getLidoApr(context, block, pool, reserves, timestamp, tvl);
  } else if (ATOKEN_POOLS.includes(pool.id)) {
    return getAavePoolApr(context, block, pool, reserves, timestamp, tvl);
  } else if (Y_AND_C_POOLS.includes(pool.id)) {
    return getCompOrYPoolApr(context, block, pool, reserves, timestamp, tvl);
  } else if (pool.id == USDN_POOL) {
    return getUsdnPoolApr(context, pool, reserves, timestamp, tvl);
  } else if (pool.id == AETH_POOL) {
    return getAethPoolApr(context, pool, reserves, timestamp, tvl);
  }
  return BIG_DECIMAL_ZERO;
}

/** Port of rebase/rebase.template.ts getDeductibleApr (mainnet variant). */
export async function getDeductibleApr(
  context: EvmOnEventContext,
  block: number,
  pool: Pool,
  reserves: readonly BigDecimal[],
  timestamp: bigint,
): Promise<BigDecimal> {
  if (reserves.length != pool.coins.length) {
    return BIG_DECIMAL_ZERO;
  }
  let tvl = BIG_DECIMAL_ZERO;
  for (const r of reserves) {
    tvl = tvl.plus(r);
  }
  if (tvl.lte(BIG_DECIMAL_ZERO)) {
    return BIG_DECIMAL_ZERO;
  }
  return getMainnetPoolApr(context, block, pool, reserves, timestamp, tvl);
}
