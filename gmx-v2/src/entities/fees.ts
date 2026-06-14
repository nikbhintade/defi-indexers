import type { EffectCaller } from "envio";
import type {
  CollectedMarketFeesInfo,
  PositionFeesInfo,
  SwapFeesInfo,
  SwapFeesInfoWithPeriod,
  PositionFeesInfoWithPeriod,
  Transaction,
} from "envio";
import type { handlerContext } from "../types";
import type { EventData } from "../utils/eventData";
import { timestampToPeriodStart } from "../utils/time";
import { pow10, ZERO } from "../utils/number";
import { getTokenPrice } from "./prices";
import { getMarketInfo } from "./markets";
import {
  getMarketPoolValueFromContract,
  getMarketTokensSupplyFromContract,
} from "../effects/contracts";

export const swapFeeTypes = new Map<string, string>([
  ["SWAP_FEE_TYPE", "0x7ad0b6f464d338ea140ff9ef891b4a69cf89f107060a105c31bb985d9e532214"],
  ["DEPOSIT_FEE_TYPE", "0x39226eb4fed85317aa310fa53f734c7af59274c49325ab568f9c4592250e8cc5"],
  ["WITHDRAWAL_FEE_TYPE", "0xda1ac8fcb4f900f8ab7c364d553e5b6b8bdc58f74160df840be80995056f3838"],
  ["ATOMIC_SWAP_FEE_TYPE", "0x0715366437cc1f9a874eb5c6cd8111dcbea3677598c568f8b8d013d6c4380688"],
]);

export function getSwapActionByFeeType(context: handlerContext, swapFeeType: string): string {
  if (
    swapFeeType === swapFeeTypes.get("SWAP_FEE_TYPE") ||
    swapFeeType === swapFeeTypes.get("ATOMIC_SWAP_FEE_TYPE")
  ) {
    return "swap";
  }
  if (swapFeeType === swapFeeTypes.get("DEPOSIT_FEE_TYPE")) return "deposit";
  if (swapFeeType === swapFeeTypes.get("WITHDRAWAL_FEE_TYPE")) return "withdrawal";

  context.log.error(`Unknown swap fee type: ${swapFeeType}`);
  throw new Error("Unknown swap fee type: " + swapFeeType);
}

function getUpdatedFeeUsdPerPoolValue(
  feeInfo: CollectedMarketFeesInfo,
  fee: bigint,
  poolValue: bigint,
): bigint {
  if (poolValue === ZERO) return ZERO;
  return feeInfo.feeUsdPerPoolValue + (fee * pow10(30)) / poolValue;
}

function getUpdatedFeeUsdPerGmToken(
  feeInfo: CollectedMarketFeesInfo,
  fee: bigint,
  marketTokensSupply: bigint,
): bigint {
  if (marketTokensSupply === ZERO) return ZERO;
  return feeInfo.feeUsdPerGmToken + (fee * pow10(18)) / marketTokensSupply;
}

function updateCollectedFeesFractions(
  poolValue: bigint,
  feesEntity: CollectedMarketFeesInfo,
  totalFeesEntity: CollectedMarketFeesInfo,
  feeUsdForPool: bigint,
  marketTokensSupply: bigint,
  prevCumulativeFeeUsdPerGmToken: bigint,
): CollectedMarketFeesInfo {
  const feeUsdPerPoolValue = getUpdatedFeeUsdPerPoolValue(feesEntity, feeUsdForPool, poolValue);
  const feeUsdPerGmToken = getUpdatedFeeUsdPerGmToken(feesEntity, feeUsdForPool, marketTokensSupply);
  return {
    ...feesEntity,
    feeUsdPerPoolValue,
    cumulativeFeeUsdPerPoolValue: totalFeesEntity.feeUsdPerPoolValue,
    feeUsdPerGmToken,
    prevCumulativeFeeUsdPerGmToken,
    cumulativeFeeUsdPerGmToken: totalFeesEntity.feeUsdPerGmToken,
  };
}

