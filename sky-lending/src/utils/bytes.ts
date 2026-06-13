/**
 * Port of src/utils/bytes.ts. graph-ts `Bytes` operations reimplemented for
 * HyperIndex, where bytes/bytes32/bytes4 event params arrive as lowercase
 * 0x-hex strings.
 */

const strip0x = (h: string): string =>
  h.startsWith("0x") || h.startsWith("0X") ? h.slice(2) : h;

/** Bytes -> 0x lowercase hex (identity for the hex strings HyperIndex delivers). */
export function toHexString(bytes: string): string {
  return ("0x" + strip0x(bytes)).toLowerCase();
}

/**
 * graph-ts `Bytes.toString()` for a bytes32 ilk: interpret bytes as UTF-8 and
 * drop trailing NULs (graph-node decodes the full 32 bytes as a string;
 * makerdao ilks are right-padded ASCII like "ETH-A"). Non-printable leading
 * bytes are kept as-is to mirror graph-node behaviour.
 */
export function bytes32ToString(hex: string): string {
  const h = strip0x(hex);
  let out = "";
  for (let i = 0; i + 1 < h.length; i += 2) {
    const code = parseInt(h.slice(i, i + 2), 16);
    if (code === 0) continue; // drop NUL padding
    out += String.fromCharCode(code);
  }
  return out;
}

/** extractCallData: slice [start,end) of a bytes blob, return 0x hex. */
export function extractCallData(bytes: string, start: number, end: number): string {
  const h = strip0x(bytes);
  return "0x" + h.slice(start * 2, end * 2);
}

/** graph-ts bytes32ToAddressHexString: last 20 bytes (40 hex chars), lowercased. */
export function bytes32ToAddressHexString(hex: string): string {
  const h = strip0x(hex).toLowerCase();
  // mirror `bytes.toHexString().slice(26)` -> last 40 chars of the 64-char body
  return "0x" + h.slice(h.length - 40);
}

/** graph-ts bytes32ToAddress -> address hex string (lowercase). */
export function bytes32ToAddress(hex: string): string {
  return bytes32ToAddressHexString(hex);
}

/** BigInt.fromUnsignedBytes(bigEndian bytes) — big-endian unsigned hex -> bigint. */
export function bytesToUnsignedBigInt(hex: string): bigint {
  const h = strip0x(hex);
  if (h.length === 0) return 0n;
  return BigInt("0x" + h);
}

/** BigInt.fromSignedBytes(bigEndian bytes) — two's-complement signed. */
export function bytesToSignedBigInt(hex: string): bigint {
  const h = strip0x(hex);
  if (h.length === 0) return 0n;
  const bits = BigInt(h.length * 4);
  const unsigned = BigInt("0x" + h);
  const signBit = 1n << (bits - 1n);
  return unsigned >= signBit ? unsigned - (1n << bits) : unsigned;
}
