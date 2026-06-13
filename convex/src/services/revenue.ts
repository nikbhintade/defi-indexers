/**
 * Port of src/services/revenue.ts.
 *
 * `getDailyRevenueSnapshot` creates the entity if missing (the original saved
 * it immediately). We `context.DailyRevenueSnapshot.set` on creation, but
 * callers persist their mutations explicitly.
 */
import { BigDecimal, type DailyRevenueSnapshot, type EffectCaller, type EvmOnEventContext } from "envio";
import {
  BIG_DECIMAL_1E18,
  BIG_DECIMAL_ONE,
  BIG_INT_ZERO,
  BOOSTER_ADDRESS,
  CONVEX_PLATFORM_ID,
  CRV_ADDRESS,
  CVX_ADDRESS,
  DENOMINATOR,
  LOCK_FEES_ADDRESS,
} from "../constants";
import { getIntervalFromTimestamp, DAY, toBigDecimal } from "../utils";
import { getCvxMintAmount, getUsdRate } from "./pricing";
import { getPlatform } from "./platform";
import {
  boosterEarmarkIncentive,
  boosterLockIncentive,
  boosterPlatformFee,
  boosterStakerIncentive,
  rewardPoolHistoricalRewards,
} from "../effects/contracts";

type EC = EffectCaller | null;

export async function getDailyRevenueSnapshot(context: EvmOnEventContext, day: bigint): Promise<DailyRevenueSnapshot> {
  let revenueSnapshot = await context.DailyRevenueSnapshot.get(day.toString());
  if (!revenueSnapshot) {
    revenueSnapshot = {
      id: day.toString(),
      platform_id: CONVEX_PLATFORM_ID,
      crvRevenueToLpProvidersAmount: new BigDecimal("0"),
      cvxRevenueToLpProvidersAmount: new BigDecimal("0"),
      crvRevenueToCvxCrvStakersAmount: new BigDecimal("0"),
      cvxRevenueToCvxCrvStakersAmount: new BigDecimal("0"),
      threeCrvRevenueToCvxCrvStakersAmount: new BigDecimal("0"),
      crvRevenueToCvxStakersAmount: new BigDecimal("0"),
      crvRevenueToCallersAmount: new BigDecimal("0"),
      crvRevenueToPlatformAmount: new BigDecimal("0"),
      totalCrvRevenue: new BigDecimal("0"),
      fxsRevenueToCvxStakersAmount: new BigDecimal("0"),
      fxsRevenueToCvxFxsStakersAmount: new BigDecimal("0"),
      fxsRevenueToLpProvidersAmount: new BigDecimal("0"),
      fxsRevenueToCallersAmount: new BigDecimal("0"),
      fxsRevenueToPlatformAmount: new BigDecimal("0"),
      totalFxsRevenue: new BigDecimal("0"),
      otherRevenue: new BigDecimal("0"),
      crvPrice: new BigDecimal("0"),
      cvxPrice: new BigDecimal("0"),
      fxsPrice: new BigDecimal("0"),
      bribeRevenue: new BigDecimal("0"),
      timestamp: 0n,
    };
    context.DailyRevenueSnapshot.set(revenueSnapshot);
  }
  return revenueSnapshot;
}

export async function getHistoricalRewards(context: EvmOnEventContext, ec: EC, contract: string, block: number): Promise<bigint> {
  const histRewardResults = await rewardPoolHistoricalRewards(ec, contract, block);
  const histRewards = histRewardResults === null ? BIG_INT_ZERO : histRewardResults;
  if (histRewardResults === null) {
    context.log.warn(`Failed to get historical rewards for ${contract}`);
  }
  return histRewards;
}

