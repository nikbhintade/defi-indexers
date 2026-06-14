/**
 * Ported from src/utils/strategy/strategy.ts, strategy-report.ts,
 * strategy-report-result.ts, strategy-migration.ts.
 *
 * NOTE: the subgraph's `StrategyTemplate.create(strategyAddress)` (dynamic
 * registration of the Strategy template) is handled in the contractRegister
 * handler (src/handlers/registration.ts), not here — HyperIndex only allows
 * dynamic registration inside contractRegister.
 */
import { BigDecimal } from "envio";
import type {
  Harvest,
  Strategy,
  StrategyMigration,
  StrategyReport,
  StrategyReportResult,
  Transaction,
} from "envio";
import type { Env } from "./types";
import { low, getTimeInMillis, getTimestampInMillis } from "./commons";
import { BIGINT_ZERO, DAYS_PER_YEAR, MS_PER_DAY } from "./constants";
import {
  strategyApiVersion,
  strategyDelegatedAssets,
  strategyDoHealthCheck,
  strategyEmergencyExit,
  strategyHealthCheck,
  strategyKeeper,
  strategyName,
  strategyRewards,
  strategyStrategist,
  strategyVault,
} from "../effects/contracts";
import { ZERO_ADDRESS } from "./constants";

export function buildStrategyId(strategyAddress: string): string {
  return low(strategyAddress);
}

/** strategy.createAndGet — creates a Strategy entity (template registered elsewhere). */
export async function createAndGet(
  env: Env,
  transactionId: string,
  strategyAddress: string,
  vaultAddr: string,
  debtLimit: bigint,
  rateLimit: bigint,
  minDebtPerHarvest: bigint,
  maxDebtPerHarvest: bigint,
  performanceFee: bigint,
  clonedFrom: Strategy | null,
  transaction: Transaction,
  delegatedAssets: bigint,
): Promise<Strategy> {
  const { context } = env;
  const id = buildStrategyId(strategyAddress);
  const vault = low(vaultAddr);
  const existing = await context.Strategy.get(id);
  if (existing) return existing;

  const name = await strategyName(env.ec, id);
  const apiVersion = await strategyApiVersion(env.ec, id);
  const keeper = await strategyKeeper(env.ec, id, env.block);
  const strategist = await strategyStrategist(env.ec, id, env.block);
  const rewards = await strategyRewards(env.ec, id, env.block);
  const emergencyExit = await strategyEmergencyExit(env.ec, id, env.block);
  const healthCheck = await strategyHealthCheck(env.ec, id, env.block);
  const doHealthCheck = await strategyDoHealthCheck(env.ec, id, env.block);

  const strategy: Strategy = {
    id,
    inQueue: true,
    blockNumber: transaction.blockNumber,
    timestamp: getTimeInMillis(transaction.timestamp),
    transaction_id: transactionId,
    name: name === null ? "TBD" : name,
    address: id,
    vault_id: vault,
    debtLimit,
    rateLimit,
    minDebtPerHarvest,
    maxDebtPerHarvest,
    performanceFeeBps: performanceFee,
    delegatedAssets,
    apiVersion: apiVersion === null ? "0" : apiVersion,
    keeper: keeper === null ? ZERO_ADDRESS : keeper,
    strategist: strategist === null ? ZERO_ADDRESS : strategist,
    rewards: rewards === null ? ZERO_ADDRESS : rewards,
    emergencyExit: emergencyExit === null ? false : emergencyExit,
    clonedFrom_id: clonedFrom ? clonedFrom.id : undefined,
    healthCheck: healthCheck === null ? undefined : healthCheck,
    doHealthCheck: doHealthCheck === null ? false : doHealthCheck,
    latestReport_id: undefined,
  };
  context.Strategy.set(strategy);

  const vaultInstance = await context.Vault.get(vault);
  if (vaultInstance) {
    const withdrawalQueue = [...vaultInstance.withdrawalQueue, id];
    const strategyIds = [...vaultInstance.strategyIds, id];
    context.Vault.set({ ...vaultInstance, withdrawalQueue, strategyIds });
  }
  return strategy;
}

/** strategy.createReport — creates StrategyReport + StrategyReportResult. */
export async function createReport(
  env: Env,
  transaction: Transaction,
  strategyId: string,
  gain: bigint,
  loss: bigint,
  totalGain: bigint,
  totalLoss: bigint,
  totalDebt: bigint,
  debtAdded: bigint,
  debtLimit: bigint,
  debtPaid: bigint,
  reportId: string,
  blockNumber: number,
  blockTimestamp: number,
): Promise<StrategyReport | null> {
  const { context } = env;
  const id = low(strategyId);
  const strategy = await context.Strategy.get(id);
  if (!strategy) return null;

  const currentReportId = strategy.latestReport_id;
  const latestReport = await strategyReportGetOrCreate(
    env, transaction.id, strategy, gain, loss, totalGain, totalLoss,
    totalDebt, debtAdded, debtLimit, debtPaid, reportId, blockNumber, blockTimestamp,
  );

  // strategy.latestReport = latestReport.id (and debtLimit set inside getOrCreate)
  const refreshed = await context.Strategy.getOrThrow(id);
  context.Strategy.set({ ...refreshed, latestReport_id: latestReport.id });

  if (currentReportId !== undefined) {
    const currentReport = await context.StrategyReport.get(currentReportId);
    if (currentReport) {
      await createReportResult(env, transaction, currentReport, latestReport);
    }
  }
  return latestReport;
}

