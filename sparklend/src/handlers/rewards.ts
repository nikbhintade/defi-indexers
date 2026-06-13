/**
 * Port of src/mapping/incentives-controller/v3.ts (RewardsController, static).
 */
import { indexer } from "envio";
import type { RewardsController } from "envio";
import { low } from "../common/constants";
import type { Ctx } from "../common/types";
import { getHistoryEntityId } from "../common/ids";
import { getOrInitUser } from "../mappingHelpers/initializers";
import {
  tryGetRewardOracle,
  tryRewardAssetDecimals,
  trySymbol,
  tryDecimals,
} from "../effects/contracts";

async function getOrInitController(context: Ctx, address: string): Promise<RewardsController> {
  const id = low(address);
  let c = await context.RewardsController.get(id);
  if (!c) {
    c = { id };
    context.RewardsController.set(c);
  }
  return c;
}

indexer.onEvent(
  { contract: "RewardsController", event: "EmissionManagerUpdated" },
  async ({ event, context }) => {
    await getOrInitController(context, event.srcAddress);
  },
);

indexer.onEvent(
  { contract: "RewardsController", event: "AssetConfigUpdated" },
  async ({ event, context }) => {
    const blockTimestamp = event.block.timestamp;
    const asset = low(event.params.asset);
    const reward = low(event.params.reward);
    const controller = low(event.srcAddress);
    await getOrInitController(context, controller);

    const rewardIncentiveId = controller + ":" + asset + ":" + reward;
    let rewardIncentive = await context.Reward.get(rewardIncentiveId);
    if (!rewardIncentive) {
      const decimals = (await tryDecimals(context.effect, reward)) ?? 0;
      const symbol = (await trySymbol(context.effect, reward)) ?? "";
      const precision = (await tryRewardAssetDecimals(context.effect, controller, asset)) ?? 0;

      // reward oracle
      let oracle = await context.RewardFeedOracle.get(reward);
      if (!oracle) {
        const rewardOracle = (await tryGetRewardOracle(context.effect, controller, reward)) ?? low("0x0000000000000000000000000000000000000000");
        oracle = {
          id: reward,
          rewardFeedAddress: low(rewardOracle),
          createdAt: blockTimestamp,
          updatedAt: blockTimestamp,
        };
        context.RewardFeedOracle.set(oracle);
      }

      rewardIncentive = {
        id: rewardIncentiveId,
        rewardToken: reward,
        asset_id: asset,
        rewardsController_id: controller,
        rewardTokenDecimals: decimals,
        rewardTokenSymbol: symbol,
        precision,
        rewardFeedOracle_id: oracle.id,
        createdAt: blockTimestamp,
        // fields set below
        index: 0n,
        distributionEnd: 0,
        emissionsPerSecond: 0n,
        updatedAt: blockTimestamp,
      };
    }

    context.Reward.set({
      ...rewardIncentive,
      index: event.params.assetIndex,
      distributionEnd: Number(event.params.newDistributionEnd),
      emissionsPerSecond: event.params.newEmission,
      updatedAt: blockTimestamp,
    });
  },
);

indexer.onEvent({ contract: "RewardsController", event: "Accrued" }, async ({ event, context }) => {
  const userAddress = low(event.params.user);
  const amount = event.params.rewardsAccrued;
  const asset = low(event.params.asset);
  const reward = low(event.params.reward);
  const controller = low(event.srcAddress);
  const blockTimestamp = event.block.timestamp;

  const user = await getOrInitUser(context, userAddress);
  context.User.set({
    ...user,
    unclaimedRewards: user.unclaimedRewards + amount,
    lifetimeRewards: user.lifetimeRewards + amount,
    rewardsLastUpdated: blockTimestamp,
  });

  const rewardId = controller + ":" + asset + ":" + reward;
  const rewardIncentive = await context.Reward.get(rewardId);
  if (rewardIncentive) {
    context.Reward.set({
      ...rewardIncentive,
      index: event.params.assetIndex,
      updatedAt: blockTimestamp,
    });
  }

  const userRewardsId = rewardId + ":" + userAddress;
  const existing = await context.UserReward.get(userRewardsId);
  context.UserReward.set({
    id: userRewardsId,
    reward_id: rewardId,
    createdAt: existing?.createdAt ?? blockTimestamp,
    user_id: userAddress,
    index: event.params.userIndex,
    updatedAt: blockTimestamp,
  });

  context.RewardedAction.set({
    id: getHistoryEntityId(event),
    rewardsController_id: controller,
    user_id: userAddress,
    amount,
  });
});

indexer.onEvent(
  { contract: "RewardsController", event: "RewardsClaimed" },
  async ({ event, context }) => {
    const caller = event.params.claimer;
    const onBehalfOf = event.params.user;
    const to = event.params.to;
    const amount = event.params.amount;

    const user = await getOrInitUser(context, onBehalfOf);
    context.User.set({
      ...user,
      unclaimedRewards: user.unclaimedRewards - amount,
      rewardsLastUpdated: event.block.timestamp,
    });
    await getOrInitUser(context, to);
    await getOrInitUser(context, caller);

    context.ClaimRewardsCall.set({
      id: getHistoryEntityId(event),
      rewardsController_id: low(event.srcAddress),
      user_id: low(onBehalfOf),
      amount,
      to_id: low(to),
      caller_id: low(caller),
      txHash: event.transaction.hash.toLowerCase(),
      action: "ClaimRewardsCall",
      timestamp: event.block.timestamp,
    });
  },
);

indexer.onEvent(
  { contract: "RewardsController", event: "RewardOracleUpdated" },
  async ({ event, context }) => {
    const reward = low(event.params.reward);
    const blockTimestamp = event.block.timestamp;
    const existing = await context.RewardFeedOracle.get(reward);
    context.RewardFeedOracle.set({
      id: reward,
      rewardFeedAddress: low(event.params.rewardOracle),
      createdAt: existing?.createdAt ?? blockTimestamp,
      updatedAt: blockTimestamp,
    });
  },
);
