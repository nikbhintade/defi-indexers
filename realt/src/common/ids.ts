/**
 * Entity id construction ported from src/utils/id-generation.ts.
 *
 * graph-ts `Bytes.toHexString()` yields lowercase `0x…` hex; all ids here are
 * lowercase.
 *
 * DEVIATION: the subgraph's `getHistoryEntityId` is
 *   block.number ":" transaction.index ":" transaction.hash ":" logIndex ":" transactionLogIndex
 * HyperIndex does not expose `transactionLogIndex`; we drop that final component
 * and keep block:txIndex:txHash:logIndex (still globally unique per log).
 * Documented in MIGRATION.md.
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

/** reserve id = underlyingAsset(hex) ++ poolId. */
export function getReserveId(underlyingAsset: string, poolId: string): string {
  return underlyingAsset.toLowerCase() + poolId;
}

/** userReserve id = user(hex) ++ underlyingAsset(hex) ++ poolId. */
export function getUserReserveId(
  userAddress: string,
  underlyingAssetAddress: string,
  poolId: string,
): string {
  return userAddress.toLowerCase() + underlyingAssetAddress.toLowerCase() + poolId;
}

/** aToken/sToken/vToken id = the token address (lowercase). */
export function getAtokenId(aTokenAddress: string): string {
  return aTokenAddress.toLowerCase();
}
