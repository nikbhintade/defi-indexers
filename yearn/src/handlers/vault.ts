/** Ported from src/mappings/vaultMappings.ts (Vault template + bootstrap vaults). */
import { indexer } from "envio";
import type { Env } from "../utils/types";
import { low, fromSharesToAmount, getTransactionId } from "../utils/commons";
import { BIGINT_ZERO, ZERO_ADDRESS } from "../utils/constants";
import { getOrCreateTransactionFromEvent } from "../utils/transaction";
import * as vaultLibrary from "../utils/vault";
import * as strategyLibrary from "../utils/strategy";
import { vaultToken, vaultTotalAssets, vaultTotalSupply } from "../effects/contracts";

const mkEnv = (event: { block: { number: number } }, context: Env["context"]): Env => ({
  context,
  ec: context.effect,
  block: event.block.number,
});

// ---- StrategyAdded ----

indexer.onEvent({ contract: "Vault", event: "StrategyAddedV2" }, async ({ event, context }) => {
  const env = mkEnv(event, context);
  const transaction = await getOrCreateTransactionFromEvent(context, event, "AddStrategyV2Event");
  await strategyLibrary.createAndGet(
    env, transaction.id, low(event.params.strategy), low(event.srcAddress),
    event.params.debtRatio, BIGINT_ZERO, event.params.minDebtPerHarvest, event.params.maxDebtPerHarvest,
    event.params.performanceFee, null, transaction, BIGINT_ZERO,
  );
});

indexer.onEvent({ contract: "Vault", event: "StrategyAddedV1" }, async ({ event, context }) => {
  const env = mkEnv(event, context);
  const transaction = await getOrCreateTransactionFromEvent(context, event, "AddStrategyV1Event");
  await strategyLibrary.createAndGet(
    env, transaction.id, low(event.params.strategy), low(event.srcAddress),
    event.params.debtLimit, event.params.rateLimit, BIGINT_ZERO, BIGINT_ZERO,
    event.params.performanceFee, null, transaction, BIGINT_ZERO,
  );
});

// ---- StrategyReported ----

indexer.onEvent({ contract: "Vault", event: "StrategyReportedV030" }, async ({ event, context }) => {
  const env = mkEnv(event, context);
  const transaction = await getOrCreateTransactionFromEvent(context, event, "StrategyReportedEvent");
  const reportId = getTransactionId(event.transaction.hash, event.logIndex);
  const report = await strategyLibrary.createReport(
    env, transaction, low(event.params.strategy),
    event.params.gain, event.params.loss, event.params.totalGain, event.params.totalLoss,
    event.params.totalDebt, event.params.debtAdded, event.params.debtLimit, BIGINT_ZERO,
    reportId, event.block.number, event.block.timestamp,
  );
  if (!report) return;
  await vaultLibrary.strategyReported(env, transaction, report, low(event.srcAddress));
});

indexer.onEvent({ contract: "Vault", event: "StrategyReported" }, async ({ event, context }) => {
  const env = mkEnv(event, context);
  const transaction = await getOrCreateTransactionFromEvent(context, event, "StrategyReportedEvent");
  const reportId = getTransactionId(event.transaction.hash, event.logIndex);
  const report = await strategyLibrary.createReport(
    env, transaction, low(event.params.strategy),
    event.params.gain, event.params.loss, event.params.totalGain, event.params.totalLoss,
    event.params.totalDebt, event.params.debtAdded, event.params.debtRatio, event.params.debtPaid,
    reportId, event.block.number, event.block.timestamp,
  );
  if (!report) return;
  await vaultLibrary.strategyReported(env, transaction, report, low(event.srcAddress));
});

// ---- StrategyMigrated ----

indexer.onEvent({ contract: "Vault", event: "StrategyMigrated" }, async ({ event, context }) => {
  const env = mkEnv(event, context);
  const transaction = await getOrCreateTransactionFromEvent(context, event, "StrategyMigratedEvent");
  const oldStrategy = await context.Strategy.get(low(event.params.oldVersion));
  if (!oldStrategy) return;
  const newStrategyAddress = low(event.params.newVersion);
  await strategyLibrary.createMigration(env, oldStrategy, newStrategyAddress, transaction);
  const newExisting = await context.Strategy.get(newStrategyAddress);
  if (!newExisting) {
    await strategyLibrary.createAndGet(
      env, transaction.id, newStrategyAddress, low(event.srcAddress),
      oldStrategy.debtLimit, oldStrategy.rateLimit, oldStrategy.minDebtPerHarvest, oldStrategy.maxDebtPerHarvest,
      oldStrategy.performanceFeeBps, null, transaction, oldStrategy.delegatedAssets,
    );
  }
  await vaultLibrary.strategyRemovedFromQueue(env, low(event.params.oldVersion), low(event.srcAddress));
});

