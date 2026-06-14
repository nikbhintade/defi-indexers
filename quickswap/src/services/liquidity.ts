/**
 * Port of createUser / createLiquidityPosition / createLiquiditySnapshot from
 * mappings/helpers.ts. Used by handleTransfer to track LP balances and
 * per-transfer snapshots.
 */
import { BigDecimal, type EvmOnEventContext, type LiquidityPosition } from "envio";
import { ONE_BI, ZERO_BD } from "../utils";

export async function createUser(context: EvmOnEventContext, address: string): Promise<void> {
  const user = await context.User.get(address);
  if (user === undefined) {
    context.User.set({ id: address, usdSwapped: ZERO_BD });
  }
}

/**
 * Loads or creates the LiquidityPosition for (pair, user). On creation it
 * increments the pair's liquidityProviderCount, exactly like the original.
 * `exchange` is the lowercased pair address, `user` the lowercased account.
 */
export async function createLiquidityPosition(
  context: EvmOnEventContext,
  exchange: string,
  user: string,
): Promise<LiquidityPosition> {
  const id = exchange.concat("-").concat(user);
  let position = await context.LiquidityPosition.get(id);
  if (position === undefined) {
    const pair = await context.Pair.getOrThrow(exchange);
    context.Pair.set({ ...pair, liquidityProviderCount: pair.liquidityProviderCount + ONE_BI });
    position = {
      id,
      liquidityTokenBalance: ZERO_BD,
      pair_id: exchange,
      user_id: user,
    };
    context.LiquidityPosition.set(position);
  }
  return position;
}

/**
 * Creates a LiquidityPositionSnapshot. id = position.id + timestamp (no dash),
 * matching the original `position.id.concat(timestamp.toString())`.
 */
export async function createLiquiditySnapshot(
  context: EvmOnEventContext,
  position: LiquidityPosition,
  block: number,
  timestamp: number,
): Promise<void> {
  const bundle = await context.Bundle.getOrThrow("1");
  const pair = await context.Pair.getOrThrow(position.pair_id);
  const token0 = await context.Token.getOrThrow(pair.token0_id);
  const token1 = await context.Token.getOrThrow(pair.token1_id);

  context.LiquidityPositionSnapshot.set({
    id: position.id.concat(timestamp.toString()),
    timestamp: timestamp,
    block: block,
    user_id: position.user_id,
    pair_id: position.pair_id,
    token0PriceUSD: (token0.derivedETH as BigDecimal).times(bundle.ethPrice),
    token1PriceUSD: (token1.derivedETH as BigDecimal).times(bundle.ethPrice),
    reserve0: pair.reserve0,
    reserve1: pair.reserve1,
    reserveUSD: pair.reserveUSD,
    liquidityTokenTotalSupply: pair.totalSupply,
    liquidityTokenBalance: position.liquidityTokenBalance,
    liquidityPosition_id: position.id,
  });
}
