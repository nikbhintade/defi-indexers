/** Ported from src/utils/vault/vault-update.ts. */
import type { Transaction, Vault, VaultUpdate } from "envio";
import type { Env } from "./types";
import { BIGINT_ZERO } from "./constants";
import { buildVaultUpdateId, buildVaultUpdateIdFromVaultAndTransaction } from "./vault-update-id";
import { updateVaultDayData } from "./vault-day-data";
import { getTotalAssets } from "./vault-reads";
import { vaultPricePerShare } from "../effects/contracts";
import * as tokenFeeLibrary from "./token-fees";

export { buildVaultUpdateId, buildVaultUpdateIdFromVaultAndTransaction };

type NewFields = {
  feesPaid: bigint | null;
  newManagementFee: bigint | null;
  newPerformanceFee: bigint | null;
  newRewards: string | null;
  newHealthCheck: string | null;
};

/**
 * Mirrors createVaultUpdate. Persists both the VaultUpdate and the mutated
 * Vault (latestUpdate / balance / shares / availableDepositLimit) and updates
 * VaultDayData. Returns the created VaultUpdate.
 */
async function createVaultUpdate(
  env: Env,
  id: string,
  vault: Vault,
  transaction: Transaction,
  tokensDeposited: bigint,
  tokensWithdrawn: bigint,
  sharesMinted: bigint,
  sharesBurnt: bigint,
  balancePosition: bigint,
  returnsGenerated: bigint,
  fields: NewFields,
): Promise<VaultUpdate> {
  const { context } = env;

  // --- constructVaultUpdateEntity ---
  let previous: VaultUpdate | undefined;
  if (vault.latestUpdate_id !== undefined) {
    previous = await context.VaultUpdate.get(vault.latestUpdate_id);
  }

  let totalFees: bigint;
  if (fields.feesPaid === null) {
    totalFees = previous ? previous.totalFees : BIGINT_ZERO;
  } else {
    totalFees = previous ? previous.totalFees + fields.feesPaid : fields.feesPaid;
  }

  const ppsRaw = await vaultPricePerShare(env.ec, vault.id, env.block); // hard call in subgraph
  const pricePerShare = ppsRaw === null ? BIGINT_ZERO : ppsRaw;
  const balanceTokens = await getTotalAssets(env, vault.id);

  const vaultUpdate: VaultUpdate = {
    id,
    totalFees,
    pricePerShare,
    currentBalanceTokens: balanceTokens,
    timestamp: transaction.timestamp,
    blockNumber: transaction.blockNumber,
    transaction_id: transaction.id,
    vault_id: vault.id,
    newHealthCheck_id: fields.newHealthCheck === null ? undefined : fields.newHealthCheck,
    newManagementFee: fields.newManagementFee === null ? undefined : fields.newManagementFee,
    newPerformanceFee: fields.newPerformanceFee === null ? undefined : fields.newPerformanceFee,
    newRewards: fields.newRewards === null ? undefined : fields.newRewards,
    availableDepositLimit: vault.availableDepositLimit,
    depositLimit: vault.depositLimit,
    tokensDeposited,
    tokensWithdrawn,
    sharesMinted,
    sharesBurnt,
    balancePosition,
    returnsGenerated,
    guardian: vault.guardian,
    management: vault.management,
    governance: vault.governance,
  };
  context.VaultUpdate.set(vaultUpdate);

  // --- mutate + persist vault ---
  const balanceTokensIdle = vault.balanceTokensIdle + tokensDeposited - tokensWithdrawn;
  const sharesSupply = vault.sharesSupply + sharesMinted - sharesBurnt;
  let availableDepositLimit: bigint;
  if (vault.depositLimit <= balanceTokens) {
    availableDepositLimit = BIGINT_ZERO;
  } else {
    availableDepositLimit = vault.depositLimit - balanceTokens;
  }
  const updatedVault: Vault = {
    ...vault,
    latestUpdate_id: vaultUpdate.id,
    balanceTokens,
    balanceTokensIdle,
    sharesSupply,
    availableDepositLimit,
  };
  context.Vault.set(updatedVault);

  await updateVaultDayData(env, transaction, updatedVault, vaultUpdate);
  return vaultUpdate;
}

const NO_NEW: NewFields = {
  feesPaid: null,
  newManagementFee: null,
  newPerformanceFee: null,
  newRewards: null,
  newHealthCheck: null,
};

export async function firstDeposit(
  env: Env,
  vault: Vault,
  transaction: Transaction,
  depositedAmount: bigint,
  sharesMinted: bigint,
  balancePosition: bigint,
): Promise<VaultUpdate> {
  const id = buildVaultUpdateIdFromVaultAndTransaction(vault, transaction);
  const existing = await env.context.VaultUpdate.get(id);
  if (existing) return existing;
  return createVaultUpdate(env, id, vault, transaction, depositedAmount, BIGINT_ZERO, sharesMinted, BIGINT_ZERO, balancePosition, BIGINT_ZERO, NO_NEW);
}

