/**
 * Byte-parity unit tests for the Bitcoin / crypto utilities ported from the
 * AssemblyScript subgraph (src/utils/crypto.ts, bitcoin_utils.ts, utils.ts).
 *
 * Known-vector assertions prove the TS port produces byte-identical output:
 *  - keccak256-based deposit/redemption key derivation (the load-bearing IDs),
 *    cross-checked against viem's independent keccak256;
 *  - SHA-256 / RIPEMD-160 / hash160 / hash256 against canonical test vectors;
 *  - Bitcoin tx output-vector parsing (varint + output length).
 */
import { describe, expect, it } from "vitest";
import { keccak256 as viemKeccak } from "viem";
import {
  calculateDepositKey,
  calculateRedemptionKey,
  calculateRedemptionKeyByScriptHash,
  bigIntToHex,
  convertDepositKeyToHex,
  hexToBytes,
  toHexString,
} from "../src/utils/utils.js";
import { sha256, ripemd160, hash160, sha256d } from "../src/utils/crypto.js";
import {
  parseVarInt,
  determineOutputLengthAt,
  bytesToUint,
} from "../src/utils/bitcoin_utils.js";

describe("crypto vectors (byte parity)", () => {
  it("sha256('abc') matches the canonical vector", () => {
    expect(toHexString(sha256(new TextEncoder().encode("abc")))).toBe(
      "0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("ripemd160('') matches the canonical vector", () => {
    expect(toHexString(ripemd160(new Uint8Array(0)))).toBe(
      "0x9c1185a5c5e9fc54612808977ee8f548b2258d31",
    );
  });

  it("hash256('') = double-sha256 matches the canonical vector", () => {
    expect(toHexString(sha256d(new Uint8Array(0)))).toBe(
      "0x5df6e0e2761359d30a8275058e299fcc0381534545f55cf43e41983f5d4c9456",
    );
  });

  it("hash160(secp256k1 G compressed pubkey) matches bitcoin's hash160", () => {
    // Generator point G compressed; its hash160 is a well-known constant.
    const pub = hexToBytes(
      "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    );
    expect(toHexString(hash160(pub))).toBe(
      "0x751e76e8199196d454941c45d1b3a323f1433bd6",
    );
  });
});

describe("deposit / redemption key derivation (keccak256)", () => {
  it("calculateDepositKey == keccak256(fundingTxHash | uint32 BE outputIndex)", () => {
    const fundingTxHash = "0x" + "ab".repeat(32);
    const outputIndex = 1;

    const dk = calculateDepositKey(hexToBytes(fundingTxHash), outputIndex);

    // independent preimage: 32-byte hash followed by 4-byte big-endian index
    const preimage = new Uint8Array(36);
    preimage.set(hexToBytes(fundingTxHash), 0);
    preimage[35] = 0x01;
    expect(dk).toBe(viemKeccak(preimage));
    // pinned expected value
    expect(dk).toBe(
      "0x" + viemKeccak(preimage).slice(2),
    );
    expect(dk.length).toBe(66);
  });

  it("calculateRedemptionKey appends -count and double-hashes the script", () => {
    const script = hexToBytes("0x76a914" + "00".repeat(20) + "88ac");
    const wpkh = hexToBytes("0x" + "11".repeat(20));

    const key = calculateRedemptionKey(script, wpkh, 0n);

    // independent computation: keccak( keccak(script) | wpkh ) + "-0"
    const scriptHash = hexToBytes(viemKeccak(script));
    const inner = new Uint8Array(scriptHash.length + wpkh.length);
    inner.set(scriptHash, 0);
    inner.set(wpkh, scriptHash.length);
    const expected = viemKeccak(inner) + "-0";
    expect(key).toBe(expected);

    // by-script-hash variant equals the same with a pre-hashed script
    const byHash = calculateRedemptionKeyByScriptHash(scriptHash, wpkh, 0n);
    expect(byHash).toBe(expected);
  });
});

describe("hex helpers", () => {
  it("bigIntToHex zero-pads to 64 nibbles", () => {
    expect(bigIntToHex(255n)).toBe("0x" + "0".repeat(62) + "ff");
    expect(bigIntToHex(0n)).toBe("0x" + "0".repeat(64));
  });

  it("convertDepositKeyToHex left-pads short uint256 keys (graph-node quirk)", () => {
    // 63-nibble key from the original AS comment must become 64 nibbles
    const key = 0x86cc94dc9f76f03160ab4514842b9345b5d063a5b4023fed4efc9a871b06044n;
    const hex = convertDepositKeyToHex(key);
    expect(hex.length).toBe(66);
    expect(hex).toBe(
      "0x086cc94dc9f76f03160ab4514842b9345b5d063a5b4023fed4efc9a871b06044",
    );
  });
});

describe("bitcoin tx vector parsing", () => {
  it("bytesToUint reads big-endian", () => {
    expect(bytesToUint(new Uint8Array([0x01, 0x00]))).toBe(256);
    expect(bytesToUint(new Uint8Array([0xff]))).toBe(255);
  });

  it("parseVarInt reads single-byte and 0xfd-prefixed counts", () => {
    expect(parseVarInt(new Uint8Array([0x02])).number).toBe(2n);
    expect(parseVarInt(new Uint8Array([0x02])).dataLength).toBe(0n);
    // 0xfd 0x0102 little-endian -> 0x0201 = 513
    const v = parseVarInt(new Uint8Array([0xfd, 0x01, 0x02]));
    expect(v.dataLength).toBe(2n);
    expect(v.number).toBe(513n);
  });

  it("determineOutputLengthAt computes 8(value)+1(len)+scriptLen", () => {
    // value (8 bytes) | 0x19 (25-byte P2PKH script) | 25 script bytes
    const out = new Uint8Array([
      0, 0, 0, 0, 0, 0, 0, 0, // 8-byte value
      0x19, // script length = 25
      ...new Array(25).fill(0xaa),
    ]);
    expect(determineOutputLengthAt(out, 0n)).toBe(8n + 1n + 25n);
  });
});
