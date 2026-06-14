import type { Order, Transaction } from "envio";
import type { handlerContext } from "../types";
import type { EventData } from "../utils/eventData";

export const orderTypes = new Map<string, bigint>([
  ["MarketSwap", 0n],
  ["LimitSwap", 1n],
  ["MarketIncrease", 2n],
  ["LimitIncrease", 3n],
  ["MarketDecrease", 4n],
  ["LimitDecrease", 5n],
  ["StopLossDecrease", 6n],
  ["Liquidation", 7n],
  ["StopIncrease", 8n],
]);

export async function saveOrder(
  context: handlerContext,
  eventData: EventData,
  transaction: Transaction,
): Promise<Order> {
  const key = eventData.getBytes32Item("key")!;

  const isFrozen = eventData.getBoolItem("isFrozen");

  const order: Order = {
    id: key,
    account: eventData.getAddressItemString("account")!,
    receiver: eventData.getAddressItemString("receiver")!,
    callbackContract: eventData.getAddressItemString("callbackContract")!,
    marketAddress: eventData.getAddressItemString("market")!,
    swapPath: eventData.getAddressArrayItemString("swapPath") ?? [],
    initialCollateralTokenAddress: eventData.getAddressItemString("initialCollateralToken")!,
    sizeDeltaUsd: eventData.getUintItem("sizeDeltaUsd")!,
    initialCollateralDeltaAmount: eventData.getUintItem("initialCollateralDeltaAmount")!,
    triggerPrice: eventData.getUintItem("triggerPrice")!,
    acceptablePrice: eventData.getUintItem("acceptablePrice")!,
    callbackGasLimit: eventData.getUintItem("callbakGasLimit")!,
    minOutputAmount: eventData.getUintItem("minOutputAmount")!,
    executionFee: eventData.getUintItem("executionFee")!,
    updatedAtBlock: BigInt(transaction.blockNumber),
    orderType: eventData.getUintItem("orderType")!,
    isLong: eventData.getBoolItem("isLong"),
    shouldUnwrapNativeToken: eventData.getBoolItem("shouldUnwrapNativeToken"),
    status: isFrozen ? "Frozen" : "Created",
    cancelledReason: undefined,
    cancelledReasonBytes: undefined,
    frozenReason: undefined,
    frozenReasonBytes: undefined,
    createdTxn_id: transaction.id,
    cancelledTxn_id: undefined,
    executedTxn_id: undefined,
  };
  context.Order.set(order);
  return order;
}

export async function saveOrderCancelledState(
  context: handlerContext,
  eventData: EventData,
  transaction: Transaction,
): Promise<Order | null> {
  const key = eventData.getBytes32Item("key")!;
  const order = await context.Order.get(key);
  if (order == null) return null;

  const updated: Order = {
    ...order,
    status: "Cancelled",
    cancelledReason: eventData.getStringItem("reason")!,
    cancelledReasonBytes: eventData.getBytesItem("reasonBytes")!,
    cancelledTxn_id: transaction.id,
  };
  context.Order.set(updated);
  return updated;
}

export async function saveOrderExecutedState(
  context: handlerContext,
  eventData: EventData,
  transaction: Transaction,
): Promise<Order | null> {
  const key = eventData.getBytes32Item("key")!;
  const order = await context.Order.get(key);
  if (order == null) return null;

  const updated: Order = { ...order, status: "Executed", executedTxn_id: transaction.id };
  context.Order.set(updated);
  return updated;
}

export async function saveOrderFrozenState(
  context: handlerContext,
  eventData: EventData,
): Promise<Order | null> {
  const key = eventData.getBytes32Item("key")!;
  const order = await context.Order.get(key);
  if (order == null) return null;

  const updated: Order = {
    ...order,
    status: "Frozen",
    frozenReason: eventData.getStringItem("reason")!,
    frozenReasonBytes: eventData.getBytesItem("reasonBytes")!,
  };
  context.Order.set(updated);
  return updated;
}

export async function saveOrderUpdate(
  context: handlerContext,
  eventData: EventData,
): Promise<Order | null> {
  const key = eventData.getBytes32Item("key")!;
  const order = await context.Order.get(key);
  if (order == null) return null;

  const updated: Order = {
    ...order,
    sizeDeltaUsd: eventData.getUintItem("sizeDeltaUsd")!,
    triggerPrice: eventData.getUintItem("triggerPrice")!,
    acceptablePrice: eventData.getUintItem("acceptablePrice")!,
    minOutputAmount: eventData.getUintItem("minOutputAmount")!,
  };
  context.Order.set(updated);
  return updated;
}

export async function saveOrderSizeDeltaAutoUpdate(
  context: handlerContext,
  eventData: EventData,
): Promise<Order | null> {
  const key = eventData.getBytes32Item("key")!;
  const order = await context.Order.get(key);
  if (order == null) return null;

  const updated: Order = { ...order, sizeDeltaUsd: eventData.getUintItem("nextSizeDeltaUsd")! };
  context.Order.set(updated);
  return updated;
}

export async function saveOrderCollateralAutoUpdate(
  context: handlerContext,
  eventData: EventData,
): Promise<Order | null> {
  const key = eventData.getBytes32Item("key")!;
  const order = await context.Order.get(key);
  if (order == null) return null;

  const updated: Order = {
    ...order,
    initialCollateralDeltaAmount: eventData.getUintItem("nextCollateralDeltaAmount")!,
  };
  context.Order.set(updated);
  return updated;
}
