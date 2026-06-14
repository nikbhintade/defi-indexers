import type { PositionDecrease, PositionIncrease, Transaction } from "envio";
import type { handlerContext } from "../types";
import type { EventData } from "../utils/eventData";

export async function savePositionIncrease(
  context: handlerContext,
  eventData: EventData,
  transaction: Transaction,
): Promise<PositionIncrease> {
  const orderKey = eventData.getBytes32Item("orderKey")!;
  const entity: PositionIncrease = {
    id: orderKey,
    orderKey,
    positionKey: eventData.getBytes32Item("positionKey")!,
    account: eventData.getAddressItemString("account")!,
    marketAddress: eventData.getAddressItemString("market")!,
    collateralTokenAddress: eventData.getAddressItemString("collateralToken")!,
    collateralTokenPriceMin: eventData.getUintItem("collateralTokenPrice.min")!,
    collateralTokenPriceMax: eventData.getUintItem("collateralTokenPrice.max")!,
    sizeInUsd: eventData.getUintItem("sizeInUsd")!,
    sizeInTokens: eventData.getUintItem("sizeInTokens")!,
    collateralAmount: eventData.getUintItem("collateralAmount")!,
    sizeDeltaUsd: eventData.getUintItem("sizeDeltaUsd")!,
    sizeDeltaInTokens: eventData.getUintItem("sizeDeltaInTokens")!,
    collateralDeltaAmount: eventData.getIntItem("collateralDeltaAmount")!,
    borrowingFactor: eventData.getUintItem("borrowingFactor")!,
    priceImpactDiffUsd: eventData.getUintItem("priceImpactDiffUsd")!,
    executionPrice: eventData.getUintItem("executionPrice")!,
    longTokenFundingAmountPerSize: eventData.getIntItem("longTokenFundingAmountPerSize")!,
    shortTokenFundingAmountPerSize: eventData.getIntItem("shortTokenFundingAmountPerSize")!,
    priceImpactAmount: eventData.getIntItem("priceImpactAmount")!,
    priceImpactUsd: eventData.getIntItem("priceImpactUsd")!,
    basePnlUsd: eventData.getIntItem("basePnlUsd")!,
    orderType: eventData.getUintItem("orderType")!,
    isLong: eventData.getBoolItem("isLong"),
    transaction_id: transaction.id,
  };
  context.PositionIncrease.set(entity);
  return entity;
}

export async function savePositionDecrease(
  context: handlerContext,
  eventData: EventData,
  transaction: Transaction,
): Promise<PositionDecrease> {
  const orderKey = eventData.getBytes32Item("orderKey")!;
  const entity: PositionDecrease = {
    id: orderKey,
    orderKey,
    positionKey: eventData.getBytes32Item("positionKey")!,
    account: eventData.getAddressItemString("account")!,
    marketAddress: eventData.getAddressItemString("market")!,
    collateralTokenAddress: eventData.getAddressItemString("collateralToken")!,
    collateralTokenPriceMin: eventData.getUintItem("collateralTokenPrice.min")!,
    collateralTokenPriceMax: eventData.getUintItem("collateralTokenPrice.max")!,
    sizeInUsd: eventData.getUintItem("sizeInUsd")!,
    sizeInTokens: eventData.getUintItem("sizeInTokens")!,
    collateralAmount: eventData.getUintItem("collateralAmount")!,
    sizeDeltaUsd: eventData.getUintItem("sizeDeltaUsd")!,
    sizeDeltaInTokens: eventData.getUintItem("sizeDeltaInTokens")!,
    collateralDeltaAmount: eventData.getUintItem("collateralDeltaAmount")!,
    borrowingFactor: eventData.getUintItem("borrowingFactor")!,
    priceImpactDiffUsd: eventData.getUintItem("priceImpactDiffUsd")!,
    priceImpactUsd: eventData.getIntItem("priceImpactUsd")!,
    executionPrice: eventData.getUintItem("executionPrice")!,
    longTokenFundingAmountPerSize: eventData.getIntItem("longTokenFundingAmountPerSize")!,
    shortTokenFundingAmountPerSize: eventData.getIntItem("shortTokenFundingAmountPerSize")!,
    priceImpactAmount: eventData.getIntItem("priceImpactAmount")!,
    basePnlUsd: eventData.getIntItem("basePnlUsd")!,
    orderType: eventData.getUintItem("orderType")!,
    isLong: eventData.getBoolItem("isLong"),
    transaction_id: transaction.id,
  };
  context.PositionDecrease.set(entity);
  return entity;
}
