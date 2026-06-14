/*
 * graph-ts type-conversion compatibility layer.
 *
 * The original subgraph builds entity ids out of graph-ts `BigInt.toHex()`,
 * `Address.toHex()` and `Bytes.fromHexString` / fixed-width zero-padding. These
 * encodings are LOAD-BEARING for entity-id parity (and for the bridge-address
 * filter), so they are reproduced byte-for-byte here.
 */

/**
 * graph-ts `BigInt.toHex()` / `BigInt.toHexString()`.
 *
 * Host fn `typeConversion.bigIntToHex` (graph-node): go-ethereum hexutil
 * "quantity" encoding — lowercase, NO leading zeros, and zero encodes as "0x0"
 * (uneven nibble length is allowed, e.g. 1 -> "0x1", 256 -> "0x100").
 *
 * Source comment: "Their encoding may be of uneven length. The number zero
 * encodes as \"0x0\"."
 */
export function bigIntToHex(v: bigint): string {
  if (v === 0n) return "0x0";
  // Negative BigInts never occur here (uint256 payloads), but mirror graph-ts
  // which prepends "-" for negatives.
  if (v < 0n) return "-0x" + (-v).toString(16);
  return "0x" + v.toString(16);
}

/**
 * graph-ts `Address.toHex()` / `Bytes.toHex()`: "0x" + lowercase, fixed-width
 * (leading zeros preserved). HyperIndex delivers checksummed addresses, so we
 * just lowercase.
 */
export function addressToHex(a: string): string {
  return a.toLowerCase();
}

export const ADDRESS_TYPE = {
  STARKNET: 0,
  ETHEREUM: 1,
} as const;
export type ADDRESS_TYPE = (typeof ADDRESS_TYPE)[keyof typeof ADDRESS_TYPE];

const STARK_ADDRESS_LENGTH = 64;
const ETHEREUM_ADDRESS_LENGTH = 40;

/**
 * Port of src/utils/bigIntToAddressBytes.ts.
 *
 * Source:
 *   let unprefixedHex = address.toHexString().slice(2);
 *   return Bytes.fromHexString("0x" + "0".repeat(len - unprefixedHex.length) + unprefixedHex)
 *
 * We return the lowercase "0x"-prefixed fixed-width hex string (the textual form
 * of the resulting Bytes), which is exactly what gets stored in String fields
 * and compared in the bridge filter.
 *
 * Quirk preserved: if the value's minimal hex is LONGER than the target width
 * (only possible for a malformed/over-large felt), the original calls
 * `String.repeat(negative)` which throws — we mirror that (no silent clamp).
 */
export function bigIntToAddressBytes(address: bigint, type: ADDRESS_TYPE): string {
  const unprefixedHex = bigIntToHex(address).slice(2);
  const addressLength =
    type === ADDRESS_TYPE.ETHEREUM
      ? ETHEREUM_ADDRESS_LENGTH
      : STARK_ADDRESS_LENGTH;
  const padCount = addressLength - unprefixedHex.length;
  if (padCount < 0) {
    // graph-ts/AssemblyScript String.repeat throws on a negative count.
    throw new RangeError("bigIntToAddressBytes: value wider than address width");
  }
  return "0x" + "0".repeat(padCount) + unprefixedHex;
}

/**
 * Port of src/utils/convertUint256ToBigInt.ts: high << 128 + low.
 */
export function convertUint256ToBigInt(low: bigint, high: bigint): bigint {
  return (high << 128n) + low;
}

/**
 * Port of src/utils/makeIdFromPayload.ts:
 *   [bridgeL1Address.toHex()].concat(payload.map(p => p.toHex())).join("-")
 *
 * bridgeL1Address is an EVM address (use addressToHex); payload entries are
 * uint256 -> graph-ts BigInt.toHex() (minimal, "0x0" for zero).
 */
export function makeIdFromPayload(bridgeL1Address: string, payload: readonly bigint[]): string {
  return [addressToHex(bridgeL1Address)]
    .concat(payload.map((p) => bigIntToHex(p)))
    .join("-");
}

/**
 * Port of src/utils/getUniqId.ts: txHash.toHex() + "-" + logIndex.toString().
 * Source uses event.logIndex (NOT transactionLogIndex), which envio exposes.
 */
export function getUniqId(txHash: string, logIndex: number): string {
  return txHash.toLowerCase() + "-" + logIndex.toString();
}

/**
 * Port of src/utils/addUniq.ts: append s if not already present (preserves
 * insertion order; does not mutate the input).
 */
export function addUniq(values: readonly string[], s: string): string[] {
  const newArray = ([] as string[]).concat(values as string[]);
  if (!newArray.includes(s)) {
    newArray.push(s);
  }
  return newArray;
}
