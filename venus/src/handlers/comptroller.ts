/**
 * Port of src/mappings/comptroller.ts.
 *
 * The subgraph instantiates the VToken / VTokenUpdatedEvents templates inside
 * getOrCreateMarket (called from every comptroller handler that carries a
 * vToken param). Template instantiation maps to `indexer.contractRegister`;
 * we register the vToken address on each such event so both event generations
 * (v1 / v2) are indexed for the new market.
 */
import { indexer } from "envio";
import { comptrollerAddress } from "../constants";
import {
  getOrCreateComptroller,
  getOrCreateMarketPosition,
} from "../services/helpers";
import { getOrCreateMarket, getMarketOrThrow } from "../services/markets";
import { getMarketId } from "../utilities/ids";

// ---- Dynamic template registration (VTokenTemplate.create / VTokenUpdatedEventsTemplate.create) ----
// Every comptroller handler that carries a vToken param calls getOrCreateMarket,
// which instantiates both VToken (v1) and VTokenUpdatedEvents (v2) templates.
const REGISTER_EVENTS = [
  "MarketListed",
  "MarketEntered",
  "MarketExited",
  "NewCollateralFactor",
  "DistributedSupplierVenus",
  "DistributedBorrowerVenus",
] as const;

for (const ev of REGISTER_EVENTS) {
  indexer.contractRegister({ contract: "Comptroller", event: ev }, async ({ event, context }) => {
    context.chain.VToken.add(event.params.vToken);
    context.chain.VTokenUpdatedEvents.add(event.params.vToken);
  });
}

// ---- Event handlers ----

indexer.onEvent({ contract: "Comptroller", event: "MarketListed" }, async ({ event, context }) => {
  // Create the market for initial listing
  const market = await getOrCreateMarket(context, event.params.vToken, event.block.number);
  // If the market is listed/relisted the following values are reset
  context.Market.set({ ...market, collateralFactorMantissa: 0n });
});

indexer.onEvent({ contract: "Comptroller", event: "MarketUnlisted" }, async ({ event, context }) => {
  const market = await getMarketOrThrow(context, event.params.vToken);
  context.Market.set({ ...market, isListed: false });
});

indexer.onEvent({ contract: "Comptroller", event: "MarketEntered" }, async ({ event, context }) => {
  const market = await getOrCreateMarket(context, event.params.vToken, event.block.number);
  const result = await getOrCreateMarketPosition(
    context,
    event.params.account,
    getMarketId(market.id),
    event.block.number,
  );
  context.MarketPosition.set({ ...result.entity, enteredMarket: true });
});

indexer.onEvent({ contract: "Comptroller", event: "MarketExited" }, async ({ event, context }) => {
  const market = await getOrCreateMarket(context, event.params.vToken, event.block.number);
  const result = await getOrCreateMarketPosition(
    context,
    event.params.account,
    getMarketId(market.id),
    event.block.number,
  );
  context.MarketPosition.set({ ...result.entity, enteredMarket: false });
});

indexer.onEvent({ contract: "Comptroller", event: "NewCloseFactor" }, async ({ event, context }) => {
  const comptroller = await getOrCreateComptroller(context);
  context.Comptroller.set({
    ...comptroller,
    closeFactorMantissa: event.params.newCloseFactorMantissa,
  });
});

indexer.onEvent(
  { contract: "Comptroller", event: "NewCollateralFactor" },
  async ({ event, context }) => {
    const market = await getOrCreateMarket(context, event.params.vToken, event.block.number);
    context.Market.set({
      ...market,
      collateralFactorMantissa: event.params.newCollateralFactorMantissa,
    });
  },
);

indexer.onEvent(
  { contract: "Comptroller", event: "NewLiquidationIncentive" },
  async ({ event, context }) => {
    const comptroller = await getOrCreateComptroller(context);
    context.Comptroller.set({
      ...comptroller,
      liquidationIncentive: event.params.newLiquidationIncentiveMantissa,
    });
  },
);

indexer.onEvent({ contract: "Comptroller", event: "NewPriceOracle" }, async ({ event, context }) => {
  const comptroller = await getOrCreateComptroller(context);
  context.Comptroller.set({ ...comptroller, priceOracle: event.params.newPriceOracle.toLowerCase() });
});

