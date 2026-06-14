/**
 * FAssets (Flare mainnet) HyperIndex handlers.
 *
 * Ported from flare-foundation/fasset-indexer packages/fasset-indexer-core
 * src/indexer/eventlib/store-logic/event-storer.ts + state-updater.ts.
 *
 * Conventions:
 * - per-event record id = `${chainId}_${blockNumber}_${logIndex}` (lowercase).
 *   The source keys events on an auto-increment EvmLog whose natural unique
 *   key is (block.index, log.index); this id is the faithful HyperIndex
 *   equivalent (chainId-scoped). envio exposes `event.logIndex` (NOT
 *   transactionLogIndex) — used here.
 * - state/lookup entities use natural keys: agent vault address (lowercase),
 *   fasset enum ordinal, or `${fasset}_${naturalId}` composites, so the
 *   storer's findOneOrFail({fasset, requestId}) lookups stay id-addressable.
 * - all addresses/hex stored lowercase.
 */
import { indexer } from "envio";
import {
  FAssetType,
  AGENT_OWNER_REGISTRY,
  a,
  assetManagerFAsset,
  coreVaultManagerFAsset,
  CollateralReservationResolution,
  RedemptionResolution,
  ReturnFromCoreVaultResolution,
  TransferToCoreVaultResolution,
  UnderlyingWithdrawalResolution,
} from "./constants.js";
import {
  tryCall,
  SIG_GET_WORK_ADDRESS,
  SIG_GET_AGENT_NAME,
  SIG_GET_AGENT_DESCRIPTION,
  SIG_GET_AGENT_ICON_URL,
  SIG_SYMBOL,
} from "./effects.js";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

type EventMeta = {
  chainId: number;
  block: { number: number; timestamp: number };
  logIndex: number;
  srcAddress: string;
};

function eid(e: EventMeta): string {
  return `${e.chainId}_${e.block.number}_${e.logIndex}`;
}

/** Common columns shared by every per-event record. */
function common(e: EventMeta) {
  return {
    id: eid(e),
    blockNumber: e.block.number,
    timestamp: e.block.timestamp,
    logIndex: e.logIndex,
  };
}

const fkey = (fasset: number, natural: string | number | bigint): string =>
  `${fasset}_${natural}`;

// ---------------------------------------------------------------------------
// contractRegister: instantiate a CollateralPool template per agent vault.
// The source associates each pool with its agent vault via the
// AgentVaultCreated event's creationData.collateralPool. contractRegister
// cannot read chain state, but the pool address is in the event params, so
// registration is fully event-derived. (CollateralPoolMap, which lets pool
// handlers resolve fasset+agentVault, is written in the onEvent handler.)
// ---------------------------------------------------------------------------
indexer.contractRegister(
  { contract: "AssetManager", event: "AgentVaultCreated" },
  async ({ event, context }) => {
    context.chain.CollateralPool.add(event.params.creationData.collateralPool);
  },
);

// ===========================================================================
// settings
// ===========================================================================

indexer.onEvent({ contract: "AssetManager", event: "ContractChanged" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  context.ContractChanged.set({
    ...common(event),
    fasset,
    name: event.params.name,
    value: a(event.params.value),
  });
});

indexer.onEvent({ contract: "AssetManager", event: "SettingChanged" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  // mirror the source: only lotSizeAMG updates AssetManagerSettings state
  if (event.params.name === "lotSizeAMG") {
    context.AssetManagerSettings.set({ id: String(fasset), fasset, lotSizeAmg: event.params.value });
  }
});

indexer.onEvent({ contract: "AssetManager", event: "CollateralTypeAdded" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  const token = a(event.params.token);
  context.CollateralTypeAdded.set({
    ...common(event),
    id: fkey(fasset, token),
    fasset,
    address: token,
    decimals: Number(event.params.decimals),
    directPricePair: event.params.directPricePair,
    assetFtsoSymbol: event.params.assetFtsoSymbol,
    tokenFtsoSymbol: event.params.tokenFtsoSymbol,
    collateralClass: Number(event.params.collateralClass),
  });
});

indexer.onEvent({ contract: "AssetManager", event: "CollateralRatiosChanged" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  context.CollateralRatiosChanged.set({
    ...common(event),
    fasset,
    collateralToken_id: fkey(fasset, a(event.params.collateralToken)),
    minCollateralRatioBIPS: event.params.minCollateralRatioBIPS,
    safetyMinCollateralRatioBIPS: event.params.safetyMinCollateralRatioBIPS,
  });
});

// ===========================================================================
// agent
// ===========================================================================

