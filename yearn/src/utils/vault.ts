/**
 * Ported from src/utils/vault/vault.ts (core accounting orchestrator).
 *
 * NOTE: the subgraph's `VaultTemplate.create(vaultAddress)` (dynamic Vault
 * template registration) is handled in the contractRegister handler
 * (src/handlers/registration.ts), not here. The `createTemplate` flag still
 * drives the `isTemplateListening` field for parity.
 */
import type { Registry, Strategy, StrategyReport, Transaction, Vault, VaultUpdate } from "envio";
import type { Env } from "./types";
import { low, removeElementFromArray } from "./commons";
import { BIGINT_ZERO, REGISTRY_V3_VAULT_TYPE_LEGACY, ZERO_ADDRESS } from "./constants";
import { getOrCreateToken } from "./token";
import { getOrCreateAccount, getOrCreateHealthCheck, getOrCreateRegistry } from "./account";
import { getBalancePosition, getTotalAssets } from "./vault-reads";
import { getOrCreateDeposit } from "./deposit";
import { getOrCreateWithdrawal } from "./withdrawal";
import { getOrCreateTransfer } from "./transfer";
import * as vaultUpdateLibrary from "./vault-update";
import * as accountVaultPositionLibrary from "./vault-position";
import { buildId as buildPositionId } from "./vault-position";
import {
  vaultActivation,
  vaultApiVersion,
  vaultAvailableDepositLimit,
  vaultDepositLimit,
  vaultEmergencyShutdown,
  vaultGovernance,
  vaultGuardian,
  vaultManagement,
  vaultManagementFee,
  vaultPerformanceFee,
  vaultRewards,
  vaultToken,
  strategyDelegatedAssets,
} from "../effects/contracts";

export function buildVaultId(vaultAddress: string): string {
  return low(vaultAddress);
}

/** createNewVaultFromAddress — pulls vault metadata via eth_calls. */
async function createNewVaultFromAddress(env: Env, vaultAddress: string, transaction: Transaction): Promise<Vault> {
  const id = low(vaultAddress);
  const token = await getOrCreateToken(env, (await vaultToken(env.ec, id)) ?? ZERO_ADDRESS);
  const shareToken = await getOrCreateToken(env, id);

  const managementFee = (await vaultManagementFee(env.ec, id, env.block)) ?? BIGINT_ZERO;
  const performanceFee = (await vaultPerformanceFee(env.ec, id, env.block)) ?? BIGINT_ZERO;
  const rewards = (await vaultRewards(env.ec, id, env.block)) ?? ZERO_ADDRESS;
  const management = (await vaultManagement(env.ec, id, env.block)) ?? ZERO_ADDRESS;
  const guardian = (await vaultGuardian(env.ec, id, env.block)) ?? ZERO_ADDRESS;
  const governance = (await vaultGovernance(env.ec, id, env.block)) ?? ZERO_ADDRESS;
  const depositLimit = (await vaultDepositLimit(env.ec, id, env.block)) ?? BIGINT_ZERO;
  const activation = (await vaultActivation(env.ec, id)) ?? BIGINT_ZERO;
  const apiVersion = (await vaultApiVersion(env.ec, id)) ?? "";
  const emergencyShutdown = (await vaultEmergencyShutdown(env.ec, id, env.block)) ?? false;

  const vault: Vault = {
    id,
    transaction_id: transaction.id,
    token_id: token.id,
    shareToken_id: shareToken.id,
    classification: "Experimental",
    tags: [],
    balanceTokens: BIGINT_ZERO,
    balanceTokensIdle: BIGINT_ZERO,
    sharesSupply: BIGINT_ZERO,
    managementFeeBps: Number(managementFee),
    performanceFeeBps: Number(performanceFee),
    rewards,
    management,
    guardian,
    governance,
    depositLimit,
    activation,
    apiVersion,
    activationBlockNumber: transaction.blockNumber,
    emergencyShutdown,
    withdrawalQueue: [],
    // fields set by create()/getOrCreate caller:
    type: REGISTRY_V3_VAULT_TYPE_LEGACY,
    registry_id: "",
    strategyIds: [],
    availableDepositLimit: BIGINT_ZERO,
    isTemplateListening: false,
    latestUpdate_id: undefined,
    healthCheck_id: undefined,
  };
  return vault;
}

/** vault.getOrCreate (used by deposit/withdraw/transfer/strategyReported paths). */
export async function getOrCreate(
  env: Env,
  vaultAddress: string,
  transaction: Transaction,
  _createTemplate: boolean,
): Promise<Vault> {
  const id = buildVaultId(vaultAddress);
  const existing = await env.context.Vault.get(id);
  if (existing) return existing;
  const vault = await createNewVaultFromAddress(env, vaultAddress, transaction);
  env.context.Vault.set(vault);
  return vault;
}

