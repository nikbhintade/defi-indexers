/**
 * Port of src/handlers/holdingsHandlers.ts. Initialize/Increase/Decrease/
 * Update/UpdateValuation -> Holding (+ HoldingAccount on Initialize) (+
 * HoldingSnapshot on Increase/Update/UpdateValuation).
 *
 * IMPORTANT — faithful replication of a source bug: HoldingService.increase/
 * decrease/update use `field ?? 0n + amount`, where `??` binds looser than `+`.
 * Because assetQuantity/totalValue default to 0n (non-null), the RHS is never
 * taken: increase/decrease/update are effectively no-ops on the amount fields.
 * We replicate that exactly so this port matches the production api-v3 data.
 */
import { indexer, type Holding } from "envio";
import { getCentrifugeId, createdFields, updatedFields, tsToDate } from "../helpers/common";
import * as id from "../helpers/ids";

const HoldingAccountTypes = ["Asset", "Equity", "Loss", "Gain", "Expense", "Liability"] as const;

async function getOrInitHolding(
  context: any,
  event: any,
  centrifugeId: string,
  poolId: bigint,
  scId: string,
  assetId: bigint,
): Promise<Holding> {
  const hId = id.holdingId(scId, assetId);
  const existing = await context.Holding.get(hId);
  if (existing) return existing;
  return {
    id: hId,
    centrifugeId,
    poolId,
    tokenId: id.lc(scId),
    isInitialized: false,
    isLiability: undefined,
    valuation: undefined,
    assetId,
    assetQuantity: 0n,
    totalValue: 0n,
    ...createdFields(event),
  };
}

function writeHoldingSnapshot(context: any, event: any, h: Holding, trigger: string) {
  const snapId = id.holdingSnapshotId(h.tokenId, h.assetId, Number(event.block.number), trigger);
  context.HoldingSnapshot.set({
    id: snapId,
    timestamp: tsToDate(event.block.timestamp),
    blockNumber: Number(event.block.number),
    trigger,
    triggerTxHash: event.transaction?.hash?.toLowerCase(),
    triggerChainId: String(event.chainId),
    tokenId: h.tokenId,
    assetId: h.assetId,
    assetQuantity: h.assetQuantity ?? 0n,
    totalValue: h.totalValue ?? 0n,
  });
}

indexer.onEvent({ contract: "Holdings", event: "Initialize" }, async ({ event, context }) => {
  const centrifugeId = getCentrifugeId(event.chainId);
  const { poolId, scId, assetId, valuation, isLiability, accounts } = event.params;
  const h = await getOrInitHolding(context, event, centrifugeId, poolId, scId, assetId);
  context.Holding.set({
    ...h,
    isInitialized: true,
    isLiability,
    valuation: id.lc(valuation),
    ...updatedFields(event),
  });

  for (const acct of accounts) {
    const kindIdx = isLiability ? Number(acct.kind) + 4 : Number(acct.kind);
    const kind = HoldingAccountTypes[kindIdx];
    if (!kind) continue;
    const haId = id.holdingAccountId(String(acct.accountId));
    if (await context.HoldingAccount.get(haId)) continue;
    context.HoldingAccount.set({
      id: haId,
      tokenId: id.lc(scId),
      kind,
      ...createdFields(event),
    });
  }
});

indexer.onEvent({ contract: "Holdings", event: "Increase" }, async ({ event, context }) => {
  const centrifugeId = getCentrifugeId(event.chainId);
  const { poolId, scId, assetId } = event.params;
  const h = await getOrInitHolding(context, event, centrifugeId, poolId, scId, assetId);
  // Faithful no-op (see file header): assetQuantity/totalValue unchanged when already set.
  const updated = { ...h, ...updatedFields(event) };
  context.Holding.set(updated);
  writeHoldingSnapshot(context, event, updated, "holdingsV3_1:Increase");
});

indexer.onEvent({ contract: "Holdings", event: "Decrease" }, async ({ event, context }) => {
  const centrifugeId = getCentrifugeId(event.chainId);
  const { poolId, scId, assetId } = event.params;
  const h = await getOrInitHolding(context, event, centrifugeId, poolId, scId, assetId);
  const updated = { ...h, ...updatedFields(event) };
  context.Holding.set(updated);
});

indexer.onEvent({ contract: "Holdings", event: "Update" }, async ({ event, context }) => {
  const centrifugeId = getCentrifugeId(event.chainId);
  const { poolId, scId, assetId } = event.params;
  const h = await getOrInitHolding(context, event, centrifugeId, poolId, scId, assetId);
  const updated = { ...h, ...updatedFields(event) };
  context.Holding.set(updated);
  writeHoldingSnapshot(context, event, updated, "holdingsV3_1:Update");
});

indexer.onEvent(
  { contract: "Holdings", event: "UpdateValuation" },
  async ({ event, context }) => {
    const centrifugeId = getCentrifugeId(event.chainId);
    const { poolId, scId, assetId, valuation } = event.params;
    const h = await getOrInitHolding(context, event, centrifugeId, poolId, scId, assetId);
    const updated = { ...h, valuation: id.lc(valuation), ...updatedFields(event) };
    context.Holding.set(updated);
    writeHoldingSnapshot(context, event, updated, "holdingsV3_1:UpdateValuation");
  },
);

indexer.onEvent(
  { contract: "Holdings", event: "UpdateIsLiability" },
  async ({ event, context }) => {
    const centrifugeId = getCentrifugeId(event.chainId);
    const { poolId, scId, assetId, isLiability } = event.params;
    const h = await getOrInitHolding(context, event, centrifugeId, poolId, scId, assetId);
    context.Holding.set({ ...h, isLiability, ...updatedFields(event) });
  },
);
