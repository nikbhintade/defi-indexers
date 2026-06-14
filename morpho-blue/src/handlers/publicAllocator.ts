/**
 * Port of src/public-allocator.ts (PublicAllocator data source).
 *
 * Writes the MetaMorphoPublicAllocator / MetaMorphoPublicAllocatorMarket /
 * SetFlowCapsEvent / PublicAllocatorReallocationToEvent /
 * PublicAllocatorWithdrawalEvent / MarketFlowCapsSet entities.
 *
 * Public allocator events can be emitted for any vault address; we only index
 * MetaMorpho vaults created through the indexed factories (metaMorphoExists).
 */
import {
  indexer,
  type MarketFlowCapsSet,
  type MetaMorphoPublicAllocator,
  type MetaMorphoPublicAllocatorMarket,
  type PublicAllocatorReallocationToEvent,
  type PublicAllocatorWithdrawalEvent,
  type SetFlowCapsEvent,
} from "envio";
import type { Context, Ev } from "../context";
import { getOrCreateAccount } from "../sdk/account";
import { loadMetaMorpho, loadMetaMorphoMarket } from "../sdk/metamorpho";
import { getPublicAllocatorAddress } from "../utils/publicAllocator";
import { hexConcat, i32Bytes, low } from "../utils/graphBytes";
import { normEvent } from "../context";

function eventBase(event: Ev) {
  return {
    hash: event.transaction.hash.toLowerCase(),
    nonce: event.transaction.nonce,
    logIndex: event.logIndex,
    gasPrice: event.transaction.gasPrice,
    gasUsed: undefined,
    gasLimit: event.transaction.gas,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
  };
}

// {tx hash}{fromI32(logIndex)}
function eventId(event: Ev): string {
  return hexConcat(event.transaction.hash.toLowerCase(), i32Bytes(event.logIndex));
}

async function metaMorphoExists(context: Context, address: string): Promise<boolean> {
  const mm = await context.MetaMorpho.get(low(address));
  return mm !== undefined;
}

// loadPublicAllocatorVault: id = publicAllocatorAddress ++ metaMorpho
export async function loadPublicAllocatorVault(
  context: Context,
  metaMorpho: string,
): Promise<MetaMorphoPublicAllocator> {
  const id = hexConcat(getPublicAllocatorAddress(), low(metaMorpho));
  let pa = await context.MetaMorphoPublicAllocator.get(id);
  if (!pa) {
    const mm = await loadMetaMorpho(context, metaMorpho);
    // a vault owner can set flow caps before having set a public allocator; in
    // that case the allocator is linked dynamically when SetIsAllocator fires.
    const mmAllocator = await context.MetaMorphoAllocator.get(id);
    pa = {
      id,
      metaMorpho_id: mm.id,
      allocator_id: mmAllocator ? mmAllocator.id : undefined,
      fee: 0n,
      accruedFee: 0n,
      claimableFee: 0n,
      claimedFee: 0n,
      admin_id: undefined,
    };
    context.MetaMorphoPublicAllocator.set(pa);
  }
  return pa;
}

// loadPublicAllocatorMarket: id = metaMorpho ++ market
export async function loadPublicAllocatorMarket(
  context: Context,
  metaMorpho: string,
  market: string,
): Promise<MetaMorphoPublicAllocatorMarket> {
  const id = hexConcat(low(metaMorpho), low(market));
  let paMarket = await context.MetaMorphoPublicAllocatorMarket.get(id);
  if (!paMarket) {
    const mmMarket = await loadMetaMorphoMarket(context, low(metaMorpho), low(market));
    const paVault = await loadPublicAllocatorVault(context, metaMorpho);
    paMarket = {
      id,
      market_id: mmMarket.id,
      metaMorphoPublicAllocator_id: paVault.id,
      flowCapIn: 0n,
      flowCapOut: 0n,
    };
    context.MetaMorphoPublicAllocatorMarket.set(paMarket);
  }
  return paMarket;
}