/** vault.create (registry NewVault path). */
export async function create(
  env: Env,
  registry: Registry,
  transaction: Transaction,
  vaultAddress: string,
  classification: string,
  apiVersion: string,
  createTemplate: boolean,
  vaultType: bigint,
): Promise<Vault> {
  const { context } = env;
  const id = buildVaultId(vaultAddress);
  const existing = await context.Vault.get(id);
  if (!existing) {
    const base = await createNewVaultFromAddress(env, vaultAddress, transaction);
    const vault: Vault = {
      ...base,
      strategyIds: [],
      type: vaultType,
      availableDepositLimit: BIGINT_ZERO,
      classification: classification as Vault["classification"],
      registry_id: registry.id,
      apiVersion,
      isTemplateListening: createTemplate,
    };
    context.Vault.set(vault);
    return vault;
  } else {
    let updated = existing;
    if (existing.classification !== classification) {
      updated = { ...updated, classification: classification as Vault["classification"] };
    }
    if (!existing.isTemplateListening && createTemplate) {
      updated = { ...updated, isTemplateListening: true };
    }
    context.Vault.set(updated);
    return updated;
  }
}

/** vault.release (registry NewRelease path). */
export async function release(
  env: Env,
  vaultAddress: string,
  apiVersion: string,
  registryAddress: string,
  transaction: Transaction,
): Promise<Vault | null> {
  const registry = await env.context.Registry.get(low(registryAddress));
  if (registry) {
    return create(env, registry, transaction, vaultAddress, "Released", apiVersion, true, REGISTRY_V3_VAULT_TYPE_LEGACY);
  }
  return null;
}

/** vault.tag (VaultTagged). */
export async function tag(env: Env, vaultAddress: string, tagStr: string): Promise<void> {
  const id = buildVaultId(vaultAddress);
  const vault = await env.context.Vault.get(id);
  if (!vault) return;
  env.context.Vault.set({ ...vault, tags: tagStr.split(",") });
}

export async function isVault(env: Env, vaultAddress: string): Promise<boolean> {
  return (await env.context.Vault.get(buildVaultId(vaultAddress))) !== undefined;
}

/** vault.deposit. */
export async function deposit(
  env: Env,
  vaultAddress: string,
  transaction: Transaction,
  receiver: string,
  depositedAmount: bigint,
  sharesMinted: bigint,
): Promise<void> {
  const account = await getOrCreateAccount(env.context, receiver);
  let vault = await getOrCreate(env, vaultAddress, transaction, true);

  await accountVaultPositionLibrary.deposit(env, account, vault, transaction, depositedAmount, sharesMinted);
  await getOrCreateDeposit(env.context, account, vault, transaction, depositedAmount, sharesMinted);

  const balancePosition = await getBalancePosition(env, vaultAddress);
  // re-read vault (position deposit doesn't mutate vault accounting, but be safe)
  vault = await env.context.Vault.getOrThrow(buildVaultId(vaultAddress));
  if (vault.latestUpdate_id === undefined) {
    await vaultUpdateLibrary.firstDeposit(env, vault, transaction, depositedAmount, sharesMinted, balancePosition);
  } else {
    await vaultUpdateLibrary.deposit(env, vault, transaction, depositedAmount, sharesMinted, balancePosition);
  }
}

/** vault.withdraw. */
export async function withdraw(
  env: Env,
  vaultAddress: string,
  from: string,
  withdrawnAmount: bigint,
  sharesBurnt: bigint,
  transaction: Transaction,
): Promise<void> {
  const { context } = env;
  const account = await getOrCreateAccount(context, from);
  const balancePosition = await getBalancePosition(env, vaultAddress);
  let vault = await getOrCreate(env, vaultAddress, transaction, true);
  await getOrCreateWithdrawal(context, account, vault, transaction, withdrawnAmount, sharesBurnt);

  const positionId = buildPositionId(account, vault);
  const position = await context.AccountVaultPosition.get(positionId);
  if (position) {
    const latestUpdate = await context.AccountVaultPositionUpdate.get(position.latestUpdate_id);
    if (latestUpdate) {
      await accountVaultPositionLibrary.withdraw(env, position, withdrawnAmount, sharesBurnt, transaction);
    }
  } else {
    // see vault.ts comment: pre-registration deposits. Zero-amount -> withdrawZero.
    if (withdrawnAmount === BIGINT_ZERO) {
      await accountVaultPositionLibrary.withdrawZero(env, account, vault, transaction);
    }
  }

  vault = await context.Vault.getOrThrow(buildVaultId(vaultAddress));
  if (vault.latestUpdate_id !== undefined) {
    const latestVaultUpdate = await context.VaultUpdate.get(vault.latestUpdate_id);
    if (latestVaultUpdate) {
      await vaultUpdateLibrary.withdraw(env, vault, withdrawnAmount, sharesBurnt, transaction, balancePosition);
    }
  }
}

