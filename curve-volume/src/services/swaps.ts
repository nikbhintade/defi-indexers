/** Port of src/services/swaps.ts */
import { BigDecimal, type EvmOnEventContext, type SwapEvent } from "envio";
import {
  getCryptoSwapTokenPriceFromSnapshot,
  getStableSwapTokenPriceFromSnapshot,
  getSwapSnapshot,
  takePoolSnapshots,
} from "./snapshots";
import {
  ADDRESS_ZERO,
  BIG_DECIMAL_TWO,
  BIG_INT_ONE,
  BIG_INT_ZERO,
  DEPRECATED_POOLS,
  LENDING,
  METAPOOL_FACTORY,
  STABLE_FACTORY,
} from "../constants";
import { PERIODS } from "../utils/time";
import { getBasePool, getVirtualBaseLendingPool } from "./pools";
import { bytesToAddress, exponentToBigDecimal, toBigDecimal } from "../utils";
import { updateCandles } from "./candles";
import { updatePriceFeed } from "./pricefeeds";

const USD_VOLUME_CAP = new BigDecimal("1000000000");

export async function handleExchange(
  context: EvmOnEventContext,
  buyer: string,
  sold_id: bigint,
  bought_id: bigint,
  tokens_sold: bigint,
  tokens_bought: bigint,
  timestamp: bigint,
  blockNumber: bigint,
  address: string,
  txhash: string,
  gasLimit: bigint,
  gasUsed: bigint,
  exchangeUnderlying: boolean,
): Promise<void> {
  // NOTE: like the original, the pool is loaded *before* takePoolSnapshots,
  // and the final cumulative-volume write below is based on this (possibly
  // stale) version — reproducing the original's same-handler overwrite of
  // virtualPrice/baseApr/cumulativeFeesUSD on the swapped pool.
  const pool = await context.Pool.get(address);
  if (!pool) {
    return;
  }
  const block = Number(blockNumber);
  await takePoolSnapshots(context, block, timestamp);
  const deprecatedAt = DEPRECATED_POOLS[pool.id];
  if (deprecatedAt !== undefined && deprecatedAt > timestamp) {
    return;
  }
  const soldId = Number(sold_id);
  const boughtId = Number(bought_id);
  let tokenSold: string, tokenBought: string;
  let tokenSoldDecimals: bigint, tokenBoughtDecimals: bigint;

  if (exchangeUnderlying && pool.poolType == LENDING) {
    const basePool = await getVirtualBaseLendingPool(context, bytesToAddress(pool.basePool));
    if (soldId > basePool.coins.length - 1) {
      context.log.error(`Undefined underlying sold Id ${soldId} for lending pool ${pool.id} at tx ${txhash}`);
      return;
    }
    tokenSold = basePool.coins[soldId]!;
    tokenSoldDecimals = basePool.coinDecimals[soldId]!;
  } else if (exchangeUnderlying && soldId != 0) {
    const underlyingSoldIndex = soldId - 1;
    const basePool = await getBasePool(context, bytesToAddress(pool.basePool));
    if (underlyingSoldIndex > basePool.coins.length - 1) {
      context.log.error(`Undefined underlying sold Id ${soldId} for pool ${pool.id} at tx ${txhash}`);
      return;
    }
    tokenSold = basePool.coins[underlyingSoldIndex]!;
    if (
      ((pool.assetType == 2 && (pool.poolType == METAPOOL_FACTORY || pool.poolType == STABLE_FACTORY)) ||
        (pool.assetType == 0 && pool.poolType == STABLE_FACTORY)) &&
      boughtId == 0 &&
      !pool.isRebasing
    ) {
      // handling an edge-case in the way the dx is logged in the event
      // for BTC metapools and for USD Metapool from factory v1.2
      tokenSoldDecimals = 18n;
    } else {
      tokenSoldDecimals = basePool.coinDecimals[underlyingSoldIndex]!;
    }
  } else {
    if (soldId > pool.coins.length - 1) {
      context.log.error(`Undefined sold Id ${soldId} for pool ${pool.id} at tx ${txhash}`);
      return;
    }
    tokenSold = pool.coins[soldId]!;
    tokenSoldDecimals = pool.coinDecimals[soldId]!;
  }

  if (tokenSold == ADDRESS_ZERO) {
    context.log.error(`Undefined SOLD token for pool ${pool.id} at tx ${txhash}`);
    return;
  }

  if (exchangeUnderlying && pool.poolType == LENDING) {
    const basePool = await getVirtualBaseLendingPool(context, bytesToAddress(pool.basePool));
    if (boughtId > basePool.coins.length - 1) {
      context.log.error(`Undefined underlying bought Id ${boughtId} for lending pool ${pool.id} at tx ${txhash}`);
      return;
    }
    tokenBought = basePool.coins[boughtId]!;
    tokenBoughtDecimals = basePool.coinDecimals[boughtId]!;
  } else if (exchangeUnderlying && boughtId != 0) {
    const underlyingBoughtIndex = boughtId - 1;
    const basePool = await getBasePool(context, bytesToAddress(pool.basePool));
    if (underlyingBoughtIndex > basePool.coins.length - 1) {
      // NOTE: original logs but does NOT return here
      context.log.error(`Undefined underlying bought Id ${boughtId} for pool ${pool.id} at tx ${txhash}`);
    }
    tokenBought = basePool.coins[underlyingBoughtIndex]!;
    tokenBoughtDecimals = basePool.coinDecimals[underlyingBoughtIndex]!;
  } else {
    if (boughtId > pool.coins.length - 1) {
      context.log.error(`Undefined bought Id ${boughtId} for pool ${pool.id} at tx ${txhash}`);
      return;
    }
    tokenBought = pool.coins[boughtId]!;
    tokenBoughtDecimals = pool.coinDecimals[boughtId]!;
  }

  if (tokenBought == ADDRESS_ZERO) {
    context.log.error(`Undefined BOUGHT token for pool ${pool.id} at tx ${txhash}`);
    return;
  }

  const amountSold = toBigDecimal(tokens_sold).div(exponentToBigDecimal(tokenSoldDecimals));
  const amountBought = toBigDecimal(tokens_bought).div(exponentToBigDecimal(tokenBoughtDecimals));
  let amountBoughtUSD: BigDecimal, amountSoldUSD: BigDecimal;
  if (!pool.isV2) {
    const latestBoughtSnapshotPrice = await getStableSwapTokenPriceFromSnapshot(
      context,
      block,
      pool,
      bytesToAddress(tokenBought),
      timestamp,
    );
    const latestSoldSnapshotPrice = await getStableSwapTokenPriceFromSnapshot(
      context,
      block,
      pool,
      bytesToAddress(tokenSold),
      timestamp,
    );
    amountBoughtUSD = amountBought.times(latestBoughtSnapshotPrice);
    amountSoldUSD = amountSold.times(latestSoldSnapshotPrice);
  } else {
    const latestBoughtSnapshotPrice = await getCryptoSwapTokenPriceFromSnapshot(
      context,
      block,
      pool,
      bytesToAddress(tokenBought),
      timestamp,
    );
    const latestSoldSnapshotPrice = await getCryptoSwapTokenPriceFromSnapshot(
      context,
      block,
      pool,
      bytesToAddress(tokenSold),
      timestamp,
    );
    amountBoughtUSD = amountBought.times(latestBoughtSnapshotPrice);
    amountSoldUSD = amountSold.times(latestSoldSnapshotPrice);
  }

  const swapEvent: SwapEvent = {
    id: txhash + "-" + amountBought.toString(),
    pool_id: address,
    block: blockNumber,
    buyer,
    tx: txhash,
    gasLimit,
    gasUsed: gasUsed ? gasUsed : BIG_INT_ZERO,
    tokenBought,
    tokenSold,
    amountBought,
    amountSold,
    amountBoughtUSD,
    amountSoldUSD,
    timestamp,
  };
  context.SwapEvent.set(swapEvent);

  await updateCandles(context, pool, timestamp, tokenBought, amountBought, tokenSold, amountSold, blockNumber);

  await updatePriceFeed(
    context,
    pool,
    tokenSold,
    tokenBought,
    amountSold,
    amountBought,
    soldId,
    boughtId,
    exchangeUnderlying,
    blockNumber,
    timestamp,
  );

  const volume = amountSold.plus(amountBought).div(BIG_DECIMAL_TWO);
  let volumeUSD = amountSoldUSD.plus(amountBoughtUSD).div(BIG_DECIMAL_TWO);
  // sanity check for usd volume
  if (volumeUSD.gt(USD_VOLUME_CAP)) {
    volumeUSD = new BigDecimal("0");
  }
  // create hourly, daily & weekly snapshots
  for (let i = 0; i < PERIODS.length; i++) {
    const snapshot = await getSwapSnapshot(context, pool, timestamp, PERIODS[i]!);
    context.SwapVolumeSnapshot.set({
      ...snapshot,
      count: snapshot.count + BIG_INT_ONE,
      amountSold: snapshot.amountSold.plus(amountSold),
      amountBought: snapshot.amountBought.plus(amountBought),
      amountSoldUSD: snapshot.amountSoldUSD.plus(amountSoldUSD),
      amountBoughtUSD: snapshot.amountBoughtUSD.plus(amountBoughtUSD),
      volume: snapshot.volume.plus(volume),
      volumeUSD: snapshot.volumeUSD.plus(volumeUSD),
    });
  }

  context.Pool.set({
    ...pool,
    cumulativeVolume: pool.cumulativeVolume.plus(volume),
    cumulativeVolumeUSD: pool.cumulativeVolumeUSD.plus(volumeUSD),
  });
}
