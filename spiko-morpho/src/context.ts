/**
 * Shared handler-context type. All SDK helpers take the full envio
 * `EvmOnEventContext` (entity stores + `effect` + `log`), which is also what
 * `indexer.onEvent` passes, so the wiring is uniform and type-safe.
 */
import type { EvmOnEventContext } from "envio";

export type Context = EvmOnEventContext;

/**
 * Normalized event shape used across the SDK helpers. HyperIndex delivers
 * `block.number`/`block.timestamp` as `number`; the subgraph stored them as
 * BigInt, so we widen them once here and thread the result everywhere.
 */
export type Ev = {
  block: { number: bigint; timestamp: bigint };
  transaction: { hash: string; nonce: bigint; gasPrice?: bigint; gas?: bigint };
  logIndex: number;
  srcAddress: string;
};

type RawEvent = {
  block: { number: number; timestamp: number };
  transaction: {
    hash: string;
    nonce: bigint;
    gasPrice?: bigint | undefined;
    gas?: bigint;
  };
  logIndex: number;
  srcAddress: string;
};

export function normEvent(event: RawEvent): Ev {
  return {
    block: {
      number: BigInt(event.block.number),
      timestamp: BigInt(event.block.timestamp),
    },
    transaction: {
      hash: event.transaction.hash,
      nonce: event.transaction.nonce,
      gasPrice: event.transaction.gasPrice ?? undefined,
      gas: event.transaction.gas,
    },
    logIndex: event.logIndex,
    srcAddress: event.srcAddress,
  };
}
