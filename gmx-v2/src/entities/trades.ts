import type { Order, TradeAction, Transaction } from "envio";
import type { handlerContext } from "../types";
import { getMarketInfo } from "./markets";
import { orderTypes } from "./orders";
import { getSwapInfoId } from "./swaps";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** Builds a TradeAction prefilled with the order's fields (port of getTradeActionFromOrder). */
function getTradeActionFromOrder(eventId: string, order: Order): TradeAction {
  return {
    id: eventId,
    orderKey: order.id,
    account: order.account,
    marketAddress: order.marketAddress,
    swapPath: order.swapPath,
    initialCollateralTokenAddress: order.initialCollateralTokenAddress,
    initialCollateralDeltaAmount: order.initialCollateralDeltaAmount,
    sizeDeltaUsd: order.sizeDeltaUsd,
    triggerPrice: order.triggerPrice,
    acceptablePrice: order.acceptablePrice,
    minOutputAmount: order.minOutputAmount,
    orderType: order.orderType,
    shouldUnwrapNativeToken: order.shouldUnwrapNativeToken,
    isLong: order.isLong,
    // remaining nullable fields
    eventName: "",
    executionPrice: undefined,
    executionAmountOut: undefined,
    collateralTokenPriceMin: undefined,
    collateralTokenPriceMax: undefined,
    indexTokenPriceMin: undefined,
    indexTokenPriceMax: undefined,
    priceImpactDiffUsd: undefined,
    priceImpactUsd: undefined,
    priceImpactAmount: undefined,
    positionFeeAmount: undefined,
    liquidationFeeAmount: undefined,
    borrowingFeeAmount: undefined,
    fundingFeeAmount: undefined,
    pnlUsd: undefined,
    basePnlUsd: undefined,
    reason: undefined,
    reasonBytes: undefined,
    timestamp: 0,
    transaction_id: "",
  };
}

export async function saveOrderCreatedTradeAction(
  context: handlerContext,
  eventId: string,
  order: Order,
  transaction: Transaction,
): Promise<TradeAction> {
  const tradeAction: TradeAction = {
    ...getTradeActionFromOrder(eventId, order),
    eventName: "OrderCreated",
    transaction_id: transaction.id,
    timestamp: transaction.timestamp,
  };
  context.TradeAction.set(tradeAction);
  return tradeAction;
}

export async function saveOrderCancelledTradeAction(
  context: handlerContext,
  eventId: string,
  order: Order,
  reason: string,
  reasonBytes: string,
  transaction: Transaction,
): Promise<TradeAction> {
  const tradeAction: TradeAction = {
    ...getTradeActionFromOrder(eventId, order),
    eventName: "OrderCancelled",
    reason,
    reasonBytes,
    transaction_id: transaction.id,
    timestamp: transaction.timestamp,
  };
  context.TradeAction.set(tradeAction);
  return tradeAction;
}

export async function saveOrderExecutedTradeAction(
  context: handlerContext,
  eventId: string,
  order: Order,
  transaction: Transaction,
): Promise<TradeAction> {
  const tradeAction: TradeAction = {
    ...getTradeActionFromOrder(eventId, order),
    eventName: "OrderExecuted",
    transaction_id: transaction.id,
    timestamp: transaction.timestamp,
  };
  context.TradeAction.set(tradeAction);
  return tradeAction;
}

export async function saveOrderUpdatedTradeAction(
  context: handlerContext,
  eventId: string,
  order: Order,
  transaction: Transaction,
): Promise<TradeAction> {
  const tradeAction: TradeAction = {
    ...getTradeActionFromOrder(eventId, order),
    eventName: "OrderUpdated",
    transaction_id: transaction.id,
    timestamp: transaction.timestamp,
  };
  context.TradeAction.set(tradeAction);
  return tradeAction;
}

export async function saveOrderFrozenTradeAction(
  context: handlerContext,
  eventId: string,
  order: Order,
  reason: string,
  reasonBytes: string,
  transaction: Transaction,
): Promise<TradeAction> {
  let tradeAction = getTradeActionFromOrder(eventId, order);

  if (order.marketAddress !== ZERO_ADDRESS) {
    const marketInfo = await getMarketInfo(context, order.marketAddress);
    const tokenPrice = await context.TokenPrice.get(marketInfo.indexToken);
    if (tokenPrice == null) {
      if (context.isPreload) return tradeAction;
      throw new Error("TokenPrice not found " + marketInfo.indexToken);
    }
    tradeAction = {
      ...tradeAction,
      indexTokenPriceMin: tokenPrice.minPrice,
      indexTokenPriceMax: tokenPrice.maxPrice,
    };
  }

  tradeAction = {
    ...tradeAction,
    eventName: "OrderFrozen",
    reason,
    reasonBytes,
    transaction_id: transaction.id,
    timestamp: transaction.timestamp,
  };
  context.TradeAction.set(tradeAction);
  return tradeAction;
}

export async function saveSwapExecutedTradeAction(
  context: handlerContext,
  eventId: string,
  order: Order,
  transaction: Transaction,
): Promise<void> {
  let tradeAction = getTradeActionFromOrder(eventId, order);

  const swapPath = order.swapPath;
  let executionAmountOut = 0n;
  if (swapPath != null && swapPath.length > 0) {
    const lastSwapAddress = swapPath[swapPath.length - 1]!;
    const swapInfoId = getSwapInfoId(order.id, lastSwapAddress, transaction);
    const swapInfo = await context.SwapInfo.get(swapInfoId);
    if (swapInfo != null) {
      executionAmountOut = swapInfo.amountOut;
    }
  }

  tradeAction = {
    ...tradeAction,
    eventName: "OrderExecuted",
    orderKey: order.id,
    orderType: order.orderType,
    executionAmountOut,
    transaction_id: transaction.id,
    timestamp: transaction.timestamp,
  };
  context.TradeAction.set(tradeAction);
}

