/**
 * Port of src/mappings/lottery.ts — Lottery handlers.
 * Deposit / Withdraw / ClaimReward(winner) / Start / EndRound / ClaimRewards /
 * RequestRandomness / FullfillRandomness. No eth_calls.
 *
 * NOTE: Deposit/Withdraw key the VaultAction & Transaction by the raw tx hash
 * (so multiple receivers in one tx aggregate), while the `transaction_id`
 * reference field uses getId (txHash.concatI32(logIndex)). Both preserved.
 */
import { indexer } from "envio";
import { LOTTERY, ZERO_BI } from "../constants";
import { concatBytes, concatI32, low } from "../utils";
import {
  createLottery,
  createLotteryRound,
  createTransaction,
  createUser,
  createUserActionCount,
} from "../services/helpers";

const LOT = low(LOTTERY);

indexer.onEvent({ contract: "Lottery", event: "Deposit" }, async ({ event, context }) => {
  let lottery = await context.Lottery.get(LOT);
  if (!lottery) lottery = createLottery(context);

  const user = await context.User.get(low(event.params.user));
  if (!user) return;
  const yieldBtc = await context.YieldBTC.get(low(event.params.rewardReceiver));
  if (!yieldBtc) return;
  const order = await context.Order.get(low(event.params.rewardReceiver));
  if (!order) return;

  let lot = { ...lottery };
  if (user.totalYeildDeposited === ZERO_BI) {
    lot.totalParticipants = lot.totalParticipants + 1n;
  }
  lot.totalYields = lot.totalYields + 1n;

  const newDeposited = user.totalYeildDeposited + 1n;

  const uacId = concatBytes(low(event.params.user), LOT);
  let uac = await context.UserActionCount.get(uacId);
  if (!uac) uac = createUserActionCount(context, low(event.params.user), LOT);

  const txKey = low(event.transaction.hash);
  const id = concatI32(event.transaction.hash, event.logIndex);
  let lotteryAction = await context.VaultAction.get(txKey);
  let transaction = await context.Transaction.get(txKey);
  if (!lotteryAction) {
    lotteryAction = {
      id: txKey,
      transaction_id: id,
      txHash: txKey,
      from_id: low(event.params.user),
      type: "Stake",
      timestamp: BigInt(event.block.timestamp),
      amount: ZERO_BI,
      btcAmount: ZERO_BI,
      receiverAmount: 0,
      round: lot.currentRound,
      toLottery_id: lot.id,
      blockNumber: BigInt(event.block.number),
      toVault_id: undefined,
      rewardAmount: undefined,
      totalCoreStaked: undefined,
    };
    lot.total += 1;
    lot.stake += 1;
    context.UserActionCount.set({ ...uac, stake: uac.stake + 1, total: uac.total + 1 });
  }

  if (!transaction) {
    transaction = createTransaction(context, txKey, event.block.number, event.block.timestamp, low(event.params.user), LOT, "Lottery", "Stake", ZERO_BI, event.transaction.hash);
    transaction = { ...transaction, round: lot.currentRound };
  }

  lotteryAction = {
    ...lotteryAction,
    btcAmount: (lotteryAction.btcAmount ?? ZERO_BI) + order.btcAmount,
    receiverAmount: (lotteryAction.receiverAmount ?? 0) + 1,
  };
  context.VaultAction.set(lotteryAction);

  context.Transaction.set({
    ...transaction,
    amount: transaction.amount + order.btcAmount,
    receiverAmount: (transaction.receiverAmount ?? 0) + 1,
  });

  context.YieldBTC.set({ ...yieldBtc, isDeposited: true });
  context.User.set({ ...user, totalYeildDeposited: newDeposited });
  context.Lottery.set(lot);
});

