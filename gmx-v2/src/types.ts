/**
 * Shared structural types for the ported GMX V2 mapping helpers.
 *
 * The subgraph entities are mutable graph-ts objects that get `.save()`d;
 * envio entities are readonly plain objects. Helpers that mutate-then-save
 * take `Mutable<T>` copies (`{ ...stored }`) so the original flow is mirrored
 * 1:1 — mutations are invisible to `context.X.get` until `context.X.set`,
 * exactly like unsaved graph-node entities are invisible to `load`.
 */
import type { EvmOnEventContext } from "envio";

export type handlerContext = EvmOnEventContext;

export type Mutable<T> = { -readonly [P in keyof T]: T[P] };

/** Minimal event shape for helpers that only read block + logIndex. */
export type Ev = {
  readonly block: { readonly number: number; readonly timestamp: number };
  readonly logIndex: number;
};

/** Event shape for handlers that build Transaction entities (EventEmitter + templates). */
export type TxEv = Ev & {
  readonly transaction: {
    readonly hash: string;
    readonly from: string | undefined;
    readonly to: string | undefined;
    readonly transactionIndex: number;
  };
};
