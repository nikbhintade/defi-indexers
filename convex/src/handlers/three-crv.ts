/** Port of src/mapping-3crv.ts (ThreeCrvRewards = LOCK_FEES VirtualBalanceRewardPool). */
import { indexer } from "envio";
import { getUsdRate } from "../services/pricing";
import { BIG_DECIMAL_1E18, THREE_CRV_ADDRESS } from "../constants";
import { getPlatform } from "../services/platform";
import { getIntervalFromTimestamp, DAY, toBigDecimal } from "../utils";
import { getDailyRevenueSnapshot } from "../services/revenue";

indexer.onEvent({ contract: "ThreeCrvRewards", event: "RewardAdded" }, async ({ event, context }) => {
  const ec = context.effect;
  const block = event.block.number;
  const amount = event.params.reward;
  const threeCrvPrice = await getUsdRate(ec, block, THREE_CRV_ADDRESS);
  const value = toBigDecimal(amount).div(BIG_DECIMAL_1E18).times(threeCrvPrice);

  const platform = await getPlatform(context);
  const day = getIntervalFromTimestamp(BigInt(event.block.timestamp), DAY);
  const revenueSnapshot = await getDailyRevenueSnapshot(context, day);

  context.DailyRevenueSnapshot.set({
    ...revenueSnapshot,
    threeCrvRevenueToCvxCrvStakersAmount: revenueSnapshot.threeCrvRevenueToCvxCrvStakersAmount.plus(value),
  });
  context.Platform.set({
    ...platform,
    totalThreeCrvRevenueToCvxCrvStakers: platform.totalThreeCrvRevenueToCvxCrvStakers.plus(value),
  });
});