indexer.onEvent(
  { contract: "Comptroller", event: "DistributedSupplierVenus" },
  async ({ event, context }) => {
    const market = await getOrCreateMarket(context, event.params.vToken, event.block.number);
    // updateXvsSupplyState + accumulate distributed XVS
    context.Market.set({
      ...market,
      xvsSupplyStateIndex: event.params.venusSupplyIndex,
      xvsSupplyStateBlock: BigInt(event.block.number),
      totalXvsDistributedMantissa: market.totalXvsDistributedMantissa + event.params.venusDelta,
    });
  },
);

indexer.onEvent(
  { contract: "Comptroller", event: "DistributedBorrowerVenus" },
  async ({ event, context }) => {
    const market = await getOrCreateMarket(context, event.params.vToken, event.block.number);
    context.Market.set({
      ...market,
      xvsBorrowStateIndex: event.params.venusBorrowIndex,
      xvsBorrowStateBlock: BigInt(event.block.number),
      totalXvsDistributedMantissa: market.totalXvsDistributedMantissa + event.params.venusDelta,
    });
  },
);

indexer.onEvent(
  { contract: "Comptroller", event: "VenusSpeedUpdated" },
  async ({ event, context }) => {
    const marketAddress = event.params.vToken;
    const xvsBorrowState = await readVenusBorrowState(context, marketAddress, event.block.number);
    const market = await getMarketOrThrow(context, marketAddress);
    context.Market.set({
      ...market,
      xvsBorrowSpeed: event.params.newSpeed,
      xvsSupplySpeed: event.params.newSpeed,
      xvsBorrowStateIndex: xvsBorrowState.index,
      xvsBorrowStateBlock: xvsBorrowState.block,
    });
  },
);

indexer.onEvent(
  { contract: "Comptroller", event: "VenusBorrowSpeedUpdated" },
  async ({ event, context }) => {
    const marketAddress = event.params.vToken;
    const xvsBorrowState = await readVenusBorrowState(context, marketAddress, event.block.number);
    const market = await getMarketOrThrow(context, marketAddress);
    context.Market.set({
      ...market,
      xvsBorrowSpeed: event.params.newSpeed,
      xvsBorrowStateIndex: xvsBorrowState.index,
      xvsBorrowStateBlock: xvsBorrowState.block,
    });
  },
);

indexer.onEvent(
  { contract: "Comptroller", event: "VenusSupplySpeedUpdated" },
  async ({ event, context }) => {
    const marketAddress = event.params.vToken;
    const xvsSupplyState = await readVenusSupplyState(context, marketAddress, event.block.number);
    const market = await getMarketOrThrow(context, marketAddress);
    context.Market.set({
      ...market,
      xvsSupplySpeed: event.params.newSpeed,
      xvsSupplyStateIndex: xvsSupplyState.index,
      xvsSupplyStateBlock: xvsSupplyState.block,
    });
  },
);

// Helpers reading comptroller XVS state (non-try in the original -> abort on
// revert; here fall back to 0/0).
import {
  comptrollerVenusBorrowState,
  comptrollerVenusSupplyState,
} from "../effects/contracts";
import type { EvmOnEventContext } from "envio";

async function readVenusBorrowState(
  context: EvmOnEventContext,
  vToken: string,
  block: number,
): Promise<{ index: bigint; block: bigint }> {
  const res = await comptrollerVenusBorrowState(context.effect, comptrollerAddress, vToken, block);
  if (res === null) {
    context.log.error(`***CALL FAILED*** : Comptroller.venusBorrowState() reverted`);
    return { index: 0n, block: 0n };
  }
  return { index: res[0], block: res[1] };
}

async function readVenusSupplyState(
  context: EvmOnEventContext,
  vToken: string,
  block: number,
): Promise<{ index: bigint; block: bigint }> {
  const res = await comptrollerVenusSupplyState(context.effect, comptrollerAddress, vToken, block);
  if (res === null) {
    context.log.error(`***CALL FAILED*** : Comptroller.venusSupplyState() reverted`);
    return { index: 0n, block: 0n };
  }
  return { index: res[0], block: res[1] };
}
