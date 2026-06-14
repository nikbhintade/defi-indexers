/**
 * Port of template/utils/token.ts (fetchTokenSymbol / fetchTokenName /
 * fetchTokenDecimals / fetchTokenTotalSupply). The staticTokenDefinition
 * fallback is a no-op on BSC (the source's staticTokenDefinition.ts has all
 * definitions commented out and fromAddress() returns null), so it is omitted
 * here — documented in MIGRATION.md.
 */
import type { EffectCaller } from "envio";
import { bytes32ToString, isNullEthValue } from "./index";
import {
  erc20Decimals,
  erc20Name,
  erc20NameBytes32,
  erc20Symbol,
  erc20SymbolBytes32,
  erc20TotalSupply,
} from "../effects/contracts";

type EC = EffectCaller | null;

export async function fetchTokenSymbol(ec: EC, tokenAddress: string): Promise<string> {
  let symbolValue = "unknown";
  const symbolResult = await erc20Symbol(ec, tokenAddress);
  if (symbolResult === null) {
    const symbolResultBytes = await erc20SymbolBytes32(ec, tokenAddress);
    if (symbolResultBytes !== null) {
      if (!isNullEthValue(symbolResultBytes)) {
        symbolValue = bytes32ToString(symbolResultBytes);
      }
    }
  } else {
    symbolValue = symbolResult;
  }
  return symbolValue;
}

export async function fetchTokenName(ec: EC, tokenAddress: string): Promise<string> {
  let nameValue = "unknown";
  const nameResult = await erc20Name(ec, tokenAddress);
  if (nameResult === null) {
    const nameResultBytes = await erc20NameBytes32(ec, tokenAddress);
    if (nameResultBytes !== null) {
      if (!isNullEthValue(nameResultBytes)) {
        nameValue = bytes32ToString(nameResultBytes);
      }
    }
  } else {
    nameValue = nameResult;
  }
  return nameValue;
}

export async function fetchTokenTotalSupply(ec: EC, tokenAddress: string): Promise<bigint> {
  const result = await erc20TotalSupply(ec, tokenAddress);
  return result === null ? 0n : result;
}

/**
 * Original quirk preserved: in AssemblyScript, a reverted try_decimals() with
 * no static definition yields decimalValue = ZERO_BI (0). So a reverted
 * decimals() call resolves to 0 here too.
 */
export async function fetchTokenDecimals(ec: EC, tokenAddress: string): Promise<bigint> {
  const decimalResult = await erc20Decimals(ec, tokenAddress);
  return decimalResult === null ? 0n : BigInt(decimalResult);
}
