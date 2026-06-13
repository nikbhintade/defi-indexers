/**
 * Port of src/utils/numbers.ts. graph-ts BigDecimal -> bignumber.js (envio).
 */
import { BigDecimal } from "envio";
import {
  BIGDECIMAL_ONE,
  BIGDECIMAL_TWO,
  BIGDECIMAL_THREE,
  BIGDECIMAL_SIX,
  BIGDECIMAL_TWELVE,
} from "../common/constants";

/** quantity / 10^decimals as BigDecimal (graph-ts divDecimal). */
export function bigIntToBDUseDecimals(
  quantity: bigint,
  decimals: number = 18,
): BigDecimal {
  return new BigDecimal(quantity.toString()).div(
    new BigDecimal(10).pow(decimals),
  );
}

/**
 * Binomial expansion of (1 + rate)^exponent (matches subgraph exactly):
 * 1 + n*x + (n/2*(n-1))*x^2 + (n/6*(n-1)*(n-2))*x^3 + (n/12*(n-1)*(n-2)*(n-3))*x^4
 * Returns the part WITHOUT the leading 1 (subgraph returns firstTerm+...).
 */
export function bigDecimalExponential(
  rate: BigDecimal,
  exponent: BigDecimal,
): BigDecimal {
  const firstTerm = exponent.times(rate);
  const secondTerm = exponent
    .div(BIGDECIMAL_TWO)
    .times(exponent.minus(BIGDECIMAL_ONE))
    .times(rate.times(rate));
  const thirdTerm = exponent
    .div(BIGDECIMAL_SIX)
    .times(exponent.minus(BIGDECIMAL_TWO))
    .times(rate.times(rate).times(rate));
  const fourthTerm = exponent
    .div(BIGDECIMAL_TWELVE)
    .times(exponent.minus(BIGDECIMAL_THREE))
    .times(rate.times(rate).times(rate).times(rate));
  return firstTerm.plus(secondTerm).plus(thirdTerm).plus(fourthTerm);
}

/** Truncate BigDecimal to BigInt (drop decimals). */
export function bigDecimalTruncateToBigInt(x: BigDecimal): bigint {
  return BigInt(x.integerValue(BigDecimal.ROUND_DOWN).toFixed(0));
}

/** Change number of decimals for a BigInt (graph-ts bigIntChangeDecimals). */
export function bigIntChangeDecimals(x: bigint, from: number, to: number): bigint {
  if (to === from) return x;
  if (to > from) {
    return x * 10n ** BigInt(to - from);
  }
  // to < from: divide with truncation, via BigDecimal to mirror subgraph
  const diff = new BigDecimal(10).pow(from - to);
  const xBD = new BigDecimal(x.toString()).div(diff);
  return bigDecimalTruncateToBigInt(xBD);
}
