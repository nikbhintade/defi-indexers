/**
 * Port of src/handlers/balanceSheetHandlers.ts.
 * NoteDeposit / Withdraw -> HoldingEscrow assetAmount (+ HoldingEscrowSnapshot).
 * UpdateManager -> Account + PoolManager.isBalancesheetManager.
 *
 * HoldingEscrowService.increase/decreaseAssetAmount are correctly parenthesized
 * in the source (unlike HoldingService), so these DO accumulate.
 */
import { indexer, type Account, type PoolManager } from "envio";
import {
  getCentrifugeId,
  createdFields,
  updatedFields,
  truncateToAddress,
} from "../helpers/common";
import * as id from "../helpers/ids";
import {
  ensureAccount,
  latestEscrowAddress,
  upsertHoldingEscrow,
  writeHoldingEscrowSnapshot,
} from "./spoke";

async function resolveAsset(context: any, centrifugeId: string, address: string, assetTokenId: bigint) {
  const addr = id.lc(address);
  const candidates = await context.Asset.getWhere({ address: { _eq: addr } });
  const matches = candidates
    .filter(
      (a: any) =>
        a.centrifugeId === centrifugeId && a.address === addr && a.assetTokenId === assetTokenId,
    )
    .sort((a: any, b: any) => (b.createdAtBlock ?? 0) - (a.createdAtBlock ?? 0));
  return matches[0];
}

indexer.onEvent({ contract: "BalanceSheet", event: "NoteDeposit" }, async ({ event, context }) => {
  const centrifugeId = getCentrifugeId(event.chainId);
  const { poolId, scId, asset, tokenId: assetTokenId, amount, pricePoolPerAsset } = event.params;
  const assetRow = await resolveAsset(context, centrifugeId, asset, assetTokenId);
  if (!assetRow) return;
  const escrowAddress = await latestEscrowAddress(context, poolId, centrifugeId);
  if (!escrowAddress) return;
  const he = await upsertHoldingEscrow(context, event, {
    poolId,
    scId,
    centrifugeId,
    assetAddress: asset,
    assetId: BigInt(assetRow.id),
    escrowAddress,
  });
  const updated = {
    ...he,
    escrowAddress: id.lc(escrowAddress),
    assetAmount: (he.assetAmount ?? 0n) + amount,
    assetPrice: pricePoolPerAsset,
  };
  context.HoldingEscrow.set({ ...updated, ...updatedFields(event) });
  writeHoldingEscrowSnapshot(context, event, updated, "balanceSheetV3_1:NoteDeposit");
});

indexer.onEvent({ contract: "BalanceSheet", event: "Withdraw" }, async ({ event, context }) => {
  const centrifugeId = getCentrifugeId(event.chainId);
  const { poolId, scId, asset, tokenId: assetTokenId, amount, pricePoolPerAsset } = event.params;
  const assetRow = await resolveAsset(context, centrifugeId, asset, assetTokenId);
  if (!assetRow) return;
  const escrowAddress = await latestEscrowAddress(context, poolId, centrifugeId);
  if (!escrowAddress) return;
  const he = await upsertHoldingEscrow(context, event, {
    poolId,
    scId,
    centrifugeId,
    assetAddress: asset,
    assetId: BigInt(assetRow.id),
    escrowAddress,
  });
  const updated = {
    ...he,
    escrowAddress: id.lc(escrowAddress),
    assetAmount: (he.assetAmount ?? 0n) - amount,
    assetPrice: pricePoolPerAsset,
  };
  context.HoldingEscrow.set({ ...updated, ...updatedFields(event) });
  writeHoldingEscrowSnapshot(context, event, updated, "balanceSheetV3_1:Withdraw");
});

indexer.onEvent(
  { contract: "BalanceSheet", event: "UpdateManager" },
  async ({ event, context }) => {
    const centrifugeId = getCentrifugeId(event.chainId);
    const { who, poolId, canManage } = event.params;
    const manager = truncateToAddress(who);
    await ensureAccount(context, manager, event);

    const pmId = id.poolManagerId(manager, centrifugeId, poolId);
    const existing = await context.PoolManager.get(pmId);
    const base: PoolManager =
      existing ?? {
        id: pmId,
        address: manager,
        centrifugeId,
        poolId,
        isHubManager: false,
        isBalancesheetManager: false,
        crosschainInProgress: undefined,
        ...createdFields(event),
      };
    context.PoolManager.set({
      ...base,
      crosschainInProgress: undefined,
      isBalancesheetManager: canManage,
      ...updatedFields(event),
    });
  },
);