indexer.onEvent({ contract: "AssetManager", event: "AgentVaultCreated" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  const owner = a(event.params.owner);
  const agentVault = a(event.params.agentVault);
  const cd = event.params.creationData;
  const collateralPool = a(cd.collateralPool);
  const collateralPoolToken = a(cd.collateralPoolToken);

  // --- ensure AgentManager + AgentOwner (StateUpdater.ensureAgentManager/Worker) ---
  let manager = await context.AgentManager.get(owner);
  if (!manager) {
    const name = await tryCall<string>(context.effect, AGENT_OWNER_REGISTRY, SIG_GET_AGENT_NAME, "getAgentName", [owner]);
    const description = await tryCall<string>(context.effect, AGENT_OWNER_REGISTRY, SIG_GET_AGENT_DESCRIPTION, "getAgentDescription", [owner]);
    const iconUrl = await tryCall<string>(context.effect, AGENT_OWNER_REGISTRY, SIG_GET_AGENT_ICON_URL, "getAgentIconUrl", [owner]);
    manager = { id: owner, address: owner, name: name ?? undefined, description: description ?? undefined, iconUrl: iconUrl ?? undefined };
    context.AgentManager.set(manager);
  }
  // work address keyed AgentOwner (source: one AgentOwner per manager)
  const workAddress = await tryCall<string>(context.effect, AGENT_OWNER_REGISTRY, SIG_GET_WORK_ADDRESS, "getWorkAddress", [owner]);
  const ownerId = workAddress ? a(workAddress) : owner;
  const existingOwner = await context.AgentOwner.get(ownerId);
  if (!existingOwner) {
    context.AgentOwner.set({ id: ownerId, address: ownerId, manager_id: owner });
  }

  // --- collateral pool token symbol (StateUpdater eth_call) ---
  const symbol = await tryCall<string>(context.effect, collateralPoolToken, SIG_SYMBOL, "symbol", []);

  // --- AgentVault ---
  context.AgentVault.set({
    id: agentVault,
    fasset,
    address: agentVault,
    underlyingAddress: cd.underlyingAddress,
    collateralPool,
    collateralPoolToken,
    collateralPoolTokenSymbol: symbol ?? undefined,
    owner_id: ownerId,
    destroyed: false,
  });

  // --- AgentVaultSettings ---
  context.AgentVaultSettings.set({
    id: agentVault,
    agentVault_id: agentVault,
    collateralToken_id: fkey(fasset, a(cd.vaultCollateralToken)),
    feeBIPS: cd.feeBIPS,
    poolFeeShareBIPS: cd.poolFeeShareBIPS,
    mintingVaultCollateralRatioBIPS: cd.mintingVaultCollateralRatioBIPS,
    mintingPoolCollateralRatioBIPS: cd.mintingPoolCollateralRatioBIPS,
    buyFAssetByAgentFactorBIPS: cd.buyFAssetByAgentFactorBIPS,
    poolExitCollateralRatioBIPS: cd.poolExitCollateralRatioBIPS,
    redemptionPoolFeeShareBIPS: cd.redemptionPoolFeeShareBIPS,
    poolTopupCollateralRatioBIPS: undefined,
    poolTopupTokenPriceFactorBIPS: undefined,
  });

  // --- CollateralPoolMap (lets pool handlers resolve fasset/agentVault) ---
  context.CollateralPoolMap.set({ id: collateralPool, fasset, agentVault_id: agentVault });

  // --- event record ---
  context.AgentVaultCreated.set({ ...common(event), fasset, agentVault_id: agentVault });
});

indexer.onEvent({ contract: "AssetManager", event: "AgentDestroyed" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  const agentVault = a(event.params.agentVault);
  const av = await context.AgentVault.get(agentVault);
  if (av) context.AgentVault.set({ ...av, destroyed: true });
  context.AgentVaultDestroyed.set({ ...common(event), fasset, agentVault_id: agentVault });
});

indexer.onEvent({ contract: "AssetManager", event: "AgentDestroyAnnounced" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  context.AgentDestroyAnnounced.set({
    ...common(event), fasset, agentVault_id: a(event.params.agentVault), allowedAt: event.params.destroyAllowedAt,
  });
});

indexer.onEvent({ contract: "AssetManager", event: "AgentSettingChanged" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  const agentVault = a(event.params.agentVault);
  const name = event.params.name;
  const value = event.params.value;
  context.AgentSettingChanged.set({ ...common(event), fasset, agentVault_id: agentVault, name, value });
  // apply to AgentVaultSettings state
  const s = await context.AgentVaultSettings.get(agentVault);
  if (s) {
    let upd = { ...s };
    switch (name) {
      case "feeBIPS": upd = { ...upd, feeBIPS: value }; break;
      case "poolFeeShareBIPS": upd = { ...upd, poolFeeShareBIPS: value }; break;
      case "mintingVaultCollateralRatioBIPS": upd = { ...upd, mintingVaultCollateralRatioBIPS: value }; break;
      case "mintingPoolCollateralRatioBIPS": upd = { ...upd, mintingPoolCollateralRatioBIPS: value }; break;
      case "buyFAssetByAgentFactorBIPS": upd = { ...upd, buyFAssetByAgentFactorBIPS: value }; break;
      case "poolExitCollateralRatioBIPS": upd = { ...upd, poolExitCollateralRatioBIPS: value }; break;
      case "redemptionPoolFeeShareBIPS": upd = { ...upd, redemptionPoolFeeShareBIPS: value }; break;
      case "poolTopupCollateralRatioBIPS": upd = { ...upd, poolTopupCollateralRatioBIPS: value }; break;
      case "poolTopupTokenPriceFactorBIPS": upd = { ...upd, poolTopupTokenPriceFactorBIPS: value }; break;
      case "handshakeType": break; // deprecated no-op
      default: break;
    }
    context.AgentVaultSettings.set(upd);
  }
});

indexer.onEvent({ contract: "AssetManager", event: "AvailableAgentExited" }, async (_args) => {
  // source: flips AgentVaultInfo.publiclyAvailable=false. AgentVaultInfo is an
  // eth_call-derived state entity that is DEFERRED (see MIGRATION.md); the
  // source emits no event record for this either — no-op.
});

indexer.onEvent({ contract: "AssetManager", event: "AgentAvailable" }, async (_args) => {
  // source: flips AgentVaultInfo.publiclyAvailable=true (DEFERRED). No-op.
});

indexer.onEvent({ contract: "AssetManager", event: "SelfClose" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  context.SelfClose.set({ ...common(event), fasset, agentVault_id: a(event.params.agentVault), valueUBA: event.params.valueUBA });
});

