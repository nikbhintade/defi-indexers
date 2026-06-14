/**
 * Faithful TypeScript port of src/utils/utils.ts (AssemblyScript).
 * Pure helpers for key derivation and hex/byte conversion.
 */
import { keccak256 } from "./crypto.js";

const HEX_CHARS = "0123456789abcdef";

export function hexToBytes(hex: string): Uint8Array {
  let h = hex;
  if (h.startsWith("0x") || h.startsWith("0X")) {
    h = h.slice(2);
  }
  if (h.length % 2 !== 0) {
    h = "0" + h;
  }
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(h.substr(i * 2, 2), 16);
  }
  return out;
}

export function bytesToHex(bin: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bin.length; i++) {
    const b = bin[i]!;
    hex += HEX_CHARS[(b >> 4) & 0xf];
    hex += HEX_CHARS[b & 0xf];
  }
  return hex;
}

/** Lowercase 0x-prefixed hex string from bytes. */
export function toHexString(bin: Uint8Array): string {
  return "0x" + bytesToHex(bin);
}

/** alias for hexToBytes used by call-handler code that takes Bytes-like inputs */
export function bytesToUint8Array(bytes: string | Uint8Array): Uint8Array {
  return typeof bytes === "string" ? hexToBytes(bytes) : bytes;
}

/**
 * Calculates deposit key the same way as the Bridge contract:
 * `keccak256(fundingTxHash | fundingOutputIndex)` where fundingOutputIndex is
 * a big-endian uint32. Returns lowercase 0x hex (32 bytes).
 */
export function calculateDepositKey(fundingTxHash: Uint8Array, fundingOutputIndex: number): string {
  const data = new Uint8Array(fundingTxHash.length + 4);
  data.set(fundingTxHash, 0);
  const indexData = new Uint8Array(4);
  indexData[0] = (fundingOutputIndex >> 24) & 0xff;
  indexData[1] = (fundingOutputIndex >> 16) & 0xff;
  indexData[2] = (fundingOutputIndex >> 8) & 0xff;
  indexData[3] = fundingOutputIndex & 0xff;
  data.set(indexData, fundingTxHash.length);
  return toHexString(keccak256(data));
}

/**
 * keccak256(keccak256(redeemerOutputScript) | walletPubKeyHash) + "-" + count
 */
export function calculateRedemptionKey(
  redeemerOutputScript: Uint8Array,
  walletPublicKeyHash: Uint8Array,
  count: bigint,
): string {
  const scriptHashArray = keccak256(redeemerOutputScript);
  const data = new Uint8Array(scriptHashArray.length + walletPublicKeyHash.length);
  data.set(scriptHashArray, 0);
  data.set(walletPublicKeyHash, scriptHashArray.length);
  return toHexString(keccak256(data)) + "-" + count.toString();
}

/**
 * keccak256(scriptHash | walletPubKeyHash) + "-" + count
 */
export function calculateRedemptionKeyByScriptHash(
  scriptHash: Uint8Array,
  walletPublicKeyHash: Uint8Array,
  count: bigint,
): string {
  const data = new Uint8Array(scriptHash.length + walletPublicKeyHash.length);
  data.set(scriptHash, 0);
  data.set(walletPublicKeyHash, scriptHash.length);
  return toHexString(keccak256(data)) + "-" + count.toString();
}

export function calculateRedemptionKeyByBigInt(redemptionKey: bigint, count: bigint): string {
  return bigIntToHex(redemptionKey) + "-" + count.toString();
}

/**
 * Convert a bigint to a 0x-prefixed, zero-padded (default 64-nibble) lowercase
 * hex string. Mirrors the AssemblyScript `bigIntToHex`.
 */
export function bigIntToHex(value: bigint, paddingLength = 64): string {
  if (value === 0n) {
    return "0x" + "0".repeat(paddingLength);
  }
  let hex = "";
  let v = value;
  while (v > 0n) {
    const digit = Number(v % 16n);
    v = v / 16n;
    hex = HEX_CHARS[digit] + hex;
  }
  if (hex.length < paddingLength) {
    hex = "0".repeat(paddingLength - hex.length) + hex;
  }
  return "0x" + hex;
}

/**
 * Pads a deposit key hex (from uint256) to 0x + 64 nibbles. Mirrors the AS
 * `convertDepositKeyToHex` which guards against odd-length hex from
 * `BigInt.toHexString()`.
 */
export function convertDepositKeyToHex(depositKey: bigint): string {
  return bigIntToHex(depositKey, 64);
}

/** id = txHash + "-" + logIndex (lowercase hex tx hash). */
export function getIDFromEvent(txHash: string, logIndex: number): string {
  return txHash.toLowerCase() + "-" + logIndex.toString();
}

/**
 * Original call-handler id: txHash + "-" + transaction.index.
 * HyperIndex does not expose transaction.transactionIndex without extra field
 * selection; the call-handler equivalents here run from an event in the same
 * tx, so we reuse the event-based id (txHash + "-" + logIndex). Documented in
 * MIGRATION.md as a deviation.
 */
export function getIDFromCall(txHash: string, logIndex: number): string {
  return txHash.toLowerCase() + "-" + logIndex.toString();
}
