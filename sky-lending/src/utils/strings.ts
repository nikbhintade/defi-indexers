/**
 * Port of src/utils/strings.ts.
 *
 * Subgraph used `event.transaction.hash.toHexString() + "-" + event.logIndex`.
 * HyperIndex delivers tx hash via field_selection. NB: the subgraph code used
 * `event.transactionLogIndex` in *log lines* and tx-event ids in some places,
 * but `createEventID` (the id actually persisted) uses `event.logIndex`, which
 * HyperIndex exposes directly.
 */
export function createEventID(hash: string, logIndex: number): string {
  return `${hash.toLowerCase()}-${logIndex.toString()}`;
}
