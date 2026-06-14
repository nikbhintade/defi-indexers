import { BigDecimal } from "envio";
import { FIVE_BD, TEN_BI, ZERO_BD, ZERO_BI } from "../constants.js";

const TEN_BD = new BigDecimal("10");

/** graph-node BigDecimal.truncate(n): keep n decimal places, rounding toward zero. */
export function truncate(value: BigDecimal, decimals: number): BigDecimal {
  // bignumber.js ROUND_DOWN === 1 (truncate toward zero)
  return value.decimalPlaces(decimals, 1);
}

/** 10^decimals as BigDecimal. */
export function exponentToBigDecimal(decimals: bigint): BigDecimal {
  let bd = new BigDecimal("1");
  for (let i = 0n; i < decimals; i++) {
    bd = bd.times(TEN_BD);
  }
  return bd;
}

/** tokenAmount / 10^decimals (subgraph convertTokenToDecimal). */
export function convertTokenToDecimal(tokenAmount: bigint, exchangeDecimals: bigint): BigDecimal {
  if (exchangeDecimals === ZERO_BI) {
    return new BigDecimal(tokenAmount.toString());
  }
  return new BigDecimal(tokenAmount.toString()).div(exponentToBigDecimal(exchangeDecimals));
}

export function absBD(bd: BigDecimal): BigDecimal {
  return bd.lt(ZERO_BD) ? bd.negated() : bd;
}

/**
 * roundHalfUp: add (subtract for negatives) 5*10^-(decimals+1) then truncate.
 */
export function roundHalfUp(value: BigDecimal, decimals: bigint): BigDecimal {
  const dec = Number(decimals);
  const amountToAdd = FIVE_BD.div(exponentToBigDecimal(decimals + 1n));
  if (value.lt(ZERO_BD)) {
    return truncate(value.minus(amountToAdd), dec);
  }
  return truncate(value.plus(amountToAdd), dec);
}

/**
 * ValueStruct equivalent: the (sign, value) Dolomite struct delivered as an
 * envio event tuple field { sign: boolean, value: bigint }.
 */
export type DolomiteValue = { sign: boolean; value: bigint };

/** convertStructToDecimalAppliedValue: signed value / 10^decimals (0 if decimals==0). */
export function convertStructToDecimalAppliedValue(
  struct: DolomiteValue,
  exchangeDecimals: bigint,
): BigDecimal {
  const value = struct.sign ? struct.value : -struct.value;
  if (exchangeDecimals === ZERO_BI) {
    return ZERO_BD;
  }
  return new BigDecimal(value.toString()).div(exponentToBigDecimal(exchangeDecimals));
}

export function structApplied(struct: DolomiteValue): bigint {
  return struct.sign ? struct.value : -struct.value;
}

export function structAbs(struct: DolomiteValue): DolomiteValue {
  const v = struct.value < ZERO_BI ? -struct.value : struct.value;
  return { sign: true, value: v };
}

/** pow used elsewhere */
export function pow10(decimals: bigint): bigint {
  return TEN_BI ** decimals;
}
