/**
 * Port of Jug (stability fee), Pot (DSR) and Spot (price/mat/par) handlers.
 */
import { indexer } from "envio";
import type { Market } from "envio";
import { toEventInfo } from "../common/event";
import type { EventInfo, Ctx, Mutable } from "../common/types";
import {
  WAD,
  RAY,
  BIGINT_ZERO,
  BIGDECIMAL_ZERO,
  BIGDECIMAL_ONE,
  BIGDECIMAL_ONE_HUNDRED,
  SECONDS_PER_YEAR_BIGDECIMAL,
  InterestRateSide,
  InterestRateType,
  DAI_ADDRESS,
} from "../common/constants";
import { bytes32ToString, extractCallData, bytesToUnsignedBigInt } from "../utils/bytes";
import { bigIntToBDUseDecimals, bigDecimalExponential } from "../utils/numbers";
import {
  getMarketFromIlk,
  getOrCreateMarket,
  getOrCreateLendingProtocol,
  getOrCreateInterestRate,
  getOrCreateChi,
  getOrCreateToken,
} from "../common/getters";
import { snapshotMarket, updateRevenue, updatePriceForMarket } from "../common/helpers";
import { jugBase, jugIlkDuty, potChi, potRho, potPie } from "../effects/contracts";

const sig4 = (s: string): string => s.slice(0, 10).toLowerCase();
// Jug.file(bytes32 ilk, bytes32 what, uint256 data)
const SIG_FILE_ILK = "0x1a0b287e";
// Pot file(bytes32 what, address data) [vow] / file(bytes32 what, uint256 data) [dsr] / drip()
const SIG_POT_FILE_VOW = "0xd4e8be83";
const SIG_POT_FILE_DSR = "0x29ae8114";
const SIG_POT_DRIP = "0x9f678cca";
// Spot file(bytes32 ilk, bytes32 what, uint256 data) [mat] / file(bytes32 what, uint256 data) [par]
const SIG_SPOT_PAR = "0x29ae8114";

// ---------------- Jug ----------------

indexer.onEvent({ contract: "Jug", event: "LogNote" }, async ({ event, context }) => {
  if (sig4(event.params.sig) !== SIG_FILE_ILK) return;
  const ev = toEventInfo(event, context.effect);
  const ilk = event.params.arg1;
  if (bytes32ToString(ilk) === "TELEPORT-FW-A") return;
  const what = bytes32ToString(event.params.arg2);
  if (what !== "duty") return;

  const market = await getMarketFromIlk(context, ilk);
  if (market == null) return;

  const base = (await jugBase(ev.effect, ev.srcAddress, Number(ev.blockNumber))) ?? BIGINT_ZERO;
  const duty = (await jugIlkDuty(ev.effect, ev.srcAddress, ilk, Number(ev.blockNumber))) ?? BIGINT_ZERO;
  const rate = bigIntToBDUseDecimals(base + duty, RAY).minus(BIGDECIMAL_ONE);
  let rateAnnualized = BIGDECIMAL_ZERO;
  if (rate.gt(BIGDECIMAL_ZERO)) {
    rateAnnualized = bigDecimalExponential(rate, SECONDS_PER_YEAR_BIGDECIMAL).times(BIGDECIMAL_ONE_HUNDRED);
  }

  const interestRateID = InterestRateSide.BORROW + "-" + InterestRateType.STABLE + "-" + market.id;
  const interestRate = await getOrCreateInterestRate(
    context,
    market.id,
    InterestRateSide.BORROW,
    InterestRateType.STABLE,
  );
  context.InterestRate.set({ ...interestRate, rate: rateAnnualized });

  const market2: Market = { ...market, rates: [interestRateID] };
  context.Market.set(market2);
  await snapshotMarket(context, ev, market2);
});

// ---------------- Pot (DSR) ----------------

indexer.onEvent({ contract: "Pot", event: "LogNote" }, async ({ event, context }) => {
  const sig = sig4(event.params.sig);
  const ev = toEventInfo(event, context.effect);
  if (sig === SIG_POT_FILE_VOW) {
    await handlePotFileVow(context, ev, event.params.arg1);
  } else if (sig === SIG_POT_FILE_DSR) {
    await handlePotFileDsr(context, ev, event.params.arg1, event.params.arg2);
  } else if (sig === SIG_POT_DRIP) {
    await handlePotDrip(context, ev);
  }
});

async function handlePotFileVow(ctx: Ctx, ev: EventInfo, arg1: string): Promise<void> {
  const what = bytes32ToString(arg1);
  if (what === "vow") {
    await getOrCreateMarket(ctx, ev.srcAddress, "MCD POT", DAI_ADDRESS, ev.blockNumber, ev.timestamp);
  }
  const chiValue = (await potChi(ev.effect, ev.srcAddress, Number(ev.blockNumber))) ?? 1000000000000000000000000000n;
  const rhoValue = (await potRho(ev.effect, ev.srcAddress, Number(ev.blockNumber))) ?? BIGINT_ZERO;
  const chiID = ev.srcAddress;
  const _chi = await getOrCreateChi(ctx, chiID);
  ctx._Chi.set({ ..._chi, chi: chiValue, rho: rhoValue });
}

