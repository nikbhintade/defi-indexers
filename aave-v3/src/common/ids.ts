/**
 * Entity id construction ported from src/utils/id-generation.ts.
 *
 * graph-ts `Bytes.toHexString()` yields lowercase `0x…` hex; all ids here are
 * lowercase. Addresses arriving from HyperIndex are checksummed so callers
 * pass already-lowercased values (helpers lowercase defensively).
 *
 * DEVIATION: the subgraph's `getHistoryEntityId` appends
 * `event.transactionLogIndex` as a final ":"-joined component. HyperIndex does
 * not expose `transactionLogIndex`; we drop that final component and keep
 * block:txIndex:txHash:logIndex (still globally unique per log). Documented in
 * MIGRATION.md.
 */

export type HistoryEvent = {
  block: { number: number };
  transaction: { hash: string; transactionIndex: number };
  logIndex: number;
};

export function getHistoryEntityId(event: HistoryEvent): string {
  return (
    event.block.number.toString() +
    ":" +
    event.transaction.transactionIndex.toString() +
    ":" +
    event.transaction.hash.toLowerCase() +
    ":" +
    event.logIndex.toString()
  );
}

/** reserve id = underlyingAsset ++ poolId (subgraph: hex ++ poolId string). */
export function getReserveId(underlyingAsset: string, poolId: string): string {
  return underlyingAsset.toLowerCase() + poolId;
}

/** userReserve id = user ++ underlyingAsset ++ poolId. */
export function getUserReserveId(
  userAddress: string,
  underlyingAssetAddress: string,
  poolId: string,
): string {
  return userAddress.toLowerCase() + underlyingAssetAddress.toLowerCase() + poolId;
}
