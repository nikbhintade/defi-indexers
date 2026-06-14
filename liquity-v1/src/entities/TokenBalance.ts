/**
 * Ported from liquity/dev packages/subgraph/src/entities/TokenBalance.ts.
 * TokenBalance id = `${token}-${owner}` (lowercase hex).
 */
import type { EvmOnEventContext as handlerContext, EffectCaller, TokenBalance } from "envio";

import { BIGINT_ZERO } from "../utils/bignumbers";
import { ZERO_ADDRESS, a } from "../utils/constants";

import { getUser } from "./User";
import { getToken } from "./Token";

async function getTokenBalance(
  context: handlerContext,
  effectCall: EffectCaller,
  _token: string,
  _owner: string,
): Promise<TokenBalance> {
  const id = a(_token) + "-" + a(_owner);
  const user = await getUser(context, _owner);
  const balanceOrNull = await context.TokenBalance.get(id);

  if (balanceOrNull != null) {
    return balanceOrNull;
  } else {
    const newBalance: TokenBalance = {
      id,
      token_id: a(_token),
      owner_id: user.id,
      balance: BIGINT_ZERO,
    };
    context.TokenBalance.set(newBalance);
    return newBalance;
  }
}

export async function updateBalance(
  context: handlerContext,
  effectCall: EffectCaller,
  tokenAddress: string,
  _from: string,
  _to: string,
  _value: bigint,
): Promise<void> {
  let token = await getToken(context, effectCall, tokenAddress);

  if (a(_from) === ZERO_ADDRESS) {
    // mint: increase total supply
    token = { ...token, totalSupply: token.totalSupply + _value };
    context.Token.set(token);
  } else {
    // decrease from balance
    const tokenBalanceFrom = await getTokenBalance(context, effectCall, tokenAddress, _from);
    context.TokenBalance.set({ ...tokenBalanceFrom, balance: tokenBalanceFrom.balance - _value });
  }
  if (a(_to) === ZERO_ADDRESS) {
    // burn: decrease total supply
    // NB: re-read token in case mint branch above already mutated totalSupply.
    const t = (await context.Token.get(a(tokenAddress)))!;
    context.Token.set({ ...t, totalSupply: t.totalSupply - _value });
  } else {
    // increase to balance
    const tokenBalanceTo = await getTokenBalance(context, effectCall, tokenAddress, _to);
    context.TokenBalance.set({ ...tokenBalanceTo, balance: tokenBalanceTo.balance + _value });
  }
}
