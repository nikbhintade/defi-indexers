/**
 * Port of src/handlers/batchRequestManagerHandlers.ts (v3.1 events).
 *
 * Drives the epoch order lifecycle: pending orders -> approval -> issuance/
 * revocation -> claim, across PendingInvestOrder/PendingRedeemOrder,
 * EpochOutstandingInvest/Redeem, EpochInvestOrder/EpochRedeemOrder,
 * InvestOrder/RedeemOrder.
 *
 * Multi-field queries in the source (e.g. {tokenId, assetId, index, approvedAt_not:null,
 * issuedAt:null}) are realised here via HyperIndex `getWhere` on the most-selective
 * @index field plus in-memory filtering — equivalent result, documented in MIGRATION.md.
 *
 * DEFERRED: basin reconciliation links (linkBasinRedeemOrderToEpoch).
 */
import {
  indexer,
  type PendingInvestOrder,
  type PendingRedeemOrder,
  type EpochOutstandingInvest,
  type EpochOutstandingRedeem,
  type EpochInvestOrder,
  type EpochRedeemOrder,
  type InvestOrder,
  type RedeemOrder,
} from "envio";
import { createdFields, updatedFields, phaseFields, tsToDate } from "../helpers/common";
import * as id from "../helpers/ids";
import { ensureAccount, writeHoldingEscrowSnapshot } from "./spoke";

const truncate = (x: string): string => x.substring(0, 42).toLowerCase();

function computeApprovedPercentage(approveAmount: bigint, pendingAmount: bigint): bigint {
  return (approveAmount * 10n ** 21n) / (pendingAmount + approveAmount);
}
function computeApprovedUserAmount(totalApprovedAmount: bigint, approvedPercentage: bigint): bigint {
  return (totalApprovedAmount * approvedPercentage) / 10n ** 21n;
}

async function assetDecimals(context: any, assetId: bigint): Promise<number | undefined> {
  if (assetId < 1000n) return 18;
  const a = await context.Asset.get(id.assetId(assetId));
  return a?.decimals ?? undefined;
}

// ---------------- UpdateDepositRequest ----------------
indexer.onEvent(
  { contract: "BatchRequestManager", event: "UpdateDepositRequest" },
  async ({ event, context }) => {
    const { poolId, shareClassId: scId, assetId, investor, pendingAmount, queuedUserAmount } =
      event.params;
    const account = truncate(investor);
    await ensureAccount(context, account, event);

    const pioId = id.pendingOrderId(scId, assetId, account);
    const existing = await context.PendingInvestOrder.get(pioId);
    const last = existing ?? newPendingInvest(pioId, poolId, scId, assetId, account, event);
    const lastQueued = last.queuedAssetsAmount ?? 0n;
    const updatedPio: PendingInvestOrder = {
      ...last,
      queuedAssetsAmount: queuedUserAmount,
      pendingAssetsAmount: queuedUserAmount === 0n ? pendingAmount : last.pendingAssetsAmount,
      ...updatedFields(event),
    };
    saveOrClearPendingInvest(context, updatedPio);

    const eoiId = id.epochOutstandingId(scId, assetId);
    const eoi = (await context.EpochOutstandingInvest.get(eoiId)) ??
      newEpochOutstandingInvest(eoiId, poolId, scId, assetId, event);
    const delta = queuedUserAmount - lastQueued;
    const updatedEoi: EpochOutstandingInvest = {
      ...eoi,
      pendingAssetsAmount: pendingAmount,
      queuedAssetsAmount: (eoi.queuedAssetsAmount ?? 0n) + delta,
      ...updatedFields(event),
    };
    saveOrClearEpochOutstandingInvest(context, updatedEoi);
  },
);

