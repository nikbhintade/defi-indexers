/**
 * Ported from src/sdk/token.ts (TokenManager). Functional, context-based.
 * - getOrCreateToken: loads/creates a Token, fetching name/symbol/decimals via
 *   effects with bytes32 fallbacks (ERC20SymbolBytes/NameBytes), exactly like
 *   the subgraph's try_ chain.
 * - updateTokenPrice / getAmountUSD: USD pricing via fetchUsdTokenPrice.
 */
import { BigDecimal, type EffectCaller, type Token } from "envio";
import type { Context } from "../context";
import {
  erc20Symbol,
  erc20SymbolBytes,
  erc20Name,
  erc20NameBytes,
  erc20Decimals,
} from "../effects/contracts";
import { fetchUsdTokenPrice } from "../fetchUsdTokenPrice";
import { exponentToBigDecimal, toBD } from "./constants";

const UNKNOWN_TOKEN_VALUE = "unknown";
const INVALID_TOKEN_DECIMALS = 0;

function isNullEthValue(value: string): boolean {
  return (
    value ===
    "0x0000000000000000000000000000000000000000000000000000000000000001"
  );
}

async function fetchTokenSymbol(
  effect: EffectCaller,
  token: string,
): Promise<string> {
  const symbol = await erc20Symbol(effect, token);
  if (symbol !== null) return symbol;
  const symbolBytes = await erc20SymbolBytes(effect, token);
  if (symbolBytes !== null && !isNullEthValue(symbolBytes)) {
    // bytes32 -> trimmed utf8 string (graph-ts Bytes.toString)
    return bytes32ToString(symbolBytes);
  }
  return UNKNOWN_TOKEN_VALUE;
}

async function fetchTokenName(
  effect: EffectCaller,
  token: string,
): Promise<string> {
  const name = await erc20Name(effect, token);
  if (name !== null) return name;
  const nameBytes = await erc20NameBytes(effect, token);
  if (nameBytes !== null && !isNullEthValue(nameBytes)) {
    return bytes32ToString(nameBytes);
  }
  return UNKNOWN_TOKEN_VALUE;
}

/** graph-ts Bytes.toString() on a bytes32 — decode utf8, drop trailing NULs. */
function bytes32ToString(hex: string): string {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes: number[] = [];
  for (let i = 0; i + 1 < clean.length; i += 2) {
    bytes.push(parseInt(clean.slice(i, i + 2), 16));
  }
  // drop trailing zero bytes
  while (bytes.length > 0 && bytes[bytes.length - 1] === 0) bytes.pop();
  return Buffer.from(bytes).toString("utf8");
}

export async function getOrCreateToken(
  context: Context,
  tokenAddress: string,
): Promise<Token> {
  const id = tokenAddress.toLowerCase();
  const existing = await context.Token.get(id);
  if (existing) return existing;

  const name = await fetchTokenName(context.effect, id);
  const symbol = await fetchTokenSymbol(context.effect, id);
  const decimals = (await erc20Decimals(context.effect, id)) ?? INVALID_TOKEN_DECIMALS;

  const token: Token = {
    id,
    name,
    symbol,
    decimals,
    lastPriceUSD: undefined,
    lastPriceBlockNumber: undefined,
    type: undefined,
  };
  context.Token.set(token);
  return token;
}

/** TokenManager.updatePrice() — fetches USD price, writes lastPriceUSD/block. */
export async function updateTokenPrice(
  context: Context,
  token: Token,
  block: number,
): Promise<{ token: Token; priceUSD: BigDecimal }> {
  const priceUSD = await fetchUsdTokenPrice(context.effect, token.id, block);
  const updated: Token = {
    ...token,
    lastPriceUSD: priceUSD,
    lastPriceBlockNumber: BigInt(block),
  };
  context.Token.set(updated);
  return { token: updated, priceUSD };
}

/** TokenManager.getPriceUSD() */
export function getPriceUSD(token: Token): BigDecimal {
  return token.lastPriceUSD ?? new BigDecimal("0");
}

/** TokenManager.getAmountUSD(amount) */
export function getAmountUSD(token: Token, amount: bigint): BigDecimal {
  return toBD(amount)
    .div(exponentToBigDecimal(token.decimals))
    .times(getPriceUSD(token));
}
