/** Port of src/mapping-bribes.ts (VotiumBribe). */
import { indexer } from "envio";
import { getPlatform } from "../services/platform";
import { getDecimals, getUsdRate } from "../services/pricing";
import { exponentToBigDecimal, getIntervalFromTimestamp, DAY, toBigDecimal } from "../utils";
import { getDailyRevenueSnapshot } from "../services/revenue";

indexer.onEvent({ contract: "VotiumBribe", event: "UpdatedFee" }, async ({ event, context }) => {
  const platform = await getPlatform(context);
  context.Platform.set({ ...platform, bribeFee: event.params._feeAmount });
});

indexer.onEvent({ contract: "VotiumBribe", event: "Bribed" }, async ({ event, context }) => {
  const ec = context.effect;
  const block = event.block.number;
  const token = event.params._token.toLowerCase();
  const bribeTokenPrice = await getUsdRate(ec, block, token);
  const decimals = await getDecimals(ec, token);
  const bribeValue = toBigDecimal(event.params._amount).div(exponentToBigDecimal(decimals)).times(bribeTokenPrice);
  const platform = await getPlatform(context);
  const day = getIntervalFromTimestamp(BigInt(event.block.timestamp), DAY);
  const revenueSnapshot = await getDailyRevenueSnapshot(context, day);

  context.DailyRevenueSnapshot.set({ ...revenueSnapshot, bribeRevenue: revenueSnapshot.bribeRevenue.plus(bribeValue) });
  context.Platform.set({ ...platform, totalBribeRevenue: platform.totalBribeRevenue.plus(bribeValue) });
});
