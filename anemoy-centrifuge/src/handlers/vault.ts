/**
 * Port of src/handlers/vaultHandlers.ts. Vaults are factory-deployed; the
 * template is registered in spoke.ts (Spoke:DeployVault contractRegister).
 *
 * Events: DepositRequest, RedeemRequest, DepositClaimable, RedeemClaimable,
 * Deposit, Withdraw. Produces InvestorTransaction + VaultInvestOrder /
 * VaultRedeemOrder (+ InvestOrder / EpochInvestOrder for sync deposits).
 *
 * DEFERRED: TokenInstancePosition init/checkpoints, basin reconciliation.
 */
import {
  indexer,
  type VaultInvestOrder,
  type VaultRedeemOrder,
  type InvestOrder,
  type EpochInvestOrder,
} from "envio";
import {
  getCentrifugeId,
  createdFields,
  updatedFields,
  truncateToAddress,
  bigintMax,
  getSharePrice,
  phaseFields,
} from "../helpers/common";
import * as id from "../helpers/ids";
import { ensureAccount, writeInvestorTransaction } from "./spoke";

// ---------- DepositRequest ----------
indexer.onEvent({ contract: "Vault", event: "DepositRequest" }, async ({ event, context }) => {
  const centrifugeId = getCentrifugeId(event.chainId);
  const investor = truncateToAddress(event.params.controller);
  const assets = event.params.assets;
  const vaultAddress = id.lc(event.srcAddress);

  const vault = await context.Vault.get(id.vaultId(vaultAddress, centrifugeId));
  if (!vault) return; // Vault not found
  const { poolId, tokenId, assetId } = vault;

  const token = await context.Token.get(id.tokenId(tokenId));
  if (!token) return; // Token not found

  await ensureAccount(context, investor, event);

  const asset = await context.Asset.get(id.assetId(assetId));
  if (!asset) return; // Asset not found

  writeInvestorTransaction(context, event, {
    type: "DEPOSIT_REQUEST_UPDATED",
    poolId,
    tokenId,
    account: investor,
    currencyAmount: assets,
    centrifugeId,
    currencyAssetId: assetId,
  });

  const vio = await getOrInitVaultInvestOrder(context, event, centrifugeId, poolId, tokenId, assetId, investor);
  const updated: VaultInvestOrder = {
    ...vio,
    requestedAssetsAmount: (vio.requestedAssetsAmount ?? 0n) + assets,
    ...updatedFields(event),
  };
  context.VaultInvestOrder.set(updated);
});

// ---------- RedeemRequest ----------
indexer.onEvent({ contract: "Vault", event: "RedeemRequest" }, async ({ event, context }) => {
  const centrifugeId = getCentrifugeId(event.chainId);
  const investor = truncateToAddress(event.params.controller);
  const shares = event.params.shares;
  const vaultAddress = id.lc(event.srcAddress);

  const vault = await context.Vault.get(id.vaultId(vaultAddress, centrifugeId));
  if (!vault) return;
  const { poolId, tokenId, assetId } = vault;

  const token = await context.Token.get(id.tokenId(tokenId));
  if (!token) return;
  await ensureAccount(context, investor, event);
  const asset = await context.Asset.get(id.assetId(assetId));
  if (!asset) return;

  writeInvestorTransaction(context, event, {
    type: "REDEEM_REQUEST_UPDATED",
    poolId,
    tokenId,
    account: investor,
    tokenAmount: shares,
    centrifugeId,
    currencyAssetId: assetId,
  });

  const vro = await getOrInitVaultRedeemOrder(context, event, centrifugeId, poolId, tokenId, assetId, investor);
  context.VaultRedeemOrder.set({
    ...vro,
    requestedSharesAmount: (vro.requestedSharesAmount ?? 0n) + shares,
    ...updatedFields(event),
  });
});

