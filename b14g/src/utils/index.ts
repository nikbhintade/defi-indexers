/**
 * Byte / id helpers reproducing graph-ts `Bytes` semantics used by the b14g
 * subgraph. All hex is lowercase (HyperIndex delivers checksummed addresses;
 * subgraphs store lowercase).
 */
import { BigDecimal } from "envio";

// graph-node BigDecimal keeps 34 significant digits and never serializes with
// exponents. Configure bignumber.js to approximate that.
BigDecimal.config({
  DECIMAL_PLACES: 34,
  EXPONENTIAL_AT: [-1000000, 1000000],
});

export const ZERO_BI = 0n;

/** lowercase a hex string (address / hash / bytes). */
export function low(input: string): string {
  return input.toLowerCase();
}

/** strip a leading 0x (case-insensitive). */
function strip0x(hex: string): string {
  return hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
}

/**
 * graph-ts `Bytes.concat(other)` — concatenates raw bytes. Inputs are 0x hex;
 * output is a single lowercase 0x hex string.
 */
export function concatBytes(...parts: string[]): string {
  return "0x" + parts.map((p) => strip0x(p)).join("").toLowerCase();
}

/**
 * graph-ts `Bytes.concatI32(i)` — appends a 4-byte big-endian int32.
 * Used by getId: `event.transaction.hash.concatI32(event.logIndex.toI32())`.
 */
export function concatI32(hex: string, value: number): string {
  const u = value >>> 0; // int32 -> unsigned 32-bit word, big-endian 4 bytes
  const suffix = u.toString(16).padStart(8, "0");
  return ("0x" + strip0x(hex) + suffix).toLowerCase();
}

/** Port of helpers.getId(event) = txHash.concatI32(logIndex). */
export function getId(txHash: string, logIndex: number): string {
  return concatI32(txHash, logIndex);
}

/** AssemblyScript BigInt.toBigDecimal() */
export function toBD(input: bigint): BigDecimal {
  return new BigDecimal(input.toString());
}

/** Integer division truncating toward zero (graph-ts BigInt.div). */
export function bigIntDiv(a: bigint, b: bigint): bigint {
  // JS bigint `/` already truncates toward zero, matching graph-ts.
  return a / b;
}
