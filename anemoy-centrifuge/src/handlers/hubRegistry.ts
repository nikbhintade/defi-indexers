/**
 * Port of src/handlers/hubRegistryHandlers.ts (mainnet / v3.1 events only).
 * Populates Pool, Account, PoolManager, AssetRegistration, Asset (ISO currencies).
 *
 * NOTE on metadata/IPFS: the Ponder handler fetches IPFS for SetMetadata to
 * derive `pool.name`. IPFS is unreachable in this environment; we store the
 * decoded metadata string and leave name resolution to a documented TODO.
 */
import { indexer, type Account, type PoolManager } from "envio";
import { getCentrifugeId } from "../helpers/common";
import * as id from "../helpers/ids";
import { createdFields, updatedFields } from "../helpers/common";
import { isoCurrencies } from "../helpers/isoCurrencies";

const IPFS_HASH_RE = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[A-Za-z2-7]{58})$/;

async function ensureAccount(context: any, address: string, event: any): Promise<string> {
  const aid = id.accountId(address);
  const existing = await context.Account.get(aid);
  if (!existing) {
    const acct: Account = { id: aid, address: aid, ...createdFields(event) };
    context.Account.set(acct);
  }
  return aid;
}

async function ensurePoolManager(
  context: any,
  address: string,
  centrifugeId: string,
  poolId: bigint,
  event: any,
): Promise<PoolManager> {
  const pmId = id.poolManagerId(address, centrifugeId, poolId);
  const existing = await context.PoolManager.get(pmId);
  if (existing) return existing;
  return {
    id: pmId,
    address: id.lc(address),
    centrifugeId,
    poolId,
    isHubManager: false,
    isBalancesheetManager: false,
    crosschainInProgress: undefined,
    ...createdFields(event),
  };
}

indexer.onEvent({ contract: "HubRegistry", event: "NewPool" }, async ({ event, context }) => {
  const centrifugeId = getCentrifugeId(event.chainId);
  const { poolId, currency, manager } = event.params;

  // AssetService.getDecimals(currency): ISO currencies (<1000) are 18 decimals.
  let decimals: number | undefined;
  if (currency < 1000n) decimals = 18;
  else {
    const asset = await context.Asset.get(id.assetId(currency));
    decimals = asset?.decimals ?? undefined;
  }

  const pid = id.poolId(poolId);
  const existing = await context.Pool.get(pid);
  context.Pool.set({
    id: pid,
    centrifugeId,
    isActive: true,
    currency,
    decimals,
    metadata: existing?.metadata,
    name: existing?.name,
    ...(existing
      ? { ...createdFields(event), createdAt: existing.createdAt, createdAtBlock: existing.createdAtBlock, createdAtTxHash: existing.createdAtTxHash, ...updatedFields(event) }
      : createdFields(event)),
  });

  await ensureAccount(context, manager, event);
  const pm = await ensurePoolManager(context, manager, centrifugeId, poolId, event);
  context.PoolManager.set({ ...pm, isHubManager: true, ...updatedFields(event) });
});

indexer.onEvent({ contract: "HubRegistry", event: "UpdateCurrency" }, async ({ event, context }) => {
  const centrifugeId = getCentrifugeId(event.chainId);
  const { poolId, currency } = event.params;
  const pid = id.poolId(poolId);
  const existing = await context.Pool.get(pid);
  if (existing) {
    context.Pool.set({ ...existing, currency, ...updatedFields(event) });
  } else {
    context.Pool.set({
      id: pid,
      centrifugeId,
      isActive: true,
      currency,
      decimals: undefined,
      metadata: undefined,
      name: undefined,
      ...createdFields(event),
    });
  }
});

indexer.onEvent({ contract: "HubRegistry", event: "NewAsset" }, async ({ event, context }) => {
  const centrifugeId = getCentrifugeId(event.chainId);
  const { assetId: aId, decimals } = event.params;

  const arId = id.assetRegistrationId(aId, centrifugeId);
  const existingAr = await context.AssetRegistration.get(arId);
  context.AssetRegistration.set({
    id: arId,
    assetId: aId,
    centrifugeId,
    ...(existingAr
      ? { createdAt: existingAr.createdAt, createdAtBlock: existingAr.createdAtBlock, createdAtTxHash: existingAr.createdAtTxHash, ...updatedFields(event) }
      : createdFields(event)),
  });

  // ISO currencies (<1000) get an Asset row with symbol/name from the ISO table.
  if (aId < 1000n) {
    const iso = isoCurrencies[Number(aId) as keyof typeof isoCurrencies];
    const existingAsset = await context.Asset.get(id.assetId(aId));
    if (!existingAsset) {
      context.Asset.set({
        id: id.assetId(aId),
        centrifugeId: undefined,
        address: undefined,
        assetTokenId: undefined,
        decimals: Number(decimals),
        symbol: iso?.shortcode,
        name: iso?.name,
        ...createdFields(event),
      });
    }
  }
});

indexer.onEvent({ contract: "HubRegistry", event: "UpdateManager" }, async ({ event, context }) => {
  const centrifugeId = getCentrifugeId(event.chainId);
  const { manager, poolId, canManage } = event.params;
  await ensureAccount(context, manager, event);
  const pm = await ensurePoolManager(context, manager, centrifugeId, poolId, event);
  context.PoolManager.set({ ...pm, isHubManager: canManage, ...updatedFields(event) });
});

indexer.onEvent({ contract: "HubRegistry", event: "SetMetadata" }, async ({ event, context }) => {
  const centrifugeId = getCentrifugeId(event.chainId);
  const { poolId, metadata: raw } = event.params;
  const pid = id.poolId(poolId);
  const existing = await context.Pool.get(pid);
  let metadata = Buffer.from(raw.slice(2), "hex").toString("utf-8");
  if (IPFS_HASH_RE.test(metadata)) {
    metadata = `ipfs://${metadata}`;
    // TODO: Ponder fetches the IPFS doc to set pool.name; IPFS is unreachable here.
  }
  if (existing) {
    context.Pool.set({ ...existing, metadata, ...updatedFields(event) });
  } else {
    context.Pool.set({
      id: pid,
      centrifugeId,
      isActive: true,
      currency: undefined,
      decimals: undefined,
      metadata,
      name: undefined,
      ...createdFields(event),
    });
  }
});
