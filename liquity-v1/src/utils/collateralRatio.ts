/**
 * Ported from liquity/dev packages/subgraph/src/utils/collateralRatio.ts.
 */
import { BigDecimal } from "envio";

import { DECIMAL_PRECISION, DECIMAL_ZERO, truncate } from "./bignumbers";

export function calculateCollateralRatio(
  collateral: BigDecimal,
  debt: BigDecimal,
  price: BigDecimal,
): BigDecimal | null {
  if (debt.eq(DECIMAL_ZERO)) {
    return null;
  }

  return truncate(collateral.times(price).div(debt), DECIMAL_PRECISION);
}
