/**
 * Ported from liquity/dev packages/subgraph/src/entities/Token.ts.
 * Token id = token address (lowercase hex).
 *
 * The subgraph binds the emitting contract and reads name()/symbol() the first
 * time a token is seen. Here those reads go through the ethCall Effect (mockable
 * via LIQUITY_V1_CALL_MOCK). The subgraph does NOT use try_ for these, so a
 * revert there would throw; we fall back to "" only when the call returns null
 * (mock revert / RPC failure) to keep handlers from crashing offline.
 */
import type { EvmOnEventContext as handlerContext, EffectCaller, Token } from "envio";

import { BIGINT_ZERO } from "../utils/bignumbers";
import { a } from "../utils/constants";
import { erc20Name, erc20Symbol } from "../effects/calls";

async function createToken(
  context: handlerContext,
  address: string,
  name: string,
  symbol: string,
): Promise<Token> {
  const id = a(address);
  const token: Token = {
    id,
    name,
    symbol,
    totalSupply: BIGINT_ZERO,
  };
  context.Token.set(token);
  return token;
}

export async function getToken(
  context: handlerContext,
  effectCall: EffectCaller,
  _token: string,
): Promise<Token> {
  const id = a(_token);
  const tokenOrNull = await context.Token.get(id);

  if (tokenOrNull != null) {
    return tokenOrNull;
  } else {
    const name = (await erc20Name(effectCall, _token)) ?? "";
    const symbol = (await erc20Symbol(effectCall, _token)) ?? "";
    return createToken(context, _token, name, symbol);
  }
}