indexer.onEvent({ contract: "AssetManager", event: "VaultCollateralWithdrawalAnnounced" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  context.VaultCollateralWithdrawalAnnounced.set({
    ...common(event), fasset, agentVault_id: a(event.params.agentVault),
    amountWei: event.params.amountWei, allowedAt: event.params.withdrawalAllowedAt,
  });
});

indexer.onEvent({ contract: "AssetManager", event: "PoolTokenRedemptionAnnounced" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  context.PoolTokenRedemptionAnnounced.set({
    ...common(event), fasset, agentVault_id: a(event.params.agentVault),
    amountWei: event.params.amountWei, allowedAt: event.params.withdrawalAllowedAt,
  });
});

// ===========================================================================
// underlying tracking
// ===========================================================================

indexer.onEvent({ contract: "AssetManager", event: "UnderlyingWithdrawalAnnounced" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  context.UnderlyingWithdrawalAnnounced.set({
    ...common(event),
    id: fkey(fasset, event.params.announcementId),
    fasset,
    agentVault_id: a(event.params.agentVault),
    announcementId: event.params.announcementId,
    paymentReference: a(event.params.paymentReference),
    resolution: UnderlyingWithdrawalResolution.NONE,
  });
});

indexer.onEvent({ contract: "AssetManager", event: "UnderlyingWithdrawalConfirmed" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  const annId = fkey(fasset, event.params.announcementId);
  const ann = await context.UnderlyingWithdrawalAnnounced.get(annId);
  if (ann) context.UnderlyingWithdrawalAnnounced.set({ ...ann, resolution: UnderlyingWithdrawalResolution.CONFIRMED });
  context.UnderlyingWithdrawalConfirmed.set({
    ...common(event), fasset, underlyingWithdrawalAnnounced_id: annId,
    spendUBA: event.params.spentUBA, transactionHash: a(event.params.transactionHash),
  });
});

indexer.onEvent({ contract: "AssetManager", event: "UnderlyingWithdrawalCancelled" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  const annId = fkey(fasset, event.params.announcementId);
  const ann = await context.UnderlyingWithdrawalAnnounced.get(annId);
  if (ann) context.UnderlyingWithdrawalAnnounced.set({ ...ann, resolution: UnderlyingWithdrawalResolution.CANCELLED });
  context.UnderlyingWithdrawalCancelled.set({ ...common(event), fasset, underlyingWithdrawalAnnounced_id: annId });
});

indexer.onEvent({ contract: "AssetManager", event: "UnderlyingBalanceToppedUp" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  context.UnderlyingBalanceToppedUp.set({
    ...common(event), fasset, agentVault_id: a(event.params.agentVault),
    transactionHash: a(event.params.transactionHash), depositedUBA: event.params.depositedUBA,
  });
});

indexer.onEvent({ contract: "AssetManager", event: "UnderlyingBalanceChanged" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  context.UnderlyingBalanceChanged.set({
    ...common(event), fasset, agentVault_id: a(event.params.agentVault), balanceUBA: event.params.underlyingBalanceUBA,
  });
});

indexer.onEvent({ contract: "AssetManager", event: "DustChanged" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  context.DustChanged.set({ ...common(event), fasset, agentVault_id: a(event.params.agentVault), dustUBA: event.params.dustUBA });
});

indexer.onEvent({ contract: "AssetManager", event: "ConfirmedClosedMintingPayment" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  context.ConfirmedClosedMintingPayment.set({
    ...common(event), fasset, agentVault_id: a(event.params.agentVault),
    transactionHash: a(event.params.transactionHash), depositedUBA: event.params.depositedUBA,
  });
});

// ===========================================================================
// minting
// ===========================================================================

indexer.onEvent({ contract: "AssetManager", event: "CollateralReserved" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  const crId = Number(event.params.collateralReservationId);
  context.CollateralReserved.set({
    ...common(event),
    id: fkey(fasset, crId),
    fasset,
    agentVault_id: a(event.params.agentVault),
    collateralReservationId: crId,
    minter: a(event.params.minter),
    valueUBA: event.params.valueUBA,
    feeUBA: event.params.feeUBA,
    firstUnderlyingBlock: Number(event.params.firstUnderlyingBlock),
    lastUnderlyingBlock: Number(event.params.lastUnderlyingBlock),
    lastUnderlyingTimestamp: Number(event.params.lastUnderlyingTimestamp),
    paymentAddress: event.params.paymentAddress,
    paymentReference: a(event.params.paymentReference),
    executor: a(event.params.executor),
    executorFeeNatWei: event.params.executorFeeNatWei,
    resolution: CollateralReservationResolution.NONE,
  });
});

indexer.onEvent({ contract: "AssetManager", event: "MintingExecuted" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  const crKey = fkey(fasset, Number(event.params.collateralReservationId));
  const cr = await context.CollateralReserved.get(crKey);
  if (cr) context.CollateralReserved.set({ ...cr, resolution: CollateralReservationResolution.EXECUTED });
  context.MintingExecuted.set({ ...common(event), fasset, collateralReserved_id: crKey, poolFeeUBA: event.params.poolFeeUBA });
});

indexer.onEvent({ contract: "AssetManager", event: "MintingPaymentDefault" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  const crKey = fkey(fasset, Number(event.params.collateralReservationId));
  const cr = await context.CollateralReserved.get(crKey);
  if (cr) context.CollateralReserved.set({ ...cr, resolution: CollateralReservationResolution.DEFAULTED });
  context.MintingPaymentDefault.set({ ...common(event), fasset, collateralReserved_id: crKey });
});

