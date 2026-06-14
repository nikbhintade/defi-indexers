/**
 * Numeric / date helpers ported from the subgraph
 * (numberHelper.ts, dateHelper.ts) plus graph-node BigDecimal semantics.
 */
import { BigDecimal } from "envio";

// graph-node BigDecimal keeps 34 significant digits and never serializes with
// exponents. Approximate that with bignumber.js.
BigDecimal.config({
  DECIMAL_PLACES: 34,
  EXPONENTIAL_AT: [-1000000, 1000000],
});

/** lowercase an address / hash (HyperIndex delivers checksummed addresses). */
export const low = (input: string): string => input.toLowerCase();

/**
 * Port of numberHelper.toDecimal: value.divDecimal(10^decimals).
 */
export function toDecimal(value: bigint, decimals: number = 18): BigDecimal {
  const precision = new BigDecimal(10).pow(decimals);
  return new BigDecimal(value.toString()).div(precision);
}

/** AssemblyScript BigInt.toBigDecimal() */
export const toBD = (input: bigint): BigDecimal => new BigDecimal(input.toString());

export const ZERO_BD = new BigDecimal("0");

/**
 * Port of dateHelper.getISO8601DateStringFromTimestamp: `YYYY-MM-DD` from a
 * unix-seconds timestamp (UTC).
 */
export function getISO8601DateStringFromTimestamp(timestamp: bigint): string {
  const date = new Date(Number(timestamp) * 1000);
  return date.toISOString().split("T")[0]!;
}
