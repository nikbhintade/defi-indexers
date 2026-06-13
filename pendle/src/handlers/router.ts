/**
 * Port of src/pendle/router.ts (PendleRouter data source handlers):
 * handleSwap / handleJoinLiquidityPool / handleExitLiquidityPool /
 * handleMarketCreated.
 *
 * Template registration on MarketCreated:
 *  - PendleMarketTemplate.create(market)         -> register PendleMarket
 *  - getMarketLiquidityMining -> hardcoded LMv1  -> register PendleLiquidityMiningV1
 *
 * The subgraph callHandler `redeemLpInterests(address,address)` (handleRedeemLpInterests)
 * is a no-op in the source and is not ported (HyperIndex has no callHandlers).
 */
import { indexer, type LiquidityPool, type Pair, type Swap } from "envio";
import {
  ERROR_COMPOUND_MARKET,
  ONE_BD,
  ONE_BI,
  RONE,
  RONE_BD,
  ZERO_BD,
  ZERO_BI,
  convertTokenToDecimal,
  low,
  toBD,
} from "../utils";
import { marketExpiry } from "../effects/contracts";
import { generateNewToken } from "../services/tokens";
import { calcLpPrice, loadPendleData } from "../services/helpers";
import { getUniswapTokenPrice } from "../services/pricing";
import { updatePairDailyData, updatePairHourData } from "../services/updates";
import { getMarketLiquidityMining, hardcodedLmV1Address } from "../services/liquidity-mining";

// ---- contractRegister: PendleMarket + hardcoded PendleLiquidityMiningV1 ----
indexer.contractRegister({ contract: "PendleRouter", event: "MarketCreated" }, async ({ event, context }) => {
  if (low(event.params.market) === ERROR_COMPOUND_MARKET) return;
  context.chain.PendleMarket.add(event.params.market);
  const lmV1 = hardcodedLmV1Address(event.params.market);
  if (lmV1.length > 0) {
    context.chain.PendleLiquidityMiningV1.add(lmV1 as `0x${string}`);
  }
});

