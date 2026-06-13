/**
 * Shared types: a normalized event-info object threaded through the ported
 * helpers (the subgraph passed the raw `ethereum.Event`), plus a Mutable<T>
 * helper since HyperIndex entities are readonly objects.
 */
import type { EvmOnEventContext, EffectCaller } from "envio";

export type Ctx = EvmOnEventContext;

export type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** Normalized subset of `ethereum.Event` used by the ported helpers. */
export type EventInfo = {
  hash: string;
  logIndex: number;
  nonce: bigint;
  from: string; // tx.from, lowercased
  blockNumber: bigint;
  timestamp: bigint;
  srcAddress: string; // event.address, lowercased
  effect: EffectCaller;
};
