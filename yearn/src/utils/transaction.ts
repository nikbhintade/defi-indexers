/**
 * Ported from src/utils/transaction.ts.
 *
 * The subgraph's getOrCreateTransactionFromEvent builds a Transaction entity
 * keyed by `txHash-logIndex`. We mirror the field population exactly.
 *
 * Call-handler variant (getOrCreateTransactionFromCall) is omitted: HyperIndex
 * has no call handlers, and the subgraph's deposit()/withdraw() call handlers
 * are redundant with the Deposit/Withdraw *events* (both invoke the same
 * vaultLibrary.deposit/withdraw). See MIGRATION.md.
 */
import type { Ctx } from "./types";
import type { Transaction } from "envio";
import { getTimestampInMillis, low } from "./commons";
import { ZERO_ADDRESS } from "./constants";

/** Minimal event shape we need from any onEvent event. */
export type TxEvent = {
  logIndex: number;
  block: { number: number; timestamp: number; gasLimit: bigint };
  transaction: {
    hash: string;
    from: string | undefined;
    to: string | undefined;
    gas: bigint;
    gasPrice: bigint | undefined;
    value: bigint;
    transactionIndex: number;
  };
};

export function getTransactionId(transactionHash: string, logIndex: number): string {
  return low(transactionHash) + "-" + logIndex.toString();
}

export async function getOrCreateTransactionFromEvent(
  context: Ctx,
  event: TxEvent,
  action: string,
): Promise<Transaction> {
  const tx = event.transaction;
  const id = getTransactionId(tx.hash, event.logIndex);
  const existing = await context.Transaction.get(id);
  if (existing) return existing;

  // Contract-create txs have a null `to`; subgraph substitutes ZERO_ADDRESS.
  const toAddress = tx.to ? low(tx.to) : ZERO_ADDRESS;
  const transaction: Transaction = {
    id,
    logIndex: BigInt(event.logIndex),
    from: tx.from ? low(tx.from) : ZERO_ADDRESS,
    gasPrice: tx.gasPrice ?? 0n,
    gasLimit: tx.gas,
    hash: low(tx.hash),
    index: BigInt(tx.transactionIndex),
    to: toAddress,
    value: tx.value,
    timestamp: getTimestampInMillis(event.block.timestamp),
    blockGasLimit: event.block.gasLimit,
    blockNumber: BigInt(event.block.number),
    event: action,
  };
  context.Transaction.set(transaction);
  return transaction;
}
