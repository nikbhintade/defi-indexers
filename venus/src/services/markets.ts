/**
 * Port of src/operations/getOrCreate.ts (getOrCreateMarket, getOrCreateToken),
 * src/operations/updateMarket*.ts (rate/cash updates) and
 * src/utilities/getTokenPriceCents.ts (getUnderlyingPrice).
 *
 * `valueOrNotAvailableIntIfReverted` -> -1n on revert (NOT_AVAILABLE_BIG_INT);
 * `valueOrNotAvailableAddressIfReverted` -> nullAddress on revert. Non-`try_`
 * subgraph calls would abort graph-node on revert; here they fall back to
 * neutral values with an error log (documented in MIGRATION.md).
 */
import { type EvmOnEventContext, type Market, type Token } from "envio";
import {
  bep20Decimals,
  bep20Name,
  bep20Symbol,
  comptrollerVenusBorrowSpeeds,
  comptrollerVenusSupplySpeeds,
  oracleGetUnderlyingPrice,
  vTokenAccrualBlockNumber,
  vTokenBorrowIndex,
  vTokenBorrowRatePerBlock,
  vTokenComptroller,
  vTokenDecimals,
  vTokenExchangeRateStored,
  vTokenGetCash,
  vTokenInterestRateModel,
  vTokenName,
  vTokenReserveFactorMantissa,
  vTokenSupplyRatePerBlock,
  vTokenSymbol,
  vTokenTotalReserves,
  vTokenUnderlying,
} from "../effects/contracts";
import {
  NOT_AVAILABLE_BIG_INT,
  comptrollerAddress,
  initialIndex,
  nativeAddress,
  nullAddress,
  vTRXAddress,
  vTUSDOldAddress,
  wbETHAddress,
  wrappedEthTokenAddress,
  zeroBigInt32,
} from "../constants";
import { getMarketId, getTokenId } from "../utilities/ids";
import { exponentToBigInt } from "../utilities";
import { getOrCreateComptroller } from "./helpers";

/** valueOrNotAvailableIntIfReverted: -1n on revert. */
function intOrNA(value: bigint | null): bigint {
  return value === null ? NOT_AVAILABLE_BIG_INT : value;
}

/** valueOrNotAvailableAddressIfReverted: nullAddress on revert. */
function addrOrNA(value: string | null): string {
  return value === null ? nullAddress : value;
}

/** Non-try contract read returning bigint: revert aborts graph-node; fall back to 0n. */
function mustInt(context: EvmOnEventContext, value: bigint | null, what: string): bigint {
  if (value === null) {
    context.log.error(`***CALL FAILED*** : ${what} reverted`);
    return 0n;
  }
  return value;
}

/** Non-try contract read returning string: revert aborts graph-node; fall back to "". */
function mustStr(context: EvmOnEventContext, value: string | null, what: string): string {
  if (value === null) {
    context.log.error(`***CALL FAILED*** : ${what} reverted`);
    return "";
  }
  return value;
}

/** Non-try contract read returning number: revert aborts graph-node; fall back to 0. */
function mustNum(context: EvmOnEventContext, value: number | null, what: string): number {
  if (value === null) {
    context.log.error(`***CALL FAILED*** : ${what} reverted`);
    return 0;
  }
  return value;
}

/**
 * Port of getTokenPriceCents / getUnderlyingPrice. Returns the underlying price
 * in USD cents (BigInt). Reads the oracle from the Comptroller entity.
 *
 * Quirk preserved: a reverted oracle call yields NOT_AVAILABLE (-1); since -1
 * != 0 the code divides -1 / 10^factor which truncates toward zero -> 0n
 * (same as graph-node BigInt.div).
 */
export async function getUnderlyingPrice(
  context: EvmOnEventContext,
  contractAddress: string,
  underlyingDecimals: number,
  block: number,
): Promise<bigint> {
  // Original: getComptroller() = Comptroller.load(comptrollerAddress)! which
  // crashes if missing. The subgraph's handleInitialization (block handler,
  // filter: once) always created the singleton at startBlock before any market
  // event, so we lazily ensure it here with the same defaults (no data change).
  const comptroller = await getOrCreateComptroller(context);
  // `if (!comptroller.priceOracle)` in AS is false for a set Bytes; priceOracle
  // is non-nullable in the schema (defaults to nullAddress, a non-empty hex
  // string), so this branch is effectively dead — kept for parity. When the
  // oracle is still nullAddress, the oracle call reverts -> NOT_AVAILABLE (-1)
  // -> -1 / bdFactor truncates to 0, matching graph-node.
  if (comptroller.priceOracle === "") {
    return 0n;
  }
  const oracleAddress = comptroller.priceOracle;

  const mantissaDecimalFactor = 36 - underlyingDecimals - 2;
  const bdFactor = exponentToBigInt(mantissaDecimalFactor);
  const oracleUnderlyingPrice = intOrNA(
    await oracleGetUnderlyingPrice(context.effect, oracleAddress, contractAddress, block),
  );
  if (oracleUnderlyingPrice === 0n) {
    return oracleUnderlyingPrice;
  }
  // BigInt division truncates toward zero (matches graph-node BigInt.div).
  const underlyingPrice = oracleUnderlyingPrice / bdFactor;
  return underlyingPrice;
}

