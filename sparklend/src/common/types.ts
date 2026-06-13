/**
 * Shared structural types for ported helpers.
 *
 * Original AssemblyScript helpers take `event: ethereum.Event`; the port
 * passes the envio event object typed structurally. graph-node entities are
 * mutable; envio entities are readonly, so helpers mutate `{ ...stored }`
 * copies and write back with `context.X.set`.
 */
import type { EvmOnEventContext } from "envio";

export type Ctx = EvmOnEventContext;

/** Event shape needed by helpers that build history-entity ids. */
export type Ev = {
  readonly block: { readonly number: number; readonly timestamp: number };
  readonly logIndex: number;
  readonly srcAddress: string;
  readonly transaction: { readonly hash: string; readonly transactionIndex: number };
};

export type Mutable<T> = { -readonly [P in keyof T]: T[P] };
