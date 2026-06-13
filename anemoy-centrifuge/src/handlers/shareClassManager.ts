/**
 * Port of src/handlers/shareClassManagerHandlers.ts (v3.1 events).
 * AddShareClass -> Token; UpdateMetadata; UpdatePricePoolPerShare -> Token price + TokenSnapshot.
 *
 * tokenYields augmentation on snapshots is DEFERRED (see MIGRATION.md): the
 * snapshot row is still written with the in-scope columns.
 */
import { indexer, type Token } from "envio";
import { getCentrifugeId, createdFields, updatedFields, tsToDate, optTxHash } from "../helpers/common";
import * as id from "../helpers/ids";

indexer.onEvent(
  { contract: "ShareClassManager", event: "AddShareClass" },
  async ({ event, context }) => {
    const centrifugeId = getCentrifugeId(event.chainId);
    const { poolId, scId, index, name, symbol, salt } = event.params;

    const pool = await context.Pool.get(id.poolId(poolId));
    if (!pool) return; // Pool not found. Cannot add share class
    const poolDecimals = pool.decimals;

    const tid = id.tokenId(scId);
    const existing = await context.Token.get(tid);
    // upsert: preserve createdAt on conflict
    context.Token.set({
      id: tid,
      poolId,
      centrifugeId,
      name,
      symbol,
      salt: id.lc(salt),
      decimals: poolDecimals ?? undefined,
      isActive: true,
      index: Number(index),
      totalIssuance: existing?.totalIssuance ?? 0n,
      tokenPrice: existing?.tokenPrice ?? 0n,
      tokenPriceComputedAt: existing?.tokenPriceComputedAt,
      ...(existing
        ? {
            createdAt: existing.createdAt,
            createdAtBlock: existing.createdAtBlock,
            createdAtTxHash: existing.createdAtTxHash,
            ...updatedFields(event),
          }
        : createdFields(event)),
    });
  },
);

indexer.onEvent(
  { contract: "ShareClassManager", event: "UpdateMetadata" },
  async ({ event, context }) => {
    const centrifugeId = getCentrifugeId(event.chainId);
    const { poolId, scId, name, symbol } = event.params;
    const tid = id.tokenId(scId);
    const existing = await context.Token.get(tid);
    const base: Token = existing ?? newToken(tid, poolId, centrifugeId, event);
    context.Token.set({ ...base, name, symbol, salt: undefined, ...updatedFields(event) });
  },
);

indexer.onEvent(
  { contract: "ShareClassManager", event: "UpdatePricePoolPerShare" },
  async ({ event, context }) => {
    const centrifugeId = getCentrifugeId(event.chainId);
    const { poolId, scId, price, computedAt } = event.params;
    const tid = id.tokenId(scId);
    const existing = await context.Token.get(tid);
    const base: Token = existing ?? newToken(tid, poolId, centrifugeId, event);
    const computedAtDate = tsToDate(computedAt);
    const token: Token = {
      ...base,
      tokenPrice: price,
      tokenPriceComputedAt: computedAtDate,
      ...updatedFields(event),
    };
    context.Token.set(token);

    // TokenSnapshot (trigger includes version per Ponder snapshotter)
    const trigger = "shareClassManagerV3_1:UpdatePricePoolPerShare";
    const snapId = id.tokenSnapshotId(scId, Number(event.block.number), trigger);
    if (!(await context.TokenSnapshot.get(snapId))) {
      context.TokenSnapshot.set({
        id: snapId,
        timestamp: tsToDate(event.block.timestamp),
        blockNumber: Number(event.block.number),
        trigger,
        triggerTxHash: optTxHash(event),
        triggerChainId: String(event.chainId),
        tokenId: id.lc(scId),
        tokenPrice: price,
        totalIssuance: token.totalIssuance,
        tokenPriceComputedAt: computedAtDate,
      });
    }
  },
);

function newToken(tid: string, poolId: bigint, centrifugeId: string, event: any): Token {
  return {
    id: tid,
    poolId,
    centrifugeId,
    name: undefined,
    symbol: undefined,
    salt: undefined,
    decimals: undefined,
    isActive: false,
    index: undefined,
    totalIssuance: 0n,
    tokenPrice: 0n,
    tokenPriceComputedAt: undefined,
    ...createdFields(event),
  };
}
