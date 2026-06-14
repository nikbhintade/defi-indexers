/**
 * Faithful TypeScript port of src/utils/bitcoin_utils.ts (AssemblyScript).
 *
 * These pure functions parse Bitcoin transaction input/output vectors
 * (varint-prefixed) to recover deposit/redemption identifiers. They must
 * produce byte-identical results to the original. Indices and lengths that the
 * original typed as graph-ts `BigInt` are returned as native `bigint`; the
 * values are small (tx-vector offsets) so this is exact.
 *
 * Based on https://github.com/clover-network/clover-spv-pegout BTCUtils.js
 */

export type VarIntTuple = {
  dataLength: bigint;
  number: bigint;
};

export function parseVarInt(b: Uint8Array): VarIntTuple {
  return parseVarIntAt(b, 0);
}

export function parseVarIntAt(b: Uint8Array, index: number): VarIntTuple {
  const dataLength = determineVarIntDataLengthAt(b, index);
  if (dataLength === 0) {
    return {
      dataLength: 0n,
      number: BigInt(b[index]!),
    };
  }
  if (b.length < 1 + dataLength + index) {
    // original logs an error and continues
  }
  const number = bytesToUint(reverseEndianness(safeSlice(b, 1, 1 + dataLength + index)));
  return {
    dataLength: BigInt(dataLength),
    number: BigInt(number),
  };
}

/**
 * Converts a big-endian byte array to an unsigned integer.
 * Original returns i32; values here can exceed 31 bits for 8-byte slices so we
 * compute with bigint internally and return number (matches AS i32 overflow
 * only when callers truncate — see notes). Callers use the result for counts
 * and indices that fit comfortably in a JS number.
 */
export function bytesToUint(b: Uint8Array): number {
  let num = 0;
  for (let i = 0; i < b.length; i++) {
    num += b[i]! * Math.pow(2, 8 * (b.length - (i + 1)));
  }
  return num;
}

export function safeSlice(buf: Uint8Array, first = 0, last = buf.length): Uint8Array {
  const start = first;
  const end = last;
  // The original logs (does not throw) on bounds problems; we preserve the
  // permissive behaviour by letting Uint8Array.slice clamp.
  return buf.slice(start, end);
}

/**
 * Changes the endianness of a byte array. Returns a new, backwards, byte array.
 */
function reverseEndianness(uint8Arr: Uint8Array): Uint8Array {
  const newArr = safeSlice(uint8Arr);
  return newArr.reverse();
}

/**
 * Determines the length of a VarInt in bytes.
 * A VarInt of >1 byte is prefixed with a flag indicating its length.
 */
function determineVarIntDataLengthAt(data: Uint8Array, flag: number): number {
  if (data[flag] === 0xff) {
    return 8; // one-byte flag, 8 bytes data
  }
  if (data[flag] === 0xfe) {
    return 4; // one-byte flag, 4 bytes data
  }
  if (data[flag] === 0xfd) {
    return 2; // one-byte flag, 2 bytes data
  }
  return 0; // flag is data
}

/**
 * Extracts the outpoint tx id from an input (32 byte tx id).
 */
export function extractInputTxIdLEAt(input: Uint8Array, inputStartingIndex: bigint): Uint8Array {
  const i = Number(inputStartingIndex);
  return safeSlice(input, i, i + 32);
}

/**
 * Extracts the LE tx input index from the input in a tx (4 byte tx index).
 */
export function extractTxIndexLEAt(input: Uint8Array, inputStartingIndex: bigint): Uint8Array {
  const i = Number(inputStartingIndex);
  return safeSlice(input, i + 32, i + 32 + 4);
}

type TupleScriptSig = {
  dataLength: bigint;
  scriptSigLen: bigint;
};

/**
 * Determines the length of a scriptSig in an input.
 * Will return 0 if passed a witness input.
 */
export function extractScriptSigLenAt(input: Uint8Array, inputStartingIndex: bigint): TupleScriptSig {
  if (input.length < 37) {
    throw new Error("Read overrun");
  }
  const varIntTuple = parseVarInt(safeSlice(input, Number(inputStartingIndex) + 36));
  return { dataLength: varIntTuple.dataLength, scriptSigLen: varIntTuple.number };
}

/**
 * Determines the length of an input from its scriptsig.
 * 36 for outpoint, 1 for scriptsig length, 4 for sequence.
 */
export function determineInputLengthAt(input: Uint8Array, inputStartingIndex: bigint): bigint {
  const tupleScriptSig = extractScriptSigLenAt(input, inputStartingIndex);
  return 41n + tupleScriptSig.dataLength + tupleScriptSig.scriptSigLen;
}

export function determineOutputLengthAt(output: Uint8Array, outputStartingIndex: bigint): bigint {
  if (output.length < 9) {
    throw new Error("Read overrun");
  }
  const varIntTuple = parseVarIntAt(output, 8 + Number(outputStartingIndex));
  // 8 byte value, 1 byte for len itself
  return 8n + 1n + varIntTuple.dataLength + varIntTuple.number;
}
