/**
 * Port of packages/utils (index.ts + maths.ts).
 */
import { BigDecimal } from "envio";
import { ADDRESS_ZERO, BIG_DECIMAL_ZERO } from "../constants";

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

/** AssemblyScript `bytesToAddress`: returns the zero address for malformed input. */
export function bytesToAddress(input: string): string {
  if (input.length != 42) {
    return ADDRESS_ZERO;
  }
  return input.toLowerCase();
}

/** Port of BigDecimalToBigInt: truncate toward zero. */
export function bigDecimalToBigInt(input: BigDecimal): bigint {
  return BigInt(input.integerValue(BigDecimal.ROUND_DOWN).toFixed(0));
}

/** Port of IntToCallData: uint256 arg encoded as 64 hex chars (no 0x). */
export function intToCallData(input: number): string {
  return BigInt(input).toString(16).padStart(64, "0");
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

export function exponentToBigInt(decimals: bigint): bigint {
  let bi = 1n;
  for (let i = 0n; i < decimals; i += 1n) {
    bi = bi * 10n;
  }
  return bi;
}

export function growthRate(final: BigDecimal, start: BigDecimal): BigDecimal {
  return start.eq(BIG_DECIMAL_ZERO) ? BIG_DECIMAL_ZERO : final.minus(start).div(start);
}