indexer.onEvent({ contract: "Lottery", event: "Withdraw" }, async ({ event, context }) => {
  const lottery = await context.Lottery.get(LOT);
  if (!lottery) return;
  const user = await context.User.get(low(event.params.user));
  if (!user) return;
  const order = await context.Order.get(low(event.params.rewardReceiver));
  if (!order) return;
  const yieldBtc = await context.YieldBTC.get(low(event.params.rewardReceiver));
  if (!yieldBtc) return;

  let lot = { ...lottery };
  const newDeposited = user.totalYeildDeposited - 1n;
  if (newDeposited === ZERO_BI) {
    lot.totalParticipants = lot.totalParticipants - 1n;
  }
  lot.totalYields = lot.totalYields - 1n;

  const uacId = concatBytes(low(event.params.user), LOT);
  let uac = await context.UserActionCount.get(uacId);
  if (!uac) return;

  const txKey = low(event.transaction.hash);
  const id = concatI32(event.transaction.hash, event.logIndex);
  let lotteryAction = await context.VaultAction.get(txKey);
  if (!lotteryAction) {
    lotteryAction = {
      id: txKey,
      transaction_id: id,
      txHash: txKey,
      from_id: low(event.params.user),
      type: "Withdraw",
      timestamp: BigInt(event.block.timestamp),
      amount: ZERO_BI,
      btcAmount: ZERO_BI,
      receiverAmount: 0,
      round: lot.currentRound,
      toLottery_id: lot.id,
      blockNumber: BigInt(event.block.number),
      toVault_id: undefined,
      rewardAmount: undefined,
      totalCoreStaked: undefined,
    };
    lot.total += 1;
    lot.withdraw += 1;
    context.UserActionCount.set({ ...uac, withdraw: uac.withdraw + 1, total: uac.total + 1 });
  }

  let transaction = await context.Transaction.get(txKey);
  if (!transaction) {
    transaction = createTransaction(context, txKey, event.block.number, event.block.timestamp, low(event.params.user), LOT, "Lottery", "Withdraw", ZERO_BI, event.transaction.hash);
  }

  lotteryAction = {
    ...lotteryAction,
    receiverAmount: (lotteryAction.receiverAmount ?? 0) + 1,
    btcAmount: (lotteryAction.btcAmount ?? ZERO_BI) + order.btcAmount,
  };
  context.VaultAction.set(lotteryAction);

  context.Transaction.set({
    ...transaction,
    amount: transaction.amount + order.btcAmount,
    receiverAmount: (transaction.receiverAmount ?? 0) + 1,
  });

  context.YieldBTC.set({ ...yieldBtc, isDeposited: false });
  context.User.set({ ...user, totalYeildDeposited: newDeposited });
  context.Lottery.set(lot);
});

indexer.onEvent({ contract: "Lottery", event: "ClaimReward" }, async ({ event, context }) => {
  const lottery = await context.Lottery.get(LOT);
  if (!lottery) return;

  const uacId = concatBytes(low(event.params.user), LOT);
  const uac = await context.UserActionCount.get(uacId);
  if (!uac) return;

  const txKey = low(event.transaction.hash);
  const id = concatI32(event.transaction.hash, event.logIndex);
  const transaction = createTransaction(context, id, event.block.number, event.block.timestamp, low(event.params.user), LOT, "Lottery", "ClaimReward", ZERO_BI, event.transaction.hash);

  context.VaultAction.set({
    id: txKey,
    transaction_id: id,
    txHash: txKey,
    from_id: low(event.params.user),
    type: "ClaimReward",
    timestamp: BigInt(event.block.timestamp),
    amount: event.params.amount,
    round: lottery.currentRound,
    toLottery_id: lottery.id,
    btcAmount: ZERO_BI,
    receiverAmount: 0,
    blockNumber: BigInt(event.block.number),
    toVault_id: undefined,
    rewardAmount: undefined,
    totalCoreStaked: undefined,
  });

  context.Transaction.set({ ...transaction, rewardAmount: event.params.amount });

  context.Lottery.set({ ...lottery, total: lottery.total + 1, claim: lottery.claim + 1 });
  context.UserActionCount.set({ ...uac, claim: uac.claim + 1, total: uac.total + 1 });
});

indexer.onEvent({ contract: "Lottery", event: "Start" }, async ({ event, context }) => {
  const lottery = await context.Lottery.get(LOT);
  if (!lottery) return;

  const from = low(event.transaction.from ?? "");
  let user = await context.User.get(from);
  if (!user) user = await createUser(context, from, event.block.timestamp);

  const txKey = low(event.transaction.hash);
  const id = concatI32(event.transaction.hash, event.logIndex);
  createTransaction(context, id, event.block.number, event.block.timestamp, from, LOT, "Lottery", "StartRound", ZERO_BI, event.transaction.hash);

  context.VaultAction.set({
    id: txKey,
    transaction_id: id,
    txHash: txKey,
    from_id: from,
    type: "StartRound",
    timestamp: BigInt(event.block.timestamp),
    amount: ZERO_BI,
    round: lottery.currentRound,
    toLottery_id: lottery.id,
    btcAmount: ZERO_BI,
    receiverAmount: 0,
    blockNumber: BigInt(event.block.number),
    toVault_id: undefined,
    rewardAmount: undefined,
    totalCoreStaked: undefined,
  });

  const lotteryRound = createLotteryRound(context, event.params.startTimestamp, event.params.round);
  context.LotteryRound.set({ ...lotteryRound, timestamp: BigInt(event.block.timestamp) });

  let currentRound = lottery.currentRound;
  if (currentRound < event.params.round) {
    currentRound = currentRound + 1n;
  }
  context.Lottery.set({ ...lottery, currentRound, startRound: lottery.startRound + 1 });
});

