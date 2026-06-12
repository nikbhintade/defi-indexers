/**
 * Port of mappings/utils/index.ts (numeric helpers and constants) plus
 * graph-node BigDecimal semantics. The eth_call helpers (fetchTokenName /
 * fetchTokenSymbol / fetchTokenDecimals) live in src/services/tokens.ts.
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

export const ADDRESS_ZERO = "0x0000000000000000000000000000000000000000";
export const FACTORY_ADDRESS = "0xca143ce32fe78f1f7019d7d551a6402fc5350c73";

export const ZERO_BI = 0n;
export const ONE_BI = 1n;
// ZERO_BD doubles as the *sentinel object* the original compared with `===`
// (AssemblyScript reference equality) in handleSwap. Pricing functions return
// this exact object in their "neither token whitelisted" branches so the
// reference comparison ports 1:1 (see src/handlers/core.ts).
export const ZERO_BD = new BigDecimal("0");
export const ONE_BD = new BigDecimal("1");
export const BI_18 = 18n;

/** lowercase an address / hash (HyperIndex delivers checksummed addresses). */
export function low(input: string): string {
  return input.toLowerCase();
}

/** AssemblyScript BigInt.toBigDecimal() */
export function toBD(input: bigint): BigDecimal {
  return new BigDecimal(input.toString());
}

/** Port of exponentToBigDecimal. */
export function exponentToBigDecimal(decimals: bigint): BigDecimal {
  let bd = new BigDecimal("1");
  const ten = new BigDecimal("10");
  for (let i = 0n; i < decimals; i++) {
    bd = bd.times(ten);
  }
  return bd;
}

/** Port of convertTokenToDecimal. */
export function convertTokenToDecimal(tokenAmount: bigint, exchangeDecimals: bigint): BigDecimal {
  if (exchangeDecimals === ZERO_BI) {
    return toBD(tokenAmount);
  }
  return toBD(tokenAmount).div(exponentToBigDecimal(exchangeDecimals));
}

/** Port of isNullBnbValue. */
export function isNullBnbValue(value: string): boolean {
  return value == "0x0000000000000000000000000000000000000000000000000000000000000001";
}

/**
 * graph-ts `Bytes.toString()` on a bytes32 return value: UTF-8 decode,
 * stopping at the first null byte (AssemblyScript's null-terminated decode —
 * this is why bytes32 symbols come out without trailing \0 padding).
 */
export function bytes32ToString(hex: string): string {
  if (!hex.startsWith("0x")) {
    // already decoded (e.g. injected by the test call mock)
    return hex;
  }
  const bytes: number[] = [];
  for (let i = 2; i + 1 < hex.length; i += 2) {
    const byte = parseInt(hex.slice(i, i + 2), 16);
    if (byte === 0) break; // null-terminated
    bytes.push(byte);
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}
