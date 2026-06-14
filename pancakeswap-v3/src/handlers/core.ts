/**
 * Port of mappings/core.ts (handleInitialize, handleMint, handleBurn,
 * handleSwap, handleFlash, handleCollect, handleCollectProtocol).
 *
 * eth_calls (poolFeeGrowth0/1, poolTicks) are pinned to the event block so
 * bounded historical re-runs are deterministic (see effects/contracts.ts).
 *
 * Deviations from the subgraph, preserved-for-parity quirks:
 * - mint/burn/swap/collect ids use `txHash#poolTxCount` exactly as the source.
 * - `oldTick = pool.tick!` in handleSwap: if a Swap arrives before Initialize,
 *   pool.tick is null. The subgraph would crash-coerce; here we treat null as
 *   the new tick boundary (numIters becomes 0). Documented in MIGRATION.md.
 */
import { BigDecimal, indexer, type Pool, type Tick, type Token } from "envio";
import { FACTORY_ADDRESS, ONE_BI, TWO_BD, ZERO_BD, ZERO_BI, low } from "../utils/constants";
import { convertTokenToDecimal, toBD } from "../utils/index";
import { getOrLoadToken } from "../utils/entity";
import { findEthPerToken, getAdjustedAmounts, getEthPriceInUSD, sqrtPriceX96ToTokenPrices } from "../utils/pricing";
import { updateDerivedTVLAmounts } from "../utils/tvl";
import { createTick, feeTierToTickSpacing } from "../utils/tick";
import { loadTransaction } from "../utils/transaction";
import {
  updatePancakeDayData,
  updatePoolDayData,
  updatePoolHourData,
  updateTickDayData,
  updateTokenDayData,
  updateTokenHourData,
} from "../utils/intervalUpdates";
import { poolFeeGrowth0, poolFeeGrowth1, poolTicks } from "../effects/contracts";

const abs = (x: BigDecimal): BigDecimal => (x.lt(ZERO_BD) ? x.times(new BigDecimal("-1")) : x);

// ---------------------------------------------------------------------------
// Initialize
// ---------------------------------------------------------------------------
indexer.onEvent(
  { contract: "Pool", event: "Initialize" },
  async ({ event, context }) => {
    const poolId = low(event.srcAddress);
    const pool = await context.Pool.get(poolId);
    if (pool === undefined) return;

    const updatedPool: Pool = {
      ...pool,
      sqrtPrice: event.params.sqrtPriceX96,
      tick: BigInt(event.params.tick),
    };
    context.Pool.set(updatedPool);

    let token0 = await getOrLoadToken(context, updatedPool.token0_id);
    let token1 = await getOrLoadToken(context, updatedPool.token1_id);

    let bundle = await context.Bundle.get("1");
    if (bundle === undefined) return;
    bundle = { ...bundle, ethPriceUSD: await getEthPriceInUSD(context) };
    context.Bundle.set(bundle);

    await updatePoolDayData(context, updatedPool, { blockTimestamp: BigInt(event.block.timestamp), poolAddress: poolId });
    await updatePoolHourData(context, updatedPool, { blockTimestamp: BigInt(event.block.timestamp), poolAddress: poolId });

    token0 = { ...token0, derivedETH: await findEthPerToken(context, bundle, token0) };
    token1 = { ...token1, derivedETH: await findEthPerToken(context, bundle, token1) };
    context.Token.set(token0);
    context.Token.set(token1);
  },
);

