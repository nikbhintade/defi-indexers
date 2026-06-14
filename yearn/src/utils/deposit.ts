/** Ported from src/utils/deposit.ts. */
import type { Account, Deposit, Transaction, Vault } from "envio";
import type { Ctx } from "./types";
import { buildVaultUpdateId } from "./vault-update-id";

export function buildDepositId(account: Account, transaction: Transaction): string {
  // account-txId-txIndex  (txId is already txHash-logIndex)
  return account.id + "-" + transaction.id + "-" + transaction.index.toString();
}

export async function getOrCreateDeposit(
  context: Ctx,
  account: Account,
  vault: Vault,
  transaction: Transaction,
  amount: bigint,
  sharesMinted: bigint,
): Promise<Deposit> {
  const id = buildDepositId(account, transaction);
  const existing = await context.Deposit.get(id);
  if (existing) return existing;

  const deposit: Deposit = {
    id,
    timestamp: transaction.timestamp,
    blockNumber: transaction.blockNumber,
    account_id: account.id,
    vault_id: vault.id,
    tokenAmount: amount,
    sharesMinted,
    transaction_id: transaction.id,
    // the vault update entity is created later; id references it by convention
    vaultUpdate_id: buildVaultUpdateId(vault.id, transaction.id, transaction.index.toString()),
  };
  context.Deposit.set(deposit);
  return deposit;
}
