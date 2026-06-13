/**
 * Byte-layout helpers replicating graph-ts `Bytes` id construction so entity
 * ids match the original subgraph byte-for-byte (stored as lowercase 0x hex
 * strings, exactly how graph-node serializes `Bytes` ids).
 *
 * Reused from the compound-v3 port (src/common/graphBytes.ts), extended with
 * `i32Bytes` (graph-ts `Bytes.fromI32`) and `concatI32` (graph-ts
 * `Bytes.concatI32`) used by Morpho's snapshot/event ids.
 */

/** graph-ts `Bytes.fromByteArray(Bytes.fromBigInt(x))` -> hex (no 0x). */
export function bigIntBytes(value: bigint): string {
  if (value === 0n) {
    return "00";
  }
  const bytes: number[] = [];
  if (value > 0n) {
    let v = value;
    while (v > 0n) {
      bytes.push(Number(v & 0xffn));
      v >>= 8n;
    }
    if ((bytes[bytes.length - 1]! & 0x80) !== 0) {
      bytes.push(0);
    }
  } else {
    let len = 1;
    while (value < -(1n << BigInt(8 * len - 1))) {
      len += 1;
    }
    let v = (1n << BigInt(8 * len)) + value;
    for (let i = 0; i < len; i++) {
      bytes.push(Number(v & 0xffn));
      v >>= 8n;
    }
  }
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * graph-ts `Bytes.fromI32(x)` -> hex (no 0x). graph-node stores i32 as a
 * 4-byte little-endian two's complement buffer.
 */
export function i32Bytes(value: number): string {
  const v = value >>> 0; // to uint32
  const b0 = v & 0xff;
  const b1 = (v >> 8) & 0xff;
  const b2 = (v >> 16) & 0xff;
  const b3 = (v >> 24) & 0xff;
  return [b0, b1, b2, b3].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** graph-ts `a.concat(b)...` for Bytes -> "0x" + joined hex (parts may carry 0x). */
export function hexConcat(...parts: string[]): string {
  return (
    "0x" +
    parts
      .map((p) => (p.startsWith("0x") || p.startsWith("0X") ? p.slice(2) : p))
      .join("")
      .toLowerCase()
  );
}

/** graph-ts `bytes.concatI32(x)` -> "0x" + bytesHex + fromI32(x)Hex. */
export function concatI32(bytesHex: string, value: number): string {
  const base = bytesHex.startsWith("0x") ? bytesHex.slice(2) : bytesHex;
  return ("0x" + base + i32Bytes(value)).toLowerCase();
}

/** lowercase an address / hash (HyperIndex delivers checksummed addresses). */
export function low(input: string): string {
  return input.toLowerCase();
}

export const ADDRESS_ZERO = "0x0000000000000000000000000000000000000000";
