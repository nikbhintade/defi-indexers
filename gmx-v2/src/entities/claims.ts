import type { ClaimAction, ClaimCollateralAction, Order, Transaction } from "envio";
import type { handlerContext } from "../types";
import type { EventData } from "../utils/eventData";
import { orderTypes } from "./orders";
import { getTokenPrice } from "./prices";
import { ZERO, ONE } from "../utils/number";

export async function saveClaimActionOnOrderCreated(
  context: handlerContext,
  transaction: Transaction,
  eventData: EventData,
): Promise<void> {
  const orderId = eventData.getBytes32Item("key")!;
  let claimAction = await getOrCreateClaimAction(context, "SettleFundingFeeCreated", eventData, transaction);

  const marketAddress = eventData.getAddressItemString("market")!;
  claimAction = {
    ...claimAction,
    marketAddresses: [...claimAction.marketAddresses, marketAddress],
    isLongOrders: [...(claimAction.isLongOrders as boolean[]), eventData.getBoolItem("isLong")],
  };
  context.ClaimAction.set(claimAction);

  await createClaimRefIfNotExists(context, orderId);
}

export async function saveClaimActionOnOrderCancelled(
  context: handlerContext,
  transaction: Transaction,
  eventData: EventData,
): Promise<void> {
  let claimAction = await getOrCreateClaimAction(context, "SettleFundingFeeCancelled", eventData, transaction);

  const orderId = eventData.getBytes32Item("key")!;
  const order = await context.Order.get(orderId);
  if (!order) throw new Error("Order not found");

  claimAction = {
    ...claimAction,
    marketAddresses: [...claimAction.marketAddresses, order.marketAddress],
    isLongOrders: [...(claimAction.isLongOrders as boolean[]), order.isLong],
  };
  context.ClaimAction.set(claimAction);
}

export async function saveClaimActionOnOrderExecuted(
  context: handlerContext,
  transaction: Transaction,
  eventData: EventData,
): Promise<void> {
  let claimAction = await getOrCreateClaimAction(context, "SettleFundingFeeExecuted", eventData, transaction);
  const orderId = eventData.getBytes32Item("key")!;
  const order = await context.Order.get(orderId);
  if (!order) throw new Error("Order not found");

  const account = eventData.getAddressItemString("account")!;
  const claimableFundingFeeInfoId = transaction.id + ":" + account;
  const claimableFundingFeeInfo = await context.ClaimableFundingFeeInfo.get(claimableFundingFeeInfoId);

  // if position has no pending funding fees ClaimableFundingUpdated is not emitted
  if (!claimableFundingFeeInfo) {
    return;
  }

  const tokenAddresses = [...claimAction.tokenAddresses];
  const tokenPrices = [...claimAction.tokenPrices];
  const sourceTokenAddresses = claimableFundingFeeInfo.tokenAddresses;
  for (let i = 0; i < sourceTokenAddresses.length; i++) {
    const sourceTokenAddress = sourceTokenAddresses[i]!;
    tokenAddresses.push(sourceTokenAddress);
    tokenPrices.push(await getTokenPrice(context, sourceTokenAddress));
  }

  const amounts = [...claimAction.amounts];
  for (const sourceAmount of claimableFundingFeeInfo.amounts) {
    amounts.push(sourceAmount);
  }

  const tokensCount = claimableFundingFeeInfo.tokenAddresses.length;
  const marketAddresses = [...claimAction.marketAddresses];
  const isLongOrders = [...(claimAction.isLongOrders as boolean[])];
  for (let i = 0; i < tokensCount; i++) {
    marketAddresses.push(order.marketAddress);
    isLongOrders.push(order.isLong);
  }

  claimAction = { ...claimAction, tokenAddresses, tokenPrices, amounts, marketAddresses, isLongOrders };
  context.ClaimAction.set(claimAction);
}