// ---------------------------------------------------------------------------
// Mint
// ---------------------------------------------------------------------------
indexer.onEvent(
  { contract: "Pool", event: "Mint" },
  async ({ event, context }) => {
    const bundle = await context.Bundle.get("1");
    if (bundle === undefined) return;
    const poolId = low(event.srcAddress);
    let pool = await context.Pool.get(poolId);
    if (pool === undefined) return;
    let factory = await context.Factory.get(FACTORY_ADDRESS);
    if (factory === undefined) return;

    let token0 = await getOrLoadToken(context, pool.token0_id);
    let token1 = await getOrLoadToken(context, pool.token1_id);
    const amount0 = convertTokenToDecimal(event.params.amount0, token0.decimals);
    const amount1 = convertTokenToDecimal(event.params.amount1, token1.decimals);

    const amountUSD = amount0
      .times(token0.derivedETH.times(bundle.ethPriceUSD))
      .plus(amount1.times(token1.derivedETH.times(bundle.ethPriceUSD)));

    const oldPoolTVLETH = pool.totalValueLockedETH;
    const oldPoolTVLETHUntracked = pool.totalValueLockedETHUntracked;
    token0 = { ...token0, totalValueLocked: token0.totalValueLocked.plus(amount0) };
    token1 = { ...token1, totalValueLocked: token1.totalValueLocked.plus(amount1) };
    pool = {
      ...pool,
      totalValueLockedToken0: pool.totalValueLockedToken0.plus(amount0),
      totalValueLockedToken1: pool.totalValueLockedToken1.plus(amount1),
    };
    const tvl = updateDerivedTVLAmounts(
      context,
      bundle,
      pool,
      factory,
      token0,
      token1,
      oldPoolTVLETH,
      oldPoolTVLETHUntracked,
    );
    pool = tvl.pool;
    factory = tvl.factory;
    token0 = tvl.token0;
    token1 = tvl.token1;

    factory = { ...factory, txCount: factory.txCount + ONE_BI };
    token0 = { ...token0, txCount: token0.txCount + ONE_BI };
    token1 = { ...token1, txCount: token1.txCount + ONE_BI };
    pool = { ...pool, txCount: pool.txCount + ONE_BI };

    if (
      pool.tick !== undefined &&
      pool.tick !== null &&
      BigInt(event.params.tickLower) <= pool.tick &&
      BigInt(event.params.tickUpper) > pool.tick
    ) {
      pool = { ...pool, liquidity: pool.liquidity + event.params.amount };
    }

    pool = { ...pool, liquidityProviderCount: pool.liquidityProviderCount + ONE_BI };

    const transaction = await loadTransaction(
      context,
      event.transaction.hash,
      BigInt(event.block.number),
      BigInt(event.block.timestamp),
      event.transaction.gasPrice,
    );

    const mintId = `${transaction.id}#${pool.txCount.toString()}`;
    context.Mint.set({
      id: mintId,
      transaction_id: transaction.id,
      timestamp: transaction.timestamp,
      pool_id: pool.id,
      token0_id: pool.token0_id,
      token1_id: pool.token1_id,
      owner: low(event.params.owner),
      sender: low(event.params.sender),
      origin: low(event.transaction.from ?? "0x"),
      amount: event.params.amount,
      amount0,
      amount1,
      amountUSD,
      tickLower: BigInt(event.params.tickLower),
      tickUpper: BigInt(event.params.tickUpper),
      logIndex: BigInt(event.logIndex),
    });

    // tick entities
    const lowerTickIdx = event.params.tickLower;
    const upperTickIdx = event.params.tickUpper;
    const lowerTickId = `${poolId}#${BigInt(event.params.tickLower).toString()}`;
    const upperTickId = `${poolId}#${BigInt(event.params.tickUpper).toString()}`;

    let lowerTick = await context.Tick.get(lowerTickId);
    let upperTick = await context.Tick.get(upperTickId);
    if (lowerTick === undefined) {
      lowerTick = createTick(lowerTickId, lowerTickIdx, pool.id, BigInt(event.block.timestamp), BigInt(event.block.number));
    }
    if (upperTick === undefined) {
      upperTick = createTick(upperTickId, upperTickIdx, pool.id, BigInt(event.block.timestamp), BigInt(event.block.number));
    }

    const amount = event.params.amount;
    lowerTick = {
      ...lowerTick,
      liquidityGross: lowerTick.liquidityGross + amount,
      liquidityNet: lowerTick.liquidityNet + amount,
    };
    upperTick = {
      ...upperTick,
      liquidityGross: upperTick.liquidityGross + amount,
      liquidityNet: upperTick.liquidityNet - amount,
    };

    await updatePancakeDayData(context, factory, BigInt(event.block.timestamp));
    await updatePoolDayData(context, pool, { blockTimestamp: BigInt(event.block.timestamp), poolAddress: poolId });
    await updatePoolHourData(context, pool, { blockTimestamp: BigInt(event.block.timestamp), poolAddress: poolId });
    await updateTokenDayData(context, bundle, token0, BigInt(event.block.timestamp));
    await updateTokenDayData(context, bundle, token1, BigInt(event.block.timestamp));
    await updateTokenHourData(context, bundle, token0, BigInt(event.block.timestamp));
    await updateTokenHourData(context, bundle, token1, BigInt(event.block.timestamp));

    context.Token.set(token0);
    context.Token.set(token1);
    context.Pool.set(pool);
    context.Factory.set(factory);

    await updateTickFeeVarsAndSave(context, lowerTick, poolId, event.block.number, BigInt(event.block.timestamp));
    await updateTickFeeVarsAndSave(context, upperTick, poolId, event.block.number, BigInt(event.block.timestamp));
  },
);

