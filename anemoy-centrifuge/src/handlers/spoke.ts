/**
 * Port of src/handlers/spokeHandlers.ts + the v3.1 vault deploy/link/unlink
 * (src/handlers/vaultRegistryHandlers.ts — in v3.1 the factory event is the
 * Spoke `DeployVault`). Registers Vault and TokenInstance contract templates.
 *
 * DEFERRED (documented): basin reconciliation hooks, initial-holder seeding
 * (config/INITIAL_HOLDERS), token-yield snapshot augmentation, cross-chain
 * in-progress flags.
 */
import { indexer, type Asset, type Token, type TokenInstance, type Vault, type Account } from "envio";
import {
  getCentrifugeId,
  createdFields,
  updatedFields,
  tsToDate,
  truncateToAddress,
} from "../helpers/common";
import * as id from "../helpers/ids";
import { erc20TotalSupply } from "../effects/calls";

const VaultKinds = ["Async", "Sync", "SyncDepositAsyncRedeem"] as const;
const VAULT_ERC20_ASSET_TOKEN_ID = 0n;
const MAX_UINT128 = 2n ** 128n - 1n;

// ---- contract templates: vaults + token instances are factory-deployed ----
indexer.contractRegister({ contract: "Spoke", event: "DeployVault" }, async ({ event, context }) => {
  context.chain.Vault.add(event.params.vault);
});
indexer.contractRegister({ contract: "Spoke", event: "AddShareClass" }, async ({ event, context }) => {
  context.chain.TokenInstance.add(event.params.token);
});

// Resolve newest Asset by (centrifugeId, address, assetTokenId) — AssetService.getByToken.
async function getAssetByToken(
  context: any,
  centrifugeId: string,
  address: string,
  assetTokenId: bigint,
): Promise<Asset | undefined> {
  const addr = id.lc(address);
  const candidates: Asset[] = await context.Asset.getWhere({ address: { _eq: addr } });
  const matches = candidates
    .filter(
      (a: Asset) =>
        a.centrifugeId === centrifugeId && a.address === addr && a.assetTokenId === assetTokenId,
    )
    .sort((a: Asset, b: Asset) => (b.createdAtBlock ?? 0) - (a.createdAtBlock ?? 0));
  return matches[0];
}

indexer.onEvent({ contract: "Spoke", event: "RegisterAsset" }, async ({ event, context }) => {
  const centrifugeId = getCentrifugeId(event.chainId);
  const { assetId, asset, tokenId: assetTokenId, name, symbol, decimals } = event.params;
  const aId = id.assetId(assetId);
  const existing = await context.Asset.get(aId);
  context.Asset.set({
    id: aId,
    centrifugeId,
    address: id.lc(asset),
    decimals: Number(decimals),
    name,
    symbol,
    assetTokenId,
    ...(existing
      ? {
          createdAt: existing.createdAt,
          createdAtBlock: existing.createdAtBlock,
          createdAtTxHash: existing.createdAtTxHash,
          ...updatedFields(event),
        }
      : createdFields(event)),
  });
});