// ---------------- UpdateRedeemRequest ----------------
indexer.onEvent(
  { contract: "BatchRequestManager", event: "UpdateRedeemRequest" },
  async ({ event, context }) => {
    const { poolId, shareClassId: scId, assetId, investor, pendingAmount, queuedUserAmount } =
      event.params;
    const account = truncate(investor);
    await ensureAccount(context, account, event);

    const proId = id.pendingOrderId(scId, assetId, account);
    const existing = await context.PendingRedeemOrder.get(proId);
    const last = existing ?? newPendingRedeem(proId, poolId, scId, assetId, account, event);
    const lastQueued = last.queuedSharesAmount ?? 0n;
    const updatedPro: PendingRedeemOrder = {
      ...last,
      queuedSharesAmount: queuedUserAmount,
      pendingSharesAmount: queuedUserAmount === 0n ? pendingAmount : last.pendingSharesAmount,
      ...updatedFields(event),
    };
    saveOrClearPendingRedeem(context, updatedPro);

    const eorId = id.epochOutstandingId(scId, assetId);
    const eor = (await context.EpochOutstandingRedeem.get(eorId)) ??
      newEpochOutstandingRedeem(eorId, poolId, scId, assetId, event);
    const delta = queuedUserAmount - lastQueued;
    const updatedEor: EpochOutstandingRedeem = {
      ...eor,
      pendingSharesAmount: pendingAmount,
      queuedSharesAmount: (eor.queuedSharesAmount ?? 0n) + delta,
      ...updatedFields(event),
    };
    saveOrClearEpochOutstandingRedeem(context, updatedEor);
  },
);

// ---------------- ApproveDeposits ----------------
indexer.onEvent(
  { contract: "BatchRequestManager", event: "ApproveDeposits" },
  async ({ event, context }) => {
    const { poolId, shareClassId: scId, assetId, epochId, approvedPoolAmount, approvedAssetAmount, pendingAssetAmount } =
      event.params;
    const epochIndex = Number(epochId);
    const decimals = await assetDecimals(context, assetId);
    if (!decimals) return;

    const approvedPercentage = computeApprovedPercentage(approvedAssetAmount, pendingAssetAmount);

    const eioId = id.epochOrderId(scId, assetId, epochIndex);
    if (!(await context.EpochInvestOrder.get(eioId))) {
      const eio: EpochInvestOrder = {
        id: eioId,
        poolId,
        tokenId: id.lc(scId),
        assetId,
        index: epochIndex,
        ...(phaseFields("approved", event) as any),
        approvedAssetsAmount: approvedAssetAmount,
        approvedPoolAmount,
        approvedPercentageOfTotalPending: approvedPercentage,
        issuedSharesAmount: 0n,
        issuedWithNavPoolPerShare: 0n,
        issuedWithNavAssetPerShare: 0n,
        ...(phaseFields("issued", null) as any),
        ...createdFields(event),
      };
      context.EpochInvestOrder.set(eio);
    }

    const eoiId = id.epochOutstandingId(scId, assetId);
    const eoi = (await context.EpochOutstandingInvest.get(eoiId)) ??
      newEpochOutstandingInvest(eoiId, poolId, scId, assetId, event);
    saveOrClearEpochOutstandingInvest(context, {
      ...eoi,
      pendingAssetsAmount: pendingAssetAmount,
      ...updatedFields(event),
    });

    const pendings: PendingInvestOrder[] = (
      await context.PendingInvestOrder.getWhere({ tokenId: { _eq: id.lc(scId) } })
    ).filter((p: PendingInvestOrder) => p.assetId === assetId && (p.pendingAssetsAmount ?? 0n) > 0n);

    for (const pio of pendings) {
      const pending = pio.pendingAssetsAmount ?? 0n;
      const approvedUser = computeApprovedUserAmount(pending, approvedPercentage);
      const ioId = id.orderId(scId, assetId, pio.account, epochIndex);
      const io: InvestOrder = {
        id: ioId,
        poolId,
        tokenId: id.lc(scId),
        assetId,
        account: pio.account,
        index: epochIndex,
        ...(phaseFields("approved", event) as any),
        approvedAssetsAmount: approvedUser,
        issuedSharesAmount: 0n,
        issuedWithNavPoolPerShare: 0n,
        issuedWithNavAssetPerShare: 0n,
        ...(phaseFields("issued", null) as any),
        ...(phaseFields("claimed", null) as any),
        claimedSharesAmount: 0n,
        ...createdFields(event),
      };
      context.InvestOrder.set(io);
      saveOrClearPendingInvest(context, {
        ...pio,
        pendingAssetsAmount: pending - approvedUser,
        ...updatedFields(event),
      });
    }

    await snapshotHoldingEscrows(context, event, scId, "shareClassManagerV3:ApproveDeposits");
  },
);