// ---- Deposit / Withdraw events ----

indexer.onEvent({ contract: "Vault", event: "Deposit" }, async ({ event, context }) => {
  const env = mkEnv(event, context);
  const transaction = await getOrCreateTransactionFromEvent(context, event, "DepositEvent");
  await vaultLibrary.deposit(
    env, low(event.srcAddress), transaction, low(event.params.recipient),
    event.params.amount, event.params.shares,
  );
});

indexer.onEvent({ contract: "Vault", event: "Withdraw" }, async ({ event, context }) => {
  const env = mkEnv(event, context);
  const transaction = await getOrCreateTransactionFromEvent(context, event, "WithdrawEvent");
  await vaultLibrary.withdraw(
    env, low(event.srcAddress), low(event.params.recipient),
    event.params.amount, event.params.shares, transaction,
  );
});

// ---- Transfer (shares) ----

indexer.onEvent({ contract: "Vault", event: "Transfer" }, async ({ event, context }) => {
  const env = mkEnv(event, context);
  const sender = low(event.params.sender);
  const receiver = low(event.params.receiver);
  if (sender === ZERO_ADDRESS || receiver === ZERO_ADDRESS) return;
  if (!(await vaultLibrary.isVault(env, low(event.srcAddress)))) return;

  const transaction = await getOrCreateTransactionFromEvent(context, event, "vault.transfer(address,uint256)");
  const vaultAddress = low(event.srcAddress);
  const totalAssets = (await vaultTotalAssets(env.ec, vaultAddress, env.block)) ?? BIGINT_ZERO;
  const totalSupply = (await vaultTotalSupply(env.ec, vaultAddress, env.block)) ?? BIGINT_ZERO;
  const sharesAmount = event.params.value;
  const amount = fromSharesToAmount(sharesAmount, totalAssets, totalSupply);
  const wantToken = (await vaultToken(env.ec, vaultAddress)) ?? ZERO_ADDRESS;
  await vaultLibrary.transfer(env, sender, receiver, amount, wantToken, sharesAmount, vaultAddress, transaction);
});

// ---- Fees ----

indexer.onEvent({ contract: "Vault", event: "UpdatePerformanceFee" }, async ({ event, context }) => {
  const env = mkEnv(event, context);
  const transaction = await getOrCreateTransactionFromEvent(context, event, "UpdatePerformanceFee");
  await vaultLibrary.performanceFeeUpdated(env, low(event.srcAddress), transaction, event.params.performanceFee);
});

indexer.onEvent({ contract: "Vault", event: "UpdateManagementFee" }, async ({ event, context }) => {
  const env = mkEnv(event, context);
  const transaction = await getOrCreateTransactionFromEvent(context, event, "UpdateManagementFee");
  await vaultLibrary.managementFeeUpdated(env, low(event.srcAddress), transaction, event.params.managementFee);
});

// ---- Queue ----

indexer.onEvent({ contract: "Vault", event: "StrategyAddedToQueue" }, async ({ event, context }) => {
  const env = mkEnv(event, context);
  await getOrCreateTransactionFromEvent(context, event, "StrategyAddedToQueue");
  await vaultLibrary.strategyAddedToQueue(env, low(event.params.strategy), low(event.srcAddress));
});

indexer.onEvent({ contract: "Vault", event: "StrategyRemovedFromQueue" }, async ({ event, context }) => {
  const env = mkEnv(event, context);
  await getOrCreateTransactionFromEvent(context, event, "StrategyRemovedFromQueue");
  await vaultLibrary.strategyRemovedFromQueue(env, low(event.params.strategy), low(event.srcAddress));
});

