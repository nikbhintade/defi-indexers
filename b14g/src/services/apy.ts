/**
 * Port of the APY math in lendingVault.ts / lendingVaultV2.ts.
 * graph-ts BigDecimal -> envio BigDecimal (bignumber.js).
 */
import { BigDecimal } from "envio";
import { toBD } from "../utils";

/** aprToApy: APY = e^APR - 1 via 4-term Taylor series (matches source exactly). */
export function aprToApy(apr: BigDecimal): BigDecimal {
  const ONE = new BigDecimal("1");
  const TWO = new BigDecimal("2");
  const SIX = new BigDecimal("6");
  const TWENTY_FOUR = new BigDecimal("24");
  let result = ONE;
  result = result.plus(apr);
  const termTwo = apr.times(apr).div(TWO);
  result = result.plus(termTwo);
  const termThree = apr.times(apr).times(apr).div(SIX);
  result = result.plus(termThree);
  const termFour = apr.times(apr).times(apr).times(apr).div(TWENTY_FOUR);
  result = result.plus(termFour);
  return result.minus(ONE);
}

/** calculateApy: APR (1e18-scaled bigint) -> APY (1e18-scaled bigint, truncated). */
export function calculateApy(apr: bigint): bigint {
  const aprDecimal = toBD(apr).div(new BigDecimal("1000000000000000000"));
  const wbtcApy = aprToApy(aprDecimal).times(new BigDecimal("1000000000000000000"));
  // BigInt.fromString(wbtcApy.toString().split(".")[0]) — truncate at the dot.
  const intPart = wbtcApy.toString().split(".")[0]!;
  return BigInt(intPart);
}
