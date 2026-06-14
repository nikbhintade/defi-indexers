/** Ported from vault-update.buildIdFromVaultTxHashAndIndex (kept separate to avoid import cycles). */
import type { Transaction, Vault } from "envio";

/** id = vault-txId-txIndex (txId is already txHash-logIndex). */
export function buildVaultUpdateId(vault: string, transactionId: string, transactionIndex: string): string {
  return vault + "-" + transactionId + "-" + transactionIndex;
}

export function buildVaultUpdateIdFromVaultAndTransaction(vault: Vault, transaction: Transaction): string {
  return buildVaultUpdateId(vault.id, transaction.id, transaction.index.toString());
}
