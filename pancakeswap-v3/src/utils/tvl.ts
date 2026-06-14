/**
 * Port of template/utils/tvl.ts (updateDerivedTVLAmounts).
 *
 * The subgraph mutates token0/token1/pool/factory in place and saves all four.
 * In envio, entities are immutable objects: this function returns the updated
 * copies AND writes them to the store (matching the original's `.save()`
 * calls). Callers should use the returned objects for subsequent reads in the
 * same handler.
 */
import { type BigDecimal, type Bundle, type EvmOnEventContext, type Factory, type Pool, type Token } from "envio";
import { type AmountType, getAdjustedAmounts } from "./pricing";

export function updateDerivedTVLAmounts(
  context: EvmOnEventContext,
  bundle: Bundle,
  pool: Pool,
  factory: Factory,
  token0: Token,
  token1: Token,
  oldPoolTotalValueLockedETH: BigDecimal,
  oldPoolTotalValueLockedETHUntracked: BigDecimal,
): { pool: Pool; factory: Factory; token0: Token; token1: Token } {
  // Update token TVL values.
  let t0 = {
    ...token0,
    totalValueLockedUSD: token0.totalValueLocked.times(token0.derivedETH.times(bundle.ethPriceUSD)),
  };
  let t1 = {
    ...token1,
    totalValueLockedUSD: token1.totalValueLocked.times(token1.derivedETH.times(bundle.ethPriceUSD)),
  };

  const amounts: AmountType = getAdjustedAmounts(
    bundle,
    pool.totalValueLockedToken0,
    t0,
    pool.totalValueLockedToken1,
    t1,
  );

  let p = {
    ...pool,
    totalValueLockedETH: amounts.eth,
    totalValueLockedUSD: amounts.usd,
    totalValueLockedETHUntracked: amounts.ethUntracked,
    totalValueLockedUSDUntracked: amounts.usdUntracked,
  };

  // Reset factory values before updating with new amounts.
  let f = { ...factory };
  f = {
    ...f,
    totalValueLockedETH: f.totalValueLockedETH.minus(oldPoolTotalValueLockedETH),
    totalValueLockedETHUntracked: f.totalValueLockedETHUntracked.minus(oldPoolTotalValueLockedETHUntracked),
  };
  f = {
    ...f,
    totalValueLockedETH: f.totalValueLockedETH.plus(amounts.eth),
    totalValueLockedETHUntracked: f.totalValueLockedETHUntracked.plus(amounts.ethUntracked),
  };
  f = {
    ...f,
    totalValueLockedUSD: f.totalValueLockedETH.times(bundle.ethPriceUSD),
    totalValueLockedUSDUntracked: f.totalValueLockedETHUntracked.times(bundle.ethPriceUSD),
  };

  context.Token.set(t0);
  context.Token.set(t1);
  context.Factory.set(f);
  context.Pool.set(p);

  return { pool: p, factory: f, token0: t0, token1: t1 };
}
