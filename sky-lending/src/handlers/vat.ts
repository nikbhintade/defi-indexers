/**
 * Port of Vat handlers in src/mapping.ts. The subgraph routed LogNote by
 * topic0 (the called function's 4-byte selector); here one handler receives
 * every Vat.LogNote and dispatches on `event.params.sig`.
 */
import { indexer, BigDecimal } from "envio";
import type { Market } from "envio";
import { toEventInfo, low } from "../common/event";
import type { EventInfo, Ctx, Mutable } from "../common/types";
import {
  WAD,
  RAD,
  ILK_SAI,
  ZERO_ADDRESS,
  BIGINT_ZERO,
  BIGDECIMAL_ZERO,
  DAI_ADDRESS,
  VOW_ADDRESS,
  MIGRATION_ADDRESS,
  ProtocolSideRevenueType,
} from "../common/constants";
import {
  bytes32ToString,
  bytes32ToAddressHexString,
  extractCallData,
  bytesToSignedBigInt,
  bytesToUnsignedBigInt,
} from "../utils/bytes";
import { bigIntToBDUseDecimals, bigIntChangeDecimals } from "../utils/numbers";
import {
  getOrCreateMarket,
  getOrCreateIlk,
  getOrCreateToken,
  getOrCreateLendingProtocol,
  getMarketFromIlk,
  getMarketAddressFromIlk,
  getOwnerAddress,
} from "../common/getters";
import {
  createTransactions,
  updateUsageMetrics,
  updatePosition,
  updateMarket,
  updateProtocol,
  updateFinancialsSnapshot,
  updateRevenue,
  transferPosition,
} from "../common/helpers";
import {
  erc20Name,
  erc20Symbol,
  erc20Decimals,
  gemJoinIlk,
  gemJoinGem,
  vatIlks,
} from "../effects/contracts";
import { tryGetReceiptTopics } from "../effects/calls";
import { keccak256, toHex } from "viem";

// 4-byte selectors used as LogNote topic0 in the subgraph manifest
const SIG_RELY = "0x65fae35e";
const SIG_CAGE = "0x69245009";
const SIG_FROB = "0x76088703";
const SIG_GRAB = "0x7bab3f40";
const SIG_FORK = "0x870c616d";
const SIG_FOLD = "0xb65337df";

const sig4 = (s: string): string => s.slice(0, 10).toLowerCase();

indexer.onEvent({ contract: "Vat", event: "LogNote" }, async ({ event, context }) => {
  const ev = toEventInfo(event, context.effect);
  const sig = sig4(event.params.sig);
  switch (sig) {
    case SIG_RELY:
      return handleVatRely(context, ev, event.params.arg1);
    case SIG_CAGE:
      return handleVatCage(context);
    case SIG_FROB:
      return handleVatFrob(context, ev, event.params.arg1, event.params.arg2, event.params.arg3, event.params.data);
    case SIG_GRAB:
      return handleVatGrab(context, ev, event.params.arg1, event.params.arg2, event.params.arg3, event.params.data);
    case SIG_FORK:
      return handleVatFork(context, ev, event.params.arg1, event.params.arg2, event.params.arg3, event.params.data);
    case SIG_FOLD:
      return handleVatFold(context, ev, event.params.arg1, event.params.arg2, event.params.arg3);
    default:
      return;
  }
});

