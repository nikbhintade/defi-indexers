/**
 * Ported from src/maths/{maths,shares}.ts — Morpho Blue shares<->assets math.
 * Exact integer rounding (mulDivUp / mulDivDown) preserved.
 */
import { BIGINT_ONE } from "../sdk/constants";

const VIRTUAL_SHARES = 10n ** 6n;
const VIRTUAL_ASSETS = 1n;

export function mulDivUp(x: bigint, y: bigint, z: bigint): bigint {
  return (x * y + (z - BIGINT_ONE)) / z;
}

export function mulDivDown(x: bigint, y: bigint, z: bigint): bigint {
  return (x * y) / z;
}

export function toAssetsUp(
  shares: bigint,
  totalShares: bigint,
  totalAssets: bigint,
): bigint {
  return mulDivUp(
    shares,
    totalAssets + VIRTUAL_ASSETS,
    totalShares + VIRTUAL_SHARES,
  );
}

export function toAssetsDown(
  shares: bigint,
  totalShares: bigint,
  totalAssets: bigint,
): bigint {
  return mulDivDown(
    shares,
    totalAssets + VIRTUAL_ASSETS,
    totalShares + VIRTUAL_SHARES,
  );
}
