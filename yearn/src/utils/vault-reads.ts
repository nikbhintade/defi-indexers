/** Ported from vault.getTotalAssets / getBalancePosition (kept separate to avoid cycles). */
import type { Env } from "./types";
import { BIGINT_ZERO } from "./constants";
import { vaultDecimals, vaultPricePerShare, vaultTotalAssets } from "../effects/contracts";

/** vault.getTotalAssets: try_totalAssets, 0 on revert. State read -> pinned. */
export async function getTotalAssets(env: Env, vaultAddress: string): Promise<bigint> {
  const result = await vaultTotalAssets(env.ec, vaultAddress, env.block);
  return result === null ? BIGINT_ZERO : result;
}

/**
 * vault.getBalancePosition:
 *   totalAssets * pricePerShare / 10**decimals
 * try_totalAssets & try_pricePerShare default to 0 on revert; decimals() is a
 * hard call (defaults to 18 here if it reverts — see MIGRATION.md).
 */
export async function getBalancePosition(env: Env, vaultAddress: string): Promise<bigint> {
  const taRaw = await vaultTotalAssets(env.ec, vaultAddress, env.block);
  const totalAssets = taRaw === null ? BIGINT_ZERO : taRaw;
  const ppsRaw = await vaultPricePerShare(env.ec, vaultAddress, env.block);
  const pricePerShare = ppsRaw === null ? BIGINT_ZERO : ppsRaw;
  const decRaw = await vaultDecimals(env.ec, vaultAddress);
  const decimals = decRaw === null ? 18n : BigInt(decRaw);
  return (totalAssets * pricePerShare) / 10n ** decimals;
}
