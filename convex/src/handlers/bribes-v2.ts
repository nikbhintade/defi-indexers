/** Port of src/mapping-bribes-v2.ts (VotiumBribeV2). */
import { indexer } from "envio";
import { getPlatform } from "../services/platform";
import { getDecimals, getUsdRate } from "../services/pricing";
import { exponentToBigDecimal, getIntervalFromTimestamp, DAY, WEEK, toBigDecimal } from "../utils";
import { getDailyRevenueSnapshot } from "../services/revenue";

export function getCurrentRound(timestamp: bigint): bigint {
  const BASE = BigInt(1348 * 86400 * 14);
  const week = getIntervalFromTimestamp(timestamp, WEEK);
  const round = (week - BASE) / (WEEK * 2n);
  return round;
}

indexer.onEvent({ contract: "VotiumBribeV2", event: "IncreasedIncentive" }, async ({ event, context }) => {
  const ec = context.effect;
  const block = event.block.number;
  const token = event.params._token.toLowerCase();
  const bribeTokenPrice = await getUsdRate(ec, block, token);
  const decimals = await getDecimals(ec, token);
  const bribeValue = toBigDecimal(event.params._increase).div(exponentToBigDecimal(decimals)).times(bribeTokenPrice);
  const platform = await getPlatform(context);
  const day = getIntervalFromTimestamp(BigInt(event.block.timestamp), DAY);
  const futureWeeks = event.params._round - getCurrentRound(BigInt(event.block.timestamp));
  const revenueSnapshot = await getDailyRevenueSnapshot(context, day + WEEK * futureWeeks);

  context.DailyRevenueSnapshot.set({ ...revenueSnapshot, bribeRevenue: revenueSnapshot.bribeRevenue.plus(bribeValue) });
  context.Platform.set({ ...platform, totalBribeRevenue: platform.totalBribeRevenue.plus(bribeValue) });
});

indexer.onEvent({ contract: "VotiumBribeV2", event: "NewIncentive" }, async ({ event, context }) => {
  const ec = context.effect;
  const block = event.block.number;
  const token = event.params._token.toLowerCase();
  const bribeTokenPrice = await getUsdRate(ec, block, token);
  const decimals = await getDecimals(ec, token);
  const bribeValue = toBigDecimal(event.params._amount).div(exponentToBigDecimal(decimals)).times(bribeTokenPrice);
  const platform = await getPlatform(context);
  const day = getIntervalFromTimestamp(BigInt(event.block.timestamp), DAY);
  const futureWeeks = event.params._round - getCurrentRound(BigInt(event.block.timestamp));
  const revenueSnapshot = await getDailyRevenueSnapshot(context, day + WEEK * futureWeeks);

  context.DailyRevenueSnapshot.set({ ...revenueSnapshot, bribeRevenue: revenueSnapshot.bribeRevenue.plus(bribeValue) });
  context.Platform.set({ ...platform, totalBribeRevenue: platform.totalBribeRevenue.plus(bribeValue) });
});

indexer.onEvent({ contract: "VotiumBribeV2", event: "UpdatedFee" }, async ({ event, context }) => {
  const platform = await getPlatform(context);
  context.Platform.set({ ...platform, bribeFee: event.params._feeAmount });
});
