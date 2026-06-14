/**
 * Port of src/mappings/coreVault.ts — CoreVault (dualCORE vault) handlers.
 * Stake / WithdrawDirect / Unbond / Withdraw / ClaimReward / ReInvest.
 *
 * eth_calls (block-pinned, via Effects):
 *  - ReInvest:    coreVault.totalStaked()
 *  - ClaimReward: coreVault.exchangeCore(1e18)
 */
import { indexer } from "envio";
import { B14G_ID, DUAL_CORE_VAULT, ZERO_BI } from "../constants";
import { concatBytes, concatI32, low } from "../utils";
import {
  createTransaction,
  createUser,
  createUserActionCount,
  handleVaultAction,
} from "../services/helpers";
import { coreVaultExchangeCore, coreVaultTotalStaked } from "../effects/contracts";

const VAULT = low(DUAL_CORE_VAULT);

indexer.onEvent({ contract: "CoreVault", event: "Stake" }, async ({ event, context }) => {
  const id = concatI32(event.transaction.hash, event.logIndex);
  const user = low(event.params.user);
  createTransaction(context, id, event.block.number, event.block.timestamp, user, VAULT, "DualCoreVault", "Stake", event.params.coreAmount, event.transaction.hash);

  const totalCoreStaked = await handleVaultAction(context, event.params.coreAmount, event.params.dualCoreAmount, true, false);

  context.VaultAction.set({
    id,
    transaction_id: id,
    blockNumber: BigInt(event.block.number),
    timestamp: BigInt(event.block.timestamp),
    txHash: low(event.transaction.hash),
    type: "Stake",
    from_id: user,
    amount: event.params.coreAmount,
    toVault_id: VAULT,
    totalCoreStaked,
    rewardAmount: undefined,
    toLottery_id: undefined,
    receiverAmount: undefined,
    btcAmount: undefined,
    round: undefined,
  });

  let u = await context.User.get(user);
  if (!u) u = await createUser(context, user, event.block.timestamp);

  let uac = await context.UserActionCount.get(concatBytes(u.id, VAULT));
  if (!uac) uac = createUserActionCount(context, user, VAULT);
  context.UserActionCount.set({ ...uac, stake: uac.stake + 1, total: uac.total + 1 });
});

indexer.onEvent({ contract: "CoreVault", event: "WithdrawDirect" }, async ({ event, context }) => {
  const id = concatI32(event.transaction.hash, event.logIndex);
  const user = low(event.params.user);
  createTransaction(context, id, event.block.number, event.block.timestamp, user, VAULT, "DualCoreVault", "RedeemInstantly", event.params.coreAmount, event.transaction.hash);

  const totalCoreStaked = await handleVaultAction(context, event.params.coreAmount + event.params.fee, event.params.dualCoreAmount, false, false);

  context.VaultAction.set({
    id,
    transaction_id: id,
    blockNumber: BigInt(event.block.number),
    timestamp: BigInt(event.block.timestamp),
    txHash: low(event.transaction.hash),
    type: "RedeemInstantly",
    from_id: user,
    amount: event.params.coreAmount,
    toVault_id: VAULT,
    totalCoreStaked,
    rewardAmount: undefined,
    toLottery_id: undefined,
    receiverAmount: undefined,
    btcAmount: undefined,
    round: undefined,
  });

  const uac = await context.UserActionCount.get(concatBytes(user, VAULT));
  if (!uac) return;
  context.UserActionCount.set({ ...uac, withdrawDirect: uac.withdrawDirect + 1, total: uac.total + 1 });
});