export async function handleCollateralClaimAction(
  context: handlerContext,
  eventName: string,
  eventData: EventData,
  transaction: Transaction,
): Promise<void> {
  const market = eventData.getAddressItemString("market")!;
  const token = eventData.getAddressItemString("token")!;
  const amount = eventData.getUintItem("amount")!;
  const tokenPrice = await getTokenPrice(context, token);

  const claimCollateralAction = await getOrCreateClaimCollateralAction(context, eventName, eventData, transaction);
  const claimAction = await getOrCreateClaimAction(context, eventName, eventData, transaction);

  context.ClaimAction.set({
    ...claimAction,
    marketAddresses: [...claimAction.marketAddresses, market],
    tokenAddresses: [...claimAction.tokenAddresses, token],
    tokenPrices: [...claimAction.tokenPrices, tokenPrice],
    amounts: [...claimAction.amounts, amount],
  });

  context.ClaimCollateralAction.set({
    ...claimCollateralAction,
    marketAddresses: [...claimCollateralAction.marketAddresses, market],
    tokenAddresses: [...claimCollateralAction.tokenAddresses, token],
    tokenPrices: [...claimCollateralAction.tokenPrices, tokenPrice],
    amounts: [...claimCollateralAction.amounts, amount],
  });
}

export async function saveClaimableFundingFeeInfo(
  context: handlerContext,
  eventData: EventData,
  transaction: Transaction,
): Promise<void> {
  const account = eventData.getAddressItemString("account")!;
  const id = transaction.id + ":" + account;
  let entity = await context.ClaimableFundingFeeInfo.get(id);

  if (!entity) {
    entity = { id, amounts: [], marketAddresses: [], tokenAddresses: [] };
  }

  context.ClaimableFundingFeeInfo.set({
    ...entity,
    marketAddresses: [...entity.marketAddresses, eventData.getAddressItemString("market")!],
    tokenAddresses: [...entity.tokenAddresses, eventData.getAddressItemString("token")!],
    amounts: [...entity.amounts, eventData.getUintItem("delta")!],
  });
}

async function getOrCreateClaimCollateralAction(
  context: handlerContext,
  eventName: string,
  eventData: EventData,
  transaction: Transaction,
): Promise<ClaimCollateralAction> {
  const account = eventData.getAddressItemString("account")!;
  const id = transaction.id + ":" + account + ":" + eventName;
  let entity = await context.ClaimCollateralAction.get(id);
  if (!entity) {
    entity = {
      id,
      marketAddresses: [],
      tokenAddresses: [],
      tokenPrices: [],
      amounts: [],
      eventName: eventName as ClaimCollateralAction["eventName"],
      account,
      transaction_id: transaction.id,
    };
    context.ClaimCollateralAction.set(entity);
  }
  return entity;
}

async function getOrCreateClaimAction(
  context: handlerContext,
  eventName: string,
  eventData: EventData,
  transaction: Transaction,
): Promise<ClaimAction> {
  const account = eventData.getAddressItemString("account")!;
  const id = transaction.id + ":" + account + ":" + eventName;
  let entity = await context.ClaimAction.get(id);
  if (!entity) {
    entity = {
      id,
      marketAddresses: [],
      tokenAddresses: [],
      tokenPrices: [],
      amounts: [],
      isLongOrders: [] as boolean[],
      eventName: eventName as ClaimAction["eventName"],
      account,
      transaction_id: transaction.id,
    };
    context.ClaimAction.set(entity);
  }
  return entity;
}

export function isFundingFeeSettleOrder(order: Order): boolean {
  return (
    order.initialCollateralDeltaAmount === ONE &&
    order.sizeDeltaUsd === ZERO &&
    order.orderType === orderTypes.get("MarketDecrease")
  );
}

async function createClaimRefIfNotExists(context: handlerContext, orderId: string): Promise<void> {
  if (!(await context.ClaimRef.get(orderId))) {
    context.ClaimRef.set({ id: orderId });
  }
}