// ---------- DepositClaimable ----------
indexer.onEvent({ contract: "Vault", event: "DepositClaimable" }, async ({ event, context }) => {
  const centrifugeId = getCentrifugeId(event.chainId);
  const { controller, assets, shares } = event.params;
  const vaultAddress = id.lc(event.srcAddress);

  const vault = await context.Vault.get(id.vaultId(vaultAddress, centrifugeId));
  if (!vault) return;
  const { poolId, tokenId, kind, assetId } = vault;
  if (kind !== "Async") return;

  const asset = await context.Asset.get(id.assetId(assetId));
  if (!asset || asset.decimals == null) return;
  const token = await context.Token.get(id.tokenId(tokenId));
  if (!token || token.decimals == null) return;

  const investor = id.lc(controller);
  await ensureAccount(context, controller, event);

  writeInvestorTransaction(context, event, {
    type: "DEPOSIT_CLAIMABLE",
    poolId,
    tokenId,
    account: investor,
    tokenAmount: shares,
    currencyAmount: assets,
    tokenPrice: getSharePrice(assets, shares, asset.decimals, token.decimals) ?? 0n,
    centrifugeId,
    currencyAssetId: assetId,
  });

  const vio = await getOrInitVaultInvestOrder(context, event, centrifugeId, poolId, tokenId, assetId, investor);
  context.VaultInvestOrder.set({
    ...vio,
    claimableAssetsAmount: (vio.claimableAssetsAmount ?? 0n) + assets,
    ...updatedFields(event),
  });
});

// ---------- RedeemClaimable ----------
indexer.onEvent({ contract: "Vault", event: "RedeemClaimable" }, async ({ event, context }) => {
  const centrifugeId = getCentrifugeId(event.chainId);
  const { controller, assets, shares } = event.params;
  const vaultAddress = id.lc(event.srcAddress);

  const vault = await context.Vault.get(id.vaultId(vaultAddress, centrifugeId));
  if (!vault) return;
  const { poolId, tokenId, assetId } = vault;

  const asset = await context.Asset.get(id.assetId(assetId));
  if (!asset || asset.decimals == null) return;
  const token = await context.Token.get(id.tokenId(tokenId));
  if (!token || token.decimals == null) return;

  const investor = id.lc(controller);
  await ensureAccount(context, controller, event);

  writeInvestorTransaction(context, event, {
    type: "REDEEM_CLAIMABLE",
    poolId,
    tokenId,
    account: investor,
    tokenAmount: shares,
    currencyAmount: assets,
    tokenPrice: getSharePrice(assets, shares, asset.decimals, token.decimals) ?? 0n,
    centrifugeId,
    currencyAssetId: assetId,
  });

  const vro = await getOrInitVaultRedeemOrder(context, event, centrifugeId, poolId, tokenId, assetId, investor);
  context.VaultRedeemOrder.set({
    ...vro,
    claimableSharesAmount: (vro.claimableSharesAmount ?? 0n) + shares,
    ...updatedFields(event),
  });
});

