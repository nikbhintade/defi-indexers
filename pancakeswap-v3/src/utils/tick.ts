/**
 * Port of template/utils/tick.ts (createTick, feeTierToTickSpacing).
 */
import { BigDecimal, type Tick } from "envio";
import { bigDecimalExponated, safeDiv } from "./index";
import { ONE_BD, ZERO_BD, ZERO_BI } from "./constants";

export function createTick(
  tickId: string,
  tickIdx: bigint,
  poolId: string,
  blockTimestamp: bigint,
  blockNumber: bigint,
): Tick {
  // 1.0001^tick is token1/token0.
  const price0 = bigDecimalExponated(new BigDecimal("1.0001"), tickIdx);
  const tick: Tick = {
    id: tickId,
    tickIdx: tickIdx,
    pool_id: poolId,
    poolAddress: poolId,
    createdAtTimestamp: blockTimestamp,
    createdAtBlockNumber: blockNumber,
    liquidityGross: ZERO_BI,
    liquidityNet: ZERO_BI,
    price0,
    price1: safeDiv(ONE_BD, price0),
    volumeToken0: ZERO_BD,
    volumeToken1: ZERO_BD,
    volumeUSD: ZERO_BD,
    feesUSD: ZERO_BD,
    untrackedVolumeUSD: ZERO_BD,
    collectedFeesToken0: ZERO_BD,
    collectedFeesToken1: ZERO_BD,
    collectedFeesUSD: ZERO_BD,
    liquidityProviderCount: ZERO_BI,
    feeGrowthOutside0X128: ZERO_BI,
    feeGrowthOutside1X128: ZERO_BI,
  } satisfies Tick;
  return tick;
}

export function feeTierToTickSpacing(feeTier: bigint): bigint {
  if (feeTier === 10000n) return 200n;
  if (feeTier === 2500n) return 50n;
  if (feeTier === 500n) return 10n;
  if (feeTier === 100n) return 1n;
  throw new Error("Unexpected fee tier");
}
