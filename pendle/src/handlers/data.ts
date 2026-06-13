/**
 * Port of src/pendle/data.ts (PendleData data source handlers).
 *
 * `PendleForgeTemplate.create(event.params.forgeAddress)` -> contractRegister
 * adding the forge address to the IPendleForge template contract.
 */
import { indexer } from "envio";
import { RONE_BD, forgeIdToString, low, toBD } from "../utils";
import { loadPendleData } from "../services/helpers";
import { initializeUniswapPools } from "../services/uniswap-pools";

/** PENDLE DATA EVENTS */
indexer.onEvent({ contract: "PendleData", event: "MarketFeesSet" }, async ({ event, context }) => {
  const pendleData = await loadPendleData(context);
  // both swapFee and protocolSwapFee are set from _swapFee in the original (a
  // preserved quirk — protocolSwapFee is *not* derived from _protocolSwapFee).
  const swapFee = toBD(event.params._swapFee).div(RONE_BD);
  context.PendleData.set({
    ...pendleData,
    swapFee,
    protocolSwapFee: swapFee,
  });
});

/** PENDLE ROUTER EVENTS (emitted by PendleData) */
indexer.contractRegister({ contract: "PendleData", event: "ForgeAdded" }, async ({ event, context }) => {
  context.chain.IPendleForge.add(event.params.forgeAddress);
});

indexer.onEvent({ contract: "PendleData", event: "ForgeAdded" }, async ({ event, context }) => {
  // This line is put here on the purpose that its just gonna run once at the start of Pendle subgraph
  await initializeUniswapPools(context);
  context.Forge.set({
    id: low(event.params.forgeAddress),
    forgeId: forgeIdToString(event.params.forgeId),
  });
});

indexer.onEvent({ contract: "PendleData", event: "NewMarketFactory" }, async ({ event, context }) => {
  context.MarketFactory.set({
    id: forgeIdToString(event.params.marketFactoryId),
    address: low(event.params.marketFactoryAddress),
  });
});