// ---------------- ApproveRedeems ----------------
indexer.onEvent(
  { contract: "BatchRequestManager", event: "ApproveRedeems" },
  async ({ event, context }) => {
    const { poolId, shareClassId: scId, assetId, epochId, approvedShareAmount, pendingShareAmount } =
      event.params;
    const epochIndex = Number(epochId);
    const pool = await context.Pool.get(id.poolId(poolId));
    if (!pool || pool.currency == null) return;

    const approvedPercentage = computeApprovedPercentage(approvedShareAmount, pendingShareAmount);

    const eroId = id.epochOrderId(scId, assetId, epochIndex);
    if (!(await context.EpochRedeemOrder.get(eroId))) {
      const ero: EpochRedeemOrder = {
        id: eroId,
        poolId,
        tokenId: id.lc(scId),
        assetId,
        index: epochIndex,
        ...(phaseFields("approved", event) as any),
        approvedSharesAmount: approvedShareAmount,
        approvedPercentageOfTotalPending: approvedPercentage,
        ...(phaseFields("revoked", null) as any),
        revokedSharesAmount: 0n,
        revokedAssetsAmount: 0n,
        revokedPoolAmount: 0n,
        revokedWithNavPoolPerShare: 0n,
        revokedWithNavAssetPerShare: 0n,
        ...createdFields(event),
      };
      context.EpochRedeemOrder.set(ero);
    }

    const eorId = id.epochOutstandingId(scId, assetId);
    const eor = (await context.EpochOutstandingRedeem.get(eorId)) ??
      newEpochOutstandingRedeem(eorId, poolId, scId, assetId, event);
    saveOrClearEpochOutstandingRedeem(context, {
      ...eor,
      pendingSharesAmount: pendingShareAmount,
      ...updatedFields(event),
    });

    const pendings: PendingRedeemOrder[] = (
      await context.PendingRedeemOrder.getWhere({ tokenId: { _eq: id.lc(scId) } })
    ).filter((p: PendingRedeemOrder) => p.assetId === assetId && (p.pendingSharesAmount ?? 0n) > 0n);

    for (const pro of pendings) {
      const pending = pro.pendingSharesAmount ?? 0n;
      const approvedUser = computeApprovedUserAmount(pending, approvedPercentage);
      const roId = id.orderId(scId, assetId, pro.account, epochIndex);
      const ro: RedeemOrder = {
        id: roId,
        poolId,
        tokenId: id.lc(scId),
        assetId,
        account: pro.account,
        index: epochIndex,
        ...(phaseFields("approved", event) as any),
        approvedSharesAmount: approvedUser,
        ...(phaseFields("revoked", null) as any),
        revokedSharesAmount: 0n,
        revokedAssetsAmount: 0n,
        revokedPoolAmount: 0n,
        revokedWithNavPoolPerShare: 0n,
        revokedWithNavAssetPerShare: 0n,
        ...(phaseFields("claimed", null) as any),
        claimedAssetsAmount: 0n,
        ...createdFields(event),
      };
      context.RedeemOrder.set(ro);
      saveOrClearPendingRedeem(context, {
        ...pro,
        pendingSharesAmount: pending - approvedUser,
        ...updatedFields(event),
      });
      // DEFERRED: linkBasinRedeemOrderToEpoch
    }

    await snapshotHoldingEscrows(context, event, scId, "shareClassManagerV3:ApproveRedeems");
  },
);

// ---------------- IssueShares ----------------
indexer.onEvent(
  { contract: "BatchRequestManager", event: "IssueShares" },
  async ({ event, context }) => {
    const { shareClassId: scId, assetId, epochId, pricePoolPerShare, priceAssetPerShare, issuedShareAmount } =
      event.params;
    const epochIndex = Number(epochId);
    const navAssetPerShare = priceAssetPerShare;
    const navPoolPerShare = pricePoolPerShare;

    const eio = await context.EpochInvestOrder.get(id.epochOrderId(scId, assetId, epochIndex));
    if (!eio) return;
    context.EpochInvestOrder.set({
      ...eio,
      issuedSharesAmount: issuedShareAmount,
      issuedWithNavPoolPerShare: navPoolPerShare,
      issuedWithNavAssetPerShare: navAssetPerShare,
      ...(phaseFields("issued", event) as any),
      ...updatedFields(event),
    });

    const aDec = await assetDecimals(context, assetId);
    if (!aDec) return;
    const token = await context.Token.get(id.tokenId(scId));
    const tDec = token?.decimals;
    if (!tDec) return;

    const orders: InvestOrder[] = (
      await context.InvestOrder.getWhere({ tokenId: { _eq: id.lc(scId) } })
    ).filter(
      (o: InvestOrder) =>
        o.assetId === assetId &&
        o.index === epochIndex &&
        o.approvedAt != null &&
        o.issuedAt == null,
    );
    for (const o of orders) {
      if (o.issuedAt != null || o.approvedAssetsAmount == null) continue;
      const issuedSharesAmount =
        (o.approvedAssetsAmount * 10n ** BigInt(18 + tDec - aDec)) / navAssetPerShare;
      context.InvestOrder.set({
        ...o,
        issuedSharesAmount,
        issuedWithNavAssetPerShare: navAssetPerShare,
        issuedWithNavPoolPerShare: navPoolPerShare,
        ...(phaseFields("issued", event) as any),
        ...updatedFields(event),
      });
    }
  },
);

