import { BigDecimal } from "envio";
import type { EvmOnEventContext, DolomiteMargin, InterestIndex, Token, TotalPar, InterestRate, MarketRiskInfo } from "envio";
type handlerContext = EvmOnEventContext;
import {
  AAVE_ALT_COIN_COPY_CAT_V1_INTEREST_SETTER_ADDRESS,
  AAVE_STABLE_COIN_COPY_CAT_V1_INTEREST_SETTER_ADDRESS,
  ALWAYS_ZERO_INTEREST_SETTER_ADDRESS,
  DOUBLE_EXPONENT_V1_INTEREST_SETTER_ADDRESS,
  INTEREST_PRECISION,
  ONE_ETH_BD,
  ONE_ETH_BI,
  SECONDS_IN_YEAR,
  USD_PRECISION,
  ZERO_BD,
  ZERO_BI,
} from "../constants.js";
import { absBD, type DolomiteValue, exponentToBigDecimal, truncate } from "./math.js";
import { parToWei } from "./entities.js";
import { getTokenOraclePriceUSD } from "./pricing.js";

type Ctx = handlerContext;

const SECONDS_IN_YEAR_BI = 31536000n;
const PERCENT = 100n;

function getLinearStepFunctionInterestRatePerSecond(
  optimalUtilization: bigint,
  lowerOptimalRate: bigint,
  upperOptimalRate: bigint,
  borrowWei: bigint,
  supplyWei: bigint,
): bigint {
  const maxGoal = lowerOptimalRate + upperOptimalRate;
  const BASE = ONE_ETH_BI;
  if (borrowWei === ZERO_BI) return ZERO_BI;
  if (supplyWei === ZERO_BI) return maxGoal / SECONDS_IN_YEAR_BI;

  const utilization = (BASE * borrowWei) / supplyWei;
  const optimalUtilizationDeltaToMax = BASE - optimalUtilization;
  const initialGoal = lowerOptimalRate;

  let aprBI: bigint;
  if (utilization >= BASE) {
    aprBI = maxGoal;
  } else if (utilization > optimalUtilization) {
    const deltaToGoal = maxGoal - initialGoal;
    const interestToAdd = (deltaToGoal * (utilization - optimalUtilization)) / optimalUtilizationDeltaToMax;
    aprBI = interestToAdd + initialGoal;
  } else {
    aprBI = (initialGoal * utilization) / optimalUtilization;
  }
  return aprBI / SECONDS_IN_YEAR_BI;
}

function getDoubleExponentInterestRatePerSecond(borrowWei: bigint, supplyWei: bigint): bigint {
  if (borrowWei === ZERO_BI) return ZERO_BI;
  const maxAPR = ONE_ETH_BI;
  if (borrowWei >= supplyWei) return maxAPR / SECONDS_IN_YEAR_BI;

  const coefficients = [0n, 20n, 0n, 0n, 0n, 0n, 20n, 60n];
  let result = coefficients[0]! * ONE_ETH_BI;
  let polynomial = (ONE_ETH_BI * borrowWei) / supplyWei;
  for (let i = 1; i < coefficients.length; i++) {
    const coefficient = coefficients[i]!;
    if (coefficient !== 0n) {
      result = result + coefficient * polynomial;
    }
    polynomial = (polynomial * polynomial) / ONE_ETH_BI;
  }
  return (result * maxAPR) / (SECONDS_IN_YEAR_BI * ONE_ETH_BI * PERCENT);
}

function getInterestRatePerSecond(borrowWeiBI: bigint, supplyWeiBI: bigint, ir: InterestRate): bigint {
  const setter = ir.interestSetter;
  if (setter === DOUBLE_EXPONENT_V1_INTEREST_SETTER_ADDRESS) {
    return getDoubleExponentInterestRatePerSecond(borrowWeiBI, supplyWeiBI);
  } else if (
    setter === AAVE_ALT_COIN_COPY_CAT_V1_INTEREST_SETTER_ADDRESS ||
    setter === AAVE_STABLE_COIN_COPY_CAT_V1_INTEREST_SETTER_ADDRESS
  ) {
    return getLinearStepFunctionInterestRatePerSecond(
      ir.optimalUtilizationRate,
      ir.lowerOptimalRate,
      ir.upperOptimalRate,
      borrowWeiBI,
      supplyWeiBI,
    );
  } else if (setter === ALWAYS_ZERO_INTEREST_SETTER_ADDRESS) {
    return ZERO_BI;
  }
  return getLinearStepFunctionInterestRatePerSecond(
    ir.optimalUtilizationRate,
    ir.lowerOptimalRate,
    ir.upperOptimalRate,
    borrowWeiBI,
    supplyWeiBI,
  );
}

/** BigDecimal that holds a non-negative integer -> bigint. */
function bdIntegerToBigInt(bd: BigDecimal): bigint {
  // bd has been multiplied by 10^decimals so it is integral; ROUND_DOWN then string.
  return BigInt(bd.decimalPlaces(0, 1).toFixed(0));
}

