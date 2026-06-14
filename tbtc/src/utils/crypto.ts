/**
 * Cryptographic primitives.
 *
 * The original subgraph shipped a hand-rolled AssemblyScript SHA-256
 * implementation in `src/utils/crypto.ts` (a port of fast-sha256-js) that was
 * exposed to mappings via `Utils.hash()`. In AssemblyScript the graph-node
 * runtime had no built-in SHA-256, hence the manual implementation. Here we
 * delegate to @noble/hashes, which produces byte-identical SHA-256 output.
 *
 * Note: the load-bearing hashing for entity IDs in the active mappings is
 * keccak256 (graph-ts `crypto.keccak256`), not this SHA-256 — see utils.ts.
 * `hash()` / `sha256d` / `hash160` are ported for completeness + parity tests.
 */
import { sha256 as nobleSha256 } from "@noble/hashes/sha256";
import { ripemd160 as nobleRipemd160 } from "@noble/hashes/ripemd160";
import { keccak_256 } from "@noble/hashes/sha3";

/** Single SHA-256 (mirrors the AssemblyScript `Utils.hash`). */
export function sha256(data: Uint8Array): Uint8Array {
  return nobleSha256(data);
}

/** Alias matching the original `Utils.hash`. */
export function hash(data: Uint8Array): Uint8Array {
  return sha256(data);
}

/** Bitcoin double-SHA256 (hash256). */
export function sha256d(data: Uint8Array): Uint8Array {
  return nobleSha256(nobleSha256(data));
}

/** RIPEMD-160. */
export function ripemd160(data: Uint8Array): Uint8Array {
  return nobleRipemd160(data);
}

/** Bitcoin hash160 = RIPEMD-160(SHA-256(data)). */
export function hash160(data: Uint8Array): Uint8Array {
  return nobleRipemd160(nobleSha256(data));
}

/** keccak256 — mirrors graph-ts `crypto.keccak256`. */
export function keccak256(data: Uint8Array): Uint8Array {
  return keccak_256(data);
}