// ---------------------------------------------------------------------------
// Burn
// ---------------------------------------------------------------------------
indexer.onEvent(
  { contract: "Pool", event: "Burn" },
  async ({ event, context }) => {
    const bundle = await context.Bundle.get("1");
    if (bundle === undefined) return;
    const poolId = low(event.srcAddress);
    let pool = await context.Pool.get(poolId);
    if (pool === undefined) return;
    let factory = await context.Factory.get(FACTORY_ADDRESS);
    if (factory === undefined) return;

    let token0 = await getOrLoadToken(context, pool.token0_id);
    let token1 = await getOrLoadToken(context, pool.token1_id);
    const amount0 = convertTokenToDecimal(event.params.amount0, token0.decimals);
    const amount1 = convertTokenToDecimal(event.params.amount1, token1.decimals);

    const amountUSD = amount0
      .times(token0.derivedETH.times(bundle.ethPriceUSD))
      .plus(amount1.times(token1.derivedETH.times(bundle.ethPriceUSD)));

    factory = { ...factory, txCount: factory.txCount + ONE_BI };
    token0 = { ...token0, txCount: token0.txCount + ONE_BI };
    token1 = { ...token1, txCount: token1.txCount + ONE_BI };
    pool = { ...pool, txCount: pool.txCount + ONE_BI };

    const oldPoolTVLETH = pool.totalValueLockedETH;
    const oldPoolTVLETHUntracked = pool.totalValueLockedETHUntracked;
    token0 = { ...token0, totalValueLocked: token0.totalValueLocked.minus(amount0) };
    token1 = { ...token1, totalValueLocked: token1.totalValueLocked.minus(amount1) };
    pool = {
      ...pool,
      totalValueLockedToken0: pool.totalValueLockedToken0.minus(amount0),
      totalValueLockedToken1: pool.totalValueLockedToken1.minus(amount1),
    };
    const tvl = updateDerivedTVLAmounts(
      context,
      bundle,
      pool,
      factory,
      token0,
      token1,
      oldPoolTVLETH,
      oldPoolTVLETHUntracked,
    );
    pool = tvl.pool;
    factory = tvl.factory;
    token0 = tvl.token0;
    token1 = tvl.token1;

    if (
      pool.tick !== undefined &&
      pool.tick !== null &&
      BigInt(event.params.tickLower) <= pool.tick &&
      BigInt(event.params.tickUpper) > pool.tick
    ) {
      pool = { ...pool, liquidity: pool.liquidity - event.params.amount };
    }

    const transaction = await loadTransaction(
      context,
      event.transaction.hash,
      BigInt(event.block.number),
      BigInt(event.block.timestamp),
      event.transaction.gasPrice,
    );

    const burnId = `${transaction.id}#${pool.txCount.toString()}`;
    context.Burn.set({
      id: burnId,
      transaction_id: transaction.id,
      timestamp: transaction.timestamp,
      pool_id: pool.id,
      token0_id: pool.token0_id,
      token1_id: pool.token1_id,
      owner: low(event.params.owner),
      origin: low(event.transaction.from ?? "0x"),
      amount: event.params.amount,
      amount0,
      amount1,
      amountUSD,
      tickLower: BigInt(event.params.tickLower),
      tickUpper: BigInt(event.params.tickUpper),
      logIndex: BigInt(event.logIndex),
    });

    const lowerTickId = `${poolId}#${BigInt(event.params.tickLower).toString()}`;
    const upperTickId = `${poolId}#${BigInt(event.params.tickUpper).toString()}`;
    let lowerTick = await context.Tick.get(lowerTickId);
    let upperTick = await context.Tick.get(upperTickId);
    if (lowerTick === undefined || upperTick === undefined) {
      // still persist the entities mutated above before bailing
      context.Token.set(token0);
      context.Token.set(token1);
      context.Pool.set(pool);
      context.Factory.set(factory);
      return;
    }
    const amount = event.params.amount;
    lowerTick = {
      ...lowerTick,
      liquidityGross: lowerTick.liquidityGross - amount,
      liquidityNet: lowerTick.liquidityNet - amount,
    };
    upperTick = {
      ...upperTick,
      liquidityGross: upperTick.liquidityGross - amount,
      liquidityNet: upperTick.liquidityNet + amount,
    };

    await updatePancakeDayData(context, factory, BigInt(event.block.timestamp));
    await updatePoolDayData(context, pool, { blockTimestamp: BigInt(event.block.timestamp), poolAddress: poolId });
    await updatePoolHourData(context, pool, { blockTimestamp: BigInt(event.block.timestamp), poolAddress: poolId });
    await updateTokenDayData(context, bundle, token0, BigInt(event.block.timestamp));
    await updateTokenDayData(context, bundle, token1, BigInt(event.block.timestamp));
    await updateTokenHourData(context, bundle, token0, BigInt(event.block.timestamp));
    await updateTokenHourData(context, bundle, token1, BigInt(event.block.timestamp));
    await updateTickFeeVarsAndSave(context, lowerTick, poolId, event.block.number, BigInt(event.block.timestamp));
    await updateTickFeeVarsAndSave(context, upperTick, poolId, event.block.number, BigInt(event.block.timestamp));

    context.Token.set(token0);
    context.Token.set(token1);
    context.Pool.set(pool);
    context.Factory.set(factory);
  },
);

