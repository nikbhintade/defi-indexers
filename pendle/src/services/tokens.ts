/**
 * Port of src/utils/token-fetch.ts (fetchTokenSymbol / fetchTokenName /
 * fetchTokenDecimals / fetchTokenTotalSupply) and the Token-entity factory
 * from src/utils/load-entity.ts (generateNewToken / loadToken).
 *
 * In the original, these eth_call wrappers were free functions using the
 * global contract bindings; here `context`/`block` are threaded through so the
 * calls go through the cached `ethCall` Effect.
 */
import { type EvmOnEventContext, type Token } from "envio";
import { bytes32ToString, isNullEthValue, low, ZERO_BD, ZERO_BI } from "../utils";
import {
  erc20Decimals,
  erc20Name,
  erc20NameBytes32,
  erc20Symbol,
  erc20SymbolBytes32,
  erc20TotalSupply,
} from "../effects/contracts";

type Ctx = EvmOnEventContext;

export async function fetchTokenSymbol(context: Ctx, tokenAddress: string): Promise<string> {
  const addr = low(tokenAddress);
  // hard coded overrides
  if (addr == "0xe0b7927c4af23765cb51314a0e0521a9645f0e2a") return "DGD";
  if (addr == "0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9") return "AAVE";

  let symbolValue = "unknown";
  const symbolResult = await erc20Symbol(context.effect, addr);
  if (symbolResult === null) {
    const symbolResultBytes = await erc20SymbolBytes32(context.effect, addr);
    if (symbolResultBytes !== null) {
      // for broken pairs that have no symbol function exposed
      if (!isNullEthValue(symbolResultBytes)) {
        symbolValue = bytes32ToString(symbolResultBytes);
      }
    }
  } else {
    symbolValue = symbolResult;
  }
  return symbolValue;
}

export async function fetchTokenName(context: Ctx, tokenAddress: string): Promise<string> {
  const addr = low(tokenAddress);
  // hard coded overrides
  if (addr == "0xe0b7927c4af23765cb51314a0e0521a9645f0e2a") return "DGD";
  if (addr == "0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9") return "Aave Token";

  let nameValue = "unknown";
  const nameResult = await erc20Name(context.effect, addr);
  if (nameResult === null) {
    const nameResultBytes = await erc20NameBytes32(context.effect, addr);
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
 * Port of fetchTokenTotalSupply. Non-`try_` in the original (a revert would
 * abort graph-node); here a null read falls back to 0n. Pinned to the event
 * block so the supply matches the state the original read.
 */
export async function fetchTokenTotalSupply(context: Ctx, tokenAddress: string, block: number): Promise<bigint> {
  const value = await erc20TotalSupply(context.effect, low(tokenAddress), block);
  return value === null ? 0n : value;
}

/**
 * Port of fetchTokenDecimals. Original quirk preserved: AssemblyScript coerces
 * the null of a reverted try_decimals() to 0 via `BigInt.fromI32(null as i32)`,
 * so this never returns null — the `if (decimals === null) return` branch in
 * generateNewToken is dead code.
 */
export async function fetchTokenDecimals(context: Ctx, tokenAddress: string): Promise<bigint> {
  const addr = low(tokenAddress);
  // hardcode override
  if (addr == "0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9") return 18n;
  const decimalResult = await erc20Decimals(context.effect, addr);
  return decimalResult === null ? 0n : BigInt(decimalResult);
}

/**
 * Port of generateNewToken (load-entity.ts). Always (re)fetches metadata and
 * persists a fresh Token. Returns the created Token. `block` pins the
 * totalSupply read.
 */
export async function generateNewToken(context: Ctx, tokenAddress: string, block: number): Promise<Token> {
  const id = low(tokenAddress);
  const token: Token = {
    id,
    symbol: await fetchTokenSymbol(context, id),
    name: await fetchTokenName(context, id),
    totalSupply: await fetchTokenTotalSupply(context, id, block),
    decimals: await fetchTokenDecimals(context, id),
    forgeId: undefined,
    underlyingAsset: undefined,
    tradeVolume: ZERO_BD,
    tradeVolumeUSD: ZERO_BD,
    mintVolume: ZERO_BD,
    mintVolumeUSD: ZERO_BD,
    redeemVolume: ZERO_BD,
    redeemVolumeUSD: ZERO_BD,
    txCount: ZERO_BI,
    totalLiquidity: ZERO_BD,
    type: undefined,
  };
  context.Token.set(token);
  return token;
}

/**
 * Port of loadToken (load-entity.ts): load existing or create via
 * generateNewToken.
 */
export async function loadToken(context: Ctx, tokenAddress: string, block: number): Promise<Token> {
  const id = low(tokenAddress);
  const existing = await context.Token.get(id);
  if (existing === undefined) {
    return generateNewToken(context, id, block);
  }
  return existing;
}