indexer.onEvent(
  { contract: "PublicAllocator", event: "PublicReallocateTo" },
  async ({ event, context }) => {
    if (!(await metaMorphoExists(context, event.params.vault))) return;
    const ev = normEvent(event);

    const paMarket = await loadPublicAllocatorMarket(
      context,
      low(event.params.vault),
      low(event.params.supplyMarketId),
    );
    const newFlowCapIn = paMarket.flowCapIn - event.params.suppliedAssets;
    const newFlowCapOut = paMarket.flowCapOut + event.params.suppliedAssets;

    const id = eventId(ev);
    const author = await getOrCreateAccount(context, event.params.sender);

    const reallocateToEvent: PublicAllocatorReallocationToEvent = {
      id,
      ...eventBase(ev),
      author_id: author.id,
      metaMorphoPublicAllocator_id: paMarket.metaMorphoPublicAllocator_id,
      marketPublicAllocator_id: paMarket.id,
      suppliedAssets: event.params.suppliedAssets,
    };
    context.PublicAllocatorReallocationToEvent.set(reallocateToEvent);

    const marketFlowCapsSet: MarketFlowCapsSet = {
      id,
      metaMorphoPublicAllocator_id: paMarket.metaMorphoPublicAllocator_id,
      marketPublicAllocator_id: paMarket.market_id,
      prevFlowCapIn: paMarket.flowCapIn,
      flowCapIn: newFlowCapIn,
      prevFlowCapOut: paMarket.flowCapOut,
      flowCapOut: newFlowCapOut,
      setFlowCapsEvent_id: undefined,
      publicReallocationEvent_id: reallocateToEvent.id,
      publicWithdrawalEvent_id: undefined,
    };
    context.MarketFlowCapsSet.set(marketFlowCapsSet);

    context.MetaMorphoPublicAllocatorMarket.set({
      ...paMarket,
      flowCapIn: newFlowCapIn,
      flowCapOut: newFlowCapOut,
    });
  },
);

indexer.onEvent(
  { contract: "PublicAllocator", event: "PublicWithdrawal" },
  async ({ event, context }) => {
    if (!(await metaMorphoExists(context, event.params.vault))) return;
    const ev = normEvent(event);

    const paVault = await loadPublicAllocatorVault(context, low(event.params.vault));
    context.MetaMorphoPublicAllocator.set({
      ...paVault,
      accruedFee: paVault.accruedFee + paVault.fee,
      claimableFee: paVault.claimableFee + paVault.fee,
    });

    const paMarket = await loadPublicAllocatorMarket(
      context,
      low(event.params.vault),
      low(event.params.id),
    );
    const newFlowCapOut = paMarket.flowCapOut - event.params.withdrawnAssets;
    const newFlowCapIn = paMarket.flowCapIn + event.params.withdrawnAssets;

    const id = eventId(ev);
    const author = await getOrCreateAccount(context, event.params.sender);

    const withdrawalEvent: PublicAllocatorWithdrawalEvent = {
      id,
      ...eventBase(ev),
      author_id: author.id,
      metaMorphoPublicAllocator_id: paMarket.metaMorphoPublicAllocator_id,
      marketPublicAllocator_id: paMarket.id,
      withdrawnAssets: event.params.withdrawnAssets,
    };
    context.PublicAllocatorWithdrawalEvent.set(withdrawalEvent);

    const marketFlowCapsSet: MarketFlowCapsSet = {
      id,
      metaMorphoPublicAllocator_id: paMarket.metaMorphoPublicAllocator_id,
      marketPublicAllocator_id: paMarket.market_id,
      prevFlowCapIn: paMarket.flowCapIn,
      flowCapIn: newFlowCapIn,
      prevFlowCapOut: paMarket.flowCapOut,
      flowCapOut: newFlowCapOut,
      setFlowCapsEvent_id: undefined,
      publicReallocationEvent_id: undefined,
      publicWithdrawalEvent_id: withdrawalEvent.id,
    };
    context.MarketFlowCapsSet.set(marketFlowCapsSet);

    context.MetaMorphoPublicAllocatorMarket.set({
      ...paMarket,
      flowCapIn: newFlowCapIn,
      flowCapOut: newFlowCapOut,
    });
  },
);

