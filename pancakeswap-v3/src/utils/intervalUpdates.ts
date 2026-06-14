/**
 * Port of template/utils/intervalUpdates.ts. Each updater creates-or-updates
 * its snapshot entity, writes it to the store, and returns it. handleSwap then
 * mutates the returned copies further (adding volume) and writes them again —
 * matching the subgraph's load -> save -> mutate -> save pattern.
 */
import {
  type Bundle,
  type EvmOnEventContext,
  type Factory,
  type PancakeDayData,
  type Pool,
  type PoolDayData,
  type PoolHourData,
  type Tick,
  type TickDayData,
  type Token,
  type TokenDayData,
  type TokenHourData,
} from "envio";
import { ONE_BI, ZERO_BD, ZERO_BI, low } from "./constants";

type EventInfo = { blockTimestamp: bigint; poolAddress: string };

export async function updatePancakeDayData(
  context: EvmOnEventContext,
  factory: Factory,
  blockTimestamp: bigint,
): Promise<PancakeDayData> {
  const timestamp = Number(blockTimestamp);
  const dayID = Math.floor(timestamp / 86400);
  const dayStartTimestamp = dayID * 86400;
  let pancakeDayData = await context.PancakeDayData.get(dayID.toString());
  if (pancakeDayData === undefined) {
    pancakeDayData = {
      id: dayID.toString(),
      date: dayStartTimestamp,
      volumeETH: ZERO_BD,
      volumeUSD: ZERO_BD,
      volumeUSDUntracked: ZERO_BD,
      feesUSD: ZERO_BD,
      protocolFeesUSD: ZERO_BD,
      tvlUSD: ZERO_BD,
      txCount: ZERO_BI,
    };
  }
  pancakeDayData = {
    ...pancakeDayData,
    tvlUSD: factory.totalValueLockedUSD,
    txCount: factory.txCount,
  };
  context.PancakeDayData.set(pancakeDayData);
  return pancakeDayData;
}

export async function updatePoolDayData(
  context: EvmOnEventContext,
  pool: Pool,
  ev: EventInfo,
): Promise<PoolDayData> {
  const timestamp = Number(ev.blockTimestamp);
  const dayID = Math.floor(timestamp / 86400);
  const dayStartTimestamp = dayID * 86400;
  const dayPoolID = low(ev.poolAddress).concat("-").concat(dayID.toString());
  let poolDayData = await context.PoolDayData.get(dayPoolID);
  if (poolDayData === undefined) {
    poolDayData = {
      id: dayPoolID,
      date: dayStartTimestamp,
      pool_id: pool.id,
      volumeToken0: ZERO_BD,
      volumeToken1: ZERO_BD,
      volumeUSD: ZERO_BD,
      feesUSD: ZERO_BD,
      protocolFeesUSD: ZERO_BD,
      txCount: ZERO_BI,
      feeGrowthGlobal0X128: ZERO_BI,
      feeGrowthGlobal1X128: ZERO_BI,
      open: pool.token0Price,
      high: pool.token0Price,
      low: pool.token0Price,
      close: pool.token0Price,
      liquidity: ZERO_BI,
      sqrtPrice: ZERO_BI,
      token0Price: ZERO_BD,
      token1Price: ZERO_BD,
      tick: undefined,
      tvlUSD: ZERO_BD,
    };
  }

  let high = poolDayData.high;
  let lowV = poolDayData.low;
  if (pool.token0Price.gt(high)) high = pool.token0Price;
  if (pool.token0Price.lt(lowV)) lowV = pool.token0Price;

  poolDayData = {
    ...poolDayData,
    high,
    low: lowV,
    liquidity: pool.liquidity,
    sqrtPrice: pool.sqrtPrice,
    feeGrowthGlobal0X128: pool.feeGrowthGlobal0X128,
    feeGrowthGlobal1X128: pool.feeGrowthGlobal1X128,
    token0Price: pool.token0Price,
    token1Price: pool.token1Price,
    tick: pool.tick,
    tvlUSD: pool.totalValueLockedUSD,
    txCount: poolDayData.txCount + ONE_BI,
    close: pool.token0Price,
  };
  context.PoolDayData.set(poolDayData);
  return poolDayData;
}

