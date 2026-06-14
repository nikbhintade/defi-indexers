import type {
  GlpGmMigrationStat,
  IncentivesStat,
  LiquidityProviderIncentivesStat,
  LiquidityProviderInfo,
  UserGlpGmMigrationStat,
} from "envio";
import type { handlerContext } from "../../types";
import type { EventData } from "../../utils/eventData";
import { periodToSeconds, timestampToPeriodStart } from "../../utils/time";
import { getMarketInfo } from "../markets";
import { convertAmountToUsd, convertUsdToAmount } from "../prices";
import { ZERO } from "../../utils/number";

const SECONDS_IN_WEEK = periodToSeconds("1w");
const ARB_PRECISION = 10n ** 18n;

const INCENTIVES_START_TIMESTAMP = 1699401600; // 2023-11-08 00:00:00

const GLP_GM_MIGRATION_DECREASE_THRESHOLD_IN_ARB = 100_000_000n * ARB_PRECISION; // 100m ARB
const GLP_GM_MIGRATION_CAP_THRESHOLD_IN_ARB = 200_000_000n * ARB_PRECISION; // 200m ARB

const MAX_FEE_BASIS_POINTS_FOR_REBATE = 25n;
const MAX_FEE_BASIS_POINTS_FOR_REBATE_REDUCED = 10n;

const ARB_TOKEN_ADDRESS = "0x912ce59144191c1204e64559fe8253a0e49e6548";

function incentivesActive(timestamp: number): boolean {
  return timestamp > INCENTIVES_START_TIMESTAMP;
}

export async function saveLiquidityProviderInfo(
  context: handlerContext,
  account: string,
  glvOrMarketAddress: string,
  type: string,
  tokensDelta: bigint,
): Promise<void> {
  const entity = await getLiquidityProviderInfo(context, account, glvOrMarketAddress, type);
  context.LiquidityProviderInfo.set({ ...entity, tokensBalance: entity.tokensBalance + tokensDelta });
}

export async function saveLiquidityProviderIncentivesStat(
  context: handlerContext,
  account: string,
  glvOrMarketAddress: string,
  type: string,
  period: string,
  marketTokenBalanceDelta: bigint,
  timestamp: number,
): Promise<void> {
  if (!incentivesActive(timestamp)) return;

  let entity = await getOrCreateLiquidityProviderIncentivesStat(
    context,
    account,
    glvOrMarketAddress,
    type,
    period,
    timestamp,
  );

  if (entity.updatedTimestamp === 0) {
    // new entity was created
    const liquidityProviderInfo = await getLiquidityProviderInfo(context, account, glvOrMarketAddress, type);
    const timeInSeconds = BigInt(timestamp - entity.timestamp);
    entity = {
      ...entity,
      cumulativeTimeByTokensBalance: liquidityProviderInfo.tokensBalance * timeInSeconds,
      lastTokensBalance: liquidityProviderInfo.tokensBalance + marketTokenBalanceDelta,
    };
  } else {
    const timeInSeconds = BigInt(timestamp - entity.updatedTimestamp);
    entity = {
      ...entity,
      cumulativeTimeByTokensBalance: entity.cumulativeTimeByTokensBalance + entity.lastTokensBalance * timeInSeconds,
      lastTokensBalance: entity.lastTokensBalance + marketTokenBalanceDelta,
    };
  }

  const endTimestamp = entity.timestamp + SECONDS_IN_WEEK;
  const extrapolatedTimeByMarketTokensBalance = entity.lastTokensBalance * BigInt(endTimestamp - timestamp);
  entity = {
    ...entity,
    weightedAverageTokensBalance:
      (entity.cumulativeTimeByTokensBalance + extrapolatedTimeByMarketTokensBalance) / BigInt(SECONDS_IN_WEEK),
    updatedTimestamp: timestamp,
  };
  context.LiquidityProviderIncentivesStat.set(entity);
}

