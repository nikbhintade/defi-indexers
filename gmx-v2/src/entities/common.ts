import type { Transaction } from "envio";
import type { handlerContext, TxEv } from "../types";

const a = (x: string | undefined): string => (x ? x.toLowerCase() : "");

/** Port of getIdFromEvent: txHash + ":" + logIndex. envio exposes logIndex. */
export function getIdFromEvent(event: TxEv): string {
  return event.transaction.hash.toLowerCase() + ":" + event.logIndex.toString();
}

/** Port of getOrCreateTransaction. */
export async function getOrCreateTransaction(
  context: handlerContext,
  event: TxEv,
): Promise<Transaction> {
  const id = event.transaction.hash.toLowerCase();
  let entity = await context.Transaction.get(id);

  if (entity == null) {
    entity = {
      id,
      hash: event.transaction.hash.toLowerCase(),
      timestamp: event.block.timestamp,
      blockNumber: event.block.number,
      transactionIndex: event.transaction.transactionIndex,
      from: a(event.transaction.from),
      // subgraph: to == null -> "" ; else lowercase hex
      to: event.transaction.to == null ? "" : a(event.transaction.to),
    };
    context.Transaction.set(entity);
  }

  return entity;
}