/** strategyReportLibrary.getOrCreate. id = txHash-logIndex (buildIdFromEvent). */
async function strategyReportGetOrCreate(
  env: Env,
  transactionId: string,
  strategy: Strategy,
  gain: bigint,
  loss: bigint,
  totalGain: bigint,
  totalLoss: bigint,
  totalDebt: bigint,
  debtAdded: bigint,
  debtLimit: bigint,
  debtPaid: bigint,
  reportId: string,
  blockNumber: number,
  blockTimestamp: number,
): Promise<StrategyReport> {
  const { context } = env;
  // buildIdFromEvent: event.transaction.hash - event.logIndex (passed explicitly).
  const existing = await context.StrategyReport.get(reportId);
  if (existing) return existing;

  const report: StrategyReport = {
    id: reportId,
    strategy_id: strategy.id,
    blockNumber: BigInt(blockNumber),
    timestamp: getTimestampInMillis(blockTimestamp),
    transaction_id: transactionId,
    gain,
    loss,
    totalGain,
    totalLoss,
    totalDebt,
    debtAdded,
    debtLimit,
    debtPaid,
  };
  context.StrategyReport.set(report);
  // strategy.debtLimit = debtLimit; strategy.save()
  const refreshed = await context.Strategy.getOrThrow(strategy.id);
  context.Strategy.set({ ...refreshed, debtLimit });
  return report;
}

/** strategy-report-result.create. id = txHash-logIndex (buildIdFromTransaction). */
async function createReportResult(
  env: Env,
  transaction: Transaction,
  previousReport: StrategyReport,
  currentReport: StrategyReport,
): Promise<StrategyReportResult> {
  // buildIdFromTransaction: transaction.hash - transaction.logIndex
  const id = low(transaction.hash) + "-" + transaction.logIndex.toString();
  const ZERO = new BigDecimal(0);

  const duration = new BigDecimal(currentReport.timestamp.toString()).minus(
    new BigDecimal(previousReport.timestamp.toString()),
  );
  let durationPr = ZERO;
  let apr = ZERO;

  const profit = currentReport.totalGain - previousReport.totalGain;
  const msInDays = duration.div(new BigDecimal(MS_PER_DAY));

  if (previousReport.totalDebt !== BIGINT_ZERO && !msInDays.eq(ZERO)) {
    const profitOverTotalDebt = new BigDecimal(profit.toString()).div(
      new BigDecimal(previousReport.totalDebt.toString()),
    );
    durationPr = profitOverTotalDebt;
    const yearOverDuration = new BigDecimal(DAYS_PER_YEAR).div(msInDays);
    apr = profitOverTotalDebt.times(yearOverDuration);
  }

  const result: StrategyReportResult = {
    id,
    timestamp: transaction.timestamp,
    blockNumber: transaction.blockNumber,
    currentReport_id: currentReport.id,
    previousReport_id: previousReport.id,
    startTimestamp: previousReport.timestamp,
    endTimestamp: currentReport.timestamp,
    duration,
    durationPr,
    apr,
    transaction_id: transaction.id,
  };
  env.context.StrategyReportResult.set(result);
  return result;
}

/** strategy.harvest. id = strategy-txHash-txIndex. */
export async function harvest(
  env: Env,
  harvester: string,
  strategyAddress: string,
  timestamp: bigint,
  blockNumber: bigint,
  transactionHash: string,
  transactionIndex: bigint,
  profit: bigint,
  loss: bigint,
  debtPayment: bigint,
  debtOutstanding: bigint,
  transaction: Transaction,
): Promise<Harvest> {
  const { context } = env;
  const sid = low(strategyAddress);
  const harvestId = sid + "-" + low(transactionHash) + "-" + transactionIndex.toString();
  const existing = await context.Harvest.get(harvestId);
  if (existing) return existing;

  const strategy = await context.Strategy.get(sid);
  let vaultId: string;
  if (strategy) {
    const delegated = await strategyDelegatedAssets(env.ec, sid, env.block);
    context.Strategy.set({ ...strategy, delegatedAssets: delegated === null ? strategy.delegatedAssets : delegated });
    vaultId = strategy.vault_id;
  } else {
    const v = await strategyVault(env.ec, sid);
    vaultId = v === null ? ZERO_ADDRESS : v;
  }

  const h: Harvest = {
    id: harvestId,
    timestamp,
    blockNumber,
    transaction_id: transaction.id,
    vault_id: vaultId,
    strategy_id: sid,
    harvester: low(harvester),
    profit,
    loss,
    debtPayment,
    debtOutstanding,
  };
  context.Harvest.set(h);
  return h;
}