indexer.onEvent({ contract: "CoreVault", event: "Unbond" }, async ({ event, context }) => {
  const id = concatI32(event.transaction.hash, event.logIndex);
  const user = low(event.params.user);
  createTransaction(context, id, event.block.number, event.block.timestamp, user, VAULT, "DualCoreVault", "Redeem", event.params.coreAmount, event.transaction.hash);

  const totalCoreStaked = await handleVaultAction(context, event.params.coreAmount, event.params.dualCoreAmount, false, true);

  context.VaultAction.set({
    id,
    transaction_id: id,
    blockNumber: BigInt(event.block.number),
    timestamp: BigInt(event.block.timestamp),
    txHash: low(event.transaction.hash),
    type: "Redeem",
    from_id: user,
    amount: event.params.coreAmount,
    toVault_id: VAULT,
    totalCoreStaked,
    rewardAmount: undefined,
    toLottery_id: undefined,
    receiverAmount: undefined,
    btcAmount: undefined,
    round: undefined,
  });

  const uac = await context.UserActionCount.get(concatBytes(user, VAULT));
  if (!uac) return;
  context.UserActionCount.set({ ...uac, unbond: uac.unbond + 1, total: uac.total + 1 });
});

indexer.onEvent({ contract: "CoreVault", event: "Withdraw" }, async ({ event, context }) => {
  const id = concatI32(event.transaction.hash, event.logIndex);
  const user = low(event.params.user);
  createTransaction(context, id, event.block.number, event.block.timestamp, user, VAULT, "DualCoreVault", "Withdraw", event.params.amount, event.transaction.hash);

  const stats = await context.Stats.get(B14G_ID);
  const vault = await context.Vault.get(VAULT);
  if (!stats || !vault) return;

  context.VaultAction.set({
    id,
    transaction_id: id,
    blockNumber: BigInt(event.block.number),
    timestamp: BigInt(event.block.timestamp),
    txHash: low(event.transaction.hash),
    type: "Withdraw",
    from_id: user,
    amount: event.params.amount,
    toVault_id: VAULT,
    totalCoreStaked: stats.totalCoreStaked,
    rewardAmount: undefined,
    toLottery_id: undefined,
    receiverAmount: undefined,
    btcAmount: undefined,
    round: undefined,
  });

  context.Vault.set({ ...vault, withdraw: vault.withdraw + 1, total: vault.total + 1 });

  const uac = await context.UserActionCount.get(concatBytes(user, VAULT));
  if (!uac) return;
  context.UserActionCount.set({ ...uac, withdraw: uac.withdraw + 1, total: uac.total + 1 });
});

indexer.onEvent({ contract: "CoreVault", event: "ReInvest" }, async ({ event, context }) => {
  const amount = (await coreVaultTotalStaked(context.effect, VAULT, event.block.number)) ?? ZERO_BI;
  const id = concatI32(event.transaction.hash, event.logIndex);
  const from = low(event.transaction.from ?? "");
  createTransaction(context, id, event.block.number, event.block.timestamp, from, VAULT, "DualCoreVault", "ReInvest", amount, event.transaction.hash);

  const stats = await context.Stats.get(B14G_ID);
  const vault = await context.Vault.get(VAULT);
  if (!stats || !vault) return;

  context.VaultAction.set({
    id,
    transaction_id: id,
    blockNumber: BigInt(event.block.number),
    timestamp: BigInt(event.block.timestamp),
    txHash: low(event.transaction.hash),
    type: "ReInvest",
    from_id: from,
    amount,
    toVault_id: VAULT,
    totalCoreStaked: stats.totalCoreStaked,
    rewardAmount: undefined,
    toLottery_id: undefined,
    receiverAmount: undefined,
    btcAmount: undefined,
    round: undefined,
  });

  context.Vault.set({ ...vault, reInvest: vault.reInvest + 1, total: vault.total + 1 });
});

indexer.onEvent({ contract: "CoreVault", event: "ClaimReward" }, async ({ event, context }) => {
  const stats = await context.Stats.get(B14G_ID);
  if (!stats) return;
  if (event.params.reward > ZERO_BI) {
    const id = concatI32(event.transaction.hash, event.logIndex);
    const value = (await coreVaultExchangeCore(context.effect, VAULT, 1_000_000_000_000_000_000n, event.block.number)) ?? ZERO_BI;
    context.VaultExchangeRate.set({
      id,
      timestamp: BigInt(event.block.timestamp),
      blockNumber: BigInt(event.block.number),
      value,
    });
  }
  context.Stats.set({ ...stats, totalCoreStaked: stats.totalCoreStaked + event.params.reward });
});
