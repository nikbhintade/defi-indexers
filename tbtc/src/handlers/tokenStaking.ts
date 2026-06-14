/**
 * TokenStaking data source — stake/topup/unstake/slash accounting on Operator
 * and the global StatsRecord. Faithful port of src/mappingTokenStaking.ts.
 */
import { indexer } from "envio";
import * as Utils from "../utils/utils.js";
import {
  getOrCreateOperator,
  getOrCreateOperatorEvent,
  getStats,
  lc,
} from "../utils/helper.js";

indexer.onEvent(
  { contract: "TokenStaking", event: "OwnerRefreshed" },
  async ({ event, context }) => {
    const operator = await getOrCreateOperator(context, event.params.stakingProvider);
    context.Operator.set({ ...operator, owner: lc(event.params.newOwner) });
  },
);

indexer.onEvent(
  { contract: "TokenStaking", event: "Staked" },
  async ({ event, context }) => {
    const evId = Utils.getIDFromEvent(event.transaction.hash, event.logIndex);
    const eventEntity = await getOrCreateOperatorEvent(
      context,
      evId,
      event.transaction.from ?? "",
      event.transaction.hash,
      event.transaction.to ?? undefined,
      BigInt(event.block.timestamp),
      "STAKED",
    );
    context.Event.set({ ...eventEntity, amount: event.params.amount });

    const operator = await getOrCreateOperator(context, event.params.stakingProvider);
    context.Operator.set({
      ...operator,
      stakedAmount: event.params.amount,
      beneficiary: lc(event.params.beneficiary),
      authorizer: lc(event.params.authorizer),
      owner: lc(event.params.owner),
      stakeType: Number(event.params.stakeType),
      stakedAt: BigInt(event.block.timestamp),
      events: [...operator.events, evId],
    });

    const stats = await getStats(context);
    context.StatsRecord.set({
      ...stats,
      totalStaked: stats.totalStaked + event.params.amount,
      numOperators: stats.numOperators + 1,
    });
  },
);

indexer.onEvent(
  { contract: "TokenStaking", event: "TokensSeized" },
  async ({ event, context }) => {
    const evId = Utils.getIDFromEvent(event.transaction.hash, event.logIndex);
    const eventEntity = await getOrCreateOperatorEvent(
      context,
      evId,
      event.transaction.from ?? "",
      event.transaction.hash,
      event.transaction.to ?? undefined,
      BigInt(event.block.timestamp),
      "SLASHED",
    );
    context.Event.set({ ...eventEntity, amount: event.params.amount });

    const operator = await getOrCreateOperator(context, event.params.stakingProvider);
    context.Operator.set({
      ...operator,
      stakedAmount: operator.stakedAmount - event.params.amount,
      events: [...operator.events, evId],
    });

    const stats = await getStats(context);
    context.StatsRecord.set({ ...stats, totalStaked: stats.totalStaked - event.params.amount });
  },
);

indexer.onEvent(
  { contract: "TokenStaking", event: "ToppedUp" },
  async ({ event, context }) => {
    const evId = Utils.getIDFromEvent(event.transaction.hash, event.logIndex);
    const eventEntity = await getOrCreateOperatorEvent(
      context,
      evId,
      event.transaction.from ?? "",
      event.transaction.hash,
      event.transaction.to ?? undefined,
      BigInt(event.block.timestamp),
      "TOPUP",
    );
    context.Event.set({ ...eventEntity, amount: event.params.amount });

    const operator = await getOrCreateOperator(context, event.params.stakingProvider);
    context.Operator.set({
      ...operator,
      stakedAmount: operator.stakedAmount + event.params.amount,
      events: [...operator.events, evId],
    });

    const stats = await getStats(context);
    context.StatsRecord.set({ ...stats, totalStaked: stats.totalStaked + event.params.amount });
  },
);

indexer.onEvent(
  { contract: "TokenStaking", event: "Unstaked" },
  async ({ event, context }) => {
    const evId = Utils.getIDFromEvent(event.transaction.hash, event.logIndex);
    const eventEntity = await getOrCreateOperatorEvent(
      context,
      evId,
      event.transaction.from ?? "",
      event.transaction.hash,
      event.transaction.to ?? undefined,
      BigInt(event.block.timestamp),
      "UNSTAKE",
    );
    context.Event.set({ ...eventEntity, amount: event.params.amount });

    const operator = await getOrCreateOperator(context, event.params.stakingProvider);
    context.Operator.set({
      ...operator,
      stakedAmount: operator.stakedAmount - event.params.amount,
      events: [...operator.events, evId],
    });

    const stats = await getStats(context);
    context.StatsRecord.set({ ...stats, totalStaked: stats.totalStaked - event.params.amount });
  },
);