/** strategy.strategyCloned. */
export async function strategyCloned(
  env: Env,
  clonedStrategyAddress: string,
  fromStrategyAddress: string,
  transaction: Transaction,
): Promise<void> {
  const fromId = buildStrategyId(fromStrategyAddress);
  const clonedFrom = (await env.context.Strategy.get(fromId)) ?? null;
  const vaultAddr = await strategyVault(env.ec, low(clonedStrategyAddress));
  await createAndGet(
    env, transaction.id, clonedStrategyAddress, vaultAddr === null ? ZERO_ADDRESS : vaultAddr,
    BIGINT_ZERO, BIGINT_ZERO, BIGINT_ZERO, BIGINT_ZERO, BIGINT_ZERO, clonedFrom, transaction, BIGINT_ZERO,
  );
}

export function buildIdForStrategyMigration(oldStrategy: string, newStrategy: string): string {
  return `${oldStrategy}-${newStrategy}`;
}

export async function createMigration(
  env: Env,
  oldStrategy: Strategy,
  newStrategyAddress: string,
  tx: Transaction,
): Promise<StrategyMigration> {
  const oldId = low(oldStrategy.address);
  const newId = low(newStrategyAddress);
  const id = buildIdForStrategyMigration(oldId, newId);
  const migration: StrategyMigration = {
    id,
    oldStrategy_id: oldId,
    newStrategy_id: newId,
    blockNumber: tx.blockNumber,
    timestamp: tx.timestamp,
    transaction_id: tx.id,
  };
  env.context.StrategyMigration.set(migration);
  return migration;
}

// --- simple setters (healthCheckSet / doHealthCheckSet / emergencyExit / updated* / update*) ---

export async function healthCheckSet(env: Env, strategyAddress: string, healthCheckAddress: string): Promise<void> {
  const id = buildStrategyId(strategyAddress);
  const s = await env.context.Strategy.get(id);
  if (s) env.context.Strategy.set({ ...s, healthCheck: low(healthCheckAddress) });
}

export async function doHealthCheckSet(env: Env, strategyAddress: string, doHealthCheck: boolean): Promise<void> {
  const id = buildStrategyId(strategyAddress);
  const s = await env.context.Strategy.get(id);
  if (s) env.context.Strategy.set({ ...s, doHealthCheck });
}

export async function emergencyExitEnabled(env: Env, strategyAddress: string): Promise<void> {
  const id = buildStrategyId(strategyAddress);
  const s = await env.context.Strategy.get(id);
  if (s) env.context.Strategy.set({ ...s, emergencyExit: true });
}

export async function updatedKeeper(env: Env, strategyAddress: string, keeper: string): Promise<void> {
  const id = buildStrategyId(strategyAddress);
  const s = await env.context.Strategy.get(id);
  if (s) env.context.Strategy.set({ ...s, keeper: low(keeper) });
}

export async function updatedStrategist(env: Env, strategyAddress: string, strategist: string): Promise<void> {
  const id = buildStrategyId(strategyAddress);
  const s = await env.context.Strategy.get(id);
  if (s) env.context.Strategy.set({ ...s, strategist: low(strategist) });
}

export async function updatedRewards(env: Env, strategyAddress: string, rewards: string): Promise<void> {
  const id = buildStrategyId(strategyAddress);
  const s = await env.context.Strategy.get(id);
  if (s) env.context.Strategy.set({ ...s, rewards: low(rewards) });
}

export async function updateMaxDebtPerHarvest(env: Env, vaultAddress: string, strategyAddress: string, value: bigint): Promise<void> {
  const id = buildStrategyId(strategyAddress);
  const vaultId = low(vaultAddress);
  const vault = await env.context.Vault.get(vaultId);
  if (!vault) return;
  const s = await env.context.Strategy.get(id);
  if (!s || s.vault_id !== vaultId) return;
  env.context.Strategy.set({ ...s, maxDebtPerHarvest: value });
}

export async function updateMinDebtPerHarvest(env: Env, vaultAddress: string, strategyAddress: string, value: bigint): Promise<void> {
  const id = buildStrategyId(strategyAddress);
  const vaultId = low(vaultAddress);
  const vault = await env.context.Vault.get(vaultId);
  if (!vault) return;
  const s = await env.context.Strategy.get(id);
  if (!s || s.vault_id !== vaultId) return;
  env.context.Strategy.set({ ...s, minDebtPerHarvest: value });
}

export async function updatePerformanceFee(env: Env, vaultAddress: string, strategyAddress: string, value: bigint): Promise<void> {
  const id = buildStrategyId(strategyAddress);
  const vaultId = low(vaultAddress);
  const vault = await env.context.Vault.get(vaultId);
  if (!vault) return;
  const s = await env.context.Strategy.get(id);
  if (!s || s.vault_id !== vaultId) return;
  env.context.Strategy.set({ ...s, performanceFeeBps: value });
}