// ---------------------------------------------------------------------------
// Swap
// ---------------------------------------------------------------------------
indexer.onEvent(
  { contract: "Pool", event: "Swap" },
  async ({ event, context }) => {
    let bundle = await context.Bundle.get("1");
    if (bundle === undefined) return;
    let factory = await context.Factory.get(FACTORY_ADDRESS);
    if (factory === undefined) return;
    const poolId = low(event.srcAddress);
    let pool = await context.Pool.get(poolId);
    if (pool === undefined) return;

    let token0 = await getOrLoadToken(context, pool.token0_id);
    let token1 = await getOrLoadToken(context, pool.token1_id);

    const oldTick = pool.tick ?? ZERO_BI;

    const amount0 = convertTokenToDecimal(event.params.amount0, token0.decimals);
    const amount1 = convertTokenToDecimal(event.params.amount1, token1.decimals);
    const protocolFeeAmount0 = convertTokenToDecimal(event.params.protocolFeesToken0, token0.decimals);
    const protocolFeeAmount1 = convertTokenToDecimal(event.params.protocolFeesToken1, token1.decimals);

    const amount0Abs = amount0.times(new BigDecimal(amount0.lt(ZERO_BD) ? "-1" : "1"));
    const amount1Abs = amount1.times(new BigDecimal(amount1.lt(ZERO_BD) ? "-1" : "1"));

    const volumeAmounts = getAdjustedAmounts(bundle, amount0Abs, token0, amount1Abs, token1);
    const volumeETH = volumeAmounts.eth.div(TWO_BD);
    const volumeUSD = volumeAmounts.usd.div(TWO_BD);
    const volumeUSDUntracked = volumeAmounts.usdUntracked.div(TWO_BD);

    const protocolFeeAmounts = getAdjustedAmounts(bundle, protocolFeeAmount0, token0, protocolFeeAmount1, token1);

    const feesETH = volumeETH.times(toBD(pool.feeTier)).div(new BigDecimal("1000000"));
    const feesUSD = volumeUSD.times(toBD(pool.feeTier)).div(new BigDecimal("1000000"));
    const feesProtocolETH = protocolFeeAmounts.eth;

    // global updates
    factory = {
      ...factory,
      txCount: factory.txCount + ONE_BI,
      totalVolumeETH: factory.totalVolumeETH.plus(volumeETH),
      totalVolumeUSD: factory.totalVolumeUSD.plus(volumeUSD),
      untrackedVolumeUSD: factory.untrackedVolumeUSD.plus(volumeUSDUntracked),
      totalFeesETH: factory.totalFeesETH.plus(feesETH),
      totalFeesUSD: factory.totalFeesUSD.plus(feesUSD),
      totalProtocolFeesETH: factory.totalProtocolFeesETH.plus(feesProtocolETH),
      totalProtocolFeesUSD: factory.totalProtocolFeesUSD.plus(protocolFeeAmounts.usd),
    };

    pool = {
      ...pool,
      volumeToken0: pool.volumeToken0.plus(amount0Abs),
      volumeToken1: pool.volumeToken1.plus(amount1Abs),
      volumeUSD: pool.volumeUSD.plus(volumeUSD),
      untrackedVolumeUSD: pool.untrackedVolumeUSD.plus(volumeUSDUntracked),
      feesUSD: pool.feesUSD.plus(feesUSD),
      protocolFeesUSD: pool.protocolFeesUSD.plus(protocolFeeAmounts.usd),
      txCount: pool.txCount + ONE_BI,
      liquidity: event.params.liquidity,
      tick: BigInt(event.params.tick),
      sqrtPrice: event.params.sqrtPriceX96,
    };

    token0 = {
      ...token0,
      volume: token0.volume.plus(amount0Abs),
      volumeUSD: token0.volumeUSD.plus(volumeUSD),
      untrackedVolumeUSD: token0.untrackedVolumeUSD.plus(volumeUSDUntracked),
      feesUSD: token0.feesUSD.plus(feesUSD),
      protocolFeesUSD: token0.protocolFeesUSD.plus(protocolFeeAmounts.usd),
      txCount: token0.txCount + ONE_BI,
    };
    token1 = {
      ...token1,
      volume: token1.volume.plus(amount1Abs),
      volumeUSD: token1.volumeUSD.plus(volumeUSD),
      untrackedVolumeUSD: token1.untrackedVolumeUSD.plus(volumeUSDUntracked),
      feesUSD: token1.feesUSD.plus(feesUSD),
      protocolFeesUSD: token1.protocolFeesUSD.plus(protocolFeeAmounts.usd),
      txCount: token1.txCount + ONE_BI,
    };

    const prices = sqrtPriceX96ToTokenPrices(pool.sqrtPrice, token0, token1);
    pool = { ...pool, token0Price: prices[0]!, token1Price: prices[1]! };
    context.Pool.set(pool);

    const token0DerivedETH = token0.derivedETH;

    // update USD pricing
    bundle = { ...bundle, ethPriceUSD: await getEthPriceInUSD(context) };
    context.Bundle.set(bundle);
    token0 = { ...token0, derivedETH: await findEthPerToken(context, bundle, token0) };
    token1 = { ...token1, derivedETH: await findEthPerToken(context, bundle, token1) };

    const transaction = await loadTransaction(
      context,
      event.transaction.hash,
      BigInt(event.block.number),
      BigInt(event.block.timestamp),
      event.transaction.gasPrice,
    );

    // fix for bad pricing on wbtc-weth 18450862 (mainnet-specific; preserved)
    if (transaction.blockNumber === 18450862n) {
      if (token0.id === "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599") {
        token0 = { ...token0, derivedETH: token0DerivedETH };
      }
    }

    token0 = { ...token0, derivedUSD: token0.derivedETH.times(bundle.ethPriceUSD) };
    token1 = { ...token1, derivedUSD: token1.derivedETH.times(bundle.ethPriceUSD) };

    const oldPoolTVLETH = pool.totalValueLockedETH;
    const oldPoolTVLETHUntracked = pool.totalValueLockedETHUntracked;
    pool = {
      ...pool,
      totalValueLockedToken0: pool.totalValueLockedToken0.plus(amount0),
      totalValueLockedToken1: pool.totalValueLockedToken1.plus(amount1),
    };
    token0 = { ...token0, totalValueLocked: token0.totalValueLocked.plus(amount0) };
    token1 = { ...token1, totalValueLocked: token1.totalValueLocked.plus(amount1) };
    const tvl = updateDerivedTVLAmounts(
      context,
      bundle,
      pool,
      factory,
      token0,
      token1,
      oldPoolTVLETH,
      oldPoolTVLETHUntracked,
    );
    pool = tvl.pool;
    factory = tvl.factory;
    token0 = tvl.token0;
    token1 = tvl.token1;

    // create Swap event
    const swapId = `${transaction.id}#${pool.txCount.toString()}`;
    context.Swap.set({
      id: swapId,
      transaction_id: transaction.id,
      timestamp: transaction.timestamp,
      pool_id: pool.id,
      token0_id: pool.token0_id,
      token1_id: pool.token1_id,
      sender: low(event.params.sender),
      origin: low(event.transaction.from ?? "0x"),
      recipient: low(event.params.recipient),
      amount0,
      amount1,
      amountUSD: volumeUSD,
      amountFeeUSD: protocolFeeAmounts.usd,
      tick: BigInt(event.params.tick),
      sqrtPriceX96: event.params.sqrtPriceX96,
      logIndex: BigInt(event.logIndex),
    });

    // update fee growth (eth_call, pinned to event block)
    const fg0 = await poolFeeGrowth0(context.effect, poolId, event.block.number);
    const fg1 = await poolFeeGrowth1(context.effect, poolId, event.block.number);
    pool = {
      ...pool,
      feeGrowthGlobal0X128: fg0 ?? pool.feeGrowthGlobal0X128,
      feeGrowthGlobal1X128: fg1 ?? pool.feeGrowthGlobal1X128,
    };

    // interval data
    let pancakeDayData = await updatePancakeDayData(context, factory, BigInt(event.block.timestamp));
    let poolDayData = await updatePoolDayData(context, pool, {
      blockTimestamp: BigInt(event.block.timestamp),
      poolAddress: poolId,
    });
    let poolHourData = await updatePoolHourData(context, pool, {
      blockTimestamp: BigInt(event.block.timestamp),
      poolAddress: poolId,
    });
    let token0DayData = await updateTokenDayData(context, bundle, token0, BigInt(event.block.timestamp));
    let token1DayData = await updateTokenDayData(context, bundle, token1, BigInt(event.block.timestamp));
    let token0HourData = await updateTokenHourData(context, bundle, token0, BigInt(event.block.timestamp));
    let token1HourData = await updateTokenHourData(context, bundle, token1, BigInt(event.block.timestamp));

    pancakeDayData = {
      ...pancakeDayData,
      volumeETH: pancakeDayData.volumeETH.plus(volumeETH),
      volumeUSD: pancakeDayData.volumeUSD.plus(volumeUSD),
      feesUSD: pancakeDayData.feesUSD.plus(feesUSD),
      protocolFeesUSD: pancakeDayData.protocolFeesUSD.plus(protocolFeeAmounts.usd),
    };
    poolDayData = {
      ...poolDayData,
      volumeUSD: poolDayData.volumeUSD.plus(volumeUSD),
      volumeToken0: poolDayData.volumeToken0.plus(amount0Abs),
      volumeToken1: poolDayData.volumeToken1.plus(amount1Abs),
      feesUSD: poolDayData.feesUSD.plus(feesUSD),
      protocolFeesUSD: poolDayData.protocolFeesUSD.plus(protocolFeeAmounts.usd),
    };
    poolHourData = {
      ...poolHourData,
      volumeUSD: poolHourData.volumeUSD.plus(volumeUSD),
      volumeToken0: poolHourData.volumeToken0.plus(amount0Abs),
      volumeToken1: poolHourData.volumeToken1.plus(amount1Abs),
      feesUSD: poolHourData.feesUSD.plus(feesUSD),
      protocolFeesUSD: poolHourData.protocolFeesUSD.plus(protocolFeeAmounts.usd),
    };
    token0DayData = {
      ...token0DayData,
      volume: token0DayData.volume.plus(amount0Abs),
      volumeUSD: token0DayData.volumeUSD.plus(volumeUSD),
      untrackedVolumeUSD: token0DayData.untrackedVolumeUSD.plus(volumeUSDUntracked),
      feesUSD: token0DayData.feesUSD.plus(feesUSD),
      protocolFeesUSD: token0DayData.protocolFeesUSD.plus(protocolFeeAmounts.usd),
    };
    token0HourData = {
      ...token0HourData,
      volume: token0HourData.volume.plus(amount0Abs),
      volumeUSD: token0HourData.volumeUSD.plus(volumeUSD),
      untrackedVolumeUSD: token0HourData.untrackedVolumeUSD.plus(volumeUSDUntracked),
      feesUSD: token0HourData.feesUSD.plus(feesUSD),
      protocolFeesUSD: token0HourData.protocolFeesUSD.plus(protocolFeeAmounts.usd),
    };
    token1DayData = {
      ...token1DayData,
      volume: token1DayData.volume.plus(amount1Abs),
      volumeUSD: token1DayData.volumeUSD.plus(volumeUSD),
      untrackedVolumeUSD: token1DayData.untrackedVolumeUSD.plus(volumeUSDUntracked),
      feesUSD: token1DayData.feesUSD.plus(feesUSD),
      protocolFeesUSD: token1DayData.protocolFeesUSD.plus(protocolFeeAmounts.usd),
    };
    token1HourData = {
      ...token1HourData,
      volume: token1HourData.volume.plus(amount1Abs),
      volumeUSD: token1HourData.volumeUSD.plus(volumeUSD),
      untrackedVolumeUSD: token1HourData.untrackedVolumeUSD.plus(volumeUSDUntracked),
      feesUSD: token1HourData.feesUSD.plus(feesUSD),
      protocolFeesUSD: token1HourData.protocolFeesUSD.plus(protocolFeeAmounts.usd),
    };

    context.PancakeDayData.set(pancakeDayData);
    context.PoolDayData.set(poolDayData);
    context.PoolHourData.set(poolHourData);
    context.TokenDayData.set(token0DayData);
    context.TokenDayData.set(token1DayData);
    context.TokenHourData.set(token0HourData);
    context.TokenHourData.set(token1HourData);
    context.Factory.set(factory);
    context.Pool.set(pool);
    context.Token.set(token0);
    context.Token.set(token1);

    // Update inner vars of current or crossed ticks
    const newTick = pool.tick ?? ZERO_BI;
    const tickSpacing = feeTierToTickSpacing(pool.feeTier);
    // graph-node BigInt.mod() is truncated division (sign follows dividend),
    // which matches JS bigint %.
    const modulo = newTick % tickSpacing;
    if (modulo === ZERO_BI) {
      await loadTickUpdateFeeVarsAndSave(context, Number(newTick), poolId, event.block.number, BigInt(event.block.timestamp));
    }

    const diff = oldTick - newTick;
    const numIters = (diff < 0n ? -diff : diff) / tickSpacing;
    if (numIters > 100n) {
      // too many ticks to update; skip to avoid timeouts (matches subgraph)
    } else if (newTick > oldTick) {
      const firstInitialized = oldTick + (tickSpacing - modulo);
      for (let i = firstInitialized; i <= newTick; i = i + tickSpacing) {
        await loadTickUpdateFeeVarsAndSave(context, Number(i), poolId, event.block.number, BigInt(event.block.timestamp));
      }
    } else if (newTick < oldTick) {
      const firstInitialized = oldTick - modulo;
      for (let i = firstInitialized; i >= newTick; i = i - tickSpacing) {
        await loadTickUpdateFeeVarsAndSave(context, Number(i), poolId, event.block.number, BigInt(event.block.timestamp));
      }
    }
  },
);

