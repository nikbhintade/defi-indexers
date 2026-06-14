/**
 * Port of template/utils/index.ts (numeric helpers) + graph-node BigDecimal
 * semantics.
 */
import { BigDecimal } from "envio";
import { ONE_BD, ONE_BI, ZERO_BD, ZERO_BI } from "./constants";

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

/** return 0 if denominator is 0 in division */
export function safeDiv(amount0: BigDecimal, amount1: BigDecimal): BigDecimal {
  if (amount1.eq(ZERO_BD)) {
    return ZERO_BD;
  }
  return amount0.div(amount1);
}

/** Port of bigDecimalExponated. */
export function bigDecimalExponated(value: BigDecimal, power: bigint): BigDecimal {
  if (power === ZERO_BI) {
    return ONE_BD;
  }
  const negativePower = power < ZERO_BI;
  let result = ZERO_BD.plus(value);
  const powerAbs = power < 0n ? -power : power;
  for (let i = ONE_BI; i < powerAbs; i = i + ONE_BI) {
    result = result.times(value);
  }
  if (negativePower) {
    result = safeDiv(ONE_BD, result);
  }
  return result;
}

/** Port of convertTokenToDecimal. */
export function convertTokenToDecimal(tokenAmount: bigint, exchangeDecimals: bigint): BigDecimal {
  if (exchangeDecimals === ZERO_BI) {
    return toBD(tokenAmount);
  }
  return safeDiv(toBD(tokenAmount), exponentToBigDecimal(exchangeDecimals));
}

/** Port of isNullEthValue. */
export function isNullEthValue(value: string): boolean {
  return value === "0x0000000000000000000000000000000000000000000000000000000000000001";
}

/**
 * graph-ts `Bytes.toString()` on a bytes32 return value: UTF-8 decode,
 * stopping at the first null byte.
 */
export function bytes32ToString(hex: string): string {
  if (!hex.startsWith("0x")) {
    return hex;
  }
  const bytes: number[] = [];
  for (let i = 2; i + 1 < hex.length; i += 2) {
    const byte = parseInt(hex.slice(i, i + 2), 16);
    if (byte === 0) break;
    bytes.push(byte);
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}
