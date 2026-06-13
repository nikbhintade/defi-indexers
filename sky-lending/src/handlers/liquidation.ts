/**
 * Port of Cat/Dog liquidation + Flip/Clip auction handlers.
 *
 * Templates: the subgraph did `Flip.create(flip)` / `Clip.create(clip)` to
 * spin up dynamic data sources for the auction contract emitted in
 * Cat.Bite / Dog.Bark. Here that is `indexer.contractRegister` on those
 * events, adding the auction address to the Flip / Clip contract.
 */
import { indexer, BigDecimal } from "envio";
import type { Market } from "envio";
import { toEventInfo } from "../common/event";
import type { EventInfo, Ctx } from "../common/types";
import {
  WAD,
  RAD,
  CAT_V1_ADDRESS,
  RAY,
  BIGINT_ZERO,
  BIGINT_NEG_ONE,
  BIGDECIMAL_ZERO,
  BIGDECIMAL_ONE,
  BIGDECIMAL_NEG_ONE,
  BIGDECIMAL_ONE_HUNDRED,
  INT_ZERO,
  INT_ONE,
  ZERO_ADDRESS,
  ProtocolSideRevenueType,
} from "../common/constants";
import { bytes32ToString, extractCallData, bytesToUnsignedBigInt } from "../utils/bytes";
import { bigIntChangeDecimals, bigIntToBDUseDecimals } from "../utils/numbers";
import {
  getOrCreateMarket,
  getOrCreateToken,
  getMarketFromIlk,
  getMarketAddressFromIlk,
  getOrCreateLiquidate,
  getOwnerAddress,
} from "../common/getters";
import {
  liquidatePosition,
  updateMarket,
  updateProtocol,
  updateFinancialsSnapshot,
  updateRevenue,
  updateUsageMetrics,
} from "../common/helpers";
import { flipIlk, flipBids, clipIlk, clipSales } from "../effects/contracts";
import { createEventID } from "../utils/strings";

const sig4 = (s: string): string => s.slice(0, 10).toLowerCase();
const SIG_FILE_ILK = "0x1a0b287e"; // file(bytes32 ilk, bytes32 what, uint256 data)
// Flip auction selectors
const SIG_FLIP_TEND = "0x4b43ed12";
const SIG_FLIP_DENT = "0x5ff3a382";
const SIG_FLIP_DEAL = "0xc959c42b";
const SIG_FLIP_YANK = "0x26e027f1";

// ---------------- Cat (legacy) ----------------

async function handleCatBite(
  ctx: Ctx,
  ev: EventInfo,
  p: { ilk: string; urn: string; ink: bigint; art: bigint; tab: bigint; flip: string; id: bigint },
): Promise<void> {
  const ilk = p.ilk;
  const urn = p.urn.toLowerCase();
  if (bytes32ToString(ilk) === "TELEPORT-FW-A") return;
  const flip = p.flip.toLowerCase();
  const id = p.id;
  const lot = p.ink;
  const art = p.art;
  const tab = p.tab;

  const market = (await getMarketFromIlk(ctx, ilk))!;
  const token = await getOrCreateToken(ctx, market.inputToken_id);
  const collateral = bigIntChangeDecimals(lot, WAD, token.decimals);
  const collateralUSD = bigIntToBDUseDecimals(collateral, token.decimals).times(
    token.lastPriceUSD ?? BIGDECIMAL_ZERO,
  );
  const deltaCollateral = collateral * BIGINT_NEG_ONE;
  const deltaCollateralUSD = collateralUSD.times(BIGDECIMAL_NEG_ONE);
  const deltaDebtUSD = bigIntToBDUseDecimals(art, WAD).times(BIGDECIMAL_NEG_ONE);

  const liquidatedPositionIds = await liquidatePosition(ctx, ev, urn, ilk, collateral, art);
  await updateMarket(ctx, ev, market, deltaCollateral, deltaCollateralUSD, deltaDebtUSD);
  await updateProtocol(ctx, ev);
  await updateFinancialsSnapshot(ctx, ev);

  const liquidationRevenueUSD = bigIntToBDUseDecimals(tab, RAD).times(
    market.liquidationPenalty.div(BIGDECIMAL_ONE_HUNDRED),
  );
  await updateRevenue(ctx, ev, market.id, liquidationRevenueUSD, BIGDECIMAL_ZERO, ProtocolSideRevenueType.LIQUIDATION);

  const storeID = flip.concat("-").concat(id.toString());
  const liquidatee = await getOwnerAddress(ctx, urn);
  ctx._FlipBidsStore.set({
    id: storeID,
    round: INT_ZERO,
    urn,
    liquidatee,
    lot,
    art,
    tab,
    bid: BIGINT_ZERO,
    bidder: ZERO_ADDRESS,
    ilk: ilk.toLowerCase(),
    market_id: market.id,
    ended: false,
    positions: liquidatedPositionIds,
  });
}

