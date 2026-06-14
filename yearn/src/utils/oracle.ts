/**
 * Ported from src/utils/oracle/usdc-oracle.ts (mainnet path only).
 *
 * The subgraph tries, in order: yearn-lens Oracle.getNormalizedValueUsdc ->
 * PPS oracle -> SushiSwap calculations -> Curve calculations, returning the
 * first non-zero result (else 0).
 *
 * DEVIATION (documented in MIGRATION.md): only the yearn-lens Oracle path is
 * ported. The PPS / SushiSwap / Curve fallbacks depend on several extra
 * Calculations* contracts and yShare-token introspection; on mainnet the
 * yearn-lens Oracle covers the vault want-tokens, and before the oracle was
 * deployed (block 12198044) the subgraph returns 0 anyway. The fallbacks
 * resolve to 0 here, matching the subgraph whenever the oracle reverts.
 *
 * usdcPrice() is also block-pinned: the subgraph read live oracle state.
 */
import type { Env } from "./types";
import type { Token } from "envio";
import { BIGINT_ZERO, ETH_MAINNET_USDC_ORACLE_ADDRESS } from "./constants";
import { oracleGetNormalizedValueUsdc, oracleGetPriceUsdcRecommended } from "../effects/contracts";

/** usdcPrice(token, tokenAmount): value of `tokenAmount` of `token` in USDC. */
export async function usdcPrice(env: Env, token: Token, tokenAmount: bigint): Promise<bigint> {
  const fromOracle = await oracleGetNormalizedValueUsdc(
    env.ec,
    ETH_MAINNET_USDC_ORACLE_ADDRESS,
    token.id,
    tokenAmount,
    env.block,
  );
  if (fromOracle !== null && fromOracle !== BIGINT_ZERO) {
    return fromOracle;
  }
  // PPS / SushiSwap / Curve fallbacks resolve to 0 (see header).
  return BIGINT_ZERO;
}

/** usdcPricePerToken(tokenAddress): price of one token in USDC (recommended). */
export async function usdcPricePerToken(env: Env, tokenAddress: string): Promise<bigint> {
  const result = await oracleGetPriceUsdcRecommended(
    env.ec,
    ETH_MAINNET_USDC_ORACLE_ADDRESS,
    tokenAddress,
    env.block,
  );
  return result === null ? BIGINT_ZERO : result;
}