export async function updatePoolHourData(
  context: EvmOnEventContext,
  pool: Pool,
  ev: EventInfo,
): Promise<PoolHourData> {
  const timestamp = Number(ev.blockTimestamp);
  const hourIndex = Math.floor(timestamp / 3600);
  const hourStartUnix = hourIndex * 3600;
  const hourPoolID = low(ev.poolAddress).concat("-").concat(hourIndex.toString());
  let poolHourData = await context.PoolHourData.get(hourPoolID);
  if (poolHourData === undefined) {
    poolHourData = {
      id: hourPoolID,
      periodStartUnix: hourStartUnix,
      pool_id: pool.id,
      volumeToken0: ZERO_BD,
      volumeToken1: ZERO_BD,
      volumeUSD: ZERO_BD,
      txCount: ZERO_BI,
      feesUSD: ZERO_BD,
      protocolFeesUSD: ZERO_BD,
      feeGrowthGlobal0X128: ZERO_BI,
      feeGrowthGlobal1X128: ZERO_BI,
      open: pool.token0Price,
      high: pool.token0Price,
      low: pool.token0Price,
      close: pool.token0Price,
      liquidity: ZERO_BI,
      sqrtPrice: ZERO_BI,
      token0Price: ZERO_BD,
      token1Price: ZERO_BD,
      tick: undefined,
      tvlUSD: ZERO_BD,
    };
  }

  let high = poolHourData.high;
  let lowV = poolHourData.low;
  if (pool.token0Price.gt(high)) high = pool.token0Price;
  if (pool.token0Price.lt(lowV)) lowV = pool.token0Price;

  poolHourData = {
    ...poolHourData,
    high,
    low: lowV,
    liquidity: pool.liquidity,
    sqrtPrice: pool.sqrtPrice,
    token0Price: pool.token0Price,
    token1Price: pool.token1Price,
    feeGrowthGlobal0X128: pool.feeGrowthGlobal0X128,
    feeGrowthGlobal1X128: pool.feeGrowthGlobal1X128,
    close: pool.token0Price,
    tick: pool.tick,
    tvlUSD: pool.totalValueLockedUSD,
    txCount: poolHourData.txCount + ONE_BI,
  };
  context.PoolHourData.set(poolHourData);
  return poolHourData;
}

export async function updateTokenDayData(
  context: EvmOnEventContext,
  bundle: Bundle,
  token: Token,
  blockTimestamp: bigint,
): Promise<TokenDayData> {
  const timestamp = Number(blockTimestamp);
  const dayID = Math.floor(timestamp / 86400);
  const dayStartTimestamp = dayID * 86400;
  const tokenDayID = token.id.concat("-").concat(dayID.toString());
  const tokenPrice = token.derivedETH.times(bundle.ethPriceUSD);

  let tokenDayData = await context.TokenDayData.get(tokenDayID);
  if (tokenDayData === undefined) {
    tokenDayData = {
      id: tokenDayID,
      date: dayStartTimestamp,
      token_id: token.id,
      volume: ZERO_BD,
      volumeUSD: ZERO_BD,
      feesUSD: ZERO_BD,
      protocolFeesUSD: ZERO_BD,
      untrackedVolumeUSD: ZERO_BD,
      open: tokenPrice,
      high: tokenPrice,
      low: tokenPrice,
      close: tokenPrice,
      priceUSD: ZERO_BD,
      totalValueLocked: ZERO_BD,
      totalValueLockedUSD: ZERO_BD,
    };
  }

  let high = tokenDayData.high;
  let lowV = tokenDayData.low;
  if (tokenPrice.gt(high)) high = tokenPrice;
  if (tokenPrice.lt(lowV)) lowV = tokenPrice;

  tokenDayData = {
    ...tokenDayData,
    high,
    low: lowV,
    close: tokenPrice,
    priceUSD: token.derivedETH.times(bundle.ethPriceUSD),
    totalValueLocked: token.totalValueLocked,
    totalValueLockedUSD: token.totalValueLockedUSD,
  };
  context.TokenDayData.set(tokenDayData);
  return tokenDayData;
}

