/**
 * Ported from liquity/dev packages/subgraph/src/entities/Transaction.ts.
 * id = transaction hash (lowercase hex).
 */
import type { EvmOnEventContext as handlerContext, Transaction } from "envio";

import { getTransactionSequenceNumber } from "./Global";
import type { ChangeCommon } from "./Change";
import { a } from "../utils/constants";

export async function getTransaction(
  context: handlerContext,
  event: ChangeCommon,
): Promise<Transaction> {
  const transactionId = a(event.transaction.hash);
  const transactionOrNull = await context.Transaction.get(transactionId);

  if (transactionOrNull != null) {
    return transactionOrNull;
  } else {
    const sequenceNumber = await getTransactionSequenceNumber(context);
    const newTransaction: Transaction = {
      id: transactionId,
      sequenceNumber,
      blockNumber: event.block.number,
      timestamp: event.block.timestamp,
    };
    context.Transaction.set(newTransaction);
    return newTransaction;
  }
}