indexer.onEvent(
  { contract: "PublicAllocator", event: "SetAdmin" },
  async ({ event, context }) => {
    if (!(await metaMorphoExists(context, event.params.vault))) return;
    const paVault = await loadPublicAllocatorVault(context, low(event.params.vault));
    const admin = await getOrCreateAccount(context, event.params.admin);
    context.MetaMorphoPublicAllocator.set({ ...paVault, admin_id: admin.id });
  },
);

indexer.onEvent(
  { contract: "PublicAllocator", event: "SetFee" },
  async ({ event, context }) => {
    if (!(await metaMorphoExists(context, event.params.vault))) return;
    const paVault = await loadPublicAllocatorVault(context, low(event.params.vault));
    context.MetaMorphoPublicAllocator.set({ ...paVault, fee: event.params.fee });
  },
);

indexer.onEvent(
  { contract: "PublicAllocator", event: "SetFlowCaps" },
  async ({ event, context }) => {
    if (!(await metaMorphoExists(context, event.params.vault))) return;
    const ev = normEvent(event);
    const paVault = await loadPublicAllocatorVault(context, low(event.params.vault));

    const id = eventId(ev);
    const author = await getOrCreateAccount(context, event.params.sender);
    const setFlowCapsEvent: SetFlowCapsEvent = {
      id,
      ...eventBase(ev),
      author_id: author.id,
      metaMorphoPublicAllocator_id: paVault.id,
    };
    context.SetFlowCapsEvent.set(setFlowCapsEvent);

    for (const config of event.params.config) {
      const configId = low(config.id);
      const maxIn = config.caps.maxIn;
      const maxOut = config.caps.maxOut;

      const mmMarketExists = await context.MetaMorphoMarket.get(
        hexConcat(low(event.params.vault), configId),
      );
      if (!mmMarketExists && maxIn === 0n && maxOut === 0n) {
        // flow cap can be set to 0 for a non-listed market; skip it.
        continue;
      }

      const paMarket = await loadPublicAllocatorMarket(
        context,
        low(event.params.vault),
        configId,
      );

      const marketFlowCapsSet: MarketFlowCapsSet = {
        id: hexConcat(id, configId),
        metaMorphoPublicAllocator_id: paMarket.metaMorphoPublicAllocator_id,
        marketPublicAllocator_id: paMarket.id,
        prevFlowCapIn: paMarket.flowCapIn,
        flowCapIn: maxIn,
        prevFlowCapOut: paMarket.flowCapOut,
        flowCapOut: maxOut,
        setFlowCapsEvent_id: setFlowCapsEvent.id,
        publicReallocationEvent_id: undefined,
        publicWithdrawalEvent_id: undefined,
      };
      context.MarketFlowCapsSet.set(marketFlowCapsSet);

      context.MetaMorphoPublicAllocatorMarket.set({
        ...paMarket,
        flowCapIn: maxIn,
        flowCapOut: maxOut,
      });
    }
  },
);

indexer.onEvent(
  { contract: "PublicAllocator", event: "TransferFee" },
  async ({ event, context }) => {
    if (!(await metaMorphoExists(context, event.params.vault))) return;
    const pa = await loadPublicAllocatorVault(context, low(event.params.vault));
    context.MetaMorphoPublicAllocator.set({
      ...pa,
      claimableFee: pa.claimableFee - event.params.amount,
      claimedFee: pa.claimedFee + event.params.amount,
    });
  },
);