async function handleCatFile(
  ctx: Ctx,
  ev: EventInfo,
  arg1: string,
  arg2: string,
  data: string,
): Promise<void> {
  const ilk = arg1;
  if (bytes32ToString(ilk) === "TELEPORT-FW-A") return;
  const what = bytes32ToString(arg2);
  const chop = bytesToUnsignedBigInt(extractCallData(data, 68, 100));
  if (what !== "chop") return;

  const market = await getMarketFromIlk(ctx, ilk);
  if (market == null) return;
  const chopDecimals = ev.srcAddress === CAT_V1_ADDRESS ? RAY : WAD;
  const liquidationPenalty = bigIntToBDUseDecimals(chop, chopDecimals)
    .minus(BIGDECIMAL_ONE)
    .times(BIGDECIMAL_ONE_HUNDRED);
  if (liquidationPenalty.gt(BIGDECIMAL_ZERO)) {
    ctx.Market.set({ ...market, liquidationPenalty });
  }
}

// ---------------- Dog (current) ----------------

async function handleDogBark(
  ctx: Ctx,
  ev: EventInfo,
  p: { ilk: string; urn: string; ink: bigint; art: bigint; due: bigint; clip: string; id: bigint },
): Promise<void> {
  const ilk = p.ilk;
  if (bytes32ToString(ilk) === "TELEPORT-FW-A") return;
  const urn = p.urn.toLowerCase();
  const clip = p.clip.toLowerCase();
  const id = p.id;
  const lot = p.ink;
  const art = p.art;
  const due = p.due;

  const market = await getMarketFromIlk(ctx, ilk);
  if (!market) return;

  const token = await getOrCreateToken(ctx, market.inputToken_id);
  const collateral = bigIntChangeDecimals(lot, WAD, token.decimals);
  const collateralUSD = bigIntToBDUseDecimals(collateral, token.decimals).times(
    token.lastPriceUSD ?? BIGDECIMAL_ZERO,
  );
  const deltaCollateral = collateral * BIGINT_NEG_ONE;
  const deltaCollateralUSD = collateralUSD.times(BIGDECIMAL_NEG_ONE);
  const deltaDebtUSD = bigIntToBDUseDecimals(art, WAD).times(BIGDECIMAL_NEG_ONE);

  const liquidatedPositionIds = await liquidatePosition(ctx, ev, urn, ilk, collateral, art);
  await updateMarket(ctx, ev, market, deltaCollateral, deltaCollateralUSD, deltaDebtUSD);
  await updateProtocol(ctx, ev);
  await updateFinancialsSnapshot(ctx, ev);

  const liquidationRevenueUSD = bigIntToBDUseDecimals(due, RAD).times(
    market.liquidationPenalty.div(BIGDECIMAL_ONE_HUNDRED),
  );
  await updateRevenue(ctx, ev, market.id, liquidationRevenueUSD, BIGDECIMAL_ZERO, ProtocolSideRevenueType.LIQUIDATION);

  const storeID = clip.concat("-").concat(id.toString());
  ctx._ClipTakeStore.set({
    id: storeID,
    slice: INT_ZERO,
    ilk: ilk.toLowerCase(),
    market_id: market.id,
    urn,
    liquidatee: undefined,
    lot,
    art,
    tab: due,
    tab0: due,
    positions: liquidatedPositionIds,
  });
}