// ---------------------------------------------------------------------------
// Flash
// ---------------------------------------------------------------------------
indexer.onEvent(
  { contract: "Pool", event: "Flash" },
  async ({ event, context }) => {
    const poolId = low(event.srcAddress);
    const pool = await context.Pool.get(poolId);
    if (pool === undefined) return;
    const fg0 = await poolFeeGrowth0(context.effect, poolId, event.block.number);
    const fg1 = await poolFeeGrowth1(context.effect, poolId, event.block.number);
    context.Pool.set({
      ...pool,
      feeGrowthGlobal0X128: fg0 ?? pool.feeGrowthGlobal0X128,
      feeGrowthGlobal1X128: fg1 ?? pool.feeGrowthGlobal1X128,
    });
  },
);

// ---------------------------------------------------------------------------
// Collect
// ---------------------------------------------------------------------------
indexer.onEvent(
  { contract: "Pool", event: "Collect" },
  async ({ event, context }) => {
    const poolId = low(event.srcAddress);
    let pool = await context.Pool.get(poolId);
    if (pool === undefined) return;
    let factory = await context.Factory.get(FACTORY_ADDRESS);
    if (factory === undefined) return;
    const bundle = await context.Bundle.get("1");
    if (bundle === undefined) return;

    let token0 = await getOrLoadToken(context, pool.token0_id);
    let token1 = await getOrLoadToken(context, pool.token1_id);
    const transaction = await loadTransaction(
      context,
      event.transaction.hash,
      BigInt(event.block.number),
      BigInt(event.block.timestamp),
      event.transaction.gasPrice,
    );

    const amount0 = convertTokenToDecimal(event.params.amount0, token0.decimals);
    const amount1 = convertTokenToDecimal(event.params.amount1, token1.decimals);
    const amounts = getAdjustedAmounts(bundle, amount0, token0, amount1, token1);

    pool = {
      ...pool,
      collectedFeesToken0: pool.collectedFeesToken0.plus(amount0),
      collectedFeesToken1: pool.collectedFeesToken1.plus(amount1),
      collectedFeesUSD: pool.collectedFeesUSD.plus(amounts.usd),
    };

    factory = { ...factory, txCount: factory.txCount + ONE_BI };
    token0 = { ...token0, txCount: token0.txCount + ONE_BI };
    token1 = { ...token1, txCount: token1.txCount + ONE_BI };
    pool = { ...pool, txCount: pool.txCount + ONE_BI };

    const collectId = `${transaction.id}#${pool.txCount.toString()}`;
    context.Collect.set({
      id: collectId,
      transaction_id: transaction.id,
      timestamp: BigInt(event.block.timestamp),
      pool_id: pool.id,
      owner: low(event.params.owner),
      amount0,
      amount1,
      amountUSD: amounts.usd,
      tickLower: BigInt(event.params.tickLower),
      tickUpper: BigInt(event.params.tickUpper),
      logIndex: BigInt(event.logIndex),
    });

    context.Token.set(token0);
    context.Token.set(token1);
    context.Factory.set(factory);
    context.Pool.set(pool);
  },
);