/** vault.transfer (share Transfer). */
export async function transfer(
  env: Env,
  from: string,
  to: string,
  amount: bigint,
  wantTokenAddress: string,
  shareAmount: bigint,
  vaultAddress: string,
  transaction: Transaction,
): Promise<void> {
  const { context } = env;
  const token = await getOrCreateToken(env, wantTokenAddress);
  const shareToken = await getOrCreateToken(env, vaultAddress);
  const fromAccount = await getOrCreateAccount(context, from);
  const toAccount = await getOrCreateAccount(context, to);
  const vault = await getOrCreate(env, vaultAddress, transaction, true);

  await getOrCreateTransfer(env, fromAccount, toAccount, vault, token, amount, shareToken, shareAmount, transaction);
  await accountVaultPositionLibrary.transfer(env, fromAccount, toAccount, vault, amount, shareAmount, transaction);

  for (const strategyId of vault.strategyIds) {
    const loaded = await context.Strategy.get(strategyId);
    if (loaded) {
      const delegated = await strategyDelegatedAssets(env.ec, strategyId, env.block);
      context.Strategy.set({ ...loaded, delegatedAssets: delegated === null ? loaded.delegatedAssets : delegated });
    }
  }
}

/** vault.strategyReported. */
export async function strategyReported(
  env: Env,
  transaction: Transaction,
  strategyReport: StrategyReport,
  vaultAddress: string,
): Promise<void> {
  const vault = await getOrCreate(env, vaultAddress, transaction, true);
  const balancePosition = await getBalancePosition(env, vaultAddress);
  const grossReturnsGenerated = strategyReport.gain - strategyReport.loss;
  await vaultUpdateLibrary.strategyReported(env, vault, transaction, balancePosition, grossReturnsGenerated);
}

/** vault.performanceFeeUpdated. */
export async function performanceFeeUpdated(
  env: Env,
  vaultAddress: string,
  transaction: Transaction,
  performanceFee: bigint,
): Promise<void> {
  const { context } = env;
  const id = buildVaultId(vaultAddress);
  const vault = await context.Vault.get(id);
  if (!vault) return;
  const balancePosition = await getBalancePosition(env, vaultAddress);
  const vaultUpdate = await vaultUpdateLibrary.performanceFeeUpdated(env, vault, transaction, balancePosition, performanceFee);
  const refreshed = await context.Vault.getOrThrow(id);
  context.Vault.set({ ...refreshed, latestUpdate_id: vaultUpdate.id, performanceFeeBps: Number(performanceFee) });
}

/** vault.managementFeeUpdated. */
export async function managementFeeUpdated(
  env: Env,
  vaultAddress: string,
  transaction: Transaction,
  managementFee: bigint,
): Promise<void> {
  const { context } = env;
  const id = buildVaultId(vaultAddress);
  const vault = await context.Vault.get(id);
  if (!vault) return;
  const balancePosition = await getBalancePosition(env, vaultAddress);
  const vaultUpdate = await vaultUpdateLibrary.managementFeeUpdated(env, vault, transaction, balancePosition, managementFee);
  const refreshed = await context.Vault.getOrThrow(id);
  context.Vault.set({ ...refreshed, latestUpdate_id: vaultUpdate.id, managementFeeBps: Number(managementFee) });
}

/** vault.strategyAddedToQueue. */
export async function strategyAddedToQueue(env: Env, strategyAddress: string, vaultAddress: string): Promise<void> {
  const { context } = env;
  const id = low(strategyAddress);
  const strategy = await context.Strategy.get(id);
  if (!strategy) return;
  context.Strategy.set({ ...strategy, inQueue: true });
  const vault = await context.Vault.get(low(vaultAddress));
  if (vault) {
    const queue = [...vault.withdrawalQueue];
    if (!queue.includes(low(strategy.address))) queue.push(low(strategy.address));
    context.Vault.set({ ...vault, withdrawalQueue: queue });
  }
}

/** vault.strategyRemovedFromQueue. */
export async function strategyRemovedFromQueue(env: Env, strategyAddress: string, vaultAddress: string): Promise<void> {
  const { context } = env;
  const id = low(strategyAddress);
  const strategy = await context.Strategy.get(id);
  if (!strategy) return;
  context.Strategy.set({ ...strategy, inQueue: false });
  const vault = await context.Vault.get(low(vaultAddress));
  if (vault) {
    context.Vault.set({
      ...vault,
      withdrawalQueue: removeElementFromArray(vault.withdrawalQueue, low(strategy.address)),
    });
  }
}

