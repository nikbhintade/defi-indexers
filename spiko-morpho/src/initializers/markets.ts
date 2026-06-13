/**
 * Ported from src/initializers/markets.ts. createMarket builds the Market,
 * Oracle, supply/borrow InterestRate entities, bumps protocol.totalPoolCount
 * and appends to _MarketList. getMarket / getZeroMarket mirror the source.
 */
import type { Context } from "../context";
import { BigDecimal, type EffectCaller, type InterestRate, type Market, type Oracle } from "envio";
import {
  BIGDECIMAL_ONE,
  BIGDECIMAL_WAD,
  BIGDECIMAL_ZERO,
  INT_ONE,
  INT_ZERO,
  InterestRateSide,
  InterestRateType,
  insert,
} from "../sdk/constants";
import { getAmountUSD, getOrCreateToken, getPriceUSD } from "../sdk/token";
import { getLiquidationIncentiveFactor } from "../utils/metaMorphoUtils";
import { ADDRESS_ZERO, hexConcat, low } from "../utils/graphBytes";
import { getProtocol } from "./protocol";

export type MarketParams = {
  loanToken: string;
  collateralToken: string;
  oracle: string;
  irm: string;
  lltv: bigint;
} | null;

export async function createMarket(
  context: Context,
  id: string,
  marketStruct: MarketParams,
  block: { number: bigint; timestamp: bigint },
): Promise<Market> {
  const collateralAddr = marketStruct
    ? low(marketStruct.collateralToken)
    : ADDRESS_ZERO;
  const loanAddr = marketStruct ? low(marketStruct.loanToken) : ADDRESS_ZERO;

  const collateralToken = await getOrCreateToken(context, collateralAddr);
  const loanToken = await getOrCreateToken(context, loanAddr);

  const protocol = await getProtocol(context);

  const lltvBD = marketStruct
    ? new BigDecimal(marketStruct.lltv.toString()).div(BIGDECIMAL_WAD)
    : BIGDECIMAL_ZERO;
  const liquidationPenalty = marketStruct
    ? new BigDecimal(getLiquidationIncentiveFactor(marketStruct.lltv).toString())
        .div(BIGDECIMAL_WAD)
        .minus(BIGDECIMAL_ONE)
    : BIGDECIMAL_ZERO;

  const oracleAddress = marketStruct ? low(marketStruct.oracle) : ADDRESS_ZERO;
  const oracleId = hexConcat(id, oracleAddress);
  const oracle: Oracle = {
    id: oracleId,
    oracleAddress: oracleAddress,
    blockCreated: block.number,
    timestampCreated: block.timestamp,
    isActive: true,
    isUSD: loanToken.symbol.includes("USD"),
    hashEnded: undefined,
    oracleSource: undefined,
  };
  context.Oracle.set(oracle);

  const supplyRateId = id + "-supply";
  const borrowRateId = id + "-borrow";

  const market: Market = {
    id,
    protocol_id: protocol.id,
    name: loanToken.symbol + " / " + collateralToken.symbol,
    isActive: true,
    canBorrowFrom: true,
    canUseAsCollateral: true,
    maximumLTV: lltvBD,
    liquidationThreshold: lltvBD,
    liquidationPenalty,
    canIsolate: true,
    createdTimestamp: block.timestamp,
    createdBlockNumber: block.number,
    oracle_id: oracleId,
    relation: undefined,
    inputToken_id: collateralToken.id,
    inputTokenBalance: 0n,
    inputTokenPriceUSD: getPriceUSD(collateralToken),
    rates: [supplyRateId, borrowRateId],
    reserves: BIGDECIMAL_ZERO,
    reserveFactor: BIGDECIMAL_ZERO,
    borrowedToken_id: loanToken.id,
    variableBorrowedTokenBalance: 0n,
    indexLastUpdatedTimestamp: undefined,
    supplyIndex: undefined,
    borrowIndex: undefined,
    totalValueLockedUSD: BIGDECIMAL_ZERO,
    cumulativeSupplySideRevenueUSD: BIGDECIMAL_ZERO,
    cumulativeProtocolSideRevenueUSD: BIGDECIMAL_ZERO,
    cumulativeTotalRevenueUSD: BIGDECIMAL_ZERO,
    revenueDetail_id: undefined,
    totalDepositBalanceUSD: BIGDECIMAL_ZERO,
    cumulativeDepositUSD: BIGDECIMAL_ZERO,
    totalBorrowBalanceUSD: BIGDECIMAL_ZERO,
    cumulativeBorrowUSD: BIGDECIMAL_ZERO,
    cumulativeLiquidateUSD: BIGDECIMAL_ZERO,
    cumulativeTransferUSD: BIGDECIMAL_ZERO,
    cumulativeFlashloanUSD: BIGDECIMAL_ZERO,
    transactionCount: INT_ZERO,
    depositCount: INT_ZERO,
    withdrawCount: INT_ZERO,
    borrowCount: INT_ZERO,
    repayCount: INT_ZERO,
    liquidationCount: INT_ZERO,
    transferCount: INT_ZERO,
    flashloanCount: INT_ZERO,
    cumulativeUniqueUsers: INT_ZERO,
    cumulativeUniqueDepositors: INT_ZERO,
    cumulativeUniqueBorrowers: INT_ZERO,
    cumulativeUniqueLiquidators: INT_ZERO,
    cumulativeUniqueLiquidatees: INT_ZERO,
    cumulativeUniqueTransferrers: INT_ZERO,
    cumulativeUniqueFlashloaners: INT_ZERO,
    positionCount: INT_ZERO,
    openPositionCount: INT_ZERO,
    closedPositionCount: INT_ZERO,
    lendingPositionCount: INT_ZERO,
    borrowingPositionCount: INT_ZERO,
    collateralPositionCount: INT_ZERO,
    totalCollateral: 0n,
    totalSupplyShares: 0n,
    totalBorrowShares: 0n,
    totalSupply: 0n,
    totalBorrow: 0n,
    lastUpdate: block.timestamp,
    interest: 0n,
    fee: 0n,
    irm: marketStruct ? low(marketStruct.irm) : ADDRESS_ZERO,
    lltv: marketStruct ? marketStruct.lltv : 0n,
  };
  context.Market.set(market);

  const supplyRate: InterestRate = {
    id: supplyRateId,
    rate: BIGDECIMAL_ZERO,
    market_id: id,
    side: InterestRateSide.LENDER,
    type: InterestRateType.VARIABLE,
  };
  context.InterestRate.set(supplyRate);

  const borrowRate: InterestRate = {
    id: borrowRateId,
    rate: BIGDECIMAL_ZERO,
    market_id: id,
    side: InterestRateSide.BORROWER,
    type: InterestRateType.VARIABLE,
  };
  context.InterestRate.set(borrowRate);

  context.LendingProtocol.set({
    ...protocol,
    totalPoolCount: protocol.totalPoolCount + INT_ONE,
  });

  const marketList = (await context._MarketList.get(protocol.id)) ?? {
    id: protocol.id,
    markets: [],
  };
  context._MarketList.set({
    id: marketList.id,
    markets: insert(marketList.markets.slice(), id),
  });

  return market;
}

export async function getMarket(
  context: Context,
  id: string,
): Promise<Market> {
  const market = await context.Market.get(id);
  if (!market) throw new Error(`Market ${id} does not exist`);
  return market;
}

export async function getZeroMarket(
  context: Context,
  block: { number: bigint; timestamp: bigint },
): Promise<Market> {
  const market = await context.Market.get(ADDRESS_ZERO);
  if (market) return market;
  return createMarket(context, ADDRESS_ZERO, null, block);
}

// keep getAmountUSD reachable for callers importing from here
export { getAmountUSD };