// ---------------------------------------------------------------------------
// CollectProtocol
// ---------------------------------------------------------------------------
indexer.onEvent(
  { contract: "Pool", event: "CollectProtocol" },
  async ({ event, context }) => {
    const poolId = low(event.srcAddress);
    let pool = await context.Pool.get(poolId);
    if (pool === undefined) return;
    let factory = await context.Factory.get(FACTORY_ADDRESS);
    if (factory === undefined) return;
    const bundle = await context.Bundle.get("1");
    if (bundle === undefined) return;
    let token0 = await getOrLoadToken(context, pool.token0_id);
    let token1 = await getOrLoadToken(context, pool.token1_id);

    const amount0 = convertTokenToDecimal(event.params.amount0, token0.decimals);
    const amount1 = convertTokenToDecimal(event.params.amount1, token1.decimals);

    const oldPoolTVLETH = pool.totalValueLockedETH;
    const oldPoolTVLETHUntracked = pool.totalValueLockedETHUntracked;
    pool = {
      ...pool,
      totalValueLockedToken0: pool.totalValueLockedToken0.minus(amount0),
      totalValueLockedToken1: pool.totalValueLockedToken1.minus(amount1),
    };
    token0 = { ...token0, totalValueLocked: token0.totalValueLocked.minus(amount0) };
    token1 = { ...token1, totalValueLocked: token1.totalValueLocked.minus(amount1) };
    const tvl = updateDerivedTVLAmounts(
      context,
      bundle,
      pool,
      factory,
      token0,
      token1,
      oldPoolTVLETH,
      oldPoolTVLETHUntracked,
    );
    pool = tvl.pool;
    factory = tvl.factory;
    token0 = tvl.token0;
    token1 = tvl.token1;

    factory = { ...factory, txCount: factory.txCount + ONE_BI };
    token0 = { ...token0, txCount: token0.txCount + ONE_BI };
    token1 = { ...token1, txCount: token1.txCount + ONE_BI };
    pool = { ...pool, txCount: pool.txCount + ONE_BI };

    context.Token.set(token0);
    context.Token.set(token1);
    context.Factory.set(factory);
    context.Pool.set(pool);
  },
);

// ---------------------------------------------------------------------------
// Tick fee var helpers
// ---------------------------------------------------------------------------
async function updateTickFeeVarsAndSave(
  context: import("envio").EvmOnEventContext,
  tick: Tick,
  poolAddress: string,
  blockNumber: number,
  blockTimestamp: bigint,
): Promise<void> {
  const tickResult = await poolTicks(context.effect, poolAddress, Number(tick.tickIdx), blockNumber);
  let updated: Tick = tick;
  if (tickResult !== null) {
    updated = {
      ...tick,
      feeGrowthOutside0X128: tickResult[2] as bigint,
      feeGrowthOutside1X128: tickResult[3] as bigint,
    };
  }
  context.Tick.set(updated);
  await updateTickDayData(context, updated, blockTimestamp);
}

async function loadTickUpdateFeeVarsAndSave(
  context: import("envio").EvmOnEventContext,
  tickId: number,
  poolAddress: string,
  blockNumber: number,
  blockTimestamp: bigint,
): Promise<void> {
  const tick = await context.Tick.get(`${poolAddress}#${tickId.toString()}`);
  if (tick !== undefined) {
    await updateTickFeeVarsAndSave(context, tick, poolAddress, blockNumber, blockTimestamp);
  }
}
