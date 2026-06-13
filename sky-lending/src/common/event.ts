/**
 * Build the normalized EventInfo from a HyperIndex event. tx fields come from
 * config.yaml field_selection (hash, from, nonce).
 *
 * NB on transactionLogIndex: the subgraph used `event.transactionLogIndex` in
 * a few *log* statements and as part of the persisted tx-event id is actually
 * `event.logIndex` (see createEventID). HyperIndex does not expose
 * transactionLogIndex, so we use `event.logIndex` everywhere (documented).
 */
import type { EventInfo } from "./types";

const low = (a: string): string => a.toLowerCase();

type AnyEvent = {
  block: { number: number; timestamp: number };
  logIndex: number;
  srcAddress: string;
  transaction: { hash: string; from?: string | undefined; nonce?: bigint | undefined };
};

export function toEventInfo(event: AnyEvent, effect: EventInfo["effect"]): EventInfo {
  return {
    hash: low(event.transaction.hash),
    logIndex: event.logIndex,
    nonce: event.transaction.nonce ?? 0n,
    from: low(event.transaction.from ?? "0x0000000000000000000000000000000000000000"),
    blockNumber: BigInt(event.block.number),
    timestamp: BigInt(event.block.timestamp),
    srcAddress: low(event.srcAddress),
    effect,
  };
}

export { low };