indexer.onEvent({ contract: "AssetManager", event: "CollateralReservationDeleted" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  const crKey = fkey(fasset, Number(event.params.collateralReservationId));
  const cr = await context.CollateralReserved.get(crKey);
  if (cr) context.CollateralReserved.set({ ...cr, resolution: CollateralReservationResolution.DELETED });
  context.CollateralReservationDeleted.set({ ...common(event), fasset, collateralReserved_id: crKey });
});

indexer.onEvent({ contract: "AssetManager", event: "SelfMint" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  context.SelfMint.set({
    ...common(event), fasset, agentVault_id: a(event.params.agentVault),
    mintFromFreeUnderlying: event.params.mintFromFreeUnderlying,
    mintedUBA: event.params.mintedAmountUBA, depositedUBA: event.params.depositedAmountUBA, poolFeeUBA: event.params.poolFeeUBA,
  });
});

// ===========================================================================
// direct minting
// ===========================================================================

indexer.onEvent({ contract: "AssetManager", event: "DirectMintingExecuted" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  context.DirectMintingExecuted.set({
    ...common(event), fasset, transactionId: a(event.params.transactionId),
    targetAddress: a(event.params.targetAddress), executor: a(event.params.executor),
    mintedAmountUBA: event.params.mintedAmountUBA, mintingFeeUBA: event.params.mintingFeeUBA, executorFeeUBA: event.params.executorFeeUBA,
  });
});

indexer.onEvent({ contract: "AssetManager", event: "DirectMintingExecutedToSmartAccount" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  context.DirectMintingExecutedToSmartAccount.set({
    ...common(event), fasset, transactionId: a(event.params.transactionId),
    sourceAddress: event.params.sourceAddress, executor: a(event.params.executor),
    mintedAmountUBA: event.params.mintedAmountUBA, mintingFeeUBA: event.params.mintingFeeUBA, memoData: a(event.params.memoData),
  });
});

indexer.onEvent({ contract: "AssetManager", event: "DirectMintingPaymentTooSmallForFee" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  context.DirectMintingPaymentTooSmallForFee.set({
    ...common(event), fasset, transactionId: a(event.params.transactionId),
    receivedAmountUBA: event.params.receivedAmountUBA, minimumMintingFeeUBA: event.params.minimumMintingFeeUBA,
  });
});

indexer.onEvent({ contract: "AssetManager", event: "DirectMintingDelayed" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  context.DirectMintingDelayed.set({
    ...common(event), fasset, transactionId: a(event.params.transactionId),
    amount: event.params.amount, executionAllowedAt: event.params.executionAllowedAt,
  });
});

indexer.onEvent({ contract: "AssetManager", event: "LargeDirectMintingDelayed" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  context.LargeDirectMintingDelayed.set({
    ...common(event), fasset, transactionId: a(event.params.transactionId),
    amount: event.params.amount, executionAllowedAt: event.params.executionAllowedAt,
  });
});

indexer.onEvent({ contract: "AssetManager", event: "DirectMintingsUnblocked" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  context.DirectMintingsUnblocked.set({ ...common(event), fasset, startedUntilTimestamp: event.params.startedUntilTimestamp });
});

// ===========================================================================
// redemption
// ===========================================================================

indexer.onEvent({ contract: "AssetManager", event: "RedemptionRequested" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  const reqId = Number(event.params.requestId);
  context.RedemptionRequested.set({
    ...common(event), id: fkey(fasset, reqId), kind: "plain", fasset,
    agentVault_id: a(event.params.agentVault), requestId: reqId, redeemer: a(event.params.redeemer),
    paymentAddress: event.params.paymentAddress, valueUBA: event.params.valueUBA, feeUBA: event.params.feeUBA,
    firstUnderlyingBlock: Number(event.params.firstUnderlyingBlock), lastUnderlyingBlock: Number(event.params.lastUnderlyingBlock),
    lastUnderlyingTimestamp: Number(event.params.lastUnderlyingTimestamp), paymentReference: a(event.params.paymentReference),
    executor: a(event.params.executor), executorFeeNatWei: event.params.executorFeeNatWei,
    resolution: RedemptionResolution.NONE, destinationTag: undefined,
  });
});

indexer.onEvent({ contract: "AssetManager", event: "RedemptionWithTagRequested" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  const reqId = Number(event.params.requestId);
  context.RedemptionRequested.set({
    ...common(event), id: fkey(fasset, reqId), kind: "tagged", fasset,
    agentVault_id: a(event.params.agentVault), requestId: reqId, redeemer: a(event.params.redeemer),
    paymentAddress: event.params.paymentAddress, valueUBA: event.params.valueUBA, feeUBA: event.params.feeUBA,
    firstUnderlyingBlock: Number(event.params.firstUnderlyingBlock), lastUnderlyingBlock: Number(event.params.lastUnderlyingBlock),
    lastUnderlyingTimestamp: Number(event.params.lastUnderlyingTimestamp), paymentReference: a(event.params.paymentReference),
    executor: a(event.params.executor), executorFeeNatWei: event.params.executorFeeNatWei,
    resolution: RedemptionResolution.NONE, destinationTag: event.params.destinationTag,
  });
});

indexer.onEvent({ contract: "AssetManager", event: "RedemptionPerformed" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  const rrKey = fkey(fasset, Number(event.params.requestId));
  const rr = await context.RedemptionRequested.get(rrKey);
  if (rr) context.RedemptionRequested.set({ ...rr, resolution: RedemptionResolution.PERFORMED });
  context.RedemptionPerformed.set({
    ...common(event), fasset, redemptionRequested_id: rrKey,
    transactionHash: a(event.params.transactionHash), spentUnderlyingUBA: event.params.spentUnderlyingUBA,
  });
});