async function handleDogFile(ctx: Ctx, ev: EventInfo, ilk: string, what: string, data: bigint): Promise<void> {
  if (bytes32ToString(ilk) === "TELEPORT-FW-A") return;
  if (bytes32ToString(what) !== "chop") return;
  const market = await getMarketFromIlk(ctx, ilk);
  if (market == null) return;
  const chop = data;
  const liquidationPenalty = bigIntToBDUseDecimals(chop, WAD)
    .minus(BIGDECIMAL_ONE)
    .times(BIGDECIMAL_ONE_HUNDRED);
  if (liquidationPenalty.gte(BIGDECIMAL_ZERO)) {
    ctx.Market.set({ ...market, liquidationPenalty });
  }
  void ev;
}

// ---------------- Flip auction ----------------

async function handleFlipBids(ctx: Ctx, ev: EventInfo, arg1: string): Promise<void> {
  const id = bytesToUnsignedBigInt(arg1);
  const bids = await flipBids(ev.effect, ev.srcAddress, id, Number(ev.blockNumber));
  if (bids == null) return;
  const bid = bids.bid;
  const lot = bids.lot;
  const tab = bids.tab;
  const bidder = bids.guy.toLowerCase();

  const ilk = (await flipIlk(ev.effect, ev.srcAddress, Number(ev.blockNumber)))!;
  const storeID = ev.srcAddress.concat("-").concat(id.toString());
  const store = await ctx._FlipBidsStore.get(storeID);
  if (!store) return;

  let newTab = store.tab;
  let newBid = store.bid;
  let newBidder = store.bidder;
  let newLot = store.lot;
  if (store.tab !== tab) newTab = tab;
  if (store.bid < bid) {
    newBid = bid;
    newBidder = bidder;
  }
  if (store.lot > lot) {
    newLot = lot;
    newBidder = bidder;
  }
  ctx._FlipBidsStore.set({
    ...store,
    tab: newTab,
    bid: newBid,
    bidder: newBidder,
    lot: newLot,
    round: store.round + INT_ONE,
  });
  void ilk;
}

async function handleFlipEndAuction(ctx: Ctx, ev: EventInfo, arg1: string): Promise<void> {
  const id = bytesToUnsignedBigInt(arg1);
  const storeID = ev.srcAddress.concat("-").concat(id.toString());
  const store = await ctx._FlipBidsStore.get(storeID);
  if (!store) return;

  const marketID = store.market_id;
  const market = await getOrCreateMarket(ctx, marketID);
  const token = await getOrCreateToken(ctx, market.inputToken_id);

  const amount = bigIntChangeDecimals(store.lot, WAD, token.decimals);
  const amountUSD = bigIntToBDUseDecimals(amount, token.decimals).times(token.lastPriceUSD ?? BIGDECIMAL_ZERO);
  const profitUSD = amountUSD.minus(bigIntToBDUseDecimals(store.bid, RAD));

  const liquidatee = await getOwnerAddress(ctx, store.liquidatee);
  const liquidator = store.bidder;

  const liquidateID = createEventID(ev.hash, ev.logIndex);
  const liquidate = await getOrCreateLiquidate(
    ctx,
    liquidateID,
    ev,
    market,
    liquidatee,
    liquidator,
    amount,
    amountUSD,
    profitUSD,
  );
  const positions = store.positions ?? [];
  ctx.Liquidate.set({ ...liquidate, position_id: positions[0] ?? "" });

  ctx._FlipBidsStore.set({ ...store, ended: true });

  await updateUsageMetrics(ctx, ev, [], BIGDECIMAL_ZERO, BIGDECIMAL_ZERO, amountUSD, liquidator, liquidatee);
  await updateMarket(ctx, ev, market, BIGINT_ZERO, BIGDECIMAL_ZERO, BIGDECIMAL_ZERO, amountUSD);
  await updateProtocol(ctx, ev, BIGDECIMAL_ZERO, BIGDECIMAL_ZERO, amountUSD);
  await updateFinancialsSnapshot(ctx, ev, BIGDECIMAL_ZERO, BIGDECIMAL_ZERO, amountUSD);
}