indexer.onEvent({ contract: "Lottery", event: "EndRound" }, async ({ event, context }) => {
  const lottery = await context.Lottery.get(LOT);
  if (!lottery) return;

  const from = low(event.transaction.from ?? "");
  let user = await context.User.get(from);
  if (!user) user = await createUser(context, from, event.block.timestamp);

  const txKey = low(event.transaction.hash);
  const id = concatI32(event.transaction.hash, event.logIndex);
  createTransaction(context, id, event.block.number, event.block.timestamp, from, LOT, "Lottery", "EndRound", ZERO_BI, event.transaction.hash);

  context.VaultAction.set({
    id: txKey,
    transaction_id: id,
    txHash: txKey,
    from_id: from,
    type: "EndRound",
    timestamp: BigInt(event.block.timestamp),
    amount: ZERO_BI,
    round: lottery.currentRound,
    toLottery_id: lottery.id,
    btcAmount: ZERO_BI,
    receiverAmount: 0,
    blockNumber: BigInt(event.block.number),
    toVault_id: undefined,
    rewardAmount: undefined,
    totalCoreStaked: undefined,
  });

  let lot = { ...lottery, total: lottery.total + 1, endRound: lottery.endRound + 1 };

  const round = lot.currentRound;
  const lotteryRound = await context.LotteryRound.get(round.toString());
  if (!lotteryRound) {
    context.Lottery.set(lot);
    return;
  }

  const winners = [...lotteryRound.winners];
  for (let i = 0; i < event.params.winners.length; i++) {
    winners.push(low(event.params.winners[i]!));
  }

  lot = {
    ...lot,
    totalReward: lot.totalReward + event.params.reward,
    totalFee: lot.totalFee + event.params.feeAmount,
  };

  context.LotteryRound.set({
    ...lotteryRound,
    endTime: BigInt(event.block.timestamp),
    winners,
    totalParticipants: lot.totalParticipants,
    totalYields: lot.totalYields,
    rewardAmount: event.params.reward,
    feeAmount: event.params.feeAmount,
    endRoundTx: txKey,
  });
  context.Lottery.set(lot);
});

indexer.onEvent({ contract: "Lottery", event: "ClaimRewards" }, async ({ event, context }) => {
  const lottery = await context.Lottery.get(LOT);
  if (!lottery) return;
  const lotteryRound = await context.LotteryRound.get(lottery.currentRound.toString());
  if (!lotteryRound) return;
  let rewardAmount = lotteryRound.rewardAmount;
  for (let i = 0; i < event.params.amounts.length; i++) {
    rewardAmount = rewardAmount + event.params.amounts[i]!;
  }
  context.LotteryRound.set({ ...lotteryRound, rewardAmount });
});

indexer.onEvent({ contract: "Lottery", event: "RequestRandomness" }, async ({ event, context }) => {
  const lottery = await context.Lottery.get(LOT);
  if (!lottery) return;

  const from = low(event.transaction.from ?? "");
  let user = await context.User.get(from);
  if (!user) user = await createUser(context, from, event.block.timestamp);

  const round = lottery.currentRound;
  const lotteryRound = await context.LotteryRound.get(round.toString());
  if (!lotteryRound) return;
  context.LotteryRound.set({ ...lotteryRound, randomnessId: low(event.params.randomnessId) });

  const txKey = low(event.transaction.hash);
  const id = concatI32(event.transaction.hash, event.logIndex);
  createTransaction(context, id, event.block.number, event.block.timestamp, from, LOT, "Lottery", "RequestRandomness", ZERO_BI, event.transaction.hash);

  context.VaultAction.set({
    id: txKey,
    transaction_id: id,
    txHash: txKey,
    from_id: from,
    type: "RequestRandomness",
    timestamp: BigInt(event.block.timestamp),
    amount: ZERO_BI,
    round: lottery.currentRound,
    toLottery_id: lottery.id,
    btcAmount: ZERO_BI,
    receiverAmount: 0,
    blockNumber: BigInt(event.block.number),
    toVault_id: undefined,
    rewardAmount: undefined,
    totalCoreStaked: undefined,
  });

  context.Lottery.set({ ...lottery, total: lottery.total + 1, requestRandomness: lottery.requestRandomness + 1 });
});

indexer.onEvent({ contract: "Lottery", event: "FullfillRandomness" }, async ({ event, context }) => {
  const lottery = await context.Lottery.get(LOT);
  if (!lottery) return;

  const from = low(event.transaction.from ?? "");
  let user = await context.User.get(from);
  if (!user) user = await createUser(context, from, event.block.timestamp);

  const txKey = low(event.transaction.hash);
  const id = concatI32(event.transaction.hash, event.logIndex);
  createTransaction(context, id, event.block.number, event.block.timestamp, from, LOT, "Lottery", "FullfillRandomness", ZERO_BI, event.transaction.hash);

  context.VaultAction.set({
    id: txKey,
    transaction_id: id,
    txHash: txKey,
    from_id: from,
    type: "FullfillRandomness",
    timestamp: BigInt(event.block.timestamp),
    amount: ZERO_BI,
    round: lottery.currentRound,
    toLottery_id: lottery.id,
    btcAmount: ZERO_BI,
    receiverAmount: 0,
    blockNumber: BigInt(event.block.number),
    toVault_id: undefined,
    rewardAmount: undefined,
    totalCoreStaked: undefined,
  });

  context.Lottery.set({ ...lottery, total: lottery.total + 1, fullfillRandomness: lottery.fullfillRandomness + 1 });
});