indexer.onEvent({ contract: "PendleRouter", event: "SwapEvent" }, async ({ event, context }) => {
  const block = event.block.number;
  const pair = await context.Pair.getOrThrow(low(event.params.market));
  let inToken = await context.Token.getOrThrow(low(event.params.inToken));
  let outToken = await context.Token.getOrThrow(low(event.params.outToken));
  const amountIn = convertTokenToDecimal(event.params.exactIn, inToken.decimals);
  const amountOut = convertTokenToDecimal(event.params.exactOut, outToken.decimals);
  const pendleData = await loadPendleData(context);

  let derivedAmountUSD = ZERO_BD;
  if (inToken.type == "swapBase") {
    const baseTokenPrice = await getUniswapTokenPrice(context, block, inToken);
    derivedAmountUSD = amountIn.times(baseTokenPrice);
  } else {
    const baseTokenPrice = await getUniswapTokenPrice(context, block, outToken);
    derivedAmountUSD = amountOut.times(baseTokenPrice);
  }

  inToken = { ...inToken, tradeVolume: inToken.tradeVolume.plus(amountIn), tradeVolumeUSD: inToken.tradeVolumeUSD.plus(derivedAmountUSD) };
  outToken = { ...outToken, tradeVolume: outToken.tradeVolume.plus(amountOut), tradeVolumeUSD: outToken.tradeVolumeUSD.plus(derivedAmountUSD) };
  inToken = { ...inToken, txCount: inToken.txCount + ONE_BI };
  outToken = { ...outToken, txCount: outToken.txCount + ONE_BI };

  const tokenFee = amountIn.times(pendleData.swapFee);
  const usdFee = derivedAmountUSD.times(pendleData.swapFee);

  let next: Pair = { ...pair, txCount: pair.txCount + ONE_BI, volumeUSD: pair.volumeUSD.plus(derivedAmountUSD) };
  if (inToken.id == next.token0_id) {
    next = {
      ...next,
      volumeToken0: next.volumeToken0.plus(amountIn),
      volumeToken1: next.volumeToken1.plus(amountOut),
      feesToken0: next.feesToken0.plus(tokenFee),
    };
  } else if (inToken.id == next.token1_id) {
    next = {
      ...next,
      volumeToken1: next.volumeToken1.plus(amountIn),
      volumeToken0: next.volumeToken0.plus(amountOut),
      feesToken1: next.feesToken1.plus(tokenFee),
    };
  }
  next = { ...next, feesUSD: next.feesUSD.plus(usdFee) };
  context.Pair.set(next);
  context.Token.set(inToken);
  context.Token.set(outToken);

  // Create Swap Entity (id = tx hash)
  const swap: Swap = {
    id: low(event.transaction.hash),
    timestamp: BigInt(event.block.timestamp),
    pair_id: next.id,
    sender: low(event.params.trader),
    from: low(event.transaction.from ?? ""),
    inToken_id: inToken.id,
    outToken_id: outToken.id,
    inAmount: amountIn,
    outAmount: amountOut,
    to: low(event.params.trader),
    logIndex: BigInt(event.logIndex),
    feesCollected: tokenFee,
    feesCollectedUSD: usdFee,
    amountUSD: derivedAmountUSD,
  };
  context.Swap.set(swap);

  let pairHourData = await updatePairHourData(context, block, BigInt(event.block.timestamp), next);
  let pairDayData = await updatePairDailyData(context, block, BigInt(event.block.timestamp), next);
  // PARITY: the original tests `inToken.underlyingAsset != ""`. In
  // AssemblyScript a *null* string is `!= ""` (true), and underlyingAsset is
  // only ever null or a real address (never the empty string), so the YT
  // branch is effectively always taken — `undefined !== ""` reproduces that.
  if (inToken.underlyingAsset !== "") {
    // inToken is YT
    pairHourData = {
      ...pairHourData,
      hourlyVolumeToken0: pairHourData.hourlyVolumeToken0.plus(amountIn),
      hourlyVolumeToken1: pairHourData.hourlyVolumeToken1.plus(amountOut),
    };
    pairDayData = {
      ...pairDayData,
      dailyVolumeToken0: pairDayData.dailyVolumeToken0.plus(amountIn),
      dailyVolumeToken1: pairDayData.dailyVolumeToken1.plus(amountOut),
    };
  } else {
    pairHourData = {
      ...pairHourData,
      hourlyVolumeToken0: pairHourData.hourlyVolumeToken0.plus(amountOut),
      hourlyVolumeToken1: pairHourData.hourlyVolumeToken1.plus(amountIn),
    };
    pairDayData = {
      ...pairDayData,
      dailyVolumeToken0: pairDayData.dailyVolumeToken0.plus(amountOut),
      dailyVolumeToken1: pairDayData.dailyVolumeToken1.plus(amountIn),
    };
  }
  pairHourData = {
    ...pairHourData,
    hourlyVolumeUSD: pairHourData.hourlyVolumeUSD.plus(derivedAmountUSD),
    hourlyTxns: pairHourData.hourlyTxns + ONE_BI,
  };
  pairDayData = {
    ...pairDayData,
    dailyVolumeUSD: pairDayData.dailyVolumeUSD.plus(derivedAmountUSD),
    dailyTxns: pairDayData.dailyTxns + ONE_BI,
  };
  context.PairHourData.set(pairHourData);
  context.PairDailyData.set(pairDayData);
});

