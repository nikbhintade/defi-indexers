/**
 * Shared structural types used by the ported mapping helpers.
 *
 * The original AssemblyScript helpers all take `event: ethereum.Event`; the
 * port passes the envio event object, typed structurally so every handler's
 * event is compatible (transaction fields only where field_selection
 * provides them).
 */
import type { EvmOnEventContext } from "envio";

/** Minimal event shape needed by most helpers (block + logIndex). */
export type Ev = {
  readonly block: { readonly number: number; readonly timestamp: number };
  readonly logIndex: number;
};

/** Event shape for handlers that build Transaction entities. */
export type TxEv = Ev & {
  readonly transaction: {
    readonly hash: string;
    readonly from: string | undefined;
    readonly to: string | undefined;
    readonly gas: bigint;
    readonly gasPrice: bigint | undefined;
    readonly gasUsed: bigint;
  };
};

export type Ctx = EvmOnEventContext;

/**
 * AssemblyScript entities are mutable objects that get `.save()`d; envio
 * entities are readonly. Helpers that mutate-then-save take `Mutable<T>`
 * copies (`{ ...stored }`) so the original mutation flow can be mirrored
 * 1:1 (mutations are invisible to `context.X.get` until `context.X.set`,
 * exactly like unsaved graph-node entities are invisible to `load`).
 */
export type Mutable<T> = { -readonly [P in keyof T]: T[P] };