/** vault.UpdateWithdrawalQueue. */
export async function updateWithdrawalQueue(env: Env, newQueue: ReadonlyArray<string>, vaultAddress: string): Promise<void> {
  const { context } = env;
  const vault = await context.Vault.get(low(vaultAddress));
  if (!vault) return;
  for (const addr of vault.withdrawalQueue) {
    const s = await context.Strategy.get(addr);
    if (s) context.Strategy.set({ ...s, inQueue: false });
  }
  const newWithdrawalQueue: string[] = [];
  for (const addr of newQueue) {
    const a = low(addr);
    const s = await context.Strategy.get(a);
    if (s) context.Strategy.set({ ...s, inQueue: true });
    newWithdrawalQueue.push(a);
  }
  const refreshed = await context.Vault.getOrThrow(low(vaultAddress));
  context.Vault.set({ ...refreshed, withdrawalQueue: newWithdrawalQueue });
}

/** vault.handleUpdateRewards. */
export async function handleUpdateRewards(env: Env, vaultAddress: string, rewards: string, transaction: Transaction): Promise<void> {
  const { context } = env;
  const id = buildVaultId(vaultAddress);
  const vault = await context.Vault.get(id);
  if (!vault) return;
  const balancePosition = await getBalancePosition(env, vaultAddress);
  const vaultUpdate = await vaultUpdateLibrary.rewardsUpdated(env, vault, transaction, balancePosition, low(rewards));
  const refreshed = await context.Vault.getOrThrow(id);
  context.Vault.set({ ...refreshed, latestUpdate_id: vaultUpdate.id, rewards: low(rewards) });
}

/** vault.handleUpdateHealthCheck. */
export async function handleUpdateHealthCheck(env: Env, vaultAddress: string, healthCheckAddress: string, transaction: Transaction): Promise<void> {
  const { context } = env;
  const id = buildVaultId(vaultAddress);
  const vault = await context.Vault.get(id);
  if (!vault) return;
  if (low(healthCheckAddress) === ZERO_ADDRESS) {
    context.Vault.set({ ...vault, healthCheck_id: undefined });
    const refreshed = await context.Vault.getOrThrow(id);
    await vaultUpdateLibrary.healthCheckUpdated(env, refreshed, transaction, null);
  } else {
    const healthCheck = await getOrCreateHealthCheck(context, healthCheckAddress);
    context.Vault.set({ ...vault, healthCheck_id: healthCheck.id });
    const refreshed = await context.Vault.getOrThrow(id);
    await vaultUpdateLibrary.healthCheckUpdated(env, refreshed, transaction, healthCheck.id);
  }
}

export async function handleUpdateGuardian(env: Env, vaultAddress: string, guardianAddress: string): Promise<void> {
  const vault = await env.context.Vault.get(buildVaultId(vaultAddress));
  if (!vault) return;
  env.context.Vault.set({ ...vault, guardian: low(guardianAddress) });
}

export async function handleUpdateManagement(env: Env, vaultAddress: string, managementAddress: string): Promise<void> {
  const vault = await env.context.Vault.get(buildVaultId(vaultAddress));
  if (!vault) return;
  env.context.Vault.set({ ...vault, management: low(managementAddress) });
}

export async function handleUpdateGovernance(env: Env, vaultAddress: string, governanceAddress: string): Promise<void> {
  const vault = await env.context.Vault.get(buildVaultId(vaultAddress));
  if (!vault) return;
  env.context.Vault.set({ ...vault, governance: low(governanceAddress) });
}

export async function handleUpdateDepositLimit(env: Env, vaultAddress: string, depositLimit: bigint): Promise<void> {
  const { context } = env;
  const id = buildVaultId(vaultAddress);
  const vault = await context.Vault.get(id);
  if (!vault) return;
  const availRaw = await vaultAvailableDepositLimit(env.ec, id, env.block);
  let availableDepositLimit = availRaw === null ? BIGINT_ZERO : availRaw;
  if (availableDepositLimit !== BIGINT_ZERO && depositLimit > availableDepositLimit) {
    const totalAssets = await getTotalAssets(env, id);
    availableDepositLimit = depositLimit - totalAssets;
  }
  context.Vault.set({ ...vault, depositLimit, availableDepositLimit });
}

export async function handleEmergencyShutdown(env: Env, vaultAddress: string, emergencyShutdown: boolean): Promise<void> {
  const vault = await env.context.Vault.get(buildVaultId(vaultAddress));
  if (!vault) return;
  env.context.Vault.set({ ...vault, emergencyShutdown });
}