// Comptroller singleton id helper.
export function getComptrollerId(): string {
  return comptrollerAddress;
}

/** Port of updateMarketBorrowRate. */
async function updateMarketBorrowRate(
  context: EvmOnEventContext,
  market: Market,
  block: number,
): Promise<Market> {
  return {
    ...market,
    borrowRateMantissa: intOrNA(await vTokenBorrowRatePerBlock(context.effect, market.id, block)),
  };
}

/** Port of updateMarketSupplyRate. */
async function updateMarketSupplyRate(
  context: EvmOnEventContext,
  market: Market,
  block: number,
): Promise<Market> {
  return {
    ...market,
    supplyRateMantissa: intOrNA(await vTokenSupplyRatePerBlock(context.effect, market.id, block)),
  };
}

/** Port of updateMarketExchangeRate. */
async function updateMarketExchangeRate(
  context: EvmOnEventContext,
  market: Market,
  block: number,
): Promise<Market> {
  return {
    ...market,
    exchangeRateMantissa: intOrNA(await vTokenExchangeRateStored(context.effect, market.id, block)),
  };
}

/** Port of updateMarketRates (borrow + supply + exchange). */
export async function updateMarketRates(
  context: EvmOnEventContext,
  market: Market,
  block: number,
): Promise<Market> {
  let m = market;
  m = await updateMarketBorrowRate(context, m, block);
  m = await updateMarketSupplyRate(context, m, block);
  m = await updateMarketExchangeRate(context, m, block);
  return m;
}

/** Port of updateMarketCashMantissa (non-try getCash). */
export async function updateMarketCashMantissa(
  context: EvmOnEventContext,
  market: Market,
  block: number,
): Promise<Market> {
  return {
    ...market,
    cashMantissa: mustInt(context, await vTokenGetCash(context.effect, market.id, block), "VToken.getCash()"),
  };
}

function getMarket(context: EvmOnEventContext, vTokenAddress: string): Promise<Market | undefined> {
  return context.Market.get(getMarketId(vTokenAddress));
}

/**
 * Port of getMarket(...)! — the original logs an error then null-derefs
 * (crash) when the market is missing. Mirrored with getOrThrow.
 */
export function getMarketOrThrow(
  context: EvmOnEventContext,
  vTokenAddress: string,
): Promise<Market> {
  return context.Market.getOrThrow(getMarketId(vTokenAddress));
}

/** getOrCreateWrappedEthToken — hardcoded Wrapped Binance Beacon ETH token. */
function buildWrappedEthToken(): Token {
  return {
    id: getTokenId(wrappedEthTokenAddress),
    address: wrappedEthTokenAddress,
    name: "Wrapped Binance Beacon ETH",
    symbol: "wBETH",
    decimals: 18,
  };
}

/** Port of getOrCreateToken. */
export async function getOrCreateToken(
  context: EvmOnEventContext,
  asset: string,
): Promise<Token> {
  const id = getTokenId(asset);
  const existing = await context.Token.get(id);
  if (existing) {
    return existing;
  }
  if (asset.toLowerCase() === wbETHAddress) {
    const t = buildWrappedEthToken();
    context.Token.set(t);
    return t;
  }
  const token: Token = {
    id,
    address: asset.toLowerCase(),
    name: mustStr(context, await bep20Name(context.effect, asset), "BEP20.name()"),
    symbol: mustStr(context, await bep20Symbol(context.effect, asset), "BEP20.symbol()"),
    decimals: mustNum(context, await bep20Decimals(context.effect, asset), "BEP20.decimals()"),
  };
  context.Token.set(token);
  return token;
}

/**
 * Port of getOrCreateMarket. Returns the (persisted) Market. `blockNumber` /
 * `blockTimestamp` come from the triggering event. State reads are pinned to
 * the event block.
 *
 * Quirk preserved: the xvsBorrowSpeed assignment is gated on the *supply*
 * speed call not reverting (copy-paste bug in the original).
 */
