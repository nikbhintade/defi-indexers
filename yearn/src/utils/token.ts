/** Ported from src/utils/token.ts (ERC20 metadata getOrCreate). */
import type { Token } from "envio";
import type { Env } from "./types";
import { low } from "./commons";
import { DEFAULT_DECIMALS } from "./constants";
import { erc20Decimals, erc20Name, erc20Symbol } from "../effects/contracts";

export async function getOrCreateToken(env: Env, address: string): Promise<Token> {
  const id = low(address);
  const existing = await env.context.Token.get(id);
  if (existing) return existing;

  const decimals = await erc20Decimals(env.ec, id);
  const name = await erc20Name(env.ec, id);
  const symbol = await erc20Symbol(env.ec, id);

  const token: Token = {
    id,
    decimals: decimals === null ? DEFAULT_DECIMALS : Number(decimals),
    name: name === null ? "" : name,
    symbol: symbol === null ? "" : symbol,
  };
  env.context.Token.set(token);
  return token;
}
