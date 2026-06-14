/**
 * Port of src/clearinghouse.ts handlers: handleRebalance, handleDefund.
 *
 * Snapshot id: the subgraph used a timeseries auto-id (`new ClearinghouseSnapshot(1)`);
 * here we reconstruct a deterministic id `clearinghouse-block-logIndex`
 * (the subgraph's own unused `getSnapshotRecordId` helper). Documented in MIGRATION.md.
 */
import { indexer, BigDecimal } from "envio";
import { getISO8601DateStringFromTimestamp, low, toDecimal } from "../utils";
import { getOrCreateClearinghouse, populateClearinghouseSnapshot, type Ctx } from "../services/clearinghouse";

const NEG_ONE = new BigDecimal(-1);

function snapshotId(clearinghouse: string, block: number, logIndex: number): string {
  return `${clearinghouse}-${block}-${logIndex}`;
}

indexer.onEvent(
  { contract: "Clearinghouse", event: "Rebalance" },
  async ({ event, context }) => {
    const ctx = context as unknown as Ctx;
    const chAddr = low(event.srcAddress);
    const block = { number: event.block.number, timestamp: event.block.timestamp };
    const clearinghouse = await getOrCreateClearinghouse(ctx, chAddr, block);
    if (clearinghouse === null) return;

    const multiplier = event.params.defund ? NEG_ONE : new BigDecimal(1);
    const amount = toDecimal(event.params.daiAmount, clearinghouse.reserveTokenDecimals).times(multiplier);

    const snap = await populateClearinghouseSnapshot(ctx, clearinghouse.address, block, event.transaction.hash);
    if (snap !== null) {
      context.ClearinghouseSnapshot.set({ ...snap, id: snapshotId(clearinghouse.address, event.block.number, event.logIndex) });
    }

    context.RebalanceEvent.set({
      id: `${clearinghouse.address}-${event.block.number}`,
      date: getISO8601DateStringFromTimestamp(BigInt(event.block.timestamp)),
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
      clearinghouse_id: clearinghouse.id,
      amount,
    });
  },
);

indexer.onEvent(
  { contract: "Clearinghouse", event: "Defund" },
  async ({ event, context }) => {
    const ctx = context as unknown as Ctx;
    const chAddr = low(event.srcAddress);
    const block = { number: event.block.number, timestamp: event.block.timestamp };
    const clearinghouse = await getOrCreateClearinghouse(ctx, chAddr, block);
    if (clearinghouse === null) return;

    // Always negative.
    const amount = toDecimal(event.params.amount, clearinghouse.reserveTokenDecimals).times(NEG_ONE);

    const snap = await populateClearinghouseSnapshot(ctx, clearinghouse.address, block, event.transaction.hash);
    if (snap !== null) {
      context.ClearinghouseSnapshot.set({ ...snap, id: snapshotId(clearinghouse.address, event.block.number, event.logIndex) });
    }

    context.DefundEvent.set({
      id: `${clearinghouse.address}-${event.block.number}`,
      date: getISO8601DateStringFromTimestamp(BigInt(event.block.timestamp)),
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
      clearinghouse_id: clearinghouse.id,
      amount,
    });
  },
);
