import type { SwapInfo, Transaction } from "envio";
import type { handlerContext } from "../types";
import type { EventData } from "../utils/eventData";

const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";

export async function handleSwapInfo(
  context: handlerContext,
  eventData: EventData,
  transaction: Transaction,
): Promise<SwapInfo> {
  const orderKey = eventData.getBytes32Item("orderKey")!;
  const marketAddress = eventData.getAddressItemString("market")!;

  const swapInfoId = getSwapInfoId(orderKey, marketAddress, transaction);

  const swapInfo: SwapInfo = {
    id: swapInfoId,
    orderKey,
    marketAddress,
    transaction_id: transaction.id,
    receiver: eventData.getAddressItemString("receiver")!,
    tokenInAddress: eventData.getAddressItemString("tokenIn")!,
    tokenOutAddress: eventData.getAddressItemString("tokenOut")!,
    tokenInPrice: eventData.getUintItem("tokenInPrice")!,
    tokenOutPrice: eventData.getUintItem("tokenOutPrice")!,
    amountIn: eventData.getUintItem("amountIn")!,
    amountInAfterFees: eventData.getUintItem("amountInAfterFees")!,
    amountOut: eventData.getUintItem("amountOut")!,
    priceImpactUsd: eventData.getUintItem("priceImpactUsd")!,
  };
  context.SwapInfo.set(swapInfo);
  return swapInfo;
}

export function getSwapInfoId(orderKey: string, marketAddress: string, transaction: Transaction): string {
  let id = orderKey + ":" + marketAddress;
  if (orderKey === ZERO_BYTES32) {
    // gasless relay fee swaps are emitted with zero orderKey
    id = id + ":" + transaction.hash;
  }
  return id;
}