indexer.onEvent({ contract: "AssetManager", event: "RedemptionDefault" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  const rrKey = fkey(fasset, Number(event.params.requestId));
  const rr = await context.RedemptionRequested.get(rrKey);
  if (rr) context.RedemptionRequested.set({ ...rr, resolution: RedemptionResolution.DEFAULTED });
  context.RedemptionDefault.set({
    ...common(event), fasset, redemptionRequested_id: rrKey,
    redeemedVaultCollateralWei: event.params.redeemedVaultCollateralWei, redeemedPoolCollateralWei: event.params.redeemedPoolCollateralWei,
  });
});

indexer.onEvent({ contract: "AssetManager", event: "RedemptionPaymentBlocked" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  const rrKey = fkey(fasset, Number(event.params.requestId));
  const rr = await context.RedemptionRequested.get(rrKey);
  if (rr) context.RedemptionRequested.set({ ...rr, resolution: RedemptionResolution.BLOCKED });
  context.RedemptionPaymentBlocked.set({
    ...common(event), fasset, redemptionRequested_id: rrKey,
    transactionHash: a(event.params.transactionHash), spentUnderlyingUBA: event.params.spentUnderlyingUBA,
  });
});

indexer.onEvent({ contract: "AssetManager", event: "RedemptionPaymentFailed" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  const rrKey = fkey(fasset, Number(event.params.requestId));
  const rr = await context.RedemptionRequested.get(rrKey);
  if (rr) context.RedemptionRequested.set({ ...rr, resolution: RedemptionResolution.FAILED });
  context.RedemptionPaymentFailed.set({
    ...common(event), fasset, redemptionRequested_id: rrKey,
    transactionHash: a(event.params.transactionHash), spentUnderlyingUBA: event.params.spentUnderlyingUBA,
    failureReason: event.params.failureReason,
  });
});

indexer.onEvent({ contract: "AssetManager", event: "RedemptionRejected" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  const rrKey = fkey(fasset, Number(event.params.requestId));
  const rr = await context.RedemptionRequested.get(rrKey);
  if (rr) context.RedemptionRequested.set({ ...rr, resolution: RedemptionResolution.REJECTED });
  context.RedemptionRejected.set({ ...common(event), fasset, redemptionRequested_id: rrKey });
});

indexer.onEvent({ contract: "AssetManager", event: "RedeemedInCollateral" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  context.RedeemedInCollateral.set({
    ...common(event), fasset, agentVault_id: a(event.params.agentVault), redeemer: a(event.params.redeemer),
    redemptionAmountUBA: event.params.redemptionAmountUBA, paidVaultCollateralWei: event.params.paidVaultCollateralWei,
  });
});

indexer.onEvent({ contract: "AssetManager", event: "RedemptionRequestIncomplete" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  context.RedemptionRequestIncomplete.set({
    ...common(event), fasset, redeemer: a(event.params.redeemer), remainingLots: event.params.remainingLots,
  });
});

indexer.onEvent({ contract: "AssetManager", event: "RedemptionAmountIncomplete" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  context.RedemptionAmountIncomplete.set({
    ...common(event), fasset, redeemer: a(event.params.redeemer), remainingAmountUBA: event.params.remainingAmountUBA,
  });
});

indexer.onEvent({ contract: "AssetManager", event: "RedemptionPoolFeeMinted" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  context.RedemptionPoolFeeMinted.set({
    ...common(event), fasset, redemptionRequested_id: fkey(fasset, Number(event.params.requestId)), poolFeeUBA: event.params.poolFeeUBA,
  });
});

// ---- redemption tickets ----

indexer.onEvent({ contract: "AssetManager", event: "RedemptionTicketCreated" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  const ticketKey = fkey(fasset, event.params.redemptionTicketId);
  context.RedemptionTicketCreated.set({
    ...common(event), id: ticketKey, fasset, agentVault_id: a(event.params.agentVault),
    redemptionTicketId: event.params.redemptionTicketId, ticketValueUBA: event.params.ticketValueUBA,
  });
  context.RedemptionTicket.set({
    id: ticketKey, redemptionTicketCreated_id: ticketKey, ticketValueUBA: event.params.ticketValueUBA, destroyed: false,
  });
});

indexer.onEvent({ contract: "AssetManager", event: "RedemptionTicketUpdated" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  const ticketKey = fkey(fasset, event.params.redemptionTicketId);
  context.RedemptionTicketUpdated.set({
    ...common(event), fasset, redemptionTicketCreated_id: ticketKey, ticketValueUBA: event.params.ticketValueUBA,
  });
  const t = await context.RedemptionTicket.get(ticketKey);
  if (t) context.RedemptionTicket.set({ ...t, ticketValueUBA: event.params.ticketValueUBA });
});

indexer.onEvent({ contract: "AssetManager", event: "RedemptionTicketDeleted" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  const ticketKey = fkey(fasset, event.params.redemptionTicketId);
  context.RedemptionTicketDeleted.set({ ...common(event), fasset, redemptionTicketCreated_id: ticketKey });
  const t = await context.RedemptionTicket.get(ticketKey);
  if (t) context.RedemptionTicket.set({ ...t, ticketValueUBA: 0n, destroyed: true });
});

// ===========================================================================
// liquidation
// ===========================================================================

indexer.onEvent({ contract: "AssetManager", event: "LiquidationStarted" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  context.LiquidationStarted.set({
    id: eid(event), fasset, agentVault_id: a(event.params.agentVault), timestamp: Number(event.params.timestamp),
    blockNumber: event.block.number, blockTimestamp: event.block.timestamp, logIndex: event.logIndex,
  });
});

