/** Port of src/services/platform.ts */
import type { EvmOnEventContext, Platform } from "envio";
import { BIG_DECIMAL_ZERO, CONVEX_PLATFORM_ID } from "../constants";

export async function getPlatform(context: EvmOnEventContext): Promise<Platform> {
  let platform = await context.Platform.get(CONVEX_PLATFORM_ID);
  if (!platform) {
    platform = {
      id: CONVEX_PLATFORM_ID,
      bribeFee: 400n,
      poolCount: 0n,
      totalCrvRevenueToLpProviders: BIG_DECIMAL_ZERO,
      totalCvxRevenueToLpProviders: BIG_DECIMAL_ZERO,
      totalFxsRevenueToLpProviders: BIG_DECIMAL_ZERO,
      totalCrvRevenueToCvxCrvStakers: BIG_DECIMAL_ZERO,
      totalCvxRevenueToCvxCrvStakers: BIG_DECIMAL_ZERO,
      totalThreeCrvRevenueToCvxCrvStakers: BIG_DECIMAL_ZERO,
      totalFxsRevenueToCvxFxsStakers: BIG_DECIMAL_ZERO,
      totalCrvRevenueToCvxStakers: BIG_DECIMAL_ZERO,
      totalFxsRevenueToCvxStakers: BIG_DECIMAL_ZERO,
      totalCrvRevenueToCallers: BIG_DECIMAL_ZERO,
      totalFxsRevenueToCallers: BIG_DECIMAL_ZERO,
      totalCrvRevenueToPlatform: BIG_DECIMAL_ZERO,
      totalFxsRevenueToPlatform: BIG_DECIMAL_ZERO,
      totalCrvRevenue: BIG_DECIMAL_ZERO,
      totalFxsRevenue: BIG_DECIMAL_ZERO,
      totalBribeRevenue: BIG_DECIMAL_ZERO,
      totalOtherRevenue: BIG_DECIMAL_ZERO,
    };
    // NOTE: original does NOT save here (it's saved by callers). We don't set
    // either; callers persist via context.Platform.set after mutating.
  }
  return platform;
}