indexer.onEvent({ contract: "Vault", event: "UpdateWithdrawalQueue" }, async ({ event, context }) => {
  const env = mkEnv(event, context);
  await getOrCreateTransactionFromEvent(context, event, "UpdateWithdrawalQueue");
  await vaultLibrary.updateWithdrawalQueue(env, event.params.queue.map(low), low(event.srcAddress));
});

// ---- Rewards / HealthCheck ----

indexer.onEvent({ contract: "Vault", event: "UpdateRewards" }, async ({ event, context }) => {
  const env = mkEnv(event, context);
  const transaction = await getOrCreateTransactionFromEvent(context, event, "UpdateRewardsEvent");
  await vaultLibrary.handleUpdateRewards(env, low(event.srcAddress), low(event.params.rewards), transaction);
});

indexer.onEvent({ contract: "Vault", event: "UpdateHealthCheck" }, async ({ event, context }) => {
  const env = mkEnv(event, context);
  const transaction = await getOrCreateTransactionFromEvent(context, event, "UpdateHealthCheck");
  await vaultLibrary.handleUpdateHealthCheck(env, low(event.srcAddress), low(event.params.healthCheck), transaction);
});

// ---- Strategy parameter updates (vault-emitted) ----

indexer.onEvent({ contract: "Vault", event: "StrategyUpdateMaxDebtPerHarvest" }, async ({ event, context }) => {
  const env = mkEnv(event, context);
  await getOrCreateTransactionFromEvent(context, event, "UpdateMaxDebtPerHarvest");
  await strategyLibrary.updateMaxDebtPerHarvest(env, low(event.srcAddress), low(event.params.strategy), event.params.maxDebtPerHarvest);
});

indexer.onEvent({ contract: "Vault", event: "StrategyUpdateMinDebtPerHarvest" }, async ({ event, context }) => {
  const env = mkEnv(event, context);
  await getOrCreateTransactionFromEvent(context, event, "UpdateMinDebtPerHarvest");
  await strategyLibrary.updateMinDebtPerHarvest(env, low(event.srcAddress), low(event.params.strategy), event.params.minDebtPerHarvest);
});

indexer.onEvent({ contract: "Vault", event: "StrategyUpdatePerformanceFee" }, async ({ event, context }) => {
  const env = mkEnv(event, context);
  await getOrCreateTransactionFromEvent(context, event, "StrategyUpdatePerformanceFeeEvent");
  await strategyLibrary.updatePerformanceFee(env, low(event.srcAddress), low(event.params.strategy), event.params.performanceFee);
});

// ---- Management / Governance / Guardian / DepositLimit / EmergencyShutdown ----

indexer.onEvent({ contract: "Vault", event: "UpdateGuardian" }, async ({ event, context }) => {
  const env = mkEnv(event, context);
  await getOrCreateTransactionFromEvent(context, event, "UpdateGuardian");
  await vaultLibrary.handleUpdateGuardian(env, low(event.srcAddress), low(event.params.guardian));
});

indexer.onEvent({ contract: "Vault", event: "UpdateManagement" }, async ({ event, context }) => {
  const env = mkEnv(event, context);
  await getOrCreateTransactionFromEvent(context, event, "UpdateManagement");
  await vaultLibrary.handleUpdateManagement(env, low(event.srcAddress), low(event.params.management));
});

indexer.onEvent({ contract: "Vault", event: "UpdateGovernance" }, async ({ event, context }) => {
  const env = mkEnv(event, context);
  await getOrCreateTransactionFromEvent(context, event, "UpdateGovernance");
  await vaultLibrary.handleUpdateGovernance(env, low(event.srcAddress), low(event.params.governance));
});

indexer.onEvent({ contract: "Vault", event: "UpdateDepositLimit" }, async ({ event, context }) => {
  const env = mkEnv(event, context);
  await getOrCreateTransactionFromEvent(context, event, "UpdateDepositLimit");
  await vaultLibrary.handleUpdateDepositLimit(env, low(event.srcAddress), event.params.depositLimit);
});

indexer.onEvent({ contract: "Vault", event: "EmergencyShutdown" }, async ({ event, context }) => {
  const env = mkEnv(event, context);
  await getOrCreateTransactionFromEvent(context, event, "EmergencyShutdown");
  await vaultLibrary.handleEmergencyShutdown(env, low(event.srcAddress), event.params.active);
});
