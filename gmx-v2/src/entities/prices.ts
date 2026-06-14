import type { handlerContext } from "../types";
import type { EventData } from "../utils/eventData";
import { ZERO } from "../utils/number";

export async function handleOraclePriceUpdate(context: handlerContext, eventData: EventData): Promise<void> {
  const token = eventData.getAddressItemString("token")!;
  const minPrice = eventData.getUintItem("minPrice")!;
  const maxPrice = eventData.getUintItem("maxPrice")!;

  context.TokenPrice.set({ id: token, minPrice, maxPrice });
}

export async function getTokenPrice(
  context: handlerContext,
  tokenAddress: string,
  useMax = false,
): Promise<bigint> {
  const priceRef = await context.TokenPrice.get(tokenAddress);
  if (!priceRef) {
    return ZERO;
  }
  return useMax ? priceRef.maxPrice : priceRef.minPrice;
}

export async function convertUsdToAmount(
  context: handlerContext,
  tokenAddress: string,
  usd: bigint,
  useMax = true,
): Promise<bigint> {
  const price = await getTokenPrice(context, tokenAddress, useMax);
  if (price === ZERO) {
    return ZERO;
  }
  return usd / price;
}

export async function convertAmountToUsd(
  context: handlerContext,
  tokenAddress: string,
  amount: bigint,
  useMax = false,
): Promise<bigint> {
  const price = await getTokenPrice(context, tokenAddress, useMax);
  return amount * price;
}
