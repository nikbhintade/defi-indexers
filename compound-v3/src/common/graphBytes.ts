/**
 * Byte-layout helpers replicating graph-ts `Bytes` id construction so entity
 * ids match the original subgraph byte-for-byte (stored as lowercase 0x hex
 * strings, exactly how graph-node serializes `Bytes` ids).
 *
 * graph-ts `Bytes.fromBigInt(x)` reinterprets the BigInt's internal byte
 * buffer: graph-node host functions return BigInts as *minimal two's
 * complement little-endian* (num_bigint `to_signed_bytes_le`), so e.g.
 * block 15331590 (0xE9F286) becomes bytes [0x86, 0xf2, 0xe9, 0x00] -> no:
 * minimal LE of 0x00e9f286 is [0x86,0xf2,0xe9] and since 0xe9 has the high
 * bit set a 0x00 sign byte is appended -> "86f2e900".
 */

/** graph-ts `Bytes.fromByteArray(Bytes.fromBigInt(x))` -> hex (no 0x). */
export function bigIntBytes(value: bigint): string {
  if (value === 0n) {
    // num_bigint to_signed_bytes_le(0) == [0]
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
      bytes.push(0); // sign byte for positive values with high bit set
    }
  } else {
    // minimal two's complement length
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

/** graph-ts `Bytes.fromUTF8(s)` -> hex (no 0x). */
export function utf8Hex(s: string): string {
  return Buffer.from(s, "utf8").toString("hex");
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