indexer.onEvent({ contract: "PendleRouter", event: "Join" }, async ({ event, context }) => {
  if (low(event.params.market) == ERROR_COMPOUND_MARKET) return;
  const block = event.block.number;
  let pair = await context.Pair.getOrThrow(low(event.params.market));
  const inToken0 = await context.Token.getOrThrow(pair.token0_id);
  const inToken1 = await context.Token.getOrThrow(pair.token1_id);
  const inAmount0 = convertTokenToDecimal(event.params.token0Amount, inToken0.decimals);
  const inAmount1 = convertTokenToDecimal(event.params.token1Amount, inToken1.decimals);

  const rawLpPrice = await calcLpPrice(
    context,
    block,
    low(event.params.market),
    inToken1.id,
    event.params.token1Amount,
    toBD(event.params.exactOutLp),
    true,
  );
  const derivedAmountUSD = toBD(event.params.exactOutLp).times(rawLpPrice);

  let liquidityPool: LiquidityPool = {
    id: low(event.transaction.hash),
    timestamp: BigInt(event.block.timestamp),
    pair_id: pair.id,
    type: "Join",
    from: low(event.params.sender),
    inToken0_id: inToken0.id,
    inToken1_id: inToken1.id,
    inAmount0,
    inAmount1,
    feesCollected: ZERO_BD,
    swapFeesCollectedUSD: ZERO_BD,
    swapVolumeUSD: ZERO_BD,
    amountUSD: derivedAmountUSD,
    lpAmount: convertTokenToDecimal(event.params.exactOutLp, 18n),
  };
  context.LiquidityPool.set(liquidityPool);

  let pairHourData = await updatePairHourData(context, block, BigInt(event.block.timestamp), pair);
  pairHourData = { ...pairHourData, hourlyTxns: pairHourData.hourlyTxns + ONE_BI };
  context.PairHourData.set(pairHourData);
  let pairDayData = await updatePairDailyData(context, block, BigInt(event.block.timestamp), pair);
  pairDayData = { ...pairDayData, dailyTxns: pairDayData.dailyTxns + ONE_BI };
  context.PairDailyData.set(pairDayData);

  // Calculating swap fees for add single liq only
  if (event.params.token0Amount !== ZERO_BI && event.params.token1Amount !== ZERO_BI) {
    return;
  }

  // It will always refer to YT Token (token0) unless token1Amount > 0
  let rawAmount = event.params.token0Amount;
  let rawWeight = pair.token0WeightRaw;
  let tokenPriceFormatted = pair.token0Price;
  let inToken = inToken0;
  if (event.params.token1Amount > ZERO_BI) {
    rawAmount = event.params.token1Amount;
    rawWeight = pair.token1WeightRaw;
    tokenPriceFormatted = pair.token1Price;
    inToken = inToken1;
  }
  const poweredTokenDecimal = exponent(inToken.decimals);
  const rawSwapAmount = (rawAmount * (RONE - rawWeight)) / RONE;

  const pendleData = await loadPendleData(context);
  const usdVolume = toBD(rawSwapAmount).div(poweredTokenDecimal).times(tokenPriceFormatted);
  const usdFee = usdVolume.times(pendleData.swapFee);

  liquidityPool = { ...liquidityPool, swapFeesCollectedUSD: usdFee, swapVolumeUSD: usdVolume };
  pair = { ...pair, feesUSD: pair.feesUSD.plus(usdFee), volumeUSD: pair.volumeUSD.plus(usdVolume) };
  context.LiquidityPool.set(liquidityPool);
  context.Pair.set(pair);

  // Add single
  if (event.params.token0Amount === ZERO_BI || event.params.token1Amount === ZERO_BI) {
    const lpOut = toBD(event.params.exactOutLp);
    const totalLp = pair.totalSupply;
    const token0Weight = toBD(pair.token0WeightRaw).div(RONE_BD);
    const token0Lp = lpOut.times(token0Weight);
    const token1Lp = lpOut.minus(token0Lp);
    const token0Amount = pair.reserve0.times(token0Lp).div(totalLp.times(token0Weight));
    const token1Amount = pair.reserve1.times(token1Lp).div(totalLp.times(ONE_BD.minus(token0Weight)));
    const volumeUSD = token1Amount.times(await getUniswapTokenPrice(context, block, inToken1));

    pairHourData = {
      ...pairHourData,
      hourlyVolumeToken0: pairHourData.hourlyVolumeToken0.plus(token0Amount),
      hourlyVolumeToken1: pairHourData.hourlyVolumeToken1.plus(token1Amount),
      hourlyVolumeUSD: pairHourData.hourlyVolumeUSD.plus(volumeUSD),
    };
    pairDayData = {
      ...pairDayData,
      dailyVolumeToken0: pairDayData.dailyVolumeToken0.plus(token0Amount),
      dailyVolumeToken1: pairDayData.dailyVolumeToken1.plus(token1Amount),
      dailyVolumeUSD: pairDayData.dailyVolumeUSD.plus(volumeUSD),
    };
  }
  context.PairHourData.set(pairHourData);
  context.PairDailyData.set(pairDayData);
});