indexer.onEvent({ contract: "AssetManager", event: "FullLiquidationStarted" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  context.FullLiquidationStarted.set({
    id: eid(event), fasset, agentVault_id: a(event.params.agentVault), timestamp: Number(event.params.timestamp),
    blockNumber: event.block.number, blockTimestamp: event.block.timestamp, logIndex: event.logIndex,
  });
});

indexer.onEvent({ contract: "AssetManager", event: "LiquidationPerformed" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  context.LiquidationPerformed.set({
    ...common(event), fasset, agentVault_id: a(event.params.agentVault), liquidator: a(event.params.liquidator),
    valueUBA: event.params.valueUBA, paidVaultCollateralWei: event.params.paidVaultCollateralWei, paidPoolCollateralWei: event.params.paidPoolCollateralWei,
  });
});

indexer.onEvent({ contract: "AssetManager", event: "LiquidationEnded" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  context.LiquidationEnded.set({ ...common(event), fasset, agentVault_id: a(event.params.agentVault) });
});

// ===========================================================================
// challenges
// ===========================================================================

indexer.onEvent({ contract: "AssetManager", event: "IllegalPaymentConfirmed" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  context.IllegalPaymentConfirmed.set({
    ...common(event), fasset, agentVault_id: a(event.params.agentVault), transactionHash: a(event.params.transactionHash),
  });
});

indexer.onEvent({ contract: "AssetManager", event: "DuplicatePaymentConfirmed" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  context.DuplicatePaymentConfirmed.set({
    ...common(event), fasset, agentVault_id: a(event.params.agentVault),
    transactionHash1: a(event.params.transactionHash1), transactionHash2: a(event.params.transactionHash2),
  });
});

indexer.onEvent({ contract: "AssetManager", event: "UnderlyingBalanceTooLow" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  context.UnderlyingBalanceTooLow.set({
    ...common(event), fasset, agentVault_id: a(event.params.agentVault),
    balance: event.params.balance, requiredBalance: event.params.requiredBalance,
  });
});

// ===========================================================================
// agent ping
// ===========================================================================

indexer.onEvent({ contract: "AssetManager", event: "AgentPing" }, async ({ event, context }) => {
  const agentVault = a(event.params.agentVault);
  const av = await context.AgentVault.get(agentVault);
  const fasset = av ? av.fasset : assetManagerFAsset(event.srcAddress);
  context.AgentPing.set({ ...common(event), fasset, agentVault_id: agentVault, sender: a(event.params.sender), query: event.params.query });
});

indexer.onEvent({ contract: "AssetManager", event: "AgentPingResponse" }, async ({ event, context }) => {
  const agentVault = a(event.params.agentVault);
  const av = await context.AgentVault.get(agentVault);
  const fasset = av ? av.fasset : assetManagerFAsset(event.srcAddress);
  context.AgentPingResponse.set({ ...common(event), fasset, agentVault_id: agentVault, query: event.params.query, response: event.params.response });
});

// ===========================================================================
// system
// ===========================================================================

indexer.onEvent({ contract: "AssetManager", event: "CurrentUnderlyingBlockUpdated" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  context.CurrentUnderlyingBlockUpdated.set({
    ...common(event), fasset,
    underlyingBlockNumber: Number(event.params.underlyingBlockNumber),
    underlyingBlockTimestamp: Number(event.params.underlyingBlockTimestamp),
    updatedAt: Number(event.params.updatedAt),
  });
});

// ===========================================================================
// core vault (asset-manager side)
// ===========================================================================

indexer.onEvent({ contract: "AssetManager", event: "TransferToCoreVaultStarted" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  const trId = Number(event.params.transferRedemptionRequestId);
  context.TransferToCoreVaultStarted.set({
    ...common(event), id: fkey(fasset, trId), fasset, agentVault_id: a(event.params.agentVault),
    transferRedemptionRequestId: trId, valueUBA: event.params.valueUBA, resolution: TransferToCoreVaultResolution.NONE,
  });
});

indexer.onEvent({ contract: "AssetManager", event: "TransferToCoreVaultSuccessful" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  const key = fkey(fasset, Number(event.params.transferRedemptionRequestId));
  const s = await context.TransferToCoreVaultStarted.get(key);
  if (s) context.TransferToCoreVaultStarted.set({ ...s, resolution: TransferToCoreVaultResolution.SUCCESSFUL });
  context.TransferToCoreVaultSuccessful.set({ ...common(event), fasset, transferToCoreVaultStarted_id: key, valueUBA: event.params.valueUBA });
});

indexer.onEvent({ contract: "AssetManager", event: "TransferToCoreVaultDefaulted" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  const key = fkey(fasset, Number(event.params.transferRedemptionRequestId));
  const s = await context.TransferToCoreVaultStarted.get(key);
  if (s) context.TransferToCoreVaultStarted.set({ ...s, resolution: TransferToCoreVaultResolution.DEFAULTED });
  context.TransferToCoreVaultDefaulted.set({ ...common(event), fasset, transferToCoreVaultStarted_id: key, remintedUBA: event.params.remintedUBA });
});

indexer.onEvent({ contract: "AssetManager", event: "ReturnFromCoreVaultRequested" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  const reqId = Number(event.params.requestId);
  context.ReturnFromCoreVaultRequested.set({
    ...common(event), id: fkey(fasset, reqId), fasset, agentVault_id: a(event.params.agentVault),
    requestId: reqId, paymentReference: a(event.params.paymentReference), valueUBA: event.params.valueUBA,
    resolution: ReturnFromCoreVaultResolution.NONE,
  });
});

