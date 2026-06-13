/** Port of src/mapping-treasury.ts (CvxCrvPol, CvxFpisPol, VoteMarketRewards). */
import { BigDecimal, indexer, type EvmOnEventContext } from "envio";
import { getUsdRate } from "../services/pricing";
import { BIG_DECIMAL_1E18 } from "../constants";
import { getPlatform } from "../services/platform";
import { getIntervalFromTimestamp, DAY, toBigDecimal } from "../utils";
import { getDailyRevenueSnapshot } from "../services/revenue";

async function addToRevenueSnapshot(context: EvmOnEventContext, timestamp: bigint, value: BigDecimal): Promise<void> {
  const platform = await getPlatform(context);
  const day = getIntervalFromTimestamp(timestamp, DAY);
  const revenueSnapshot = await getDailyRevenueSnapshot(context, day);

  context.DailyRevenueSnapshot.set({ ...revenueSnapshot, otherRevenue: revenueSnapshot.otherRevenue.plus(value) });
  context.Platform.set({ ...platform, totalOtherRevenue: platform.totalOtherRevenue.plus(value) });
}

// VoteMarketRewards.Claimed
const VOTE_MARKET_CLAIMER = "0x989aeb4d175e16225e39e87d0d97a3360524ad80";
indexer.onEvent({ contract: "VoteMarketRewards", event: "Claimed" }, async ({ event, context }) => {
  if (event.params.user.toLowerCase() != VOTE_MARKET_CLAIMER) {
    return;
  }
  const ec = context.effect;
  const amount = event.params.amount;
  const tokenPrice = await getUsdRate(ec, event.block.number, event.params.rewardToken.toLowerCase());
  const value = toBigDecimal(amount).div(BIG_DECIMAL_1E18).times(tokenPrice);
  await addToRevenueSnapshot(context, BigInt(event.block.timestamp), value);
});

// CvxCrvPol (TreasurySwap).ClaimedReward
indexer.onEvent({ contract: "CvxCrvPol", event: "ClaimedReward" }, async ({ event, context }) => {
  const ec = context.effect;
  const amount = event.params._amount;
  const tokenPrice = await getUsdRate(ec, event.block.number, event.params._token.toLowerCase());
  const value = toBigDecimal(amount).div(BIG_DECIMAL_1E18).times(tokenPrice);
  await addToRevenueSnapshot(context, BigInt(event.block.timestamp), value);
});

// CvxFpisPol (TreasuryManager).ClaimedReward
indexer.onEvent({ contract: "CvxFpisPol", event: "ClaimedReward" }, async ({ event, context }) => {
  const ec = context.effect;
  const amount = event.params._amount;
  const tokenPrice = await getUsdRate(ec, event.block.number, event.params._token.toLowerCase());
  const value = toBigDecimal(amount).div(BIG_DECIMAL_1E18).times(tokenPrice);
  await addToRevenueSnapshot(context, BigInt(event.block.timestamp), value);
});
