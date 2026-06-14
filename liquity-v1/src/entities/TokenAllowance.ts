/**
 * Ported from liquity/dev packages/subgraph/src/entities/TokenAllowance.ts.
 * TokenAllowance id = `${token}-${owner}-${spender}` (lowercase hex).
 */
import type { EvmOnEventContext as handlerContext, TokenAllowance } from "envio";

import { BIGINT_ZERO } from "../utils/bignumbers";
import { a } from "../utils/constants";

import { getUser } from "./User";

async function getTokenAllowance(
  context: handlerContext,
  _token: string,
  _owner: string,
  _spender: string,
): Promise<TokenAllowance> {
  const id = a(_token) + "-" + a(_owner) + "-" + a(_spender);
  const owner = await getUser(context, _owner);
  const spender = await getUser(context, _spender);
  const allowanceOrNull = await context.TokenAllowance.get(id);

  if (allowanceOrNull != null) {
    return allowanceOrNull;
  } else {
    const newAllowance: TokenAllowance = {
      id,
      token_id: a(_token),
      owner_id: owner.id,
      spender_id: spender.id,
      value: BIGINT_ZERO,
    };
    context.TokenAllowance.set(newAllowance);
    return newAllowance;
  }
}

export async function updateAllowance(
  context: handlerContext,
  tokenAddress: string,
  _owner: string,
  _spender: string,
  _value: bigint,
): Promise<void> {
  const tokenAllowance = await getTokenAllowance(context, tokenAddress, _owner, _spender);
  context.TokenAllowance.set({ ...tokenAllowance, value: _value });
}
