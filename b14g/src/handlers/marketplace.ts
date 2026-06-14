/**
 * Port of src/mappings/marketplace.ts — Marketplace (dualCORE restaking
 * marketplace) handlers: order creation, user stake/withdraw, claim, fee update.
 *
 * eth_calls (block-pinned, via Effects):
 *  - handleNewOrder: Marketplace.fee()
 *  - handleNewOrder (FairShare path): FairShareOrder.getOwnerOfReceiver(receiver)
 */
import { indexer } from "envio";
import {
  ADDRESS_ZERO,
  B14G_ID,
  FAIR_SHARE_ORDER,
  LOTTERY,
  MARKETPLACE,
  ORDER_ACTION,
  ZERO_BI,
} from "../constants";
import { concatBytes, concatI32, low } from "../utils";
import {
  createTransaction,
  createUser,
  handleOrderAction,
} from "../services/helpers";
import { getOwnerOfReceiver, marketplaceFee } from "../effects/contracts";

const MKP = low(MARKETPLACE);

indexer.onEvent({ contract: "Marketplace", event: "CreateRewardReceiver" }, async ({ event, context }) => {
  const id = concatI32(event.transaction.hash, event.logIndex);
  const eventFrom = low(event.params.from);
  const receiver = low(event.params.rewardReceiver);
  let from = eventFrom;
  if (eventFrom === low(FAIR_SHARE_ORDER)) {
    const owner = await getOwnerOfReceiver(context.effect, eventFrom, receiver, event.block.number);
    if (owner) from = low(owner);
  }

  // ensure Stats exists (original seeds it here)
  let stats = await context.Stats.get(B14G_ID);
  if (!stats) {
    stats = {
      id: B14G_ID,
      totalStaker: 0,
      totalCoreStaked: ZERO_BI,
      totalDualCore: ZERO_BI,
      totalEarned: ZERO_BI,
      vaultMaxCap: ZERO_BI,
      marketplaceFee: undefined,
    };
    context.Stats.set(stats);
  }

  context.OrderAction.set({
    id,
    transaction_id: id,
    blockNumber: BigInt(event.block.number),
    timestamp: BigInt(event.block.timestamp),
    txHash: low(event.transaction.hash),
    type: "CreateOrder",
    from_id: from,
    order_id: receiver,
    amount: undefined,
    totalCoreStaked: stats.totalCoreStaked,
  });

  let user = await context.User.get(from);
  if (!user) await createUser(context, from, event.block.timestamp);
  user = await context.User.get(eventFrom);
  if (!user) await createUser(context, eventFrom, event.block.timestamp);

  const fee = (await marketplaceFee(context.effect, MKP, event.block.number)) ?? ZERO_BI;

  const isFairShare = from !== eventFrom;
  const toType = isFairShare ? "FairShare" : "MergeMarketplace";

  createTransaction(context, id, event.block.number, event.block.timestamp, from, receiver, toType, "CreateOrder", ZERO_BI, event.transaction.hash);

  context.Order.set({
    id: receiver,
    owner: eventFrom,
    user_id: from,
    createdAt: BigInt(event.block.timestamp),
    createdAtBlock: BigInt(event.block.number),
    coreEarned: ZERO_BI,
    btcEarned: ZERO_BI,
    fee,
    rewardSharingPortion: event.params.portion,
    realtimeStakeAmount: ZERO_BI,
    realtimeTier: ZERO_BI,
    bitcoinLockTx: ADDRESS_ZERO,
    btcAmount: ZERO_BI,
    stake: 0,
    withdraw: 0,
    claimCore: 0,
    claimBtc: 0,
    total: 1,
    type: isFairShare ? "FAIR_SHARE_ORDER" : "MERGE_ORDER",
    unlockTime: undefined,
    validator: undefined,
    confirmTimestamp: undefined,
  });
});

indexer.onEvent({ contract: "Marketplace", event: "StakeCoreProxy" }, async ({ event, context }) => {
  await stakeOrWithdraw(event, context, true);
});

indexer.onEvent({ contract: "Marketplace", event: "WithdrawProxy" }, async ({ event, context }) => {
  await stakeOrWithdraw(event, context, false);
});