indexer.onEvent({ contract: "AssetManager", event: "ReturnFromCoreVaultConfirmed" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  const key = fkey(fasset, Number(event.params.requestId));
  const s = await context.ReturnFromCoreVaultRequested.get(key);
  if (s) context.ReturnFromCoreVaultRequested.set({ ...s, resolution: ReturnFromCoreVaultResolution.CONFIRMED });
  context.ReturnFromCoreVaultConfirmed.set({
    ...common(event), fasset, returnFromCoreVaultRequested_id: key,
    receivedUnderlyingUBA: event.params.receivedUnderlyingUBA, remintedUBA: event.params.remintedUBA,
  });
});

indexer.onEvent({ contract: "AssetManager", event: "ReturnFromCoreVaultCancelled" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  const key = fkey(fasset, Number(event.params.requestId));
  const s = await context.ReturnFromCoreVaultRequested.get(key);
  if (s) context.ReturnFromCoreVaultRequested.set({ ...s, resolution: ReturnFromCoreVaultResolution.CANCELLED });
  context.ReturnFromCoreVaultCancelled.set({ ...common(event), fasset, returnFromCoreVaultRequested_id: key });
});

indexer.onEvent({ contract: "AssetManager", event: "CoreVaultRedemptionRequested" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  context.CoreVaultRedemptionRequested.set({
    ...common(event), fasset, redeemer: a(event.params.redeemer), paymentAddress: event.params.paymentAddress,
    paymentReference: a(event.params.paymentReference), valueUBA: event.params.valueUBA, feeUBA: event.params.feeUBA,
  });
});

indexer.onEvent({ contract: "AssetManager", event: "CoreVaultFundsAdded" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  context.CoreVaultFundsAdded.set({ ...common(event), fasset, amountUBA: event.params.amountUBA });
});

// ===========================================================================
// emergency pause
// ===========================================================================

indexer.onEvent({ contract: "AssetManager", event: "EmergencyPauseTriggered" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  context.EmergencyPauseTriggered.set({
    ...common(event), fasset,
    externalLevel: Number(event.params.externalLevel), governanceLevel: Number(event.params.governanceLevel),
    externalPausedUntil: event.params.externalPausedUntil, governancePausedUntil: event.params.governancePausedUntil,
  });
});

indexer.onEvent({ contract: "AssetManager", event: "EmergencyPauseCanceled" }, async ({ event, context }) => {
  const fasset = assetManagerFAsset(event.srcAddress);
  context.EmergencyPauseCancelled.set({ ...common(event), fasset });
});

// ===========================================================================
// collateral pool (CP* event set). fasset/agentVault resolved via CollateralPoolMap.
// ===========================================================================

async function poolFAsset(
  context: { CollateralPoolMap: { get: (id: string) => Promise<{ fasset: number } | undefined> } },
  srcAddress: string,
): Promise<number> {
  const m = await context.CollateralPoolMap.get(a(srcAddress));
  return m ? m.fasset : FAssetType.FXRP;
}

indexer.onEvent({ contract: "CollateralPool", event: "CPClaimedReward" }, async ({ event, context }) => {
  const fasset = await poolFAsset(context, event.srcAddress);
  context.CPClaimedReward.set({ ...common(event), fasset, amountNatWei: event.params.amountNatWei, rewardType: Number(event.params.rewardType) });
});

indexer.onEvent({ contract: "CollateralPool", event: "CPEntered" }, async ({ event, context }) => {
  const fasset = await poolFAsset(context, event.srcAddress);
  context.CPEntered.set({
    ...common(event), fasset, tokenHolder: a(event.params.tokenHolder),
    amountNatWei: event.params.amountNatWei, receivedTokensWei: event.params.receivedTokensWei, timelockExpiresAt: event.params.timelockExpiresAt,
  });
});

indexer.onEvent({ contract: "CollateralPool", event: "CPExited" }, async ({ event, context }) => {
  const fasset = await poolFAsset(context, event.srcAddress);
  context.CPExited.set({
    ...common(event), fasset, tokenHolder: a(event.params.tokenHolder),
    burnedTokensWei: event.params.burnedTokensWei, receivedNatWei: event.params.receivedNatWei,
  });
});

indexer.onEvent({ contract: "CollateralPool", event: "CPFeesWithdrawn" }, async ({ event, context }) => {
  const fasset = await poolFAsset(context, event.srcAddress);
  context.CPFeesWithdrawn.set({ ...common(event), fasset, tokenHolder: a(event.params.tokenHolder), withdrawnFeesUBA: event.params.withdrawnFeesUBA });
});

indexer.onEvent({ contract: "CollateralPool", event: "CPFeeDebtChanged" }, async ({ event, context }) => {
  const fasset = await poolFAsset(context, event.srcAddress);
  context.CPFeeDebtChanged.set({ ...common(event), fasset, tokenHolder: a(event.params.tokenHolder), newFeeDebtUBA: event.params.newFeeDebtUBA });
});

indexer.onEvent({ contract: "CollateralPool", event: "CPFeeDebtPaid" }, async ({ event, context }) => {
  const fasset = await poolFAsset(context, event.srcAddress);
  context.CPFeeDebtPaid.set({ ...common(event), fasset, tokenHolder: a(event.params.tokenHolder), paidFeesUBA: event.params.paidFeesUBA });
});

indexer.onEvent({ contract: "CollateralPool", event: "CPPaidOut" }, async ({ event, context }) => {
  const fasset = await poolFAsset(context, event.srcAddress);
  context.CPPaidOut.set({
    ...common(event), fasset, recipient: a(event.params.recipient), paidNatWei: event.params.paidNatWei, burnedTokensWei: event.params.burnedTokensWei,
  });
});