export async function updateDailyRevenueSnapshotForCrv(
  context: EvmOnEventContext,
  ec: EC,
  block: number,
  amount: bigint,
  timestamp: bigint,
): Promise<void> {
  const day = getIntervalFromTimestamp(timestamp, DAY);
  let dayRevenue = await getDailyRevenueSnapshot(context, day);
  const decimalDenominator = toBigDecimal(DENOMINATOR);
  const currentCrvPrice = await getUsdRate(ec, block, CRV_ADDRESS);
  const currentCvxPrice = await getUsdRate(ec, block, CVX_ADDRESS);
  let platform = await getPlatform(context);

  const lockIncentiveRaw = await boosterLockIncentive(ec, BOOSTER_ADDRESS, block);
  const callIncentiveRaw = await boosterEarmarkIncentive(ec, BOOSTER_ADDRESS, block);
  const stakerIncentiveRaw = await boosterStakerIncentive(ec, BOOSTER_ADDRESS, block);
  const platformFeeRaw = await boosterPlatformFee(ec, BOOSTER_ADDRESS, block);
  // original used non-try calls (would crash on revert); default to 0 here.
  const lockIncentive = toBigDecimal(lockIncentiveRaw ?? 0n).div(decimalDenominator);
  const callIncentive = toBigDecimal(callIncentiveRaw ?? 0n).div(decimalDenominator);
  const stakerIncentive = toBigDecimal(stakerIncentiveRaw ?? 0n).div(decimalDenominator);
  const platformFee = toBigDecimal(platformFeeRaw ?? 0n).div(decimalDenominator);
  const totalFees = lockIncentive.plus(callIncentive).plus(stakerIncentive).plus(platformFee);
  const lpShare = BIG_DECIMAL_ONE.minus(totalFees);

  // total rev = rev distributed to the pool / (1 - total fees applied)
  const dailyCrvTotalRevenue = toBigDecimal(amount).div(lpShare).div(BIG_DECIMAL_1E18).times(currentCrvPrice);
  // amount of CVX that could be minted from the CRV amount
  const dailyCvxMinted = (await getCvxMintAmount(ec, block, toBigDecimal(amount).div(lpShare).div(BIG_DECIMAL_1E18))).times(
    currentCvxPrice,
  );

  const crvRevenueToCvxStakersAmount = dailyCrvTotalRevenue.times(stakerIncentive);
  const crvRevenueToCvxCrvStakersAmount = dailyCrvTotalRevenue.times(lockIncentive);
  const cvxRevenueToCvxCrvStakersAmount = dailyCvxMinted.times(lockIncentive);
  const crvRevenueToCallersAmount = dailyCrvTotalRevenue.times(callIncentive);
  const crvRevenueToPlatformAmount = dailyCrvTotalRevenue.times(platformFee);
  const crvRevenueToLpProvidersAmount = toBigDecimal(amount).div(BIG_DECIMAL_1E18).times(currentCrvPrice);
  const cvxRevenueToLpProvidersAmount = dailyCvxMinted.times(lpShare);

  dayRevenue = {
    ...dayRevenue,
    totalCrvRevenue: dayRevenue.totalCrvRevenue.plus(dailyCrvTotalRevenue),
    crvRevenueToCvxStakersAmount: dayRevenue.crvRevenueToCvxStakersAmount.plus(crvRevenueToCvxStakersAmount),
    crvRevenueToCvxCrvStakersAmount: dayRevenue.crvRevenueToCvxCrvStakersAmount.plus(crvRevenueToCvxCrvStakersAmount),
    cvxRevenueToCvxCrvStakersAmount: dayRevenue.cvxRevenueToCvxCrvStakersAmount.plus(cvxRevenueToCvxCrvStakersAmount),
    crvRevenueToCallersAmount: dayRevenue.crvRevenueToCallersAmount.plus(crvRevenueToCallersAmount),
    crvRevenueToPlatformAmount: dayRevenue.crvRevenueToPlatformAmount.plus(crvRevenueToPlatformAmount),
    crvRevenueToLpProvidersAmount: dayRevenue.crvRevenueToLpProvidersAmount.plus(crvRevenueToLpProvidersAmount),
    cvxRevenueToLpProvidersAmount: dayRevenue.cvxRevenueToLpProvidersAmount.plus(cvxRevenueToLpProvidersAmount),
    timestamp,
    crvPrice: currentCrvPrice,
    cvxPrice: currentCvxPrice,
  };

  platform = {
    ...platform,
    totalCrvRevenue: platform.totalCrvRevenue.plus(dailyCrvTotalRevenue),
    totalCrvRevenueToCvxCrvStakers: platform.totalCrvRevenueToCvxCrvStakers.plus(crvRevenueToCvxCrvStakersAmount),
    totalCvxRevenueToCvxCrvStakers: platform.totalCvxRevenueToCvxCrvStakers.plus(cvxRevenueToCvxCrvStakersAmount),
    totalCrvRevenueToCvxStakers: platform.totalCrvRevenueToCvxStakers.plus(crvRevenueToCvxStakersAmount),
    totalCrvRevenueToCallers: platform.totalCrvRevenueToCallers.plus(crvRevenueToCallersAmount),
    totalCrvRevenueToPlatform: platform.totalCrvRevenueToPlatform.plus(crvRevenueToPlatformAmount),
    totalCrvRevenueToLpProviders: platform.totalCrvRevenueToLpProviders.plus(crvRevenueToLpProvidersAmount),
    totalCvxRevenueToLpProviders: platform.totalCvxRevenueToLpProviders.plus(cvxRevenueToLpProvidersAmount),
  };

  context.Platform.set(platform);
  context.DailyRevenueSnapshot.set(dayRevenue);
}

export async function recordFeeRevenue(context: EvmOnEventContext, ec: EC, block: number, timestamp: bigint): Promise<void> {
  context.FeeRevenue.set({
    id: timestamp.toString(),
    platform_id: CONVEX_PLATFORM_ID,
    amount: await getHistoricalRewards(context, ec, LOCK_FEES_ADDRESS, block),
    timestamp,
  });
}
