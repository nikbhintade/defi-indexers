/**
 * Port of loadTransaction (template/utils/index.ts). gasUsed is hard-coded to
 * ZERO_BI by the subgraph; gasPrice comes from event.transaction.gasPrice
 * (field_selection in config.yaml). The original used the lowercased tx hash
 * (Bytes.toHexString()) as the id.
 */
import { type EvmOnEventContext, type Transaction } from "envio";
import { ZERO_BI, low } from "./constants";

export async function loadTransaction(
  context: EvmOnEventContext,
  txHash: string,
  blockNumber: bigint,
  blockTimestamp: bigint,
  gasPrice: bigint | undefined,
): Promise<Transaction> {
  const id = low(txHash);
  const transaction: Transaction = {
    id,
    blockNumber,
    timestamp: blockTimestamp,
    gasUsed: ZERO_BI,
    gasPrice: gasPrice ?? ZERO_BI,
  };
  context.Transaction.set(transaction);
  return transaction;
}