// ---------------- Clip auction ----------------

async function handleClipTakeBid(
  ctx: Ctx,
  ev: EventInfo,
  p: { id: bigint; usr: string; lot: bigint; tab: bigint; owe: bigint },
): Promise<void> {
  const id = p.id;
  let liquidatee = p.usr.toLowerCase();
  const lot = p.lot;
  const tab = p.tab;
  const owe = p.owe;
  const liquidator = ev.from;
  liquidatee = await getOwnerAddress(ctx, liquidatee);

  const storeID = ev.srcAddress.concat("-").concat(id.toString());
  const store = await ctx._ClipTakeStore.get(storeID);
  if (!store) return;
  const marketID = store.market_id;
  const market = await getOrCreateMarket(ctx, marketID);
  const token = await getOrCreateToken(ctx, market.inputToken_id);

  const deltaLot = store.lot - lot;
  const amount = bigIntChangeDecimals(deltaLot, WAD, token.decimals);
  const amountUSD = bigIntToBDUseDecimals(amount, token.decimals).times(token.lastPriceUSD ?? BIGDECIMAL_ZERO);
  const profitUSD = amountUSD.minus(bigIntToBDUseDecimals(owe, RAD));

  const liquidateID = createEventID(ev.hash, ev.logIndex);
  const liquidate = await getOrCreateLiquidate(
    ctx,
    liquidateID,
    ev,
    market,
    liquidatee,
    liquidator,
    amount,
    amountUSD,
    profitUSD,
  );
  const positions = store.positions ?? [];
  ctx.Liquidate.set({ ...liquidate, position_id: positions[0] ?? "" });

  ctx._ClipTakeStore.set({ ...store, slice: store.slice + INT_ONE, lot, tab });

  await updateUsageMetrics(ctx, ev, [], BIGDECIMAL_ZERO, BIGDECIMAL_ZERO, amountUSD, liquidator, liquidatee);
  await updateMarket(ctx, ev, market, BIGINT_ZERO, BIGDECIMAL_ZERO, BIGDECIMAL_ZERO, amountUSD);
  await updateProtocol(ctx, ev, BIGDECIMAL_ZERO, BIGDECIMAL_ZERO, amountUSD);
  await updateFinancialsSnapshot(ctx, ev, BIGDECIMAL_ZERO, BIGDECIMAL_ZERO, amountUSD);
}

async function handleClipYankBid(ctx: Ctx, ev: EventInfo, id: bigint): Promise<void> {
  const storeID = ev.srcAddress.concat("-").concat(id.toString());
  const store = await ctx._ClipTakeStore.get(storeID);
  if (!store) return;

  const ilk = (await clipIlk(ev.effect, ev.srcAddress, Number(ev.blockNumber)))!;
  const sale = await clipSales(ev.effect, ev.srcAddress, id, Number(ev.blockNumber));
  const lot = sale == null ? BIGINT_ZERO : sale.lot;
  const tab = sale == null ? BIGINT_ZERO : sale.tab;
  let liquidatee = sale == null ? ZERO_ADDRESS : sale.usr.toLowerCase();
  const liquidator = ev.from;
  liquidatee = await getOwnerAddress(ctx, liquidatee);

  const market = (await getMarketFromIlk(ctx, ilk))!;
  const token = await getOrCreateToken(ctx, market.inputToken_id);
  const liquidateID = createEventID(ev.hash, ev.logIndex);
  const amount = bigIntChangeDecimals(lot, WAD, token.decimals);
  const amountUSD = bigIntToBDUseDecimals(amount, token.decimals).times(token.lastPriceUSD ?? BIGDECIMAL_ZERO);
  const profitUSD = amountUSD.minus(bigIntToBDUseDecimals(tab, RAD));
  const liquidate = await getOrCreateLiquidate(
    ctx,
    liquidateID,
    ev,
    market,
    liquidatee,
    liquidator,
    amount,
    amountUSD,
    profitUSD,
  );
  const positions = store.positions ?? [];
  ctx.Liquidate.set({ ...liquidate, position_id: positions[0] ?? "" });

  await updateUsageMetrics(ctx, ev, [], BIGDECIMAL_ZERO, BIGDECIMAL_ZERO, amountUSD, liquidator, liquidatee);
  await updateMarket(ctx, ev, market, BIGINT_ZERO, BIGDECIMAL_ZERO, BIGDECIMAL_ZERO, amountUSD);
  await updateProtocol(ctx, ev, BIGDECIMAL_ZERO, BIGDECIMAL_ZERO, amountUSD);
  await updateFinancialsSnapshot(ctx, ev, BIGDECIMAL_ZERO, BIGDECIMAL_ZERO, amountUSD);
  void getMarketAddressFromIlk;
}