export async function updateTokenHourData(
  context: EvmOnEventContext,
  bundle: Bundle,
  token: Token,
  blockTimestamp: bigint,
): Promise<TokenHourData> {
  const timestamp = Number(blockTimestamp);
  const hourIndex = Math.floor(timestamp / 3600);
  const hourStartUnix = hourIndex * 3600;
  const tokenHourID = token.id.concat("-").concat(hourIndex.toString());
  const tokenPrice = token.derivedETH.times(bundle.ethPriceUSD);

  let tokenHourData = await context.TokenHourData.get(tokenHourID);
  if (tokenHourData === undefined) {
    tokenHourData = {
      id: tokenHourID,
      periodStartUnix: hourStartUnix,
      token_id: token.id,
      volume: ZERO_BD,
      volumeUSD: ZERO_BD,
      untrackedVolumeUSD: ZERO_BD,
      feesUSD: ZERO_BD,
      protocolFeesUSD: ZERO_BD,
      open: tokenPrice,
      high: tokenPrice,
      low: tokenPrice,
      close: tokenPrice,
      priceUSD: ZERO_BD,
      totalValueLocked: ZERO_BD,
      totalValueLockedUSD: ZERO_BD,
    };
  }

  let high = tokenHourData.high;
  let lowV = tokenHourData.low;
  if (tokenPrice.gt(high)) high = tokenPrice;
  if (tokenPrice.lt(lowV)) lowV = tokenPrice;

  tokenHourData = {
    ...tokenHourData,
    high,
    low: lowV,
    close: tokenPrice,
    priceUSD: tokenPrice,
    totalValueLocked: token.totalValueLocked,
    totalValueLockedUSD: token.totalValueLockedUSD,
  };
  context.TokenHourData.set(tokenHourData);
  return tokenHourData;
}

export async function updateTickDayData(
  context: EvmOnEventContext,
  tick: Tick,
  blockTimestamp: bigint,
): Promise<TickDayData> {
  const timestamp = Number(blockTimestamp);
  const dayID = Math.floor(timestamp / 86400);
  const dayStartTimestamp = dayID * 86400;
  const tickDayDataID = tick.id.concat("-").concat(dayID.toString());
  let tickDayData = await context.TickDayData.get(tickDayDataID);
  if (tickDayData === undefined) {
    tickDayData = {
      id: tickDayDataID,
      date: dayStartTimestamp,
      pool_id: tick.pool_id,
      tick_id: tick.id,
      liquidityGross: ZERO_BI,
      liquidityNet: ZERO_BI,
      volumeToken0: ZERO_BD,
      volumeToken1: ZERO_BD,
      volumeUSD: ZERO_BD,
      feesUSD: ZERO_BD,
      feeGrowthOutside0X128: ZERO_BI,
      feeGrowthOutside1X128: ZERO_BI,
    };
  }
  tickDayData = {
    ...tickDayData,
    liquidityGross: tick.liquidityGross,
    liquidityNet: tick.liquidityNet,
    volumeToken0: tick.volumeToken0,
    // original quirk preserved: volumeToken1 is assigned tick.volumeToken0
    volumeToken1: tick.volumeToken0,
    volumeUSD: tick.volumeUSD,
    feesUSD: tick.feesUSD,
    feeGrowthOutside0X128: tick.feeGrowthOutside0X128,
    feeGrowthOutside1X128: tick.feeGrowthOutside1X128,
  };
  context.TickDayData.set(tickDayData);
  return tickDayData;
}

export type { EventInfo };