export async function saveSwapFeesInfo(
  context: handlerContext,
  eventData: EventData,
  eventId: string,
  transaction: Transaction,
): Promise<SwapFeesInfo> {
  let swapFeeType: string;
  const swapFeeTypeBytes = eventData.getBytes32Item("swapFeeType");
  if (swapFeeTypeBytes != null) {
    swapFeeType = swapFeeTypeBytes;
  } else {
    const action = eventData.getStringItem("action");
    if (action === "deposit") swapFeeType = swapFeeTypes.get("DEPOSIT_FEE_TYPE")!;
    else if (action === "withdrawal") swapFeeType = swapFeeTypes.get("WITHDRAWAL_FEE_TYPE")!;
    else swapFeeType = swapFeeTypes.get("SWAP_FEE_TYPE")!;
  }

  const tokenPrice = eventData.getUintItem("tokenPrice")!;
  const swapFeesInfo: SwapFeesInfo = {
    id: eventId,
    marketAddress: eventData.getAddressItemString("market")!,
    tokenAddress: eventData.getAddressItemString("token")!,
    swapFeeType,
    tokenPrice,
    feeReceiverAmount: eventData.getUintItem("feeReceiverAmount")!,
    feeUsdForPool: eventData.getUintItem("feeAmountForPool")! * tokenPrice,
    transaction_id: transaction.id,
  };
  context.SwapFeesInfo.set(swapFeesInfo);
  return swapFeesInfo;
}

export async function savePositionFeesInfo(
  context: handlerContext,
  eventData: EventData,
  eventName: string,
  transaction: Transaction,
): Promise<PositionFeesInfo> {
  const orderKey = eventData.getBytes32Item("orderKey")!;
  const id = orderKey + ":" + eventName;
  const collateralTokenPriceMin = eventData.getUintItem("collateralTokenPrice.min")!;

  const feesInfo: PositionFeesInfo = {
    id,
    orderKey,
    eventName,
    marketAddress: eventData.getAddressItemString("market")!,
    collateralTokenAddress: eventData.getAddressItemString("collateralToken")!,
    trader: eventData.getAddressItemString("trader")!,
    affiliate: eventData.getAddressItemString("affiliate")!,
    collateralTokenPriceMin,
    collateralTokenPriceMax: eventData.getUintItem("collateralTokenPrice.max")!,
    positionFeeAmount: eventData.getUintItem("positionFeeAmount")!,
    borrowingFeeAmount: eventData.getUintItem("borrowingFeeAmount")!,
    fundingFeeAmount: eventData.getUintItem("fundingFeeAmount")!,
    liquidationFeeAmount: eventData.getUintItem("liquidationFeeAmount") ?? undefined,
    feeUsdForPool: eventData.getUintItem("feeAmountForPool")! * collateralTokenPriceMin,
    totalRebateAmount: eventData.getUintItem("totalRebateAmount")!,
    totalRebateFactor: eventData.getUintItem("totalRebateFactor")!,
    traderDiscountAmount: eventData.getUintItem("traderDiscountAmount")!,
    affiliateRewardAmount: eventData.getUintItem("affiliateRewardAmount")!,
    transaction_id: transaction.id,
  };
  context.PositionFeesInfo.set(feesInfo);
  return feesInfo;
}

export async function getOrCreateCollectedMarketFees(
  context: handlerContext,
  marketAddress: string,
  timestamp: number,
  period: string,
): Promise<CollectedMarketFeesInfo> {
  const timestampGroup = timestampToPeriodStart(timestamp, period);
  let id = marketAddress + ":" + period;
  if (period !== "total") {
    id = id + ":" + timestampGroup.toString();
  }
  let collectedFees = await context.CollectedMarketFeesInfo.get(id);
  if (collectedFees == null) {
    collectedFees = {
      id,
      marketAddress,
      period,
      timestampGroup,
      feeUsdForPool: ZERO,
      cummulativeFeeUsdForPool: ZERO,
      feeUsdPerPoolValue: ZERO,
      cumulativeFeeUsdPerPoolValue: ZERO,
      feeUsdPerGmToken: ZERO,
      cumulativeFeeUsdPerGmToken: ZERO,
      prevCumulativeFeeUsdPerGmToken: ZERO,
    };
  }
  return collectedFees;
}

