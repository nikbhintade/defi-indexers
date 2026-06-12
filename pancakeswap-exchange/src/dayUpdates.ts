/**
 * Port of mappings/dayUpdates.ts. Each function loads its inputs fresh from
 * the store (matching the original's `X.load(...)` after the handler's
 * `save()` calls), updates/creates the snapshot and returns it so the caller
 * can apply swap-specific volume updates on top.
 *
 * `event.address` → the pair id (lowercased srcAddress) passed by the caller.
 */
import type { EvmOnEventContext, PairDayData, PairHourData, PancakeDayData, Token, TokenDayData } from "envio";
import { BigDecimal } from "envio";
import { FACTORY_ADDRESS, ONE_BI, ZERO_BD, ZERO_BI } from "./utils";

export async function updatePancakeDayData(context: EvmOnEventContext, timestamp: number): Promise<PancakeDayData> {
  const pancake = await context.PancakeFactory.getOrThrow(FACTORY_ADDRESS);
  const dayID = Math.floor(timestamp / 86400);
  const dayStartTimestamp = dayID * 86400;

  let pancakeDayData = await context.PancakeDayData.get(dayID.toString());
  if (pancakeDayData === undefined) {
    pancakeDayData = {
      id: dayID.toString(),
      date: dayStartTimestamp,
      dailyVolumeUSD: ZERO_BD,
      dailyVolumeBNB: ZERO_BD,
      totalVolumeUSD: ZERO_BD,
      totalVolumeBNB: ZERO_BD,
      dailyVolumeUntracked: ZERO_BD,
      totalLiquidityUSD: ZERO_BD,
      totalLiquidityBNB: ZERO_BD,
      totalTransactions: ZERO_BI,
    };
  }
  pancakeDayData = {
    ...pancakeDayData,
    totalLiquidityUSD: pancake.totalLiquidityUSD,
    totalLiquidityBNB: pancake.totalLiquidityBNB,
    totalTransactions: pancake.totalTransactions,
  };
  context.PancakeDayData.set(pancakeDayData);

  return pancakeDayData;
}

export async function updatePairDayData(
  context: EvmOnEventContext,
  pairId: string,
  timestamp: number,
): Promise<PairDayData> {
  const dayID = Math.floor(timestamp / 86400);
  const dayStartTimestamp = dayID * 86400;
  const dayPairID = pairId.concat("-").concat(dayID.toString());
  const pair = await context.Pair.getOrThrow(pairId);
  let pairDayData = await context.PairDayData.get(dayPairID);
  if (pairDayData === undefined) {
    pairDayData = {
      id: dayPairID,
      date: dayStartTimestamp,
      token0_id: pair.token0_id,
      token1_id: pair.token1_id,
      pairAddress: pairId,
      dailyVolumeToken0: ZERO_BD,
      dailyVolumeToken1: ZERO_BD,
      dailyVolumeUSD: ZERO_BD,
      dailyTxns: ZERO_BI,
      totalSupply: ZERO_BD,
      reserve0: ZERO_BD,
      reserve1: ZERO_BD,
      reserveUSD: ZERO_BD,
    };
  }
  pairDayData = {
    ...pairDayData,
    totalSupply: pair.totalSupply,
    reserve0: pair.reserve0,
    reserve1: pair.reserve1,
    reserveUSD: pair.reserveUSD,
    dailyTxns: pairDayData.dailyTxns + ONE_BI,
  };
  context.PairDayData.set(pairDayData);

  return pairDayData;
}

export async function updatePairHourData(
  context: EvmOnEventContext,
  pairId: string,
  timestamp: number,
): Promise<PairHourData> {
  const hourIndex = Math.floor(timestamp / 3600);
  const hourStartUnix = hourIndex * 3600;
  const hourPairID = pairId.concat("-").concat(hourIndex.toString());
  const pair = await context.Pair.getOrThrow(pairId);
  let pairHourData = await context.PairHourData.get(hourPairID);
  if (pairHourData === undefined) {
    pairHourData = {
      id: hourPairID,
      hourStartUnix: hourStartUnix,
      pair_id: pairId,
      hourlyVolumeToken0: ZERO_BD,
      hourlyVolumeToken1: ZERO_BD,
      hourlyVolumeUSD: ZERO_BD,
      hourlyTxns: ZERO_BI,
      totalSupply: ZERO_BD,
      reserve0: ZERO_BD,
      reserve1: ZERO_BD,
      reserveUSD: ZERO_BD,
    };
  }
  pairHourData = {
    ...pairHourData,
    totalSupply: pair.totalSupply,
    reserve0: pair.reserve0,
    reserve1: pair.reserve1,
    reserveUSD: pair.reserveUSD,
    hourlyTxns: pairHourData.hourlyTxns + ONE_BI,
  };
  context.PairHourData.set(pairHourData);

  return pairHourData;
}

export async function updateTokenDayData(
  context: EvmOnEventContext,
  token: Token,
  timestamp: number,
): Promise<TokenDayData> {
  const bundle = await context.Bundle.getOrThrow("1");
  const dayID = Math.floor(timestamp / 86400);
  const dayStartTimestamp = dayID * 86400;
  const tokenDayID = token.id.concat("-").concat(dayID.toString());

  let tokenDayData = await context.TokenDayData.get(tokenDayID);
  if (tokenDayData === undefined) {
    tokenDayData = {
      id: tokenDayID,
      date: dayStartTimestamp,
      token_id: token.id,
      priceUSD: (token.derivedBNB as BigDecimal).times(bundle.bnbPrice),
      dailyVolumeToken: ZERO_BD,
      dailyVolumeBNB: ZERO_BD,
      dailyVolumeUSD: ZERO_BD,
      dailyTxns: ZERO_BI,
      totalLiquidityUSD: ZERO_BD,
      totalLiquidityToken: ZERO_BD,
      totalLiquidityBNB: ZERO_BD,
    };
  }
  const totalLiquidityBNB = token.totalLiquidity.times(token.derivedBNB as BigDecimal);
  tokenDayData = {
    ...tokenDayData,
    priceUSD: (token.derivedBNB as BigDecimal).times(bundle.bnbPrice),
    totalLiquidityToken: token.totalLiquidity,
    totalLiquidityBNB: totalLiquidityBNB,
    totalLiquidityUSD: totalLiquidityBNB.times(bundle.bnbPrice),
    dailyTxns: tokenDayData.dailyTxns + ONE_BI,
  };
  context.TokenDayData.set(tokenDayData);

  return tokenDayData;
}
