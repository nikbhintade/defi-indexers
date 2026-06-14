import type { TradingIncentivesStat, UserTradingIncentivesStat } from "envio";
import type { handlerContext } from "../../types";
import { periodToSeconds, timestampToPeriodStart } from "../../utils/time";
import { ZERO, expandDecimals } from "../../utils/number";
import { convertAmountToUsd, convertUsdToAmount } from "../prices";

const INCENTIVES_START_TIMESTAMP = 1700006400; // 2023-11-15 00:00:00
const REBATE_PERCENT = 7500n;
const ARB_TOKEN_ADDRESS = "0x912ce59144191c1204e64559fe8253a0e49e6548";

// kept for parity with the original (unused otherwise)
export const SECONDS_IN_WEEK = periodToSeconds("1w");

function getRebatesCapForEpoch(_timestamp: number): bigint {
  // no caps
  return expandDecimals(100_000_000n, 18);
}

function incentivesActive(timestamp: number): boolean {
  return timestamp > INCENTIVES_START_TIMESTAMP;
}

class CappedPositionFeesResult {
  constructor(public usd: bigint, public inArb: bigint) {}
}

async function getEligibleFees(
  context: handlerContext,
  positionFeesUsd: bigint,
  positionFeesInArb: bigint,
  globalEligibleFeesInArb: bigint,
  timestamp: number,
): Promise<CappedPositionFeesResult> {
  const REBATES_CAP_FOR_EPOCH_IN_ARB = getRebatesCapForEpoch(timestamp);

  let eligibleFeesUsd = (positionFeesUsd * REBATE_PERCENT) / 10000n;
  let eligibleFeesInArb = (positionFeesInArb * REBATE_PERCENT) / 10000n;

  if (globalEligibleFeesInArb + eligibleFeesInArb > REBATES_CAP_FOR_EPOCH_IN_ARB) {
    eligibleFeesInArb = REBATES_CAP_FOR_EPOCH_IN_ARB - globalEligibleFeesInArb;
    eligibleFeesUsd = await convertAmountToUsd(context, ARB_TOKEN_ADDRESS, eligibleFeesInArb);
  }

  return new CappedPositionFeesResult(eligibleFeesUsd, eligibleFeesInArb);
}

export async function saveTradingIncentivesStat(
  context: handlerContext,
  account: string,
  timestamp: number,
  feesAmount: bigint,
  collateralTokenPrice: bigint,
): Promise<void> {
  if (!incentivesActive(timestamp)) return;

  const positionFeesUsd = feesAmount * collateralTokenPrice;
  const positionFeesInArb = await convertUsdToAmount(context, ARB_TOKEN_ADDRESS, positionFeesUsd);

  let globalEntity = await getOrCreateTradingIncentivesStat(context, timestamp);
  const eligibleFees = await getEligibleFees(
    context,
    positionFeesUsd,
    positionFeesInArb,
    globalEntity.eligibleFeesInArb,
    timestamp,
  );

  globalEntity = {
    ...globalEntity,
    positionFeesUsd: globalEntity.positionFeesUsd + positionFeesUsd,
    positionFeesInArb: globalEntity.positionFeesInArb + positionFeesInArb,
  };
  if (eligibleFees.inArb > ZERO) {
    globalEntity = {
      ...globalEntity,
      eligibleFeesUsd: globalEntity.eligibleFeesUsd + eligibleFees.usd,
      eligibleFeesInArb: globalEntity.eligibleFeesInArb + eligibleFees.inArb,
    };
  }
  context.TradingIncentivesStat.set(globalEntity);

  let userEntity = await getOrCreateUserTradingIncentivesStat(context, account, timestamp);
  userEntity = {
    ...userEntity,
    positionFeesUsd: userEntity.positionFeesUsd + positionFeesUsd,
    positionFeesInArb: userEntity.positionFeesInArb + positionFeesInArb,
  };
  if (eligibleFees.inArb > ZERO) {
    userEntity = {
      ...userEntity,
      eligibleFeesInArb: userEntity.eligibleFeesInArb + eligibleFees.inArb,
      eligibleFeesUsd: userEntity.eligibleFeesUsd + eligibleFees.usd,
      eligibleUpdatedTimestamp: timestamp,
    };
  }
  context.UserTradingIncentivesStat.set(userEntity);
}

async function getOrCreateUserTradingIncentivesStat(
  context: handlerContext,
  account: string,
  timestamp: number,
): Promise<UserTradingIncentivesStat> {
  const period = "1w";
  const startTimestamp = timestampToPeriodStart(timestamp, period);
  const id = account + ":" + period + ":" + startTimestamp.toString();
  let entity = await context.UserTradingIncentivesStat.get(id);
  if (entity == null) {
    entity = {
      id,
      period,
      timestamp: startTimestamp,
      account,
      positionFeesUsd: ZERO,
      positionFeesInArb: ZERO,
      eligibleFeesInArb: ZERO,
      eligibleFeesUsd: ZERO,
      eligibleUpdatedTimestamp: 0,
    };
  }
  return entity;
}

async function getOrCreateTradingIncentivesStat(
  context: handlerContext,
  timestamp: number,
): Promise<TradingIncentivesStat> {
  const period = "1w";
  const startTimestamp = timestampToPeriodStart(timestamp, period);
  const id = period + ":" + startTimestamp.toString();
  let entity = await context.TradingIncentivesStat.get(id);
  if (entity == null) {
    entity = {
      id,
      period,
      timestamp: startTimestamp,
      positionFeesUsd: ZERO,
      positionFeesInArb: ZERO,
      eligibleFeesInArb: ZERO,
      eligibleFeesUsd: ZERO,
      rebatesCapInArb: getRebatesCapForEpoch(timestamp),
    };
  }
  return entity;
}
