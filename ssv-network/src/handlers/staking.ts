/** Ported from ssv-subgraph src/handlers/staking.ts (commit e2f1aa0). */
import { indexer } from "envio";
import {
  buildEventEntityId,
  loadOrCreateAccount,
  low,
  stamp,
  type HandlerContext,
} from "../helpers";

indexer.onEvent(
  { contract: "SSVNetwork", event: "ERC20Rescued" },
  async ({ event, context }) => {
    context.ERC20Rescued.set({
      id: buildEventEntityId(event.transaction.hash, event.logIndex),
      token: low(event.params.token),
      to: low(event.params.to),
      amount: event.params.amount,
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
    });
  },
);

indexer.onEvent(
  { contract: "SSVNetwork", event: "FeesSynced" },
  async ({ event, context }) => {
    context.FeesSynced.set({
      id: buildEventEntityId(event.transaction.hash, event.logIndex),
      newFeesWei: event.params.newFeesWei,
      accEthPerShare: event.params.accEthPerShare,
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
    });

    const dao = await context.DAOValues.get(low(event.srcAddress));
    if (!dao) return;
    context.DAOValues.set({
      ...dao,
      updateType: "FEES_SYNCED",
      accEthPerShare: event.params.accEthPerShare,
      newFeesWei: event.params.newFeesWei,
      ...stamp(event.block.number, event.block.timestamp, event.transaction.hash),
    });
  },
);

indexer.onEvent(
  { contract: "SSVNetwork", event: "NetworkEarningsWithdrawn" },
  async ({ event, context }) => {
    context.NetworkEarningsWithdrawn.set({
      id: buildEventEntityId(event.transaction.hash, event.logIndex),
      value: event.params.value,
      recipient: low(event.params.recipient),
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
    });
  },
);

indexer.onEvent(
  { contract: "SSVNetwork", event: "RewardsClaimed" },
  async ({ event, context }) => {
    context.RewardsClaimed.set({
      id: buildEventEntityId(event.transaction.hash, event.logIndex),
      user: low(event.params.user),
      amount: event.params.amount,
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
    });
  },
);

indexer.onEvent(
  { contract: "SSVNetwork", event: "RewardsSettled" },
  async ({ event, context }) => {
    context.RewardsSettled.set({
      id: buildEventEntityId(event.transaction.hash, event.logIndex),
      user: low(event.params.user),
      accrued: event.params.accrued,
      pending: event.params.pending,
      userIndex: event.params.userIndex,
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
    });
  },
);

async function loadRequiredStakingAccount(
  context: HandlerContext,
  user: string,
) {
  return context.Account.get(low(user));
}

indexer.onEvent(
  { contract: "SSVNetwork", event: "Staked" },
  async ({ event, context }) => {
    context.Staked.set({
      id: buildEventEntityId(event.transaction.hash, event.logIndex),
      user: low(event.params.user),
      amount: event.params.amount,
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
    });

    const user = await loadOrCreateAccount(context, event.params.user);
    context.Account.set({
      ...user,
      stakedAmount: user.stakedAmount + event.params.amount,
    });
  },
);

indexer.onEvent(
  { contract: "SSVNetwork", event: "UnstakeRequested" },
  async ({ event, context }) => {
    context.UnstakeRequested.set({
      id: buildEventEntityId(event.transaction.hash, event.logIndex),
      user: low(event.params.user),
      amount: event.params.amount,
      unlockTime: event.params.unlockTime,
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
    });

    const user = await loadRequiredStakingAccount(context, event.params.user);
    if (!user) return;
    context.Account.set({
      ...user,
      unstakePendingAmount: user.unstakePendingAmount + event.params.amount,
      stakedAmount: user.stakedAmount - event.params.amount,
    });
  },
);

indexer.onEvent(
  { contract: "SSVNetwork", event: "UnstakedWithdrawn" },
  async ({ event, context }) => {
    context.UnstakedWithdrawn.set({
      id: buildEventEntityId(event.transaction.hash, event.logIndex),
      user: low(event.params.user),
      amount: event.params.amount,
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
    });

    const user = await loadRequiredStakingAccount(context, event.params.user);
    if (!user) return;
    context.Account.set({
      ...user,
      unstakePendingAmount: user.unstakePendingAmount - event.params.amount,
    });
  },
);
