/**
 * Port of src/updates.ts (updatePairHourData / updatePairDailyData).
 *
 * Each returns the snapshot entity it just persisted; callers continue to
 * spread-update and re-persist it (the AssemblyScript original mutated the
 * returned reference and saved again).
 */
import { BigDecimal, type EvmOnEventContext, type Pair, type PairDailyData, type PairHourData } from "envio";
import { DAYS_PER_YEAR_BD, ONE_DAY, ONE_HOUR, ZERO_BD, ZERO_BI, toBD } from "../utils";
import { calcMarketWorthUSD, calcYieldTokenPrice } from "./helpers";
import { getUniswapTokenPrice } from "./pricing";

type Ctx = EvmOnEventContext;

export async function updatePairHourData(context: Ctx, block: number, timestampBI: bigint, market: Pair): Promise<PairHourData> {
  const timestamp = Number(timestampBI);
  const hourID = Math.floor(timestamp / ONE_HOUR);
  const hourStartUnix = hourID * ONE_HOUR;
  const hourPairID = market.id.concat("-").concat(hourID.toString());

  const currentYieldTokenPrice = await calcYieldTokenPrice(context, block, market);

  let pairHourData = await context.PairHourData.get(hourPairID);
  if (pairHourData === undefined) {
    const baseToken = await context.Token.getOrThrow(market.token1_id);
    const yieldToken = await context.Token.getOrThrow(market.token0_id);
    const yieldBearingToken = await context.Token.getOrThrow(yieldToken.underlyingAsset as string);
    pairHourData = {
      id: hourPairID,
      hourStartUnix,
      pair_id: market.id,
      hourlyVolumeToken0: ZERO_BD,
      hourlyVolumeToken1: ZERO_BD,
      hourlyVolumeUSD: ZERO_BD,
      hourlyTxns: ZERO_BI,
      yieldTokenPrice_low: currentYieldTokenPrice,
      yieldTokenPrice_high: currentYieldTokenPrice,
      yieldTokenPrice_open: currentYieldTokenPrice,
      yieldTokenPrice_close: ZERO_BD,
      baseTokenPrice: await getUniswapTokenPrice(context, block, baseToken),
      yieldBearingAssetPrice: await getUniswapTokenPrice(context, block, yieldBearingToken),
      totalSupply: ZERO_BD,
      reserve0: ZERO_BD,
      reserve1: ZERO_BD,
      marketWorthUSD: ZERO_BD,
      lpTokenPrice: ZERO_BD,
      impliedYield: ZERO_BD,
    };
  }

  let next = { ...pairHourData };
  if (currentYieldTokenPrice.gt(next.yieldTokenPrice_high)) {
    next.yieldTokenPrice_high = currentYieldTokenPrice;
  }
  if (currentYieldTokenPrice.lt(next.yieldTokenPrice_low)) {
    next.yieldTokenPrice_low = currentYieldTokenPrice;
  }
  next.yieldTokenPrice_close = currentYieldTokenPrice;

  const yieldTokenPriceUSD = currentYieldTokenPrice.times(next.baseTokenPrice);
  const daysUntilExpiry = toBD(market.expiry).minus(toBD(timestampBI)).div(ONE_DAY);
  const impliedYieldPercentage = yieldTokenPriceUSD
    .div(next.yieldBearingAssetPrice.minus(yieldTokenPriceUSD))
    .div(daysUntilExpiry)
    .times(DAYS_PER_YEAR_BD);

  next.impliedYield = impliedYieldPercentage;
  next.reserve0 = market.reserve0;
  next.reserve1 = market.reserve1;
  next.marketWorthUSD = await calcMarketWorthUSD(context, block, market);
  next.totalSupply = market.totalSupply;
  next.lpTokenPrice = next.marketWorthUSD.div(next.totalSupply);
  context.PairHourData.set(next);
  return next;
}

export async function updatePairDailyData(context: Ctx, block: number, timestampBI: bigint, market: Pair): Promise<PairDailyData> {
  const timestamp = Number(timestampBI);
  const dayID = Math.floor(timestamp / 86400);
  const dayStartUnix = dayID * 86400;
  const dayPairID = market.id.concat("-").concat(dayID.toString());

  const currentYieldTokenPrice = await calcYieldTokenPrice(context, block, market);

  let pairDayData = await context.PairDailyData.get(dayPairID);
  if (pairDayData === undefined) {
    const baseToken = await context.Token.getOrThrow(market.token1_id);
    const yieldToken = await context.Token.getOrThrow(market.token0_id);
    const yieldBearingToken = await context.Token.getOrThrow(yieldToken.underlyingAsset as string);
    pairDayData = {
      id: dayPairID,
      dayStartUnix,
      pair_id: market.id,
      dailyVolumeToken0: ZERO_BD,
      dailyVolumeToken1: ZERO_BD,
      dailyVolumeUSD: ZERO_BD,
      dailyTxns: ZERO_BI,
      yieldTokenPrice_low: currentYieldTokenPrice,
      yieldTokenPrice_high: currentYieldTokenPrice,
      yieldTokenPrice_open: currentYieldTokenPrice,
      yieldTokenPrice_close: ZERO_BD,
      baseTokenPrice: await getUniswapTokenPrice(context, block, baseToken),
      yieldBearingAssetPrice: await getUniswapTokenPrice(context, block, yieldBearingToken),
      totalSupply: ZERO_BD,
      reserve0: ZERO_BD,
      reserve1: ZERO_BD,
      marketWorthUSD: ZERO_BD,
      lpTokenPrice: ZERO_BD,
      impliedYield: ZERO_BD,
    };
  }

  let next = { ...pairDayData };
  if (currentYieldTokenPrice.gt(next.yieldTokenPrice_high)) {
    next.yieldTokenPrice_high = currentYieldTokenPrice;
  }
  if (currentYieldTokenPrice.lt(next.yieldTokenPrice_low)) {
    next.yieldTokenPrice_low = currentYieldTokenPrice;
  }
  next.yieldTokenPrice_close = currentYieldTokenPrice;

  const yieldTokenPriceUSD = currentYieldTokenPrice.times(next.baseTokenPrice);
  const daysUntilExpiry = toBD(market.expiry).minus(toBD(timestampBI)).div(ONE_DAY);
  const impliedYieldPercentage = yieldTokenPriceUSD
    .div(next.yieldBearingAssetPrice.minus(yieldTokenPriceUSD))
    .div(daysUntilExpiry)
    .times(DAYS_PER_YEAR_BD);

  next.impliedYield = impliedYieldPercentage;
  next.reserve0 = market.reserve0;
  next.reserve1 = market.reserve1;
  next.marketWorthUSD = await calcMarketWorthUSD(context, block, market);
  next.totalSupply = market.totalSupply;
  next.lpTokenPrice = next.marketWorthUSD.div(next.totalSupply);
  context.PairDailyData.set(next);
  return next;
}
