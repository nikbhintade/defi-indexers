/**
 * Port of src/mapping-rewards.ts (PoolCrvRewards template).
 *
 * DEVIATION: the subgraph used a `queueNewRewards(uint256)` callHandler on the
 * BaseRewardPool template. HyperIndex is event-only, so we hook the
 * `RewardAdded(uint256 reward)` event the same contract emits — `reward`
 * equals the call's `_rewards`, and the reward pool address (`call.to`) equals
 * `event.srcAddress`.
 *
 * The subgraph read the pid from the template's DataSourceContext (set at
 * createWithContext time). We instead resolve it from the Pool whose
 * `crvRewardsPool` matches the emitting address (`@index` on that field).
 */
import { indexer } from "envio";
import { updateDailyRevenueSnapshotForCrv } from "../services/revenue";

indexer.onEvent({ contract: "BaseRewardPool", event: "RewardAdded" }, async ({ event, context }) => {
  const ec = context.effect;
  const contract = event.srcAddress.toLowerCase();

  // resolve pid via the pool whose crvRewardsPool == this reward contract
  const pools = await context.Pool.getWhere({ crvRewardsPool: { _eq: contract } });
  // the subgraph stored ctx pid even if the pool wasn't found yet; mirror by
  // using the matched pool's id (the pid string) when present, else skip the
  // PoolReward (no pid known) but still record revenue like the original.
  const pid = pools.length > 0 ? pools[0]!.poolid.toString() : undefined;

  if (pid !== undefined) {
    context.PoolReward.set({
      id: event.transaction.hash + "-" + contract,
      poolid_id: pid,
      crvRewards: event.params.reward,
      timestamp: BigInt(event.block.timestamp),
      contract,
    });
  }

  await updateDailyRevenueSnapshotForCrv(context, ec, event.block.number, event.params.reward, BigInt(event.block.timestamp));
});
