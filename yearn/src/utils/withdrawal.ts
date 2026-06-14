/** Ported from src/utils/withdrawal.ts. */
import type { Account, Transaction, Vault, Withdrawal } from "envio";
import type { Ctx } from "./types";
import { buildVaultUpdateId } from "./vault-update-id";

export function buildWithdrawalId(account: Account, transaction: Transaction): string {
  return account.id + "-" + transaction.id + "-" + transaction.index.toString();
}

export async function getOrCreateWithdrawal(
  context: Ctx,
  account: Account,
  vault: Vault,
  transaction: Transaction,
  tokenAmount: bigint,
  sharesBurnt: bigint,
): Promise<Withdrawal> {
  const id = buildWithdrawalId(account, transaction);
  const existing = await context.Withdrawal.get(id);
  if (existing) return existing;

  const withdrawal: Withdrawal = {
    id,
    timestamp: transaction.timestamp,
    blockNumber: transaction.blockNumber,
    account_id: account.id,
    vault_id: vault.id,
    tokenAmount,
    sharesBurnt,
    transaction_id: transaction.id,
    vaultUpdate_id: buildVaultUpdateId(vault.id, transaction.id, transaction.index.toString()),
  };
  context.Withdrawal.set(withdrawal);
  return withdrawal;
}