// Shared body for StakeCoreProxy (handleUserStake) and WithdrawProxy
// (handleUserWithdraw). Both event payloads are (receiver, from, candidate, value).
async function stakeOrWithdraw(
  event: any,
  context: any,
  isStake: boolean,
): Promise<void> {
  const id = concatI32(event.transaction.hash, event.logIndex);
  const receiver = low(event.params.receiver);
  const fromAddr = low(event.params.from);
  const candidate = low(event.params.candidate);
  const value: bigint = event.params.value;

  createTransaction(
    context,
    id,
    event.block.number,
    event.block.timestamp,
    fromAddr,
    receiver,
    "MergeMarketplace",
    isStake ? "Stake" : "Withdraw",
    value,
    event.transaction.hash,
  );

  const totalCoreStaked = await handleOrderAction(
    context,
    value,
    receiver,
    fromAddr,
    isStake ? ORDER_ACTION.STAKE : ORDER_ACTION.WITHDRAW,
  );

  context.OrderAction.set({
    id,
    transaction_id: id,
    blockNumber: BigInt(event.block.number),
    timestamp: BigInt(event.block.timestamp),
    txHash: low(event.transaction.hash),
    type: isStake ? "StakeCoreToOrder" : "WithdrawCoreFromOrder",
    from_id: fromAddr,
    order_id: receiver,
    amount: value,
    totalCoreStaked,
  });

  if (isStake) {
    await stakeBody(event, context, receiver, fromAddr, candidate, value);
  } else {
    await withdrawBody(event, context, receiver, fromAddr, candidate, value);
  }
}

async function stakeBody(event: any, context: any, receiver: string, fromAddr: string, candidate: string, value: bigint) {
  let user = await context.User.get(fromAddr);
  if (!user) user = await createUser(context, fromAddr, event.block.timestamp);

  const oacId = concatBytes(receiver, user.id);
  let oac = await context.OrderActionCount.get(oacId);
  if (!oac) {
    oac = {
      id: oacId,
      total: 0,
      stake: 0,
      withdraw: 0,
      claimBtc: 0,
      claimCore: 0,
      user_id: user.id,
      order_id: receiver,
    };
  }
  context.User.set({ ...user, coreStakedInOrder: user.coreStakedInOrder + value });
  context.OrderActionCount.set({ ...oac, stake: oac.stake + 1, total: oac.total + 1 });

  const stakedInOrder = await context.StakedInOrder.get(concatBytes(receiver, user.id));
  const newId = concatBytes(receiver, user.id, candidate);
  if (!stakedInOrder) {
    let newStaked = await context.StakedInOrder.get(newId);
    if (!newStaked) {
      context.StakedInOrder.set({
        id: newId,
        amount: value,
        user_id: fromAddr,
        order_id: receiver,
        validator: candidate,
      });
    } else {
      context.StakedInOrder.set({ ...newStaked, amount: newStaked.amount + value });
    }
  } else {
    const order = await context.Order.get(receiver);
    const validator = order?.validator;
    let newStaked = await context.StakedInOrder.get(newId);
    if (!newStaked) {
      let amount = value;
      if (validator !== undefined && low(validator) === candidate) {
        amount = amount + stakedInOrder.amount;
      }
      context.StakedInOrder.set({
        id: newId,
        amount,
        user_id: fromAddr,
        order_id: receiver,
        validator: candidate,
      });
    } else {
      context.StakedInOrder.set({ ...newStaked, amount: newStaked.amount + value });
    }
    if (validator !== undefined && low(validator) !== candidate) {
      const id2 = concatBytes(receiver, user.id, validator);
      const newStaked2 = await context.StakedInOrder.get(id2);
      if (!newStaked2) {
        context.StakedInOrder.set({
          id: id2,
          amount: stakedInOrder.amount,
          user_id: fromAddr,
          order_id: receiver,
          validator: low(validator),
        });
      }
    }
    context.StakedInOrder.set({ ...stakedInOrder, amount: ZERO_BI });
  }
}