export async function saveMarketIncentivesStat(
  context: handlerContext,
  eventData: EventData,
  blockTimestamp: number,
): Promise<void> {
  if (!incentivesActive(blockTimestamp)) return;

  const marketAddress = eventData.getAddressItemString("market")!;
  const marketTokensSupply = eventData.getUintItem("marketTokensSupply")!;

  let entity = await getOrCreateIncentivesStat(context, marketAddress, "Market", blockTimestamp);

  if (entity.updatedTimestamp === 0) {
    const marketInfo = await getMarketInfo(context, marketAddress);
    const lastTokensSupply =
      marketInfo.marketTokensSupplyFromPoolUpdated == null
        ? marketInfo.marketTokensSupply
        : marketInfo.marketTokensSupplyFromPoolUpdated;
    const timeInSeconds = BigInt(blockTimestamp - entity.timestamp);
    entity = { ...entity, cumulativeTimeByTokensSupply: lastTokensSupply * timeInSeconds };
  } else {
    const timeInSeconds = BigInt(blockTimestamp - entity.updatedTimestamp);
    entity = {
      ...entity,
      cumulativeTimeByTokensSupply: entity.cumulativeTimeByTokensSupply + entity.lastTokensSupply * timeInSeconds,
    };
  }

  entity = { ...entity, lastTokensSupply: marketTokensSupply, updatedTimestamp: blockTimestamp };

  const endTimestamp = entity.timestamp + SECONDS_IN_WEEK;
  const extrapolatedTimeByMarketTokensSupply = entity.lastTokensSupply * BigInt(endTimestamp - blockTimestamp);
  entity = {
    ...entity,
    weightedAverageTokensSupply:
      (entity.cumulativeTimeByTokensSupply + extrapolatedTimeByMarketTokensSupply) / BigInt(SECONDS_IN_WEEK),
  };
  context.IncentivesStat.set(entity);
}

class EligibleRedemptionDiffResult {
  constructor(public usd: bigint, public inArb: bigint) {}
}

async function getMaxFeeBasisPointsForRebate(context: handlerContext, eligibleDiffInArb: bigint): Promise<bigint> {
  const globalEntity = await getOrCreateGlpGmMigrationStat(context);
  const eligibleRedemptionInArb = globalEntity.eligibleRedemptionInArb;

  const nextEligibleRedemptionInArb = eligibleRedemptionInArb + eligibleDiffInArb;
  if (!(eligibleRedemptionInArb > GLP_GM_MIGRATION_DECREASE_THRESHOLD_IN_ARB)) {
    if (!(nextEligibleRedemptionInArb > GLP_GM_MIGRATION_DECREASE_THRESHOLD_IN_ARB)) {
      return MAX_FEE_BASIS_POINTS_FOR_REBATE;
    }
    return (
      ((GLP_GM_MIGRATION_DECREASE_THRESHOLD_IN_ARB - eligibleRedemptionInArb) * MAX_FEE_BASIS_POINTS_FOR_REBATE +
        (nextEligibleRedemptionInArb - GLP_GM_MIGRATION_DECREASE_THRESHOLD_IN_ARB) *
          MAX_FEE_BASIS_POINTS_FOR_REBATE_REDUCED) /
      eligibleDiffInArb
    );
  }
  return MAX_FEE_BASIS_POINTS_FOR_REBATE_REDUCED;
}