export async function savePositionIncreaseExecutedTradeAction(
  context: handlerContext,
  eventId: string,
  order: Order,
  transaction: Transaction,
): Promise<TradeAction> {
  let tradeAction = getTradeActionFromOrder(eventId, order);
  const positionIncrease = await context.PositionIncrease.get(order.id);
  const marketInfo = await getMarketInfo(context, order.marketAddress);
  const tokenPrice = await context.TokenPrice.get(marketInfo.indexToken);
  const positionFeesInfo = await context.PositionFeesInfo.get(order.id + ":" + "PositionFeesCollected");

  // during the concurrent preload pass, same-batch dependencies may be absent
  if (context.isPreload && (positionIncrease == null || tokenPrice == null || positionFeesInfo == null)) {
    return tradeAction;
  }

  if (positionIncrease == null) {
    throw new Error("PositionIncrease not found " + order.id);
  }
  if (tokenPrice == null) {
    throw new Error("TokenPrice not found " + marketInfo.indexToken);
  }
  if (positionFeesInfo == null) {
    context.log.warn(`PositionFeesInfo not found ${order.id}`);
    throw new Error("PositionFeesInfo not found " + order.id);
  }

  tradeAction = {
    ...tradeAction,
    indexTokenPriceMin: tokenPrice.minPrice,
    indexTokenPriceMax: tokenPrice.maxPrice,
    eventName: "OrderExecuted",
    orderKey: order.id,
    orderType: order.orderType,
    initialCollateralDeltaAmount: positionIncrease.collateralDeltaAmount,
    sizeDeltaUsd: positionIncrease.sizeDeltaUsd,
    executionPrice: positionIncrease.executionPrice,
    priceImpactUsd: positionIncrease.priceImpactUsd,
    collateralTokenPriceMin: positionFeesInfo.collateralTokenPriceMin,
    collateralTokenPriceMax: positionFeesInfo.collateralTokenPriceMax,
    positionFeeAmount: positionFeesInfo.positionFeeAmount,
    borrowingFeeAmount: positionFeesInfo.borrowingFeeAmount,
    fundingFeeAmount: positionFeesInfo.fundingFeeAmount,
    transaction_id: transaction.id,
    timestamp: transaction.timestamp,
  };
  context.TradeAction.set(tradeAction);
  return tradeAction;
}

export async function savePositionDecreaseExecutedTradeAction(
  context: handlerContext,
  eventId: string,
  order: Order,
  transaction: Transaction,
): Promise<void> {
  let tradeAction = getTradeActionFromOrder(eventId, order);
  const positionDecrease = await context.PositionDecrease.get(order.id);
  const marketInfo = await getMarketInfo(context, order.marketAddress);
  const tokenPrice = await context.TokenPrice.get(marketInfo.indexToken);

  const isLiquidation = order.orderType === orderTypes.get("Liquidation");
  let positionFeesInfo = null;
  if (isLiquidation) {
    positionFeesInfo = await context.PositionFeesInfo.get(order.id + ":" + "PositionFeesInfo");
  }
  if (positionFeesInfo == null) {
    positionFeesInfo = await context.PositionFeesInfo.get(order.id + ":" + "PositionFeesCollected");
  }

  // during the concurrent preload pass, same-batch dependencies may be absent
  if (context.isPreload && (positionDecrease == null || tokenPrice == null || positionFeesInfo == null)) {
    return;
  }

  if (tokenPrice == null) {
    throw new Error("TokenPrice not found " + marketInfo.indexToken);
  }

  tradeAction = {
    ...tradeAction,
    indexTokenPriceMin: tokenPrice.minPrice,
    indexTokenPriceMax: tokenPrice.maxPrice,
  };

  if (positionDecrease == null) {
    throw new Error("PositionDecrease not found " + order.id);
  }
  if (positionFeesInfo == null) {
    context.log.warn(`PositionFeesInfo not found ${order.id}`);
    throw new Error("PositionFeesInfo not found " + order.id);
  }

  const pnlUsd =
    positionDecrease.basePnlUsd -
    (positionFeesInfo.positionFeeAmount +
      positionFeesInfo.borrowingFeeAmount +
      positionFeesInfo.fundingFeeAmount) *
      positionFeesInfo.collateralTokenPriceMax +
    positionDecrease.priceImpactUsd;

  tradeAction = {
    ...tradeAction,
    eventName: "OrderExecuted",
    orderKey: order.id,
    orderType: order.orderType,
    executionPrice: positionDecrease.executionPrice,
    initialCollateralDeltaAmount: positionDecrease.collateralDeltaAmount,
    sizeDeltaUsd: positionDecrease.sizeDeltaUsd,
    collateralTokenPriceMin: positionFeesInfo.collateralTokenPriceMin,
    collateralTokenPriceMax: positionFeesInfo.collateralTokenPriceMax,
    priceImpactDiffUsd: positionDecrease.priceImpactDiffUsd,
    priceImpactAmount: positionDecrease.priceImpactAmount,
    priceImpactUsd: positionDecrease.priceImpactUsd,
    positionFeeAmount: positionFeesInfo.positionFeeAmount,
    borrowingFeeAmount: positionFeesInfo.borrowingFeeAmount,
    fundingFeeAmount: positionFeesInfo.fundingFeeAmount,
    liquidationFeeAmount: positionFeesInfo.liquidationFeeAmount,
    basePnlUsd: positionDecrease.basePnlUsd,
    pnlUsd,
    transaction_id: transaction.id,
    timestamp: transaction.timestamp,
  };
  context.TradeAction.set(tradeAction);
}