export async function getOrCreateMarket(
  context: EvmOnEventContext,
  marketAddress: string,
  blockNumber: number,
): Promise<Market> {
  const id = getMarketId(marketAddress);
  const existing = await getMarket(context, marketAddress);
  if (existing) {
    return existing;
  }

  const ec = context.effect;
  // Comptroller.bind(vTokenContract.comptroller()) — non-try; abort on revert.
  const comptrollerAddr =
    (await vTokenComptroller(ec, marketAddress)) ?? nullAddress;

  const name = mustStr(context, await vTokenName(ec, marketAddress), "VToken.name()");
  const symbol = mustStr(context, await vTokenSymbol(ec, marketAddress), "VToken.symbol()");
  const vTokenDecimalsValue = mustNum(context, await vTokenDecimals(ec, marketAddress), "VToken.decimals()");

  const xvsSupplySpeed = await comptrollerVenusSupplySpeeds(ec, comptrollerAddr, marketAddress, blockNumber);
  const supplyReverted = xvsSupplySpeed === null;
  const xvsBorrowSpeedRaw = await comptrollerVenusBorrowSpeeds(ec, comptrollerAddr, marketAddress, blockNumber);

  // underlying token
  let underlyingTokenId: string;
  if (symbol === "vBNB") {
    const tokenEntity: Token = {
      id: getTokenId(nativeAddress),
      address: nativeAddress,
      name: "BNB",
      symbol: "BNB",
      decimals: 18,
    };
    context.Token.set(tokenEntity);
    underlyingTokenId = tokenEntity.id;
  } else {
    const underlying = mustStr(context, await vTokenUnderlying(ec, marketAddress), "VToken.underlying()");
    underlyingTokenId = (await getOrCreateToken(context, underlying)).id;
  }

  const interestRateModelAddress = addrOrNA(
    await vTokenInterestRateModel(ec, marketAddress, blockNumber),
  );
  const reserveFactorMantissa = intOrNA(
    await vTokenReserveFactorMantissa(ec, marketAddress, blockNumber),
  );

  const underlyingToken = await getOrCreateToken(
    context,
    // Address.fromBytes(market.underlyingToken) — the token id is the address.
    underlyingTokenId,
  );
  const lastUnderlyingPriceCents = await getUnderlyingPrice(
    context,
    marketAddress,
    underlyingToken.decimals,
    blockNumber,
  );

  const accrualBlockNumber = mustInt(
    context,
    await vTokenAccrualBlockNumber(ec, marketAddress, blockNumber),
    "VToken.accrualBlockNumber()",
  );

  let market: Market = {
    id,
    address: marketAddress.toLowerCase(),
    vTokenDecimals: vTokenDecimalsValue,
    name,
    symbol,
    isListed: true,
    borrowRateMantissa: zeroBigInt32,
    cashMantissa: zeroBigInt32,
    collateralFactorMantissa: zeroBigInt32,
    exchangeRateMantissa: zeroBigInt32,
    interestRateModelAddress,
    reservesMantissa: zeroBigInt32,
    supplyRateMantissa: zeroBigInt32,
    totalBorrowsMantissa: zeroBigInt32,
    totalSupplyVTokenMantissa: zeroBigInt32,
    underlyingToken_id: underlyingTokenId,
    xvsSupplyStateBlock: BigInt(blockNumber),
    xvsSupplyStateIndex: initialIndex,
    xvsBorrowStateBlock: BigInt(blockNumber),
    xvsBorrowStateIndex: initialIndex,
    xvsSupplySpeed: xvsSupplySpeed === null ? zeroBigInt32 : xvsSupplySpeed,
    // Preserved bug: borrow speed gated on the supply-speed call not reverting.
    xvsBorrowSpeed: supplyReverted ? zeroBigInt32 : xvsBorrowSpeedRaw === null ? zeroBigInt32 : xvsBorrowSpeedRaw,
    accrualBlockNumber: accrualBlockNumber,
    borrowIndex: zeroBigInt32,
    reserveFactorMantissa,
    lastUnderlyingPriceCents,
    lastUnderlyingPriceBlockNumber: BigInt(blockNumber),
    totalXvsDistributedMantissa: zeroBigInt32,
    supplierCount: zeroBigInt32,
    borrowerCount: zeroBigInt32,
  };

  // updateMarketRates + updateMarketCashMantissa (state reads, pinned).
  market = await updateMarketRates(context, market, blockNumber);
  market = await updateMarketCashMantissa(context, market, blockNumber);
  market = {
    ...market,
    totalSupplyVTokenMantissa: zeroBigInt32,
    borrowIndex: intOrNA(await vTokenBorrowIndex(ec, marketAddress, blockNumber)),
    totalBorrowsMantissa: zeroBigInt32,
    reservesMantissa: zeroBigInt32,
  };

  if (marketAddress.toLowerCase() === vTRXAddress) {
    market = { ...market, symbol: "vTRXOLD", name: "Venus TRXOLD" };
  }
  if (marketAddress.toLowerCase() === vTUSDOldAddress) {
    market = { ...market, symbol: "vTUSDOLD", name: "Venus TUSDOLD" };
  }

  context.Market.set(market);
  return market;
}