async function withdrawBody(event: any, context: any, receiver: string, fromAddr: string, candidate: string, value: bigint) {
  let user = await context.User.get(fromAddr);
  if (!user) return;

  const oacId = concatBytes(receiver, user.id);
  const oac = await context.OrderActionCount.get(oacId);
  if (!oac) return;
  context.User.set({ ...user, coreStakedInOrder: user.coreStakedInOrder - value });
  context.OrderActionCount.set({ ...oac, withdraw: oac.withdraw + 1, total: oac.total + 1 });

  const stakedInOrder = await context.StakedInOrder.get(concatBytes(receiver, user.id));
  const newId = concatBytes(receiver, user.id, candidate);
  if (stakedInOrder) {
    let newStaked = await context.StakedInOrder.get(newId);
    if (!newStaked) {
      context.StakedInOrder.set({
        id: newId,
        amount: stakedInOrder.amount - value,
        user_id: fromAddr,
        order_id: receiver,
        validator: candidate,
      });
    } else {
      context.StakedInOrder.set({ ...newStaked, amount: newStaked.amount - value });
    }
    context.StakedInOrder.set({ ...stakedInOrder, amount: ZERO_BI });
  } else {
    const newStaked = await context.StakedInOrder.get(newId);
    if (!newStaked) return;
    context.StakedInOrder.set({ ...newStaked, amount: newStaked.amount - value });
  }
}

indexer.onEvent({ contract: "Marketplace", event: "ClaimProxy" }, async ({ event, context }) => {
  if (event.params.amount === ZERO_BI) return;
  const id = concatI32(event.transaction.hash, event.logIndex);
  const receiver = low(event.params.receiver);
  const fromAddr = low(event.params.from);
  const isBtcClaim: boolean = event.params.isBtcClaim;

  createTransaction(
    context,
    id,
    event.block.number,
    event.block.timestamp,
    fromAddr,
    receiver,
    "MergeMarketplace",
    isBtcClaim ? "ClaimCoreForBTCHolder" : "ClaimCoreForCoreHolder",
    event.params.amount,
    event.transaction.hash,
  );

  let user = await context.User.get(fromAddr);
  if (!user) user = await createUser(context, fromAddr, event.block.timestamp);

  let stats = await context.Stats.get(B14G_ID);
  if (!stats) {
    stats = {
      id: B14G_ID,
      totalStaker: 0,
      totalCoreStaked: ZERO_BI,
      totalDualCore: ZERO_BI,
      totalEarned: ZERO_BI,
      vaultMaxCap: ZERO_BI,
      marketplaceFee: undefined,
    };
  }
  context.Stats.set({ ...stats, totalEarned: stats.totalEarned + event.params.amount });

  const totalCoreStaked = await handleOrderAction(
    context,
    ZERO_BI,
    receiver,
    fromAddr,
    isBtcClaim ? ORDER_ACTION.CLAIM_BTC : ORDER_ACTION.CLAIM_CORE,
  );

  context.OrderAction.set({
    id,
    transaction_id: id,
    blockNumber: BigInt(event.block.number),
    timestamp: BigInt(event.block.timestamp),
    txHash: low(event.transaction.hash),
    type: isBtcClaim ? "ClaimCoreForBTCHolder" : "ClaimCoreForCoreHolder",
    from_id: fromAddr,
    order_id: receiver,
    amount: event.params.amount,
    totalCoreStaked,
  });

  const order = await context.Order.get(receiver);
  if (!order) return;

  const oacId = concatBytes(receiver, fromAddr);
  let oac = await context.OrderActionCount.get(oacId);
  if (!oac) {
    oac = {
      id: oacId,
      total: 0,
      stake: 0,
      withdraw: 0,
      claimBtc: 0,
      claimCore: 0,
      user_id: fromAddr,
      order_id: receiver,
    };
  }

  if (isBtcClaim) {
    context.Order.set({ ...order, btcEarned: order.btcEarned + event.params.amount });
    context.OrderActionCount.set({ ...oac, claimBtc: oac.claimBtc + 1, total: oac.total + 1 });
    // PARITY: the original mutates yieldBtc.roundReward/updatedRound here but
    // never calls yieldBtc.save(), so the change is discarded in graph-node.
    // We deliberately do NOT persist it to match the subgraph (see MIGRATION.md).
    const yieldBtc = await context.YieldBTC.get(receiver);
    const lottery = await context.Lottery.get(low(LOTTERY));
    void yieldBtc;
    void lottery;
  } else {
    context.Order.set({ ...order, coreEarned: order.coreEarned + event.params.amount });
    context.OrderActionCount.set({ ...oac, claimCore: oac.claimCore + 1, total: oac.total + 1 });
  }
});

indexer.onEvent({ contract: "Marketplace", event: "FeeUpdated" }, async ({ event, context }) => {
  const stats = await context.Stats.get(B14G_ID);
  if (!stats) return;
  context.Stats.set({ ...stats, marketplaceFee: event.params.newFee });
});
