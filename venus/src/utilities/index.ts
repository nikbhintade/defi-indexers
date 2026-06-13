/**
 * Port of src/utilities/exponentToBigInt.ts and exponentToBigDecimal.ts.
 * The Venus core-pool mappings work almost entirely in BigInt mantissas; the
 * only exponent helper actually used at runtime is exponentToBigInt (in
 * getTokenPriceCents). exponentToBigDecimal is kept for completeness/parity.
 */
import { BigDecimal } from "envio";

// graph-node BigDecimal keeps 34 significant digits and never serializes with
// exponents. Configure bignumber.js to approximate that (kept for any future
// BigDecimal use; the core-pool schema is all BigInt).
BigDecimal.config({
  DECIMAL_PLACES: 34,
  EXPONENTIAL_AT: [-1000000, 1000000],
});

/** Port of exponentToBigInt: 10^decimals as a BigInt. */
export function exponentToBigInt(decimals: number): bigint {
  let bd = 1n;
  for (let i = 0; i < decimals; i++) {
    bd = bd * 10n;
  }
  return bd;
}

/** Port of exponentToBigDecimal: 10^decimals as a BigDecimal. */
export function exponentToBigDecimal(decimals: number): BigDecimal {
  let bd = new BigDecimal("1");
  const ten = new BigDecimal("10");
  for (let i = 0; i < decimals; i++) {
    bd = bd.times(ten);
  }
  return bd;
}