async function handleVatRely(ctx: Ctx, ev: EventInfo, arg1: string): Promise<void> {
  const someAddress = bytes32ToAddressHexString(arg1);
  const ilkCall = await gemJoinIlk(ev.effect, someAddress);
  const gemCall = await gemJoinGem(ev.effect, someAddress);
  if (ilkCall == null || gemCall == null) return;

  const ilk = ilkCall;
  const marketID = someAddress.toLowerCase();
  const tokenId = gemCall.toLowerCase();
  let tokenName = (await erc20Name(ev.effect, tokenId)) ?? "unknown";
  let tokenSymbol = (await erc20Symbol(ev.effect, tokenId)) ?? "unknown";
  let decimals = (await erc20Decimals(ev.effect, tokenId)) ?? 18;

  if (ilk.toLowerCase() === ILK_SAI) {
    tokenName = "Dai Stablecoin v1.0";
    tokenSymbol = "SAI";
    decimals = 18;
  }

  await getOrCreateMarket(ctx, marketID, bytes32ToString(ilk), tokenId, ev.blockNumber, ev.timestamp);
  await getOrCreateIlk(ctx, ilk, marketID);
  await getOrCreateToken(ctx, tokenId, tokenName, tokenSymbol, decimals);
  await getOrCreateToken(ctx, DAI_ADDRESS, "Dai Stablecoin", "DAI", 18);

  const protocol: Mutable<Awaited<ReturnType<typeof getOrCreateLendingProtocol>>> = {
    ...(await getOrCreateLendingProtocol(ctx)),
  };
  protocol.totalPoolCount += 1;
  protocol.marketIDList = [...protocol.marketIDList, marketID];
  ctx.LendingProtocol.set(protocol);
}

async function handleVatCage(ctx: Ctx): Promise<void> {
  const protocol = await getOrCreateLendingProtocol(ctx);
  for (let i = 0; i < protocol.marketIDList.length; i++) {
    const market = await getOrCreateMarket(ctx, protocol.marketIDList[i]!);
    ctx.Market.set({ ...market, isActive: false, canBorrowFrom: false });
  }
}

// Borrow/Repay/Deposit/Withdraw
async function handleVatFrob(
  ctx: Ctx,
  ev: EventInfo,
  arg1: string,
  arg2: string,
  arg3: string,
  data: string,
): Promise<void> {
  const ilk = arg1;
  if (bytes32ToString(ilk) === "TELEPORT-FW-A") return;

  let u = bytes32ToAddressHexString(arg2);
  let v = bytes32ToAddressHexString(arg3);
  // frob(bytes32 i, address u, address v, address w, int256 dink, int256 dart)
  let w = bytes32ToAddressHexString(extractCallData(data, 100, 132));
  const dink = bytesToSignedBigInt(extractCallData(data, 132, 164));
  const dart = bytesToSignedBigInt(extractCallData(data, 164, 196));

  const urn = u;
  const migrationCaller = getMigrationCaller(u, v, w, ev);
  if (migrationCaller != null && bytes32ToString(ilk) === "SAI") {
    return;
  }

  u = await getOwnerAddress(ctx, u);
  v = await getOwnerAddress(ctx, v);
  w = await getOwnerAddress(ctx, w);

  const market = await getMarketFromIlk(ctx, ilk);
  if (market == null) return;

  const token = await getOrCreateToken(ctx, market.inputToken_id);
  const deltaCollateral = bigIntChangeDecimals(dink, WAD, token.decimals);
  const deltaCollateralUSD = bigIntToBDUseDecimals(deltaCollateral, token.decimals).times(
    token.lastPriceUSD ?? BIGDECIMAL_ZERO,
  );

  const market2: Mutable<Market> = { ...market, inputTokenPriceUSD: token.lastPriceUSD ?? market.inputTokenPriceUSD };
  ctx.Market.set(market2);

  const deltaDebtUSD = bigIntToBDUseDecimals(dart, WAD);

  await createTransactions(ctx, ev, market2, v, w, deltaCollateral, deltaCollateralUSD, dart, deltaDebtUSD);
  await updateUsageMetrics(ctx, ev, [u, v, w], deltaCollateralUSD, deltaDebtUSD);
  await updatePosition(ctx, ev, urn, ilk, deltaCollateral, dart);
  await updateMarket(ctx, ev, market2, deltaCollateral, deltaCollateralUSD, deltaDebtUSD);
  await updateProtocol(ctx, ev, deltaCollateralUSD, deltaDebtUSD);
  await updateFinancialsSnapshot(ctx, ev, deltaCollateralUSD, deltaDebtUSD);
}

