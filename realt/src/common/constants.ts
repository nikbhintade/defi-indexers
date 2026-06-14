import { BigDecimal } from "envio";

/** lowercase an address/hex string (HyperIndex delivers checksummed). */
export const low = (x: string): string => x.toLowerCase();

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export const ZERO_BI = 0n;

export function zeroBD(): BigDecimal {
  return new BigDecimal(0);
}

export const BORROW_MODE_STABLE = "Stable";
export const BORROW_MODE_VARIABLE = "Variable";
export const BORROW_MODE_NONE = "None";

/** getBorrowRateMode: numeric mode -> enum string (throws on unknown, as source). */
export function getBorrowRateMode(mode: bigint): "None" | "Stable" | "Variable" {
  const m = Number(mode);
  if (m === 0) return BORROW_MODE_NONE;
  if (m === 1) return BORROW_MODE_STABLE;
  if (m === 2) return BORROW_MODE_VARIABLE;
  throw new Error("invalid borrow rate mode");
}

// aToken Mint-to-treasury exclusion address (source: src/mapping/tokenization/tokenization.ts).
// QUIRK: the subgraph compares `from.toHexString()` (lowercase) against this
// *checksummed* literal, so the inequality is ALWAYS true — the treasury branch
// (lifetimeReserveFactorAccrued) is dead code and every Mint hits the user
// branch. We keep the mixed-case literal verbatim so the lowercased `from`
// never matches, preserving that behaviour exactly. See MIGRATION.md.
export const TREASURY_ADDRESS_CHECKSUM = "0x2c15338cadd34753ddeCCFc22762DdD981c671A4";