async function handlePotFileDsr(ctx: Ctx, ev: EventInfo, arg1: string, arg2: string): Promise<void> {
  const what = bytes32ToString(arg1);
  if (what !== "dsr") return;
  const dsr = bytesToUnsignedBigInt(arg2);
  const market = await getOrCreateMarket(ctx, ev.srcAddress);
  const rate = bigIntToBDUseDecimals(dsr, RAY).minus(BIGDECIMAL_ONE);
  let rateAnnualized = BIGDECIMAL_ZERO;
  if (rate.gt(BIGDECIMAL_ZERO)) {
    rateAnnualized = bigDecimalExponential(rate, SECONDS_PER_YEAR_BIGDECIMAL).times(BIGDECIMAL_ONE_HUNDRED);
  }
  const interestRateID = `${InterestRateSide.LENDER}-${InterestRateType.STABLE}-${ev.srcAddress}`;
  const interestRate = await getOrCreateInterestRate(
    ctx,
    market.id,
    InterestRateSide.LENDER,
    InterestRateType.STABLE,
  );
  ctx.InterestRate.set({ ...interestRate, rate: rateAnnualized });
  const market2: Market = { ...market, rates: [interestRateID] };
  ctx.Market.set(market2);
  await snapshotMarket(ctx, ev, market2);
}

async function handlePotDrip(ctx: Ctx, ev: EventInfo): Promise<void> {
  const now = ev.timestamp;
  const chiValueOnChain = (await potChi(ev.effect, ev.srcAddress, Number(ev.blockNumber))) ?? BIGINT_ZERO;
  const Pie = (await potPie(ev.effect, ev.srcAddress, Number(ev.blockNumber))) ?? BIGINT_ZERO;

  const _chi = await getOrCreateChi(ctx, ev.srcAddress);
  const chiValuePrev = _chi.chi;
  const chiValueDiff = chiValueOnChain - chiValuePrev;
  const newSupplySideRevenue = bigIntToBDUseDecimals(Pie, WAD).times(bigIntToBDUseDecimals(chiValueDiff, RAY));

  await updateRevenue(ctx, ev, ev.srcAddress, newSupplySideRevenue, newSupplySideRevenue);

  ctx._Chi.set({ ..._chi, chi: chiValueOnChain, rho: now });
}

// ---------------- Spot ----------------

indexer.onEvent({ contract: "Spot", event: "LogNote" }, async ({ event, context }) => {
  const sig = sig4(event.params.sig);
  const ev = toEventInfo(event, context.effect);
  if (sig === SIG_FILE_ILK) {
    // file(bytes32 ilk, bytes32 what, uint256 data) — mat
    await handleSpotFileMat(context, ev, event.params.arg1, event.params.arg2, event.params.data);
  } else if (sig === SIG_SPOT_PAR) {
    // file(bytes32 what, uint256 data) — par; arg1 = what, arg2 = par
    await handleSpotFilePar(context, ev, event.params.arg1, event.params.arg2);
  }
});

indexer.onEvent({ contract: "Spot", event: "Poke" }, async ({ event, context }) => {
  const ev = toEventInfo(event, context.effect);
  const ilk = event.params.ilk;
  if (bytes32ToString(ilk) === "TELEPORT-FW-A") return;
  const market = await getMarketFromIlk(context, ilk);
  if (market == null) return;

  const tokenPriceUSD = bigIntToBDUseDecimals(bytesToUnsignedBigInt(event.params.val), WAD);
  context.Market.set({ ...market, inputTokenPriceUSD: tokenPriceUSD });

  const tokenID = market.inputToken_id;
  const token = await getOrCreateToken(context, tokenID);
  context.Token.set({ ...token, lastPriceUSD: tokenPriceUSD, lastPriceBlockNumber: ev.blockNumber });

  await updatePriceForMarket(context, market.id, ev);
});

async function handleSpotFileMat(
  ctx: Ctx,
  ev: EventInfo,
  arg1: string,
  arg2: string,
  data: string,
): Promise<void> {
  const what = bytes32ToString(arg2);
  if (what !== "mat") return;
  const ilk = arg1;
  if (bytes32ToString(ilk) === "TELEPORT-FW-A") return;
  const market = await getMarketFromIlk(ctx, ilk);
  if (market == null) return;

  const mat = bytesToUnsignedBigInt(extractCallData(data, 68, 100));
  const protocol = await getOrCreateLendingProtocol(ctx);
  const par = protocol._par!;
  const m: Mutable<Market> = { ...market, _mat: mat };
  if (mat !== BIGINT_ZERO) {
    m.maximumLTV = BIGDECIMAL_ONE_HUNDRED.div(bigIntToBDUseDecimals(mat, RAY)).div(bigIntToBDUseDecimals(par, RAY));
    m.liquidationThreshold = m.maximumLTV;
  }
  ctx.Market.set(m);
  void ev;
}

async function handleSpotFilePar(ctx: Ctx, ev: EventInfo, arg1: string, arg2: string): Promise<void> {
  const what = bytes32ToString(arg1);
  if (what !== "par") return;
  const par = bytesToUnsignedBigInt(arg2);
  const protocol = await getOrCreateLendingProtocol(ctx);
  ctx.LendingProtocol.set({ ...protocol, _par: par });

  // NB: subgraph iterates `i <= marketIDList.length` (off-by-one); replicating
  // would index out of bounds. We iterate the valid range to avoid a crash.
  for (let i = 0; i < protocol.marketIDList.length; i++) {
    const market = await getOrCreateMarket(ctx, protocol.marketIDList[i]!);
    const mat = market._mat;
    if (mat !== BIGINT_ZERO) {
      const maximumLTV = BIGDECIMAL_ONE_HUNDRED.div(bigIntToBDUseDecimals(mat, RAY)).div(
        bigIntToBDUseDecimals(par, RAY),
      );
      ctx.Market.set({ ...market, maximumLTV, liquidationThreshold: maximumLTV });
    }
  }
  void ev;
}