indexer.onEvent({ contract: "PendleRouter", event: "Exit" }, async ({ event, context }) => {
  if (low(event.params.market) == ERROR_COMPOUND_MARKET) return;
  const block = event.block.number;
  let pair = await context.Pair.getOrThrow(low(event.params.market));
  const outToken0 = await context.Token.getOrThrow(pair.token0_id);
  const outToken1 = await context.Token.getOrThrow(pair.token1_id);
  const outAmount0 = convertTokenToDecimal(event.params.token0Amount, outToken0.decimals);
  const outAmount1 = convertTokenToDecimal(event.params.token1Amount, outToken1.decimals);

  const rawLpPrice = await calcLpPrice(
    context,
    block,
    low(event.params.market),
    outToken1.id,
    event.params.token1Amount,
    toBD(event.params.exactInLp),
    false,
  );
  const derivedAmountUSD = toBD(event.params.exactInLp).times(rawLpPrice);

  let liquidityPool: LiquidityPool = {
    id: low(event.transaction.hash),
    timestamp: BigInt(event.block.timestamp),
    pair_id: pair.id,
    type: "Exit",
    from: low(event.params.sender),
    inToken0_id: outToken0.id,
    inToken1_id: outToken1.id,
    inAmount0: outAmount0,
    inAmount1: outAmount1,
    feesCollected: ZERO_BD,
    swapFeesCollectedUSD: ZERO_BD,
    swapVolumeUSD: ZERO_BD,
    amountUSD: derivedAmountUSD,
    lpAmount: convertTokenToDecimal(event.params.exactInLp, 18n),
  };
  context.LiquidityPool.set(liquidityPool);

  let pairHourData = await updatePairHourData(context, block, BigInt(event.block.timestamp), pair);
  pairHourData = { ...pairHourData, hourlyTxns: pairHourData.hourlyTxns + ONE_BI };
  context.PairHourData.set(pairHourData);
  let pairDayData = await updatePairDailyData(context, block, BigInt(event.block.timestamp), pair);
  pairDayData = { ...pairDayData, dailyTxns: pairDayData.dailyTxns + ONE_BI };
  context.PairDailyData.set(pairDayData);

  if (event.params.token0Amount !== ZERO_BI && event.params.token1Amount !== ZERO_BI) {
    return;
  }

  let rawAmount = event.params.token0Amount;
  let rawWeight = pair.token0WeightRaw;
  let tokenPriceFormatted = pair.token0Price;
  let outToken = outToken0;
  if (event.params.token1Amount > ZERO_BI) {
    rawAmount = event.params.token1Amount;
    rawWeight = pair.token1WeightRaw;
    tokenPriceFormatted = pair.token1Price;
    outToken = outToken1;
  }
  const poweredTokenDecimal = exponent(outToken.decimals);
  const rawSwapAmount = (rawAmount * (RONE - rawWeight)) / RONE;

  const pendleData = await loadPendleData(context);
  const usdVolume = toBD(rawSwapAmount).div(poweredTokenDecimal).times(tokenPriceFormatted);
  const usdFee = usdVolume.times(pendleData.swapFee);

  liquidityPool = { ...liquidityPool, swapFeesCollectedUSD: usdFee, swapVolumeUSD: usdVolume };
  pair = { ...pair, feesUSD: pair.feesUSD.plus(usdFee), volumeUSD: pair.volumeUSD.plus(usdVolume) };
  context.LiquidityPool.set(liquidityPool);
  context.Pair.set(pair);

  // Remove single
  if (event.params.token0Amount === ZERO_BI || event.params.token1Amount === ZERO_BI) {
    const lpIn = toBD(event.params.exactInLp);
    const totalLp = pair.totalSupply.plus(lpIn);
    const reserve0 = pair.reserve0.plus(outAmount0);
    const reserve1 = pair.reserve1.plus(outAmount1);

    const token0Weight = toBD(pair.token0WeightRaw).div(RONE_BD);
    const token0Lp = lpIn.times(token0Weight);
    const token1Lp = lpIn.minus(token0Lp);
    const token0Amount = reserve0.times(token0Lp.div(totalLp.times(token0Weight)));
    const token1Amount = reserve1.times(token1Lp.div(totalLp.times(ONE_BD.minus(token0Weight))));
    const volumeUSD = token1Amount.times(await getUniswapTokenPrice(context, block, outToken1));

    pairHourData = {
      ...pairHourData,
      hourlyVolumeToken0: pairHourData.hourlyVolumeToken0.plus(token0Amount),
      hourlyVolumeToken1: pairHourData.hourlyVolumeToken1.plus(token1Amount),
      hourlyVolumeUSD: pairHourData.hourlyVolumeUSD.plus(volumeUSD),
    };
    pairDayData = {
      ...pairDayData,
      dailyVolumeToken0: pairDayData.dailyVolumeToken0.plus(token0Amount),
      dailyVolumeToken1: pairDayData.dailyVolumeToken1.plus(token1Amount),
      dailyVolumeUSD: pairDayData.dailyVolumeUSD.plus(volumeUSD),
    };
  }
  context.PairDailyData.set(pairDayData);
  context.PairHourData.set(pairHourData);
});