export async function saveSwapFeesInfoWithPeriod(
  context: handlerContext,
  feeAmountForPool: bigint,
  feeReceiverAmount: bigint,
  tokenPrice: bigint,
  timestamp: number,
): Promise<void> {
  const dailyTimestampGroup = timestampToPeriodStart(timestamp, "1d");
  const dailyFees = await getOrCreateSwapFeesInfoWithPeriod(context, dailyTimestampGroup.toString(), "1d");
  const totalFees = await getOrCreateSwapFeesInfoWithPeriod(context, "total", "total");

  const feeUsdForPool = feeAmountForPool * tokenPrice;
  const feeReceiverUsd = feeReceiverAmount * tokenPrice;

  context.SwapFeesInfoWithPeriod.set({
    ...dailyFees,
    totalFeeUsdForPool: dailyFees.totalFeeUsdForPool + feeUsdForPool,
    totalFeeReceiverUsd: dailyFees.totalFeeReceiverUsd + feeReceiverUsd,
  });
  context.SwapFeesInfoWithPeriod.set({
    ...totalFees,
    totalFeeUsdForPool: totalFees.totalFeeUsdForPool + feeUsdForPool,
    totalFeeReceiverUsd: totalFees.totalFeeReceiverUsd + feeReceiverUsd,
  });
}

export async function savePositionFeesInfoWithPeriod(
  context: handlerContext,
  positionFeeAmount: bigint,
  positionFeeAmountForPool: bigint,
  liquidationFeeAmount: bigint,
  borrowingFeeUsd: bigint,
  tokenPrice: bigint,
  timestamp: number,
): Promise<void> {
  const dailyTimestampGroup = timestampToPeriodStart(timestamp, "1d");
  const dailyFees = await getOrCreatePositionFeesInfoWithPeriod(context, dailyTimestampGroup.toString(), "1d");
  const totalFees = await getOrCreatePositionFeesInfoWithPeriod(context, "total", "total");

  const positionFeeUsd = positionFeeAmount * tokenPrice;
  const positionFeeUsdForPool = positionFeeAmountForPool * tokenPrice;
  const liquidationFeeUsd = liquidationFeeAmount * tokenPrice;

  const apply = (f: PositionFeesInfoWithPeriod): PositionFeesInfoWithPeriod => ({
    ...f,
    totalBorrowingFeeUsd: f.totalBorrowingFeeUsd + borrowingFeeUsd,
    totalPositionFeeAmount: f.totalPositionFeeAmount + positionFeeAmount,
    totalPositionFeeUsd: f.totalPositionFeeUsd + positionFeeUsd,
    totalPositionFeeAmountForPool: f.totalPositionFeeAmountForPool + positionFeeAmountForPool,
    totalPositionFeeUsdForPool: f.totalPositionFeeUsdForPool + positionFeeUsdForPool,
    totalLiquidationFeeAmount: f.totalLiquidationFeeAmount + liquidationFeeAmount,
    totalLiquidationFeeUsd: f.totalLiquidationFeeUsd + liquidationFeeUsd,
  });

  context.PositionFeesInfoWithPeriod.set(apply(dailyFees));
  context.PositionFeesInfoWithPeriod.set(apply(totalFees));
}

async function getOrCreateSwapFeesInfoWithPeriod(
  context: handlerContext,
  id: string,
  period: string,
): Promise<SwapFeesInfoWithPeriod> {
  let feeInfo = await context.SwapFeesInfoWithPeriod.get(id);
  if (feeInfo == null) {
    feeInfo = { id, period, totalFeeUsdForPool: ZERO, totalFeeReceiverUsd: ZERO };
  }
  return feeInfo;
}