export async function saveUserGlpGmMigrationStatGlpData(
  context: handlerContext,
  account: string,
  timestamp: number,
  usdgAmount: bigint,
  feeBasisPoints: bigint,
): Promise<void> {
  if (!incentivesActive(timestamp)) return;

  let entity = await getOrCreateUserGlpGmMigrationStatGlpData(context, account, timestamp);
  const usdAmount = usdgAmount * 10n ** 12n;
  const eligibleDiff = await getCappedEligibleRedemptionDiff(
    context,
    entity.glpRedemptionUsd,
    entity.glpRedemptionUsd + usdAmount,
    entity.gmDepositUsd,
  );

  const maxFeeBasisPointsForRebate = await getMaxFeeBasisPointsForRebate(context, eligibleDiff.inArb);
  let fbp = feeBasisPoints;
  if (fbp > maxFeeBasisPointsForRebate) {
    fbp = maxFeeBasisPointsForRebate;
  }

  const glpRedemptionUsd = entity.glpRedemptionUsd + usdAmount;
  const glpRedemptionFeeBpsByUsd = entity.glpRedemptionFeeBpsByUsd + usdAmount * fbp;
  entity = {
    ...entity,
    glpRedemptionUsd,
    glpRedemptionFeeBpsByUsd,
    glpRedemptionWeightedAverageFeeBps: Number(glpRedemptionFeeBpsByUsd / glpRedemptionUsd),
  };

  if (eligibleDiff.inArb > ZERO) {
    entity = {
      ...entity,
      eligibleRedemptionInArb: entity.eligibleRedemptionInArb + eligibleDiff.inArb,
      eligibleRedemptionUsd: entity.eligibleRedemptionUsd + eligibleDiff.usd,
      eligibleUpdatedTimestamp: timestamp,
    };
  }
  context.UserGlpGmMigrationStat.set(entity);

  await saveGlpGmMigrationStat(context, eligibleDiff);
}

export async function saveUserGlpGmMigrationStatGmData(
  context: handlerContext,
  account: string,
  timestamp: number,
  depositUsd: bigint,
): Promise<void> {
  if (!incentivesActive(timestamp)) return;

  let entity = await getOrCreateUserGlpGmMigrationStatGlpData(context, account, timestamp);
  const eligibleDiff = await getCappedEligibleRedemptionDiff(
    context,
    entity.gmDepositUsd,
    entity.gmDepositUsd + depositUsd,
    entity.glpRedemptionUsd,
  );

  entity = { ...entity, gmDepositUsd: entity.gmDepositUsd + depositUsd };
  if (eligibleDiff.inArb > ZERO) {
    entity = {
      ...entity,
      eligibleRedemptionInArb: entity.eligibleRedemptionInArb + eligibleDiff.inArb,
      eligibleRedemptionUsd: entity.eligibleRedemptionUsd + eligibleDiff.usd,
      eligibleUpdatedTimestamp: timestamp,
    };
  }
  context.UserGlpGmMigrationStat.set(entity);

  await saveGlpGmMigrationStat(context, eligibleDiff);
}

async function getCappedEligibleRedemptionDiff(
  context: handlerContext,
  usdBefore: bigint,
  usdAfter: bigint,
  otherUsd: bigint,
): Promise<EligibleRedemptionDiffResult> {
  const entity = await getOrCreateGlpGmMigrationStat(context);

  if (entity.eligibleRedemptionInArb > GLP_GM_MIGRATION_CAP_THRESHOLD_IN_ARB) {
    return new EligibleRedemptionDiffResult(ZERO, ZERO);
  }

  const minBefore = usdBefore < otherUsd ? usdBefore : otherUsd;
  const minAfter = usdAfter < otherUsd ? usdAfter : otherUsd;
  let diffUsd = minAfter - minBefore;
  let diffInArb = await convertUsdToAmount(context, ARB_TOKEN_ADDRESS, diffUsd);

  if (entity.eligibleRedemptionInArb + diffInArb > GLP_GM_MIGRATION_CAP_THRESHOLD_IN_ARB) {
    diffInArb = GLP_GM_MIGRATION_CAP_THRESHOLD_IN_ARB - entity.eligibleRedemptionInArb;
    diffUsd = await convertAmountToUsd(context, ARB_TOKEN_ADDRESS, diffInArb);
  }

  return new EligibleRedemptionDiffResult(diffUsd, diffInArb);
}