indexer.onEvent({ contract: "PendleRouter", event: "MarketCreated" }, async ({ event, context }) => {
  if (low(event.params.market) == ERROR_COMPOUND_MARKET) return;
  const block = event.block.number;
  let token0 = await context.Token.get(low(event.params.xyt));
  let token1 = await context.Token.get(low(event.params.token));
  // Generating LP Token
  await generateNewToken(context, low(event.params.market), block);

  if (token0 === undefined) {
    token0 = await generateNewToken(context, low(event.params.xyt), block);
  }
  if (token1 === undefined) {
    token1 = await generateNewToken(context, low(event.params.token), block);
  }

  token0 = { ...token0, type: "yt" };
  token1 = { ...token1, type: "swapBase" };

  const lm = await getMarketLiquidityMining(context, low(event.params.market));
  const expiryVal = (await marketExpiry(context.effect, low(event.params.market))) ?? 0n;

  const pair: Pair = {
    id: low(event.params.market),
    token0_id: token0.id,
    token1_id: token1.id,
    token0WeightRaw: ZERO_BI,
    token1WeightRaw: ZERO_BI,
    liquidityProviderCount: ZERO_BI,
    createdAtTimestamp: BigInt(event.block.timestamp),
    createdAtBlockNumber: BigInt(event.block.number),
    txCount: ZERO_BI,
    feesToken0: ZERO_BD,
    feesToken1: ZERO_BD,
    feesUSD: ZERO_BD,
    reserve0: ZERO_BD,
    reserve1: ZERO_BD,
    reserveUSD: ZERO_BD,
    totalSupply: ZERO_BD,
    volumeToken0: ZERO_BD,
    volumeToken1: ZERO_BD,
    volumeUSD: ZERO_BD,
    token0Price: ZERO_BD,
    token1Price: ZERO_BD,
    lpStaked: ZERO_BD,
    lpPriceUSD: ZERO_BD,
    lpStakedUSD: ZERO_BD,
    expiry: expiryVal,
    liquidityMining_id: lm === null ? undefined : lm.id,
    lpAPR: undefined,
    yieldTokenHolderAddress: undefined,
  };

  context.Token.set(token0);
  context.Token.set(token1);
  context.Pair.set(pair);
});

function exponent(decimals: bigint) {
  let bd = ONE_BD;
  const ten = toBD(10n);
  for (let i = 0n; i < decimals; i++) bd = bd.times(ten);
  return bd;
}