export async function updateInterestRate(
  context: Ctx,
  token: Token,
  totalPar: TotalPar,
  index: InterestIndex,
  dolomiteMargin: DolomiteMargin,
): Promise<void> {
  let borrowWei = absBD(parToWei(totalPar.borrowPar.negated(), index, token.decimals));
  let supplyWei = parToWei(totalPar.supplyPar, index, token.decimals);

  const scale = exponentToBigDecimal(token.decimals);
  borrowWei = borrowWei.times(scale);
  supplyWei = supplyWei.times(scale);

  const borrowWeiBI = bdIntegerToBigInt(borrowWei);
  const supplyWeiBI = bdIntegerToBigInt(supplyWei);

  const interestRate = await context.InterestRate.getOrThrow(index.token_id);
  const interestRatePerSecond = getInterestRatePerSecond(borrowWeiBI, supplyWeiBI, interestRate);
  const marketInfo = await context.MarketRiskInfo.getOrThrow(token.id);
  const interestPerYearBD = new BigDecimal((interestRatePerSecond * SECONDS_IN_YEAR).toString());
  const borrowInterestRate = interestPerYearBD.div(ONE_ETH_BD);

  let earningsRate: BigDecimal;
  if (marketInfo.earningsRateOverride !== undefined && marketInfo.earningsRateOverride !== null) {
    earningsRate = marketInfo.earningsRateOverride;
  } else {
    earningsRate = dolomiteMargin.earningsRate;
  }

  let supplyInterestRate: BigDecimal;
  if (borrowWei.lt(supplyWei)) {
    supplyInterestRate = truncate(
      truncate(borrowInterestRate.times(earningsRate), INTEREST_PRECISION).times(borrowWei).div(supplyWei),
      INTEREST_PRECISION,
    );
  } else {
    supplyInterestRate = truncate(borrowInterestRate.times(earningsRate), INTEREST_PRECISION);
  }

  context.InterestRate.set({ ...interestRate, borrowInterestRate, supplyInterestRate });
}

/**
 * changeProtocolBalanceApplied: recompute token + protocol borrow/supply
 * liquidity (USD), update borrow volume, and run the interest-rate update.
 */
export async function changeProtocolBalanceApplied(
  context: Ctx,
  token: Token,
  deltaWei: BigDecimal,
  index: InterestIndex,
  isVirtualTransfer: boolean,
  dolomiteMargin: DolomiteMargin,
  blockNumber: bigint,
  blockHash: string,
): Promise<DolomiteMargin> {
  let totalPar = await context.TotalPar.getOrThrow(token.id);
  await updateInterestRate(context, token, totalPar, index, dolomiteMargin);

  const tokenPriceUSD = await getTokenOraclePriceUSD(context, token, blockNumber, blockHash);

  let dm = { ...dolomiteMargin };
  let tok = { ...token };

  const isPol = tok.symbol.startsWith("pol-");
  if (!isPol) {
    dm.borrowLiquidityUSD = dm.borrowLiquidityUSD.minus(tok.borrowLiquidityUSD);
    dm.supplyLiquidityUSD = dm.supplyLiquidityUSD.minus(tok.supplyLiquidityUSD);
  }

  const tokenBorrowLiquidity = absBD(parToWei(totalPar.borrowPar.negated(), index, tok.decimals));
  const tokenBorrowLiquidityUSD = truncate(tok.borrowLiquidity.times(tokenPriceUSD), USD_PRECISION);

  if (tokenBorrowLiquidity.gt(tok.borrowLiquidity)) {
    const borrowVolumeToken = tokenBorrowLiquidity.minus(tok.borrowLiquidity);
    const borrowVolumeUsd = truncate(borrowVolumeToken.times(tokenPriceUSD), USD_PRECISION);
    dm.totalBorrowVolumeUSD = dm.totalBorrowVolumeUSD.plus(borrowVolumeUsd);
  }

  tok.borrowLiquidity = tokenBorrowLiquidity;
  tok.borrowLiquidityUSD = tokenBorrowLiquidityUSD;
  tok.supplyLiquidity = parToWei(totalPar.supplyPar, index, tok.decimals);
  tok.supplyLiquidityUSD = truncate(tok.supplyLiquidity.times(tokenPriceUSD), USD_PRECISION);

  if (!isPol) {
    dm.borrowLiquidityUSD = dm.borrowLiquidityUSD.plus(tok.borrowLiquidityUSD);
    dm.supplyLiquidityUSD = dm.supplyLiquidityUSD.plus(tok.supplyLiquidityUSD);
  }

  if (!isVirtualTransfer) {
    if (deltaWei.gt(ZERO_BD)) {
      const deltaWeiUSD = deltaWei.times(tokenPriceUSD);
      dm.totalSupplyVolumeUSD = dm.totalSupplyVolumeUSD.plus(deltaWeiUSD);
    }
  }

  context.Token.set(tok);
  context.DolomiteMargin.set(dm);
  return dm;
}

export async function changeProtocolBalance(
  context: Ctx,
  token: Token,
  deltaWeiStruct: DolomiteValue,
  index: InterestIndex,
  isVirtualTransfer: boolean,
  dolomiteMargin: DolomiteMargin,
  blockNumber: bigint,
  blockHash: string,
): Promise<DolomiteMargin> {
  const value = deltaWeiStruct.sign ? deltaWeiStruct.value : -deltaWeiStruct.value;
  const deltaWei = token.decimals === ZERO_BI ? ZERO_BD : new BigDecimal(value.toString()).div(exponentToBigDecimal(token.decimals));
  return changeProtocolBalanceApplied(
    context,
    token,
    deltaWei,
    index,
    isVirtualTransfer,
    dolomiteMargin,
    blockNumber,
    blockHash,
  );
}

export type { MarketRiskInfo };