// ---------- Deposit (ERC4626) ----------
indexer.onEvent({ contract: "Vault", event: "Deposit" }, async ({ event, context }) => {
  const centrifugeId = getCentrifugeId(event.chainId);
  const { sender, owner, assets, shares } = event.params;
  const vaultAddress = id.lc(event.srcAddress);

  const vault = await context.Vault.get(id.vaultId(vaultAddress, centrifugeId));
  if (!vault) return;
  const { poolId, tokenId, kind, assetId } = vault;

  const token = await context.Token.get(id.tokenId(tokenId));
  if (!token || token.decimals == null) return;
  const asset = await context.Asset.get(id.assetId(assetId));
  if (!asset || asset.decimals == null) return;
  const shareDecimals = token.decimals;
  const assetDecimals = asset.decimals;

  // v3.1 SyncDepositVault swaps sender/receiver -> use sender for sync.
  let investorRaw: string;
  switch (kind) {
    case "Async":
      investorRaw = owner;
      break;
    case "SyncDepositAsyncRedeem":
    case "Sync":
      investorRaw = sender;
      break;
    default:
      return;
  }
  const investor = id.lc(investorRaw);
  await ensureAccount(context, investorRaw, event);

  const tokenPrice = getSharePrice(assets, shares, assetDecimals, shareDecimals) ?? 0n;

  if (kind === "Async") {
    writeInvestorTransaction(context, event, {
      type: "DEPOSIT_CLAIMED",
      poolId,
      tokenId,
      account: investor,
      tokenAmount: shares,
      currencyAmount: assets,
      tokenPrice,
      centrifugeId,
      currencyAssetId: assetId,
    });
    const vio = await getOrInitVaultInvestOrder(context, event, centrifugeId, poolId, tokenId, assetId, investor);
    const next: VaultInvestOrder = {
      ...vio,
      requestedAssetsAmount: bigintMax((vio.requestedAssetsAmount ?? 0n) - assets, 0n),
      claimableAssetsAmount: bigintMax((vio.claimableAssetsAmount ?? 0n) - assets, 0n),
      ...updatedFields(event),
    };
    saveOrClearInvest(context, next);
  } else {
    // Sync / SyncDepositAsyncRedeem
    writeInvestorTransaction(context, event, {
      type: "SYNC_DEPOSIT",
      poolId,
      tokenId,
      account: investor,
      tokenAmount: shares,
      currencyAmount: assets,
      tokenPrice,
      centrifugeId,
      currencyAssetId: assetId,
    });

    const investOrderIndex =
      (await countInvestOrdersWithNonPositiveIndex(context, tokenId, assetId, investor)) * -1;
    const ioId = id.orderId(tokenId, assetId, investor, investOrderIndex);
    const investOrder: InvestOrder = {
      id: ioId,
      poolId,
      tokenId: id.lc(tokenId),
      assetId,
      account: investor,
      index: investOrderIndex,
      ...(phaseFields("approved", event) as any),
      approvedAssetsAmount: assets,
      issuedSharesAmount: shares,
      issuedWithNavPoolPerShare: 0n,
      issuedWithNavAssetPerShare: tokenPrice,
      ...(phaseFields("issued", event) as any),
      ...(phaseFields("claimed", event) as any),
      claimedSharesAmount: shares,
      ...createdFields(event),
    };
    context.InvestOrder.set(investOrder);

    const epochInvestIndex =
      (await countEpochInvestOrdersWithNonPositiveIndex(context, tokenId, assetId)) * -1;
    const eioId = id.epochOrderId(tokenId, assetId, epochInvestIndex);
    const epochInvestOrder: EpochInvestOrder = {
      id: eioId,
      poolId,
      tokenId: id.lc(tokenId),
      assetId,
      index: epochInvestIndex,
      ...(phaseFields("approved", event) as any),
      approvedAssetsAmount: assets,
      approvedPoolAmount: assets,
      approvedPercentageOfTotalPending: 100n * 10n ** BigInt(assetDecimals),
      issuedSharesAmount: shares,
      issuedWithNavPoolPerShare: 0n,
      issuedWithNavAssetPerShare: tokenPrice,
      ...(phaseFields("issued", event) as any),
      ...createdFields(event),
    };
    context.EpochInvestOrder.set(epochInvestOrder);
  }
});