// ---------------- Registrations ----------------

for (const cat of ["CatV1", "CatV2"] as const) {
  indexer.onEvent({ contract: cat, event: "Bite" }, async ({ event, context }) => {
    const ev = toEventInfo(event, context.effect);
    await handleCatBite(context, ev, {
      ilk: event.params.ilk,
      urn: event.params.urn,
      ink: event.params.ink,
      art: event.params.art,
      tab: event.params.tab,
      flip: event.params.flip,
      id: event.params.id,
    });
  });
  indexer.onEvent({ contract: cat, event: "LogNote" }, async ({ event, context }) => {
    if (sig4(event.params.sig) !== SIG_FILE_ILK) return;
    const ev = toEventInfo(event, context.effect);
    await handleCatFile(context, ev, event.params.arg1, event.params.arg2, event.params.data);
  });
  // dynamic data source for the Flip auction contract
  indexer.contractRegister({ contract: cat, event: "Bite" }, async ({ event, context }) => {
    context.chain.Flip.add(event.params.flip);
  });
}

indexer.onEvent({ contract: "Dog", event: "Bark" }, async ({ event, context }) => {
  const ev = toEventInfo(event, context.effect);
  await handleDogBark(context, ev, {
    ilk: event.params.ilk,
    urn: event.params.urn,
    ink: event.params.ink,
    art: event.params.art,
    due: event.params.due,
    clip: event.params.clip,
    id: event.params.id,
  });
});
indexer.onEvent({ contract: "Dog", event: "File" }, async ({ event, context }) => {
  const ev = toEventInfo(event, context.effect);
  await handleDogFile(context, ev, event.params.ilk, event.params.what, event.params.data);
});
indexer.contractRegister({ contract: "Dog", event: "Bark" }, async ({ event, context }) => {
  context.chain.Clip.add(event.params.clip);
});

indexer.onEvent({ contract: "Flip", event: "LogNote" }, async ({ event, context }) => {
  const sig = sig4(event.params.sig);
  const ev = toEventInfo(event, context.effect);
  if (sig === SIG_FLIP_TEND || sig === SIG_FLIP_DENT) {
    await handleFlipBids(context, ev, event.params.arg1);
  } else if (sig === SIG_FLIP_DEAL || sig === SIG_FLIP_YANK) {
    await handleFlipEndAuction(context, ev, event.params.arg1);
  }
});

indexer.onEvent({ contract: "Clip", event: "Take" }, async ({ event, context }) => {
  const ev = toEventInfo(event, context.effect);
  await handleClipTakeBid(context, ev, {
    id: event.params.id,
    usr: event.params.usr,
    lot: event.params.lot,
    tab: event.params.tab,
    owe: event.params.owe,
  });
});
indexer.onEvent({ contract: "Clip", event: "Yank" }, async ({ event, context }) => {
  const ev = toEventInfo(event, context.effect);
  await handleClipYankBid(context, ev, event.params.id);
});

void BigDecimal;
void (null as unknown as Market);
