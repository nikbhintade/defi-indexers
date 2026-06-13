/**
 * Ported from src/utils/metaMorphoUtils.ts — MetaMorpho (ERC4626) shares->assets
 * with the underlying-decimals share offset. Preserves graph-node integer math.
 */
export function toMetaMorphoAssetsUp(
  shares: bigint,
  totalShares: bigint,
  totalAssets: bigint,
  underlyingDecimals: number,
): bigint {
  const sharesOffset = underlyingDecimals > 18 ? 0 : 18 - underlyingDecimals;
  return (
    (shares * (totalAssets + 1n)) / (totalShares + 10n ** BigInt(sharesOffset))
  );
}

export function getLiquidationIncentiveFactor(lltv: bigint): bigint {
  const WAD = 10n ** 18n;
  const MAX_LIQUIDATION_INCENTIVE_FACTOR = 1150000000000000000n; // 1.15
  const LIQUIDATION_CURSOR = 300000000000000000n; // 0.3
  const mulDivDown = (x: bigint, y: bigint, z: bigint): bigint => (x * y) / z;
  const val = mulDivDown(
    WAD,
    WAD,
    WAD - mulDivDown(LIQUIDATION_CURSOR, WAD - lltv, WAD),
  );
  if (val > MAX_LIQUIDATION_INCENTIVE_FACTOR) {
    return MAX_LIQUIDATION_INCENTIVE_FACTOR;
  }
  return val;
}