// ---------- Withdraw (ERC4626) ----------
indexer.onEvent({ contract: "Vault", event: "Withdraw" }, async ({ event, context }) => {
  const centrifugeId = getCentrifugeId(event.chainId);
  const { owner, assets, shares } = event.params;
  const vaultAddress = id.lc(event.srcAddress);

  const vault = await context.Vault.get(id.vaultId(vaultAddress, centrifugeId));
  if (!vault) return;
  const { poolId, tokenId, kind, assetId } = vault;
  if (kind === "Sync") return; // Sync vaults not supported for redeem

  const asset = await context.Asset.get(id.assetId(assetId));
  if (!asset || asset.decimals == null) return;
  const token = await context.Token.get(id.tokenId(tokenId));
  if (!token || token.decimals == null) return;

  const investor = id.lc(owner);
  await ensureAccount(context, owner, event);

  const vro = await getOrInitVaultRedeemOrder(context, event, centrifugeId, poolId, tokenId, assetId, investor);
  const next: VaultRedeemOrder = {
    ...vro,
    requestedSharesAmount: bigintMax((vro.requestedSharesAmount ?? 0n) - shares, 0n),
    claimableSharesAmount: bigintMax((vro.claimableSharesAmount ?? 0n) - shares, 0n),
    ...updatedFields(event),
  };
  saveOrClearRedeem(context, next);

  writeInvestorTransaction(context, event, {
    type: "REDEEM_CLAIMED",
    poolId,
    tokenId,
    account: investor,
    tokenAmount: shares,
    currencyAmount: assets,
    tokenPrice: getSharePrice(assets, shares, asset.decimals, token.decimals) ?? 0n,
    centrifugeId,
    currencyAssetId: assetId,
  });
});

// ---------- helpers ----------
async function getOrInitVaultInvestOrder(
  context: any,
  event: any,
  centrifugeId: string,
  poolId: bigint,
  tokenId: string,
  assetId: bigint,
  accountAddress: string,
): Promise<VaultInvestOrder> {
  const vId = id.vaultOrderId(tokenId, centrifugeId, assetId, accountAddress);
  const existing = await context.VaultInvestOrder.get(vId);
  if (existing) return existing;
  return {
    id: vId,
    centrifugeId,
    poolId,
    tokenId: id.lc(tokenId),
    accountAddress: id.lc(accountAddress),
    assetId,
    requestedAssetsAmount: 0n,
    claimableAssetsAmount: 0n,
    epochIndex: undefined,
    ...createdFields(event),
  };
}

async function getOrInitVaultRedeemOrder(
  context: any,
  event: any,
  centrifugeId: string,
  poolId: bigint,
  tokenId: string,
  assetId: bigint,
  accountAddress: string,
): Promise<VaultRedeemOrder> {
  const vId = id.vaultOrderId(tokenId, centrifugeId, assetId, accountAddress);
  const existing = await context.VaultRedeemOrder.get(vId);
  if (existing) return existing;
  return {
    id: vId,
    centrifugeId,
    poolId,
    tokenId: id.lc(tokenId),
    accountAddress: id.lc(accountAddress),
    assetId,
    requestedSharesAmount: 0n,
    claimableSharesAmount: 0n,
    ...createdFields(event),
  };
}

function saveOrClearInvest(context: any, order: VaultInvestOrder) {
  if ((order.requestedAssetsAmount ?? 0n) === 0n && (order.claimableAssetsAmount ?? 0n) === 0n) {
    context.VaultInvestOrder.deleteUnsafe(order.id);
  } else {
    context.VaultInvestOrder.set(order);
  }
}

function saveOrClearRedeem(context: any, order: VaultRedeemOrder) {
  if ((order.requestedSharesAmount ?? 0n) === 0n && (order.claimableSharesAmount ?? 0n) === 0n) {
    context.VaultRedeemOrder.deleteUnsafe(order.id);
  } else {
    context.VaultRedeemOrder.set(order);
  }
}

async function countInvestOrdersWithNonPositiveIndex(
  context: any,
  tokenId: string,
  assetId: bigint,
  account: string,
): Promise<number> {
  const rows: InvestOrder[] = await context.InvestOrder.getWhere({ tokenId: { _eq: id.lc(tokenId) } });
  return rows.filter(
    (r) => r.assetId === assetId && r.account === id.lc(account) && r.index <= 0,
  ).length;
}

async function countEpochInvestOrdersWithNonPositiveIndex(
  context: any,
  tokenId: string,
  assetId: bigint,
): Promise<number> {
  const rows: EpochInvestOrder[] = await context.EpochInvestOrder.getWhere({
    tokenId: { _eq: id.lc(tokenId) },
  });
  return rows.filter((r) => r.assetId === assetId && r.index <= 0).length;
}
