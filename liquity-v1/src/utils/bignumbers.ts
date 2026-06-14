/**
 * Ported from liquity/dev packages/subgraph/src/utils/bignumbers.ts.
 *
 * graph-node semantics emulated with bignumber.js (re-exported by envio as
 * BigDecimal):
 *   - BigDecimal keeps 34 significant digits and serializes without trailing
 *     zeros. Tests configure `BigDecimal.config({ DECIMAL_PLACES: 34, ... })`.
 *   - graph-node `BigDecimal.truncate(n)` truncates toward zero to n decimal
 *     places -> bignumber.js `.decimalPlaces(n, ROUND_DOWN)`.
 *   - graph-node `BigInt.divDecimal(d)` = (this / d) as BigDecimal -> here
 *     `new BigDecimal(bigInt.toString()).div(d)`.
 */
import { BigDecimal } from "envio";

export const DECIMAL_PRECISION = 18;

// E.g. 1.5 is represented as 1.5 * 10^18, where 10^18 is the scaling factor
export const DECIMAL_SCALING_FACTOR = new BigDecimal("1000000000000000000");
export const BIGINT_SCALING_FACTOR = 10n ** 18n;

export const DECIMAL_ZERO = new BigDecimal("0");
export const DECIMAL_ONE = new BigDecimal("1");

export const DECIMAL_COLLATERAL_GAS_COMPENSATION_DIVISOR = new BigDecimal("200");

export const BIGINT_ZERO = 0n;

export function decimalize(bigInt: bigint): BigDecimal {
  return new BigDecimal(bigInt.toString()).div(DECIMAL_SCALING_FACTOR);
}

/** graph-node BigDecimal.truncate(decimals): round toward zero (ROUND_DOWN = 1). */
export function truncate(value: BigDecimal, decimals: number): BigDecimal {
  return value.decimalPlaces(decimals, 1 /* BigNumber.ROUND_DOWN */);
}
