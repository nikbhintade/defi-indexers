/**
 * Port of src/mappings/fairShare.ts — FairShareOrder reward handlers:
 * WithdrawCoreReward / UnbondReward / ClaimReward. No eth_calls.
 */
import { indexer } from "envio";
import { B14G_ID, FAIR_SHARE_ORDER, ZERO_BI } from "../constants";
import { concatI32, low } from "../utils";
import {
  createTransaction,
  createUser,
  createVault,
} from "../services/helpers";

const FS = low(FAIR_SHARE_ORDER);

indexer.onEvent({ contract: "FairShare", event: "WithdrawCoreReward" }, async ({ event, context }) => {
  const id = concatI32(event.transaction.hash, event.logIndex);
  const user = low(event.params.user);

  let fairShareVault = await context.Vault.get(FS);
  if (!fairShareVault) fairShareVault = createVault(context, FAIR_SHARE_ORDER);

  let u = await context.User.get(user);
  if (!u) await createUser(context, user, event.block.timestamp);

  const stats = await context.Stats.get(B14G_ID);
  if (!stats) return;

  createTransaction(context, id, event.block.number, event.block.timestamp, user, FS, "FairShare", "Withdraw", event.params.amount, event.transaction.hash);

  context.VaultAction.set({
    id,
    transaction_id: id,
    blockNumber: BigInt(event.block.number),
    timestamp: BigInt(event.block.timestamp),
    txHash: low(event.transaction.hash),
    type: "Withdraw",
    from_id: user,
    amount: event.params.amount,
    rewardAmount: event.params.amount,
    toVault_id: FS,
    totalCoreStaked: stats.totalCoreStaked,
    toLottery_id: undefined,
    receiverAmount: undefined,
    btcAmount: undefined,
    round: undefined,
  });

  context.Vault.set({ ...fairShareVault, withdraw: fairShareVault.withdraw + 1, total: fairShareVault.total + 1 });

  const fsac = await context.FairShareActionCount.get(user);
  if (!fsac) {
    context.FairShareActionCount.set({
      id: user,
      user_id: user,
      total: 0,
      withdrawCore: 0,
      claimDualCore: 0,
      unbond: 0,
    });
    return;
  }
  context.FairShareActionCount.set({
    ...fsac,
    total: fsac.total + 1,
    withdrawCore: (fsac.withdrawCore ?? 0) + 1,
  });
});

indexer.onEvent({ contract: "FairShare", event: "UnbondReward" }, async ({ event, context }) => {
  const id = concatI32(event.transaction.hash, event.logIndex);
  const user = low(event.params.user);

  let fairShareVault = await context.Vault.get(FS);
  if (!fairShareVault) fairShareVault = createVault(context, FAIR_SHARE_ORDER);

  let u = await context.User.get(user);
  if (!u) await createUser(context, user, event.block.timestamp);

  const stats = await context.Stats.get(B14G_ID);
  if (!stats) return;

  const transaction = createTransaction(context, id, event.block.number, event.block.timestamp, user, FS, "FairShare", "Redeem", event.params.core, event.transaction.hash);
  context.Transaction.set({ ...transaction, rewardAmount: event.params.dualCore });

  context.VaultAction.set({
    id,
    transaction_id: id,
    blockNumber: BigInt(event.block.number),
    timestamp: BigInt(event.block.timestamp),
    txHash: low(event.transaction.hash),
    type: "Redeem",
    from_id: user,
    amount: event.params.core,
    rewardAmount: event.params.dualCore,
    toVault_id: FS,
    totalCoreStaked: stats.totalCoreStaked,
    toLottery_id: undefined,
    receiverAmount: undefined,
    btcAmount: undefined,
    round: undefined,
  });

  context.Vault.set({ ...fairShareVault, unbond: fairShareVault.unbond + 1, total: fairShareVault.total + 1 });

  const fsac = await context.FairShareActionCount.get(user);
  if (!fsac) {
    context.FairShareActionCount.set({
      id: user,
      user_id: user,
      total: 0,
      withdrawCore: 0,
      claimDualCore: 0,
      unbond: 0,
    });
    return;
  }
  context.FairShareActionCount.set({ ...fsac, total: fsac.total + 1, unbond: fsac.unbond + 1 });
});

indexer.onEvent({ contract: "FairShare", event: "ClaimReward" }, async ({ event, context }) => {
  const id = concatI32(event.transaction.hash, event.logIndex);
  const user = low(event.params.user);

  let fairShareVault = await context.Vault.get(FS);
  if (!fairShareVault) fairShareVault = createVault(context, FAIR_SHARE_ORDER);

  let u = await context.User.get(user);
  if (!u) await createUser(context, user, event.block.timestamp);

  const stats = await context.Stats.get(B14G_ID);
  if (!stats) return;

  const transaction = createTransaction(context, id, event.block.number, event.block.timestamp, user, FS, "FairShare", "ClaimReward", event.params.dualCore, event.transaction.hash);
  context.Transaction.set({ ...transaction, rewardAmount: event.params.dualCore });

  context.VaultAction.set({
    id,
    transaction_id: id,
    blockNumber: BigInt(event.block.number),
    timestamp: BigInt(event.block.timestamp),
    txHash: low(event.transaction.hash),
    type: "ClaimReward",
    from_id: user,
    amount: event.params.dualCore,
    rewardAmount: event.params.dualCore,
    toVault_id: FS,
    totalCoreStaked: stats.totalCoreStaked,
    toLottery_id: undefined,
    receiverAmount: undefined,
    btcAmount: undefined,
    round: undefined,
  });

  context.Vault.set({ ...fairShareVault, redeemInstantly: fairShareVault.redeemInstantly + 1, total: fairShareVault.total + 1 });

  const fsac = await context.FairShareActionCount.get(user);
  if (!fsac) {
    context.FairShareActionCount.set({
      id: user,
      user_id: user,
      total: 1,
      withdrawCore: 0,
      claimDualCore: 1,
      unbond: 0,
    });
    return;
  }
  context.FairShareActionCount.set({ ...fsac, total: fsac.total + 1, claimDualCore: fsac.claimDualCore + 1 });
});