export async function deposit(
  env: Env,
  vault: Vault,
  transaction: Transaction,
  depositedAmount: bigint,
  sharesMinted: bigint,
  balancePosition: bigint,
): Promise<VaultUpdate> {
  const id = buildVaultUpdateIdFromVaultAndTransaction(vault, transaction);
  const existing = await env.context.VaultUpdate.get(id);
  if (existing) return existing;
  return createVaultUpdate(env, id, vault, transaction, depositedAmount, BIGINT_ZERO, sharesMinted, BIGINT_ZERO, balancePosition, BIGINT_ZERO, NO_NEW);
}

export async function withdraw(
  env: Env,
  vault: Vault,
  withdrawnAmount: bigint,
  sharesBurnt: bigint,
  transaction: Transaction,
  balancePosition: bigint,
): Promise<VaultUpdate> {
  const id = buildVaultUpdateIdFromVaultAndTransaction(vault, transaction);
  return createVaultUpdate(env, id, vault, transaction, BIGINT_ZERO, withdrawnAmount, BIGINT_ZERO, sharesBurnt, balancePosition, BIGINT_ZERO, NO_NEW);
}

export async function strategyReported(
  env: Env,
  vault: Vault,
  transaction: Transaction,
  balancePosition: bigint,
  grossReturnsGenerated: bigint,
): Promise<VaultUpdate> {
  const id = buildVaultUpdateIdFromVaultAndTransaction(vault, transaction);
  const feeTokensToTreasury = await tokenFeeLibrary.recognizeTreasuryFees(env.context, vault);
  const feeTokensToStrategist = await tokenFeeLibrary.recognizeStrategyFees(env.context, vault);
  const feesPaidDuringReport = feeTokensToTreasury + feeTokensToStrategist;
  const netReturnsGenerated = grossReturnsGenerated - feesPaidDuringReport;

  return createVaultUpdate(env, id, vault, transaction, BIGINT_ZERO, BIGINT_ZERO, BIGINT_ZERO, BIGINT_ZERO, balancePosition, netReturnsGenerated, {
    ...NO_NEW,
    feesPaid: feesPaidDuringReport,
  });
}

export async function performanceFeeUpdated(
  env: Env,
  vault: Vault,
  transaction: Transaction,
  balancePosition: bigint,
  performanceFee: bigint,
): Promise<VaultUpdate> {
  const id = buildVaultUpdateIdFromVaultAndTransaction(vault, transaction);
  return createVaultUpdate(env, id, vault, transaction, BIGINT_ZERO, BIGINT_ZERO, BIGINT_ZERO, BIGINT_ZERO, balancePosition, BIGINT_ZERO, {
    ...NO_NEW,
    newPerformanceFee: performanceFee,
  });
}

export async function managementFeeUpdated(
  env: Env,
  vault: Vault,
  transaction: Transaction,
  balancePosition: bigint,
  managementFee: bigint,
): Promise<VaultUpdate> {
  const id = buildVaultUpdateIdFromVaultAndTransaction(vault, transaction);
  return createVaultUpdate(env, id, vault, transaction, BIGINT_ZERO, BIGINT_ZERO, BIGINT_ZERO, BIGINT_ZERO, balancePosition, BIGINT_ZERO, {
    ...NO_NEW,
    newManagementFee: managementFee,
  });
}

export async function rewardsUpdated(
  env: Env,
  vault: Vault,
  transaction: Transaction,
  balancePosition: bigint,
  rewards: string,
): Promise<VaultUpdate> {
  const id = buildVaultUpdateIdFromVaultAndTransaction(vault, transaction);
  return createVaultUpdate(env, id, vault, transaction, BIGINT_ZERO, BIGINT_ZERO, BIGINT_ZERO, BIGINT_ZERO, balancePosition, BIGINT_ZERO, {
    ...NO_NEW,
    newRewards: rewards,
  });
}

export async function healthCheckUpdated(
  env: Env,
  vault: Vault,
  transaction: Transaction,
  healthCheck: string | null,
): Promise<void> {
  const id = buildVaultUpdateIdFromVaultAndTransaction(vault, transaction);
  let latest: VaultUpdate | undefined;
  if (vault.latestUpdate_id !== undefined) {
    latest = await env.context.VaultUpdate.get(vault.latestUpdate_id);
  }
  const balancePosition = latest ? latest.balancePosition : BIGINT_ZERO;
  await createVaultUpdate(env, id, vault, transaction, BIGINT_ZERO, BIGINT_ZERO, BIGINT_ZERO, BIGINT_ZERO, balancePosition, BIGINT_ZERO, {
    ...NO_NEW,
    newHealthCheck: healthCheck,
  });
}
