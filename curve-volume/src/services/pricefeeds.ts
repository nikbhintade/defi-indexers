/** Port of src/services/pricefeeds.ts */
import { BigDecimal, type EvmOnEventContext, type Pool, type PriceFeed } from "envio";
import { BIG_DECIMAL_ZERO, BIG_INT_ZERO } from "../constants";

const PRICE_CAP = new BigDecimal("10000000");

export async function getPriceFeed(
  context: EvmOnEventContext,
  pool: Pool,
  token0: string,
  token1: string,
  fromIndex: number,
  toIndex: number,
  isUnderlying: boolean,
): Promise<PriceFeed> {
  const priceId = pool.id + "-" + token0 + "-" + token1;
  let feed = await context.PriceFeed.get(priceId);
  if (!feed) {
    feed = {
      id: priceId,
      lastUpdated: BIG_INT_ZERO,
      lastBlock: BIG_INT_ZERO,
      price: BIG_DECIMAL_ZERO,
      pool_id: pool.id,
      token0,
      token1,
      fromIndex,
      toIndex,
      isUnderlying,
    };
    context.PriceFeed.set(feed);
  }
  return feed;
}

export async function updatePriceFeed(
  context: EvmOnEventContext,
  pool: Pool,
  tokenSold: string,
  tokenBought: string,
  amountSold: BigDecimal,
  amountBought: BigDecimal,
  soldId: number,
  boughtId: number,
  isUnderlying: boolean,
  blockNumber: bigint,
  timestamp: bigint,
): Promise<void> {
  if (amountBought.eq(BIG_DECIMAL_ZERO) || amountSold.eq(BIG_DECIMAL_ZERO)) {
    return;
  }
  const assetPrice = amountBought.div(amountSold);
  // sanity check for prices
  if (assetPrice.gt(PRICE_CAP)) {
    return;
  }
  const price = await getPriceFeed(context, pool, tokenSold, tokenBought, soldId, boughtId, isUnderlying);
  context.PriceFeed.set({
    ...price,
    lastBlock: blockNumber,
    lastUpdated: timestamp,
    price: assetPrice,
  });
}