indexer.onEvent({ contract: "CollateralPool", event: "CPSelfCloseExited" }, async ({ event, context }) => {
  const fasset = await poolFAsset(context, event.srcAddress);
  context.CPSelfCloseExited.set({
    ...common(event), fasset, tokenHolder: a(event.params.tokenHolder),
    burnedTokensWei: event.params.burnedTokensWei, receivedNatWei: event.params.receivedNatWei, closedFAssetsUBA: event.params.closedFAssetsUBA,
  });
});

// ===========================================================================
// core vault manager
// ===========================================================================

indexer.onEvent({ contract: "CoreVaultManager", event: "SettingsUpdated" }, async ({ event, context }) => {
  const fasset = coreVaultManagerFAsset(event.srcAddress);
  context.CoreVaultManagerSettingsUpdated.set({
    ...common(event), fasset, escrowEndTimeSeconds: Number(event.params.escrowEndTimeSeconds),
    escrowAmount: event.params.escrowAmount, minimalAmount: event.params.minimalAmount, fee: event.params.fee,
  });
  // maintain CoreVaultManagerSettings state
  const prev = await context.CoreVaultManagerSettings.get(String(fasset));
  context.CoreVaultManagerSettings.set({
    id: String(fasset), fasset,
    escrowAmount: event.params.escrowAmount, minimalAmount: event.params.minimalAmount,
    escrowEndTimeSeconds: Number(event.params.escrowEndTimeSeconds), chainPaymentFee: event.params.fee,
    coreVault: prev?.coreVault,
  });
});

indexer.onEvent({ contract: "CoreVaultManager", event: "CustodianAddressUpdated" }, async ({ event, context }) => {
  const fasset = coreVaultManagerFAsset(event.srcAddress);
  context.CoreVaultManagerCustodianAddressUpdated.set({ ...common(event), fasset, custodian: event.params.custodianAddress });
});

indexer.onEvent({ contract: "CoreVaultManager", event: "EscrowExpired" }, async ({ event, context }) => {
  const fasset = coreVaultManagerFAsset(event.srcAddress);
  context.EscrowExpired.set({ ...common(event), fasset, preimageHash: a(event.params.preimageHash), amount: event.params.amount });
});

indexer.onEvent({ contract: "CoreVaultManager", event: "EscrowFinished" }, async ({ event, context }) => {
  const fasset = coreVaultManagerFAsset(event.srcAddress);
  context.EscrowFinished.set({ ...common(event), fasset, preimageHash: a(event.params.preimageHash), amount: event.params.amount });
});

indexer.onEvent({ contract: "CoreVaultManager", event: "EscrowInstructions" }, async ({ event, context }) => {
  const fasset = coreVaultManagerFAsset(event.srcAddress);
  context.CoreVaultManagerEscrowInstructions.set({
    ...common(event), fasset, sequence: event.params.sequence, preimageHash: a(event.params.preimageHash),
    account: event.params.account, destination: event.params.destination,
    amount: event.params.amount, fee: event.params.fee, cancelAfterTs: event.params.cancelAfterTs,
  });
});

indexer.onEvent({ contract: "CoreVaultManager", event: "NotAllEscrowsProcessed" }, async ({ event, context }) => {
  const fasset = coreVaultManagerFAsset(event.srcAddress);
  context.CoreVaultManagerNotAllEscrowsProcessed.set({ ...common(event), fasset });
});

indexer.onEvent({ contract: "CoreVaultManager", event: "PaymentConfirmed" }, async ({ event, context }) => {
  const fasset = coreVaultManagerFAsset(event.srcAddress);
  context.CoreVaultManagerPaymentConfirmed.set({
    ...common(event), id: fkey(fasset, a(event.params.transactionId)), fasset,
    transactionId: a(event.params.transactionId), paymentReference: a(event.params.paymentReference), amount: event.params.amount,
  });
});

indexer.onEvent({ contract: "CoreVaultManager", event: "PaymentInstructions" }, async ({ event, context }) => {
  const fasset = coreVaultManagerFAsset(event.srcAddress);
  context.CoreVaultManagerPaymentInstructions.set({
    ...common(event), fasset, sequence: event.params.sequence, account: event.params.account,
    destination: event.params.destination, amount: event.params.amount, fee: event.params.fee, paymentReference: a(event.params.paymentReference),
  });
});

indexer.onEvent({ contract: "CoreVaultManager", event: "TransferRequested" }, async ({ event, context }) => {
  const fasset = coreVaultManagerFAsset(event.srcAddress);
  context.CoreVaultManagerTransferRequested.set({
    ...common(event), fasset, destination: event.params.destinationAddress,
    paymentReference: a(event.params.paymentReference), amount: event.params.amount, cancelable: event.params.cancelable,
  });
});

indexer.onEvent({ contract: "CoreVaultManager", event: "TransferRequestCanceled" }, async ({ event, context }) => {
  const fasset = coreVaultManagerFAsset(event.srcAddress);
  context.CoreVaultManagerTransferRequestCanceled.set({
    ...common(event), fasset, destination: event.params.destinationAddress,
    paymentReference: a(event.params.paymentReference), amount: event.params.amount,
  });
});

// ===========================================================================
// price publisher
// ===========================================================================

indexer.onEvent({ contract: "PriceReader", event: "PricesPublished" }, async ({ event, context }) => {
  context.PricesPublished.set({ ...common(event), votingRoundId: Number(event.params.votingRoundId) });
});