// ---------------- RevokeShares ----------------
indexer.onEvent(
  { contract: "BatchRequestManager", event: "RevokeShares" },
  async ({ event, context }) => {
    const {
      poolId,
      shareClassId: scId,
      assetId,
      epochId,
      pricePoolPerShare,
      priceAssetPerShare,
      revokedShareAmount,
      revokedAssetAmount,
      revokedPoolAmount,
    } = event.params;
    const epochIndex = Number(epochId);
    const navAssetPerShare = priceAssetPerShare;
    const navPoolPerShare = pricePoolPerShare;

    const pool = await context.Pool.get(id.poolId(poolId));
    if (!pool || pool.currency == null) return;

    const ero = await context.EpochRedeemOrder.get(id.epochOrderId(scId, assetId, epochIndex));
    if (!ero) return;
    context.EpochRedeemOrder.set({
      ...ero,
      revokedSharesAmount: revokedShareAmount,
      revokedAssetsAmount: revokedAssetAmount,
      revokedPoolAmount,
      revokedWithNavPoolPerShare: navPoolPerShare,
      revokedWithNavAssetPerShare: navAssetPerShare,
      ...(phaseFields("revoked", event) as any),
      ...updatedFields(event),
    });

    const token = await context.Token.get(id.tokenId(scId));
    const tDec = token?.decimals;
    if (!tDec) return;
    const aDec = await assetDecimals(context, assetId);
    if (!aDec) return;

    const orders: RedeemOrder[] = (
      await context.RedeemOrder.getWhere({ tokenId: { _eq: id.lc(scId) } })
    ).filter(
      (o: RedeemOrder) =>
        o.assetId === assetId &&
        o.index === epochIndex &&
        o.approvedAt != null &&
        o.revokedAt == null,
    );
    for (const o of orders) {
      if (o.revokedAt != null || o.approvedSharesAmount == null) continue;
      const approved = o.approvedSharesAmount;
      // poolDecimals === shareDecimals
      const revokedAssetsAmount = (approved * navAssetPerShare) / 10n ** BigInt(18 + tDec - aDec);
      const revokedPoolAmt = (approved * navPoolPerShare) / 10n ** BigInt(18 + tDec - tDec);
      context.RedeemOrder.set({
        ...o,
        revokedSharesAmount: approved,
        revokedAssetsAmount,
        revokedPoolAmount: revokedPoolAmt,
        revokedWithNavAssetPerShare: navAssetPerShare,
        revokedWithNavPoolPerShare: navPoolPerShare,
        ...(phaseFields("revoked", event) as any),
        ...updatedFields(event),
      });
    }
  },
);

// ---------------- ClaimDeposit ----------------
indexer.onEvent(
  { contract: "BatchRequestManager", event: "ClaimDeposit" },
  async ({ event, context }) => {
    const { shareClassId: scId, epochId, investor, assetId, paymentAssetAmount, claimedShareAmount } =
      event.params;
    const epochIndex = Number(epochId);
    const token = await context.Token.get(id.tokenId(scId));
    if (!token) return;
    const account = truncate(investor);
    await ensureAccount(context, account, event);

    const io = await context.InvestOrder.get(id.orderId(scId, assetId, account, epochIndex));
    if (!io) return;
    context.InvestOrder.set({
      ...io,
      claimedSharesAmount: claimedShareAmount,
      approvedAssetsAmount: paymentAssetAmount,
      issuedSharesAmount: claimedShareAmount,
      ...(phaseFields("claimed", event) as any),
      ...updatedFields(event),
    });
  },
);

