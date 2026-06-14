/**
 * Ported from liquity/dev packages/subgraph/src/entities/Change.ts.
 *
 * The subgraph's `Change` is a GraphQL interface; here each *Change entity is
 * standalone (see schema.graphql note). The shared lifecycle is:
 *   beginChange()  -> next global change sequence number (the global counter).
 *   initChange()   -> fills id/sequenceNumber/transaction/systemStateBefore.
 *   finishChange() -> reads the (possibly bumped) current system state id to
 *                     use as systemStateAfter.
 * Because envio entities are immutable objects, init/finish return field values
 * the per-entity creators splice into their concrete records instead of
 * mutating a shared Entity in place.
 */
import type { EvmOnEventContext as handlerContext } from "envio";

import { getChangeSequenceNumber } from "./Global";
import { getTransaction } from "./Transaction";
import { getCurrentSystemState } from "./SystemState";

/** Minimal shape of the parts of an ethereum.Event the change machinery uses. */
export type ChangeCommon = {
  transaction: { hash: string };
  block: { number: number; timestamp: number };
};

export async function beginChange(context: handlerContext): Promise<number> {
  return getChangeSequenceNumber(context);
}

export async function initChange(
  context: handlerContext,
  event: ChangeCommon,
  _sequenceNumber: number,
): Promise<{ transaction_id: string; systemStateBefore_id: string }> {
  const transactionId = (await getTransaction(context, event)).id;
  const systemStateBeforeId = (await getCurrentSystemState(context)).id;

  return {
    transaction_id: transactionId,
    systemStateBefore_id: systemStateBeforeId,
  };
}

export async function finishChange(context: handlerContext): Promise<string> {
  return (await getCurrentSystemState(context)).id;
}