async function saveGlpGmMigrationStat(
  context: handlerContext,
  diff: EligibleRedemptionDiffResult,
): Promise<void> {
  if (diff.usd === ZERO) return;
  const entity = await getOrCreateGlpGmMigrationStat(context);
  context.GlpGmMigrationStat.set({
    ...entity,
    eligibleRedemptionUsd: entity.eligibleRedemptionUsd + diff.usd,
    eligibleRedemptionInArb: entity.eligibleRedemptionInArb + diff.inArb,
  });
}

async function getOrCreateGlpGmMigrationStat(context: handlerContext): Promise<GlpGmMigrationStat> {
  const id = "total";
  let entity = await context.GlpGmMigrationStat.get(id);
  if (entity == null) {
    entity = { id, eligibleRedemptionUsd: ZERO, eligibleRedemptionInArb: ZERO };
  }
  return entity;
}

async function getOrCreateUserGlpGmMigrationStatGlpData(
  context: handlerContext,
  account: string,
  timestamp: number,
): Promise<UserGlpGmMigrationStat> {
  const period = "1w";
  const startTimestamp = timestampToPeriodStart(timestamp, period);
  const id = account + ":" + period + ":" + startTimestamp.toString();
  let entity = await context.UserGlpGmMigrationStat.get(id);
  if (entity == null) {
    entity = {
      id,
      period,
      account,
      timestamp: startTimestamp,
      glpRedemptionUsd: ZERO,
      glpRedemptionFeeBpsByUsd: ZERO,
      glpRedemptionWeightedAverageFeeBps: 0,
      gmDepositUsd: ZERO,
      eligibleRedemptionInArb: ZERO,
      eligibleRedemptionUsd: ZERO,
      eligibleUpdatedTimestamp: 0,
    };
  }
  return entity;
}

async function getOrCreateLiquidityProviderIncentivesStat(
  context: handlerContext,
  account: string,
  glvOrMarketAddress: string,
  type: string,
  period: string,
  timestamp: number,
): Promise<LiquidityProviderIncentivesStat> {
  const startTimestamp = timestampToPeriodStart(timestamp, period);
  const id = account + ":" + glvOrMarketAddress + ":" + period + ":" + startTimestamp.toString();
  let entity = await context.LiquidityProviderIncentivesStat.get(id);
  if (entity == null) {
    entity = {
      id,
      timestamp: startTimestamp,
      period,
      account,
      glvOrMarketAddress,
      type: type as LiquidityProviderIncentivesStat["type"],
      updatedTimestamp: 0,
      lastTokensBalance: ZERO,
      cumulativeTimeByTokensBalance: ZERO,
      weightedAverageTokensBalance: ZERO,
    };
  }
  return entity;
}

async function getOrCreateIncentivesStat(
  context: handlerContext,
  glvOrMarketAddress: string,
  type: string,
  timestamp: number,
): Promise<IncentivesStat> {
  const period = "1w";
  const startTimestamp = timestampToPeriodStart(timestamp, period);
  const id = glvOrMarketAddress + ":" + period + ":" + startTimestamp.toString();
  let entity = await context.IncentivesStat.get(id);
  if (entity == null) {
    entity = {
      id,
      timestamp: startTimestamp,
      period,
      glvOrMarketAddress,
      type: type as IncentivesStat["type"],
      updatedTimestamp: 0,
      lastTokensSupply: ZERO,
      cumulativeTimeByTokensSupply: ZERO,
      weightedAverageTokensSupply: ZERO,
    };
  }
  return entity;
}

async function getLiquidityProviderInfo(
  context: handlerContext,
  account: string,
  glvOrMarketAddress: string,
  type: string,
): Promise<LiquidityProviderInfo> {
  const id = account + ":" + glvOrMarketAddress;
  let entity = await context.LiquidityProviderInfo.get(id);
  if (entity == null) {
    entity = {
      id,
      tokensBalance: ZERO,
      account,
      glvOrMarketAddress,
      type: type as LiquidityProviderInfo["type"],
    };
  }
  return entity;
}
