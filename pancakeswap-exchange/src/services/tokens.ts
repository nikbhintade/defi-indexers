/**
 * Port of fetchTokenSymbol / fetchTokenName / fetchTokenDecimals from
 * mappings/utils/index.ts.
 */
import type { EffectCaller } from "envio";
import { bytes32ToString, isNullBnbValue } from "../utils";
import { erc20Decimals, erc20Name, erc20NameBytes32, erc20Symbol, erc20SymbolBytes32 } from "../effects/contracts";

type EC = EffectCaller | null;

export async function fetchTokenSymbol(ec: EC, tokenAddress: string): Promise<string> {
  let symbolValue = "unknown";
  const symbolResult = await erc20Symbol(ec, tokenAddress);
  if (symbolResult === null) {
    const symbolResultBytes = await erc20SymbolBytes32(ec, tokenAddress);
    if (symbolResultBytes !== null) {
      if (!isNullBnbValue(symbolResultBytes)) {
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
      if (!isNullBnbValue(nameResultBytes)) {
        nameValue = bytes32ToString(nameResultBytes);
      }
    }
  } else {
    nameValue = nameResult;
  }
  return nameValue;
}

/**
 * Original quirk preserved: in AssemblyScript, `BigInt.fromI32(null as i32)`
 * coerces the null of a reverted try_decimals() to 0 — fetchTokenDecimals
 * never returns null, so factory.ts's `if (decimals === null) return` branch
 * is dead code. A reverted decimals() call yields decimals = 0 here too.
 */
export async function fetchTokenDecimals(ec: EC, tokenAddress: string): Promise<bigint> {
  const decimalResult = await erc20Decimals(ec, tokenAddress);
  return decimalResult === null ? 0n : BigInt(decimalResult);
}
