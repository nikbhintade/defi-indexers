/**
 * Port of fetchTokenSymbol / fetchTokenName / fetchTokenDecimals /
 * fetchTokenTotalSupply from mappings/helpers.ts.
 */
import type { EffectCaller } from "envio";
import { bytes32ToString, isNullEthValue, low } from "../utils";
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
  // hard coded overrides (mirrors mappings/helpers.ts)
  const addr = low(tokenAddress);
  if (addr == "0xe0b7927c4af23765cb51314a0e0521a9645f0e2a") {
    return "DGD";
  }
  if (addr == "0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9") {
    return "AAVE";
  }

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

/**
 * Port of fetchTokenTotalSupply. DEVIATION (see MIGRATION.md): the original
 * mapping has a well-known AssemblyScript bug — it assigns the whole
 * `CallResult` object (rather than `.value`) and then `... as i32`, so the
 * stored value is a non-deterministic runtime pointer, not the real supply.
 * We cannot reproduce that pointer deterministically, so this port stores the
 * actual decoded totalSupply (0 on revert). totalSupply is never read by any
 * pricing/volume code, so this only affects the `Token.totalSupply` field.
 */
export async function fetchTokenTotalSupply(ec: EC, tokenAddress: string): Promise<bigint> {
  const result = await erc20TotalSupply(ec, tokenAddress);
  return result === null ? 0n : result;
}
