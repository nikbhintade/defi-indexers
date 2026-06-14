/**
 * Port of mappings/dayUpdates.ts. Each function loads its inputs fresh from the
 * store (matching the original's entity references after the handler's `.save()`
 * calls), updates/creates the snapshot and returns it so the caller can apply
 * swap-specific volume updates on top.
 *
 * `event.address` → the pair id (lowercased srcAddress) passed by the caller.
 *
 * Note vs PancakeSwap: PairHourData has no totalSupply field here, and the day
 * snapshot entity is UniswapDayData (not PancakeDayData).
 */
import type { EvmOnEventContext, PairDayData, PairHourData, Token, TokenDayData, UniswapDayData } from "envio";
import { BigDecimal } from "envio";
import { FACTORY_ADDRESS, ONE_BI, ZERO_BD, ZERO_BI } from "./utils";

export async function updateUniswapDayData(context: EvmOnEventContext, timestamp: number): Promise<UniswapDayData> {
  const uniswap = await context.UniswapFactory.getOrThrow(FACTORY_ADDRESS);
  const dayID = Math.floor(timestamp / 86400);
  const dayStartTimestamp = dayID * 86400;

  let uniswapDayData = await context.UniswapDayData.get(dayID.toString());
  if (uniswapDayData === undefined) {
    uniswapDayData = {
      id: dayID.toString(),
      date: dayStartTimestamp,
      dailyVolumeUSD: ZERO_BD,
      dailyVolumeETH: ZERO_BD,
      totalVolumeUSD: ZERO_BD,
      totalVolumeETH: ZERO_BD,
      dailyVolumeUntracked: ZERO_BD,
      totalLiquidityUSD: ZERO_BD,
      totalLiquidityETH: ZERO_BD,
      txCount: ZERO_BI,
    };
  }
  uniswapDayData = {
    ...uniswapDayData,
    totalLiquidityUSD: uniswap.totalLiquidityUSD,
    totalLiquidityETH: uniswap.totalLiquidityETH,
    txCount: uniswap.txCount,
  };
  context.UniswapDayData.set(uniswapDayData);

  return uniswapDayData;
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
      reserve0: ZERO_BD,
      reserve1: ZERO_BD,
      reserveUSD: ZERO_BD,
    };
  }
  pairHourData = {
    ...pairHourData,
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
      priceUSD: (token.derivedETH as BigDecimal).times(bundle.ethPrice),
      dailyVolumeToken: ZERO_BD,
      dailyVolumeETH: ZERO_BD,
      dailyVolumeUSD: ZERO_BD,
      dailyTxns: ZERO_BI,
      totalLiquidityUSD: ZERO_BD,
      totalLiquidityToken: ZERO_BD,
      totalLiquidityETH: ZERO_BD,
    };
  }
  const totalLiquidityETH = token.totalLiquidity.times(token.derivedETH as BigDecimal);
  tokenDayData = {
    ...tokenDayData,
    priceUSD: (token.derivedETH as BigDecimal).times(bundle.ethPrice),
    totalLiquidityToken: token.totalLiquidity,
    totalLiquidityETH: totalLiquidityETH,
    totalLiquidityUSD: totalLiquidityETH.times(bundle.ethPrice),
    dailyTxns: tokenDayData.dailyTxns + ONE_BI,
  };
  context.TokenDayData.set(tokenDayData);

  return tokenDayData;
}