indexer.onEvent({ contract: "Spoke", event: "AddShareClass" }, async ({ event, context }) => {
  const centrifugeId = getCentrifugeId(event.chainId);
  const { poolId, scId, token: tokenAddress } = event.params;

  const totalSupply =
    (await erc20TotalSupply(context.effect, id.lc(tokenAddress), Number(event.block.number))) ?? 0n;

  const tiId = id.tokenInstanceId(centrifugeId, scId);
  const existingTi = await context.TokenInstance.get(tiId);
  const prevInstanceIssuance = existingTi?.totalIssuance ?? 0n;
  const ti: TokenInstance = {
    id: tiId,
    centrifugeId,
    tokenId: id.lc(scId),
    address: id.lc(tokenAddress),
    isActive: true,
    totalIssuance: totalSupply,
    tokenPrice: existingTi?.tokenPrice ?? 0n,
    computedAt: existingTi?.computedAt,
    crosschainInProgress: existingTi?.crosschainInProgress,
    ...(existingTi
      ? {
          createdAt: existingTi.createdAt,
          createdAtBlock: existingTi.createdAtBlock,
          createdAtTxHash: existingTi.createdAtTxHash,
          ...updatedFields(event),
        }
      : createdFields(event)),
  };
  context.TokenInstance.set(ti);

  const tid = id.tokenId(scId);
  const existingToken = await context.Token.get(tid);
  const token: Token =
    existingToken ?? {
      id: tid,
      poolId,
      centrifugeId: undefined,
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
  if (prevInstanceIssuance === 0n) {
    context.Token.set({
      ...token,
      totalIssuance: (token.totalIssuance ?? 0n) + totalSupply,
      ...updatedFields(event),
    });
    // DEFERRED: initial-holder TokenInstancePosition seeding (config/INITIAL_HOLDERS).
  } else {
    context.Token.set({ ...token, ...updatedFields(event) });
  }
});

// DeployVault (v3.1 fires on Spoke) -> Vault.upsert + register template.
indexer.onEvent({ contract: "Spoke", event: "DeployVault" }, async ({ event, context }) => {
  const centrifugeId = getCentrifugeId(event.chainId);
  const { poolId, scId, asset, factory, vault: vaultAddress, kind } = event.params;
  const vaultKind = VaultKinds[Number(kind)];
  if (!vaultKind) return; // Invalid vault kind

  const assetRow = await getAssetByToken(context, centrifugeId, asset, VAULT_ERC20_ASSET_TOKEN_ID);
  if (!assetRow) return; // Asset not found. Cannot retrieve assetId for vault deployment
  const assetId = BigInt(assetRow.id);

  // DEFERRED metadata read: vault baseManager()/manager() eth_call. Stored as null
  // (try_-semantics). Not load-bearing for the in-scope investor flows.
  const vId = id.vaultId(vaultAddress, centrifugeId);
  const existing = await context.Vault.get(vId);
  context.Vault.set({
    id: vId,
    vaultAddress: id.lc(vaultAddress),
    centrifugeId,
    poolId,
    tokenId: id.lc(scId),
    assetId,
    assetAddress: id.lc(asset),
    factory: id.lc(factory),
    kind: vaultKind,
    manager: undefined,
    isActive: true,
    status: "Unlinked",
    crosschainInProgress: undefined,
    crosschainInProgressValue: undefined,
    maxReserve: MAX_UINT128,
    ...(existing
      ? {
          createdAt: existing.createdAt,
          createdAtBlock: existing.createdAtBlock,
          createdAtTxHash: existing.createdAtTxHash,
          ...updatedFields(event),
        }
      : createdFields(event)),
  });
});

indexer.onEvent({ contract: "Spoke", event: "LinkVault" }, async ({ event, context }) => {
  const centrifugeId = getCentrifugeId(event.chainId);
  const vId = id.vaultId(event.params.vault, centrifugeId);
  const vault = await context.Vault.get(vId);
  if (!vault) return;
  context.Vault.set({
    ...vault,
    status: "Linked",
    crosschainInProgress: undefined,
    crosschainInProgressValue: undefined,
    ...updatedFields(event),
  });
});

indexer.onEvent({ contract: "Spoke", event: "UnlinkVault" }, async ({ event, context }) => {
  const centrifugeId = getCentrifugeId(event.chainId);
  const vId = id.vaultId(event.params.vault, centrifugeId);
  const vault = await context.Vault.get(vId);
  if (!vault) return;
  context.Vault.set({
    ...vault,
    status: "Unlinked",
    crosschainInProgress: undefined,
    crosschainInProgressValue: undefined,
    ...updatedFields(event),
  });
});

indexer.onEvent({ contract: "Spoke", event: "UpdateSharePrice" }, async ({ event, context }) => {
  const centrifugeId = getCentrifugeId(event.chainId);
  const { scId, price, computedAt } = event.params;
  const ti = await context.TokenInstance.get(id.tokenInstanceId(centrifugeId, scId));
  if (!ti) return; // TokenInstance not found
  context.TokenInstance.set({
    ...ti,
    tokenPrice: price,
    computedAt: tsToDate(computedAt),
    crosschainInProgress: undefined,
    ...updatedFields(event),
  });
});

indexer.onEvent({ contract: "Spoke", event: "UpdateAssetPrice" }, async ({ event, context }) => {
  const centrifugeId = getCentrifugeId(event.chainId);
  const { poolId, scId, asset, tokenId: assetTokenId, price } = event.params;
  const escrowAddress = await latestEscrowAddress(context, poolId, centrifugeId);
  if (!escrowAddress) return;
  const assetRow = await getAssetByToken(context, centrifugeId, asset, assetTokenId);
  if (!assetRow) return;
  const assetId = BigInt(assetRow.id);
  const he = await upsertHoldingEscrow(context, event, {
    poolId,
    scId,
    centrifugeId,
    assetAddress: asset,
    assetId,
    escrowAddress,
  });
  context.HoldingEscrow.set({
    ...he,
    escrowAddress: id.lc(escrowAddress),
    assetPrice: price,
    crosschainInProgress: undefined,
    ...updatedFields(event),
  });
  writeHoldingEscrowSnapshot(context, event, { ...he, escrowAddress: id.lc(escrowAddress), assetPrice: price }, "spokeV3_1:UpdateAssetPrice");
});

indexer.onEvent(
  { contract: "Spoke", event: "UpdateMaxAssetPriceAge" },
  async ({ event, context }) => {
    const centrifugeId = getCentrifugeId(event.chainId);
    const { poolId, scId, asset, tokenId: assetTokenId, maxPriceAge } = event.params;
    const escrowAddress = await latestEscrowAddress(context, poolId, centrifugeId);
    if (!escrowAddress) return;
    const assetRow = await getAssetByToken(context, centrifugeId, asset, assetTokenId);
    if (!assetRow) return;
    const assetId = BigInt(assetRow.id);
    const he = await upsertHoldingEscrow(context, event, {
      poolId,
      scId,
      centrifugeId,
      assetAddress: asset,
      assetId,
      escrowAddress,
    });
    const updated = { ...he, escrowAddress: id.lc(escrowAddress), maxAssetPriceAge: maxPriceAge };
    context.HoldingEscrow.set({ ...updated, ...updatedFields(event) });
    writeHoldingEscrowSnapshot(context, event, updated, "spokeV3_1:UpdateMaxAssetPriceAge");
  },
);

indexer.onEvent(
  { contract: "Spoke", event: "InitiateTransferShares" },
  async ({ event, context }) => {
    const fromCentrifugeId = getCentrifugeId(event.chainId);
    const { centrifugeId: toCentrifugeId, poolId, scId, sender, destinationAddress, amount } =
      event.params;
    const from = truncateToAddress(sender);
    const to = truncateToAddress(destinationAddress);
    await ensureAccount(context, from, event);
    await ensureAccount(context, to, event);

    const common = {
      poolId,
      tokenId: id.lc(scId),
      centrifugeId: fromCentrifugeId,
      fromAccount: from,
      toAccount: to,
      fromCentrifugeId,
      toCentrifugeId: String(toCentrifugeId),
      currencyAssetId: undefined,
      currencyAmount: 0n,
      tokenPrice: 0n,
      transactionFee: 0n,
      epochIndex: undefined,
    };
    writeInvestorTransaction(context, event, {
      ...common,
      type: "TRANSFER_OUT",
      account: from,
      tokenAmount: amount,
    });
    writeInvestorTransaction(context, event, {
      ...common,
      type: "TRANSFER_IN",
      account: to,
      tokenAmount: amount,
    });
  },
);

// ---- shared spoke helpers ----
export async function ensureAccount(context: any, address: string, event: any): Promise<void> {
  const aid = id.accountId(address);
  if (!(await context.Account.get(aid))) {
    const acct: Account = { id: aid, address: aid, ...createdFields(event) };
    context.Account.set(acct);
  }
}

export async function latestEscrowAddress(
  context: any,
  poolId: bigint,
  centrifugeId: string,
): Promise<string | undefined> {
  const rows = await context.Escrow.getWhere({ poolId: { _eq: poolId } });
  const matches = rows
    .filter((e: any) => e.centrifugeId === centrifugeId)
    .sort((a: any, b: any) => (b.createdAtBlock ?? 0) - (a.createdAtBlock ?? 0));
  return matches[0]?.address;
}

export async function upsertHoldingEscrow(
  context: any,
  event: any,
  q: {
    poolId: bigint;
    scId: string;
    centrifugeId: string;
    assetAddress: string;
    assetId: bigint;
    escrowAddress: string;
  },
) {
  const heId = id.holdingId(q.scId, q.assetId);
  const existing = await context.HoldingEscrow.get(heId);
  if (existing) return existing;
  return {
    id: heId,
    centrifugeId: q.centrifugeId,
    poolId: q.poolId,
    tokenId: id.lc(q.scId),
    assetId: q.assetId,
    assetAddress: id.lc(q.assetAddress),
    assetAmount: 0n,
    assetPrice: 0n,
    maxAssetPriceAge: 0n,
    escrowAddress: id.lc(q.escrowAddress),
    crosschainInProgress: undefined,
    ...createdFields(event),
  };
}

export function writeHoldingEscrowSnapshot(context: any, event: any, he: any, trigger: string) {
  const snapId = id.holdingEscrowSnapshotId(
    he.tokenId,
    he.assetId,
    Number(event.block.number),
    trigger,
  );
  context.HoldingEscrowSnapshot.set({
    id: snapId,
    timestamp: tsToDate(event.block.timestamp),
    blockNumber: Number(event.block.number),
    trigger,
    triggerTxHash: event.transaction?.hash?.toLowerCase(),
    triggerChainId: String(event.chainId),
    tokenId: he.tokenId,
    assetId: he.assetId,
    assetAmount: he.assetAmount ?? 0n,
    assetPrice: he.assetPrice ?? 0n,
    maxAssetPriceAge: he.maxAssetPriceAge ?? 0n,
  });
}

export function writeInvestorTransaction(
  context: any,
  event: any,
  data: {
    type: string;
    poolId: bigint;
    tokenId: string;
    account: string;
    centrifugeId: string;
    tokenAmount?: bigint;
    currencyAmount?: bigint;
    tokenPrice?: bigint;
    transactionFee?: bigint;
    fromAccount?: string;
    toAccount?: string;
    fromCentrifugeId?: string;
    toCentrifugeId?: string;
    currencyAssetId?: bigint;
    epochIndex?: number;
  },
) {
  const txHash = (event.transaction?.hash ?? "0x").toLowerCase();
  const itId = id.investorTransactionId(data.poolId, data.tokenId, data.account, data.type, txHash);
  context.InvestorTransaction.set({
    id: itId,
    centrifugeId: data.centrifugeId,
    poolId: data.poolId,
    tokenId: id.lc(data.tokenId),
    type: data.type as any,
    account: id.lc(data.account),
    epochIndex: data.epochIndex,
    tokenAmount: data.tokenAmount ?? 0n,
    currencyAmount: data.currencyAmount ?? 0n,
    tokenPrice: data.tokenPrice ?? 0n,
    transactionFee: data.transactionFee ?? 0n,
    fromAccount: data.fromAccount ? id.lc(data.fromAccount) : undefined,
    toAccount: data.toAccount ? id.lc(data.toAccount) : undefined,
    fromCentrifugeId: data.fromCentrifugeId,
    toCentrifugeId: data.toCentrifugeId,
    currencyAssetId: data.currencyAssetId,
    createdAt: tsToDate(event.block.timestamp),
    createdAtBlock: Number(event.block.number),
    createdAtTxHash: txHash,
  });
}
