/**
 * Port of packages/utils (index.ts + maths.ts) and src/services/utils.ts.
 */
import { BigDecimal } from "envio";
import {
  ADDRESS_ZERO,
  ASSET_TYPES,
  BIG_DECIMAL_ONE,
  BIG_DECIMAL_TWO,
} from "../constants";

// graph-node BigDecimal keeps 34 significant digits and never serializes with
// exponents. Configure bignumber.js to approximate that behaviour: divisions
// keep 34 decimal places (compare tooling tolerates far-decimal differences)
// and toString never switches to exponential notation.
BigDecimal.config({
  DECIMAL_PLACES: 34,
  EXPONENTIAL_AT: [-1000000, 1000000],
});

/** lowercase an address / hash (HyperIndex delivers checksummed addresses). */
export function low(input: string): string {
  return input.toLowerCase();
}

export function toBigDecimal(input: bigint): BigDecimal {
  return new BigDecimal(input.toString());
}

/**
 * Port of `bytesToAddress` (packages/utils/index.ts): returns the zero address
 * for malformed input (a stored hex string whose length is not 42 chars).
 */
export function bytesToAddress(input: string): string {
  if (input.length != 42) {
    return ADDRESS_ZERO;
  }
  return input.toLowerCase();
}

// ---- maths.ts ----

export function exponentToBigDecimal(decimals: bigint): BigDecimal {
  let bd = new BigDecimal("1");
  const ten = new BigDecimal("10");
  for (let i = 0n; i < decimals; i += 1n) {
    bd = bd.times(ten);
  }
  return bd;
}

export function toDecimal(value: bigint, decimals: number): BigDecimal {
  let res = toBigDecimal(value);
  const ten = new BigDecimal("10");
  for (let i = 0; i < decimals; i++) {
    res = res.div(ten);
  }
  return res;
}

export function exponentToBigInt(decimals: bigint): bigint {
  let bi = 1n;
  for (let i = 0n; i < decimals; i += 1n) {
    bi = bi * 10n;
  }
  return bi;
}

/**
 * A fast approximation of (1 + rate)^exponent via 4-term binomial expansion.
 * Port of packages/utils/maths.ts `bigDecimalExponential`.
 * Source: messari/subgraphs common/utils/numbers.ts
 */
export function bigDecimalExponential(rate: BigDecimal, exponent: BigDecimal): BigDecimal {
  // 1 + n*x + (n/2*(n-1))*x^2 + (n/6*(n-1)*(n-2))*x^3 + (n/12*(n-1)*(n-2)*(n-3))*x^4
  const firstTerm = exponent.times(rate);
  const secondTerm = exponent.div(BIG_DECIMAL_TWO).times(exponent.minus(BIG_DECIMAL_ONE)).times(rate.times(rate));
  const thirdTerm = exponent
    .div(new BigDecimal("6"))
    .times(exponent.minus(BIG_DECIMAL_TWO))
    .times(rate.times(rate).times(rate));
  const fourthTerm = exponent
    .div(new BigDecimal("12"))
    .times(exponent.minus(new BigDecimal("3")))
    .times(rate.times(rate).times(rate).times(rate));
  return firstTerm.plus(secondTerm).plus(thirdTerm).plus(fourthTerm);
}

// ---- src/services/utils.ts ----

/** Port of `inferAssetType`. */
export function inferAssetType(curvePool: string, poolName: string): number {
  const known = ASSET_TYPES.get(curvePool);
  if (known !== undefined) {
    return known;
  }
  const description = poolName.toUpperCase();
  const stables = ["USD", "DAI", "MIM", "TETHER", "FRAX"];
  for (let i = 0; i < stables.length; i++) {
    if (description.indexOf(stables[i]!) >= 0) {
      return 0;
    }
  }

  if (description.indexOf("BTC") >= 0) {
    return 2;
  } else if (description.indexOf("ETH") >= 0) {
    return 1;
  } else {
    return 3;
  }
}

// ---- time.ts ----

export const DAY = BigInt(60 * 60 * 24);
export const WEEK = BigInt(60 * 60 * 24 * 7);
export const HOUR = BigInt(60 * 60);

export function getIntervalFromTimestamp(timestamp: bigint, interval: bigint): bigint {
  return (timestamp / interval) * interval;
}