// CDP confiscation: only handle non-liquidation grabs (mirror receipt check)
async function handleVatGrab(
  ctx: Ctx,
  ev: EventInfo,
  arg1: string,
  arg2: string,
  arg3: string,
  data: string,
): Promise<void> {
  const biteSig = keccak256(toHex("Bite(bytes32,address,uint256,uint256,uint256,address,uint256)"));
  const barkSig = keccak256(toHex("Bark(bytes32,address,uint256,uint256,uint256,address,uint256)"));
  const topics = await tryGetReceiptTopics(ev.effect, ev.hash);
  if (topics) {
    for (const t of topics) {
      if (t.toLowerCase() === biteSig.toLowerCase() || t.toLowerCase() === barkSig.toLowerCase()) {
        // liquidation tx; skip (handled by Cat/Dog)
        return;
      }
    }
  }
  // not a liquidation: treat like frob
  await handleVatFrob(ctx, ev, arg1, arg2, arg3, data);
}

// fork(bytes32 ilk, address src, address dst, int256 dink, int256 dart)
async function handleVatFork(
  ctx: Ctx,
  ev: EventInfo,
  arg1: string,
  arg2: string,
  arg3: string,
  data: string,
): Promise<void> {
  const ilk = arg1;
  const src = bytes32ToAddressHexString(arg2);
  const dst = bytes32ToAddressHexString(arg3);
  const dink = bytesToSignedBigInt(extractCallData(data, 100, 132));
  const dart = bytesToSignedBigInt(extractCallData(data, 132, 164));

  const market = (await getMarketFromIlk(ctx, ilk))!;
  const token = await getOrCreateToken(ctx, market.inputToken_id);
  const collateralTransferAmount = bigIntChangeDecimals(dink, WAD, token.decimals);
  const debtTransferAmount = dart;

  if (dink > BIGINT_ZERO) {
    await transferPosition(ctx, ev, ilk, src, dst, "LENDER", null, null, collateralTransferAmount);
  } else if (dink < BIGINT_ZERO) {
    await transferPosition(ctx, ev, ilk, dst, src, "LENDER", null, null, collateralTransferAmount * -1n);
  }
  if (dart > BIGINT_ZERO) {
    await transferPosition(ctx, ev, ilk, src, dst, "BORROWER", null, null, debtTransferAmount);
  } else if (dart < BIGINT_ZERO) {
    await transferPosition(ctx, ev, ilk, dst, src, "BORROWER", null, null, debtTransferAmount * -1n);
  }
}

// fold(bytes32 i, address u, int256 rate) — stability fee revenue
async function handleVatFold(
  ctx: Ctx,
  ev: EventInfo,
  arg1: string,
  arg2: string,
  arg3: string,
): Promise<void> {
  const ilk = arg1;
  if (bytes32ToString(ilk) === "TELEPORT-FW-A") return;
  const vow = bytes32ToAddressHexString(arg2);
  const rate = bytesToSignedBigInt(arg3);

  const ilkOnChain = await vatIlks(ev.effect, ev.srcAddress, ilk, Number(ev.blockNumber));
  const Art = ilkOnChain == null ? BIGINT_ZERO : ilkOnChain.Art;
  const revenue = Art * rate;
  const newTotalRevenueUSD = bigIntToBDUseDecimals(revenue, RAD);
  void vow; // parity: warning-only when not VOW_ADDRESS; no state effect
  void VOW_ADDRESS;

  const marketAddress = await getMarketAddressFromIlk(ctx, ilk);
  if (marketAddress) {
    await updateRevenue(
      ctx,
      ev,
      marketAddress,
      newTotalRevenueUSD,
      BIGDECIMAL_ZERO,
      ProtocolSideRevenueType.STABILITYFEE,
    );
  }
}

// detect migration frob; returns owner if migration, else null
function getMigrationCaller(u: string, v: string, w: string, ev: EventInfo): string | null {
  if (!(u === v && u === w && w === v)) return null;
  const owner = ev.from;
  if (u.toLowerCase() === MIGRATION_ADDRESS) return owner;
  return null;
}

void ZERO_ADDRESS;
void low;
void bytesToUnsignedBigInt;