async function getOrCreatePositionFeesInfoWithPeriod(
  context: handlerContext,
  id: string,
  period: string,
): Promise<PositionFeesInfoWithPeriod> {
  let feeInfo = await context.PositionFeesInfoWithPeriod.get(id);
  if (feeInfo == null) {
    feeInfo = {
      id,
      period,
      totalBorrowingFeeUsd: ZERO,
      totalPositionFeeAmount: ZERO,
      totalPositionFeeUsd: ZERO,
      totalPositionFeeAmountForPool: ZERO,
      totalPositionFeeUsdForPool: ZERO,
      totalLiquidationFeeAmount: ZERO,
      totalLiquidationFeeUsd: ZERO,
    };
  }
  return feeInfo;
}

export async function saveCollectedMarketFees(
  context: handlerContext,
  transaction: Transaction,
  marketAddress: string,
  poolValue: bigint,
  feeUsdForPool: bigint,
  marketTokensSupply: bigint,
): Promise<void> {
  // total should always come first, its cumulativeFeeUsdPerPoolValue is used downstream
  let totalFees = await getOrCreateCollectedMarketFees(context, marketAddress, transaction.timestamp, "total");
  totalFees = { ...totalFees, cummulativeFeeUsdForPool: totalFees.cummulativeFeeUsdForPool + feeUsdForPool };

  const prevCumulativeFeeUsdPerGmToken = totalFees.cumulativeFeeUsdPerGmToken;

  totalFees = updateCollectedFeesFractions(
    poolValue,
    totalFees,
    totalFees,
    feeUsdForPool,
    marketTokensSupply,
    prevCumulativeFeeUsdPerGmToken,
  );
  totalFees = { ...totalFees, feeUsdForPool: totalFees.feeUsdForPool + feeUsdForPool };
  context.CollectedMarketFeesInfo.set(totalFees);

  let feesFor1h = await getOrCreateCollectedMarketFees(context, marketAddress, transaction.timestamp, "1h");
  feesFor1h = updateCollectedFeesFractions(
    poolValue,
    feesFor1h,
    totalFees,
    feeUsdForPool,
    marketTokensSupply,
    prevCumulativeFeeUsdPerGmToken,
  );
  feesFor1h = {
    ...feesFor1h,
    cummulativeFeeUsdForPool: totalFees.cummulativeFeeUsdForPool,
    feeUsdForPool: feesFor1h.feeUsdForPool + feeUsdForPool,
  };
  context.CollectedMarketFeesInfo.set(feesFor1h);

  let feesFor1d = await getOrCreateCollectedMarketFees(context, marketAddress, transaction.timestamp, "1d");
  feesFor1d = updateCollectedFeesFractions(
    poolValue,
    feesFor1d,
    totalFees,
    feeUsdForPool,
    marketTokensSupply,
    prevCumulativeFeeUsdPerGmToken,
  );
  feesFor1d = {
    ...feesFor1d,
    cummulativeFeeUsdForPool: totalFees.cummulativeFeeUsdForPool,
    feeUsdForPool: feesFor1d.feeUsdForPool + feeUsdForPool,
  };
  context.CollectedMarketFeesInfo.set(feesFor1d);
}

export async function handlePositionImpactPoolDistributed(
  context: handlerContext,
  effectCall: EffectCaller | null,
  eventData: EventData,
  transaction: Transaction,
  blockNumber: number,
): Promise<void> {
  const market = eventData.getAddressItemString("market")!;
  const distributionAmount = eventData.getUintItem("distributionAmount")!;

  const marketInfo = await context.MarketInfo.get(market);
  if (!marketInfo) {
    if (context.isPreload) return;
    context.log.warn(`Market not found: ${market}`);
    throw new Error("Market not found");
  }

  const indexToken = marketInfo.indexToken;
  const tokenPrice = await getTokenPrice(context, indexToken);
  const amountUsd = distributionAmount * tokenPrice;
  const poolValue = await getMarketPoolValueFromContract(context, effectCall, market, blockNumber);
  const marketTokensSupply = await getMarketTokensSupplyFromContract(effectCall, market, blockNumber);

  await saveCollectedMarketFees(context, transaction, market, poolValue, amountUsd, marketTokensSupply);
}