// ---------------- ClaimRedeem ----------------
indexer.onEvent(
  { contract: "BatchRequestManager", event: "ClaimRedeem" },
  async ({ event, context }) => {
    const { shareClassId: scId, epochId, investor, assetId, paymentShareAmount, claimedAssetAmount } =
      event.params;
    const epochIndex = Number(epochId);
    const token = await context.Token.get(id.tokenId(scId));
    if (!token) return;
    const account = truncate(investor);
    await ensureAccount(context, account, event);

    const ro = await context.RedeemOrder.get(id.orderId(scId, assetId, account, epochIndex));
    if (!ro) return;
    context.RedeemOrder.set({
      ...ro,
      claimedAssetsAmount: claimedAssetAmount,
      approvedSharesAmount: paymentShareAmount,
      revokedAssetsAmount: claimedAssetAmount,
      ...(phaseFields("claimed", event) as any),
      ...updatedFields(event),
    });
  },
);

// ---------------- entity factories + saveOrClear ----------------
function newPendingInvest(
  pioId: string,
  poolId: bigint,
  scId: string,
  assetId: bigint,
  account: string,
  event: any,
): PendingInvestOrder {
  return {
    id: pioId,
    poolId,
    tokenId: id.lc(scId),
    assetId,
    account,
    pendingAssetsAmount: 0n,
    queuedAssetsAmount: 0n,
    ...createdFields(event),
  };
}
function newPendingRedeem(
  proId: string,
  poolId: bigint,
  scId: string,
  assetId: bigint,
  account: string,
  event: any,
): PendingRedeemOrder {
  return {
    id: proId,
    poolId,
    tokenId: id.lc(scId),
    assetId,
    account,
    pendingSharesAmount: 0n,
    queuedSharesAmount: 0n,
    ...createdFields(event),
  };
}
function newEpochOutstandingInvest(
  eoiId: string,
  poolId: bigint,
  scId: string,
  assetId: bigint,
  event: any,
): EpochOutstandingInvest {
  return {
    id: eoiId,
    poolId,
    tokenId: id.lc(scId),
    assetId,
    pendingAssetsAmount: 0n,
    queuedAssetsAmount: 0n,
    ...createdFields(event),
  };
}
function newEpochOutstandingRedeem(
  eorId: string,
  poolId: bigint,
  scId: string,
  assetId: bigint,
  event: any,
): EpochOutstandingRedeem {
  return {
    id: eorId,
    poolId,
    tokenId: id.lc(scId),
    assetId,
    pendingSharesAmount: 0n,
    queuedSharesAmount: 0n,
    ...createdFields(event),
  };
}

function saveOrClearPendingInvest(context: any, o: PendingInvestOrder) {
  if ((o.pendingAssetsAmount ?? 0n) === 0n && (o.queuedAssetsAmount ?? 0n) === 0n)
    context.PendingInvestOrder.deleteUnsafe(o.id);
  else context.PendingInvestOrder.set(o);
}
function saveOrClearPendingRedeem(context: any, o: PendingRedeemOrder) {
  if ((o.pendingSharesAmount ?? 0n) === 0n && (o.queuedSharesAmount ?? 0n) === 0n)
    context.PendingRedeemOrder.deleteUnsafe(o.id);
  else context.PendingRedeemOrder.set(o);
}
function saveOrClearEpochOutstandingInvest(context: any, o: EpochOutstandingInvest) {
  if ((o.pendingAssetsAmount ?? 0n) === 0n && (o.queuedAssetsAmount ?? 0n) === 0n)
    context.EpochOutstandingInvest.deleteUnsafe(o.id);
  else context.EpochOutstandingInvest.set(o);
}
function saveOrClearEpochOutstandingRedeem(context: any, o: EpochOutstandingRedeem) {
  if ((o.pendingSharesAmount ?? 0n) === 0n && (o.queuedSharesAmount ?? 0n) === 0n)
    context.EpochOutstandingRedeem.deleteUnsafe(o.id);
  else context.EpochOutstandingRedeem.set(o);
}

async function snapshotHoldingEscrows(context: any, event: any, scId: string, trigger: string) {
  const escrows = (
    await context.HoldingEscrow.getWhere({ tokenId: { _eq: id.lc(scId) } })
  ).filter((he: any) => (he.assetAmount ?? 0n) !== 0n);
  for (const he of escrows) writeHoldingEscrowSnapshot(context, event, he, trigger);
}
