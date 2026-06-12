/**
 * Port of src/mappings/helpers.ts (numeric helpers) plus graph-node
 * BigDecimal semantics.
 */
import { BigDecimal } from "envio";

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

/** AssemblyScript BigInt.toBigDecimal() */
export function toBD(input: bigint): BigDecimal {
  return new BigDecimal(input.toString());
}

/** Port of exponentToBigDecimal. */
export function exponentToBigDecimal(decimals: number): BigDecimal {
  let bd = new BigDecimal("1");
  const ten = new BigDecimal("10");
  for (let i = 0; i < decimals; i++) {
    bd = bd.times(ten);
  }
  return bd;
}

export const mantissaFactor = 18;
export const cTokenDecimals = 8;
export const mantissaFactorBD: BigDecimal = exponentToBigDecimal(18);
export const cTokenDecimalsBD: BigDecimal = exponentToBigDecimal(8);
export const zeroBD = new BigDecimal("0");

/**
 * graph-node `BigDecimal.truncate(n)`: truncate (not round) to n decimal
 * places, toward zero.
 */
export function truncate(value: BigDecimal, decimals: number): BigDecimal {
  return value.decimalPlaces(decimals, BigDecimal.ROUND_DOWN);
}
