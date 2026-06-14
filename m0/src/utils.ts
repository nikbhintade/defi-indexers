/**
 * Helpers ported from the M0 `protocol` subgraph (src/utils.ts) plus the
 * graph-ts `Bytes`/`Address` semantics the mappings relied on for entity ids.
 */

export const SECONDS_PER_DAY = 86400n;

/** Lowercase an address/bytes hex string (subgraphs store lowercase). */
export const a = (x: string): string => x.toLowerCase();

/**
 * Replicates `Bytes#concatI32(i32)` used by every event-entity id in the
 * subgraph: `event.transaction.hash.concatI32(event.logIndex.toI32())`.
 *
 * graph-ts appends the i32 as 4 big-endian bytes to the tx-hash bytes and the
 * id is serialized as a lowercase `0x` hex string. So the id is the 32-byte tx
 * hash hex followed by the log index encoded as 8 lowercase hex digits.
 */
export function txHashConcatLogIndex(txHash: string, logIndex: number): string {
  const hash = txHash.toLowerCase();
  const suffix = (logIndex >>> 0).toString(16).padStart(8, "0");
  return hash + suffix;
}

/**
 * Get the unique day number from a timestamp (BigInt division, floor).
 * Mirrors `dayFromTimestamp` in the subgraph utils.
 */
export function dayFromTimestamp(timestamp: bigint): bigint {
  return timestamp / SECONDS_PER_DAY;
}
