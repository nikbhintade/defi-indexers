import { BigDecimal, indexer } from "envio";
import type { EvmOnEventContext } from "envio";
type handlerContext = EvmOnEventContext;
import {
  ADDRESS_ZERO,
  FACTORY_ADDRESS,
  ONE_BI,
  ZERO_BD,
  ZERO_BI,
  _18_BI,
  a,
} from "../constants.js";
import { convertTokenToDecimal } from "../helpers/math.js";
import {
  createLiquidityPosition,
  createLiquiditySnapshot,
  createUserIfNecessary,
  getOrCreateTransaction,
} from "../helpers/entities.js";
import { findEthPerToken, getEthPriceInUSD, getTokenOraclePriceUSD, getTrackedLiquidityUSD } from "../helpers/pricing.js";
import { pairBalanceOf } from "../effects/contracts.js";

type Ctx = handlerContext;

// ---------------------------------------------------------------------------
// Factory: register the AmmPair template + create AmmPair/Bundle/reverse lookups
// ---------------------------------------------------------------------------
indexer.contractRegister({ contract: "AmmFactory", event: "PairCreated" }, async ({ event, context }) => {
  context.chain.AmmPair.add(event.params.pair);
});

indexer.onEvent({ contract: "AmmFactory", event: "PairCreated" }, async ({ event, context }) => {
  let factory = await context.AmmFactory.get(FACTORY_ADDRESS);
  if (factory === undefined) {
    factory = {
      id: FACTORY_ADDRESS,
      pairCount: 0,
      totalAmmVolumeUSD: ZERO_BD,
      ammLiquidityUSD: ZERO_BD,
      transactionCount: ZERO_BI,
      ammTradeCount: ZERO_BI,
      ammMintCount: ZERO_BI,
      ammBurnCount: ZERO_BI,
    };
    context.Bundle.set({ id: "1", ethPrice: ZERO_BD });
  }
  factory = { ...factory, pairCount: factory.pairCount + 1 };
  context.AmmFactory.set(factory);

  // tokens must already exist (created in LogAddMarket); load by id
  const token0 = await context.Token.getOrThrow(a(event.params.token0));
  const token1 = await context.Token.getOrThrow(a(event.params.token1));
  const pairId = a(event.params.pair);

  context.AmmPair.set({
    id: pairId,
    token0_id: token0.id,
    token1_id: token1.id,
    liquidityProviderCount: ZERO_BI,
    createdAtTimestamp: BigInt(event.block.timestamp),
    createdAtBlockNumber: BigInt(event.block.number),
    transactionCount: ZERO_BI,
    reserve0: ZERO_BD,
    reserve1: ZERO_BD,
    trackedReserveETH: ZERO_BD,
    reserveETH: ZERO_BD,
    reserveUSD: ZERO_BD,
    totalSupply: ZERO_BD,
    volumeToken0: ZERO_BD,
    volumeToken1: ZERO_BD,
    volumeUSD: ZERO_BD,
    token0Price: ZERO_BD,
    token1Price: ZERO_BD,
  });

  context.AmmPairReverseLookup.set({ id: `${token0.id}-${token1.id}`, pair_id: pairId });
  context.AmmPairReverseLookup.set({ id: `${token1.id}-${token0.id}`, pair_id: pairId });
});

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------
indexer.onEvent({ contract: "AmmPair", event: "Sync" }, async ({ event, context }) => {
  const pairId = a(event.srcAddress);
  let pair = await context.AmmPair.getOrThrow(pairId);
  let token0 = await context.Token.getOrThrow(pair.token0_id);
  let token1 = await context.Token.getOrThrow(pair.token1_id);
  let factory = await context.AmmFactory.getOrThrow(FACTORY_ADDRESS);

  factory = { ...factory, ammLiquidityUSD: factory.ammLiquidityUSD.minus(pair.reserveUSD) };
  token0 = { ...token0, ammTradeLiquidity: token0.ammTradeLiquidity.minus(pair.reserve0) };
  token1 = { ...token1, ammTradeLiquidity: token1.ammTradeLiquidity.minus(pair.reserve1) };

  const reserve0 = convertTokenToDecimal(event.params.reserve0, token0.decimals);
  const reserve1 = convertTokenToDecimal(event.params.reserve1, token1.decimals);
  pair = {
    ...pair,
    reserve0,
    reserve1,
    token0Price: !reserve1.eq(ZERO_BD) ? reserve0.div(reserve1) : ZERO_BD,
    token1Price: !reserve0.eq(ZERO_BD) ? reserve1.div(reserve0) : ZERO_BD,
  };
  context.AmmPair.set(pair);

  let bundle = await context.Bundle.getOrThrow("1");
  bundle = { ...bundle, ethPrice: await getEthPriceInUSD(context) };
  context.Bundle.set(bundle);

  token0 = { ...token0, derivedETH: await findEthPerToken(context, token0) };
  context.Token.set(token0);
  token1 = { ...token1, derivedETH: await findEthPerToken(context, token1) };
  context.Token.set(token1);

  let trackedLiquidityETH: BigDecimal;
  if (!bundle.ethPrice.eq(ZERO_BD)) {
    trackedLiquidityETH = (await getTrackedLiquidityUSD(context, pair.reserve0, token0, pair.reserve1, token1)).div(bundle.ethPrice);
  } else {
    trackedLiquidityETH = ZERO_BD;
  }

  const reserveETH = pair.reserve0.times(token0.derivedETH ?? ZERO_BD).plus(pair.reserve1.times(token1.derivedETH ?? ZERO_BD));
  pair = {
    ...pair,
    trackedReserveETH: trackedLiquidityETH,
    reserveETH,
    reserveUSD: reserveETH.times(bundle.ethPrice),
  };

  factory = { ...factory, ammLiquidityUSD: factory.ammLiquidityUSD.plus(pair.reserveUSD) };
  token0 = { ...token0, ammTradeLiquidity: token0.ammTradeLiquidity.plus(pair.reserve0) };
  token1 = { ...token1, ammTradeLiquidity: token1.ammTradeLiquidity.plus(pair.reserve1) };

  context.AmmPair.set(pair);
  context.AmmFactory.set(factory);
  context.Token.set(token0);
  context.Token.set(token1);
});

// ---------------------------------------------------------------------------
// ERC20 Transfer (mint/burn lifecycle bookkeeping)
// ---------------------------------------------------------------------------
indexer.onEvent({ contract: "AmmPair", event: "Transfer" }, async ({ event, context }) => {
  const fromAddr = a(event.params.from);
  const toAddr = a(event.params.to);
  if (toAddr === ADDRESS_ZERO && event.params.value === 1000n) {
    return;
  }

  let factory = await context.AmmFactory.getOrThrow(FACTORY_ADDRESS);
  await createUserIfNecessary(context, fromAddr);
  await createUserIfNecessary(context, toAddr);

  const pairId = a(event.srcAddress);
  let pair = await context.AmmPair.getOrThrow(pairId);
  const value = convertTokenToDecimal(event.params.value, _18_BI);
  const blockNumber = BigInt(event.block.number);
  const timestamp = BigInt(event.block.timestamp);
  let transaction = await getOrCreateTransaction(context, event.transaction.hash, blockNumber, timestamp);

  const isCompleteMint = async (mintId: string): Promise<boolean> => {
    const m = await context.AmmMint.getOrThrow(mintId);
    return m.sender !== undefined && m.sender !== null;
  };
  const ammEventID = (n: number) => `${a(event.transaction.hash)}-${n.toString()}`;

  let mints = transaction.intermittentAmmMints;

  // mint
  if (fromAddr === ADDRESS_ZERO) {
    pair = { ...pair, totalSupply: pair.totalSupply.plus(value) };
    context.AmmPair.set(pair);
    if (mints.length === 0 || (await isCompleteMint(mints[mints.length - 1]!))) {
      factory = { ...factory, ammMintCount: factory.ammMintCount + ONE_BI };
      const mintId = ammEventID(mints.length);
      context.AmmMint.set({
        id: mintId,
        transaction_id: transaction.id,
        pair_id: pair.id,
        to: toAddr,
        liquidity: value,
        timestamp: transaction.timestamp,
        serialId: factory.ammMintCount,
        sender: undefined,
        amount0: undefined,
        amount1: undefined,
        logIndex: undefined,
        amountUSD: undefined,
        feeTo: undefined,
        feeLiquidity: undefined,
      });
      transaction = { ...transaction, intermittentAmmMints: mints.concat([mintId]) };
      context.Transaction.set(transaction);
      context.AmmFactory.set(factory);
      mints = transaction.intermittentAmmMints;
    }
  }

  // direct send (burn-on-ETH-withdrawal path)
  if (toAddr === pair.id) {
    factory = { ...factory, ammBurnCount: factory.ammBurnCount + ONE_BI };
    context.AmmFactory.set(factory);
    const burns = transaction.intermittentAmmBurns;
    const burnId = ammEventID(burns.length);
    context.AmmBurn.set({
      id: burnId,
      transaction_id: transaction.id,
      pair_id: pair.id,
      liquidity: value,
      timestamp: transaction.timestamp,
      to: toAddr,
      sender: fromAddr,
      needsComplete: true,
      serialId: factory.ammBurnCount,
      amount0: undefined,
      amount1: undefined,
      logIndex: undefined,
      amountUSD: undefined,
      feeTo: undefined,
      feeLiquidity: undefined,
    });
    transaction = { ...transaction, intermittentAmmBurns: burns.concat([burnId]) };
    context.Transaction.set(transaction);
  }

  // burn
  if (toAddr === ADDRESS_ZERO && fromAddr === pair.id) {
    pair = { ...pair, totalSupply: pair.totalSupply.minus(value) };
    context.AmmPair.set(pair);

    const burns = transaction.intermittentAmmBurns;
    let burnId: string;
    if (burns.length > 0) {
      const currentBurn = await context.AmmBurn.getOrThrow(burns[burns.length - 1]!);
      if (currentBurn.needsComplete) {
        burnId = currentBurn.id;
      } else {
        factory = { ...factory, ammBurnCount: factory.ammBurnCount + ONE_BI };
        burnId = ammEventID(burns.length);
        context.AmmBurn.set({
          id: burnId,
          transaction_id: transaction.id,
          needsComplete: false,
          pair_id: pair.id,
          liquidity: value,
          timestamp: transaction.timestamp,
          serialId: factory.ammBurnCount,
          sender: undefined, amount0: undefined, amount1: undefined, to: undefined, logIndex: undefined, amountUSD: undefined, feeTo: undefined, feeLiquidity: undefined,
        });
        factory = { ...factory, ammBurnCount: factory.ammBurnCount + ONE_BI };
        context.AmmFactory.set(factory);
      }
    } else {
      burnId = ammEventID(burns.length);
      context.AmmBurn.set({
        id: burnId,
        transaction_id: transaction.id,
        needsComplete: false,
        pair_id: pair.id,
        liquidity: value,
        timestamp: transaction.timestamp,
        serialId: factory.ammBurnCount,
        sender: undefined, amount0: undefined, amount1: undefined, to: undefined, logIndex: undefined, amountUSD: undefined, feeTo: undefined, feeLiquidity: undefined,
      });
      factory = { ...factory, ammBurnCount: factory.ammBurnCount + ONE_BI };
      context.AmmFactory.set(factory);
    }

    let burn = await context.AmmBurn.getOrThrow(burnId);
    if (mints.length !== 0 && !(await isCompleteMint(mints[mints.length - 1]!))) {
      const mint = await context.AmmBurn.get(mints[mints.length - 1]!);
      const mintEnt = await context.AmmMint.getOrThrow(mints[mints.length - 1]!);
      burn = { ...burn, feeTo: mintEnt.to, feeLiquidity: mintEnt.liquidity };
      context.AmmMint.deleteUnsafe(mints[mints.length - 1]!);
      transaction = { ...transaction, intermittentAmmMints: mints.slice(0, mints.length - 1) };
      context.Transaction.set(transaction);
      void mint;
    }
    context.AmmBurn.set(burn);

    if (burn.needsComplete) {
      transaction = { ...transaction, intermittentAmmBurns: burns.slice(0, burns.length - 1).concat([burn.id]) };
    } else {
      transaction = { ...transaction, intermittentAmmBurns: burns.concat([burn.id]) };
    }
    context.Transaction.set(transaction);
  }

  const blk = Number(event.block.number);
  if (fromAddr !== ADDRESS_ZERO && fromAddr !== pair.id) {
    let pos = await createLiquidityPosition(context, event.srcAddress, fromAddr);
    const bal = await pairBalanceOf(context.effect, pairId, fromAddr, blk);
    pos = { ...pos, liquidityTokenBalance: convertTokenToDecimal(bal ?? ZERO_BI, _18_BI) };
    context.AmmLiquidityPosition.set(pos);
    await createLiquiditySnapshot(context, pos, blockNumber, timestamp);
  }
  if (toAddr !== ADDRESS_ZERO && toAddr !== pair.id) {
    let pos = await createLiquidityPosition(context, event.srcAddress, toAddr);
    const bal = await pairBalanceOf(context.effect, pairId, toAddr, blk);
    pos = { ...pos, liquidityTokenBalance: convertTokenToDecimal(bal ?? ZERO_BI, _18_BI) };
    context.AmmLiquidityPosition.set(pos);
    await createLiquiditySnapshot(context, pos, blockNumber, timestamp);
  }
});

// ---------------------------------------------------------------------------
// Mint / Burn (complete the intermittent record)
// ---------------------------------------------------------------------------
indexer.onEvent({ contract: "AmmPair", event: "Mint" }, async ({ event, context }) => {
  const transaction = await context.Transaction.getOrThrow(a(event.transaction.hash));
  const mints = transaction.intermittentAmmMints;
  let mint = await context.AmmMint.getOrThrow(mints[mints.length - 1]!);

  const pairId = a(event.srcAddress);
  let pair = await context.AmmPair.getOrThrow(pairId);
  let factory = await context.AmmFactory.getOrThrow(FACTORY_ADDRESS);
  let token0 = await context.Token.getOrThrow(pair.token0_id);
  let token1 = await context.Token.getOrThrow(pair.token1_id);

  const blockNumber = BigInt(event.block.number);
  const timestamp = BigInt(event.block.timestamp);
  const blockHash = a(event.block.hash ?? "0x");

  const token0Amount = convertTokenToDecimal(event.params.amount0Wei, token0.decimals);
  const token1Amount = convertTokenToDecimal(event.params.amount1Wei, token1.decimals);

  token0 = { ...token0, transactionCount: token0.transactionCount + ONE_BI };
  token1 = { ...token1, transactionCount: token1.transactionCount + ONE_BI };

  const amountTotalUSD = (await getTokenOraclePriceUSD(context, token0, blockNumber, blockHash))
    .times(token0Amount)
    .plus((await getTokenOraclePriceUSD(context, token1, blockNumber, blockHash)).times(token1Amount));

  pair = { ...pair, transactionCount: pair.transactionCount + ONE_BI };
  factory = { ...factory, transactionCount: factory.transactionCount + ONE_BI };

  context.Token.set(token0);
  context.Token.set(token1);
  context.AmmPair.set(pair);
  context.AmmFactory.set(factory);

  mint = { ...mint, sender: a(event.params.sender), amount0: token0Amount, amount1: token1Amount, logIndex: BigInt(event.logIndex), amountUSD: amountTotalUSD };
  context.AmmMint.set(mint);

  const pos = await createLiquidityPosition(context, event.srcAddress, mint.to);
  await createLiquiditySnapshot(context, pos, blockNumber, timestamp);
});

indexer.onEvent({ contract: "AmmPair", event: "Burn" }, async ({ event, context }) => {
  const transaction = await context.Transaction.get(a(event.transaction.hash));
  if (transaction === undefined) return;
  const burns = transaction.intermittentAmmBurns;
  let burn = await context.AmmBurn.getOrThrow(burns[burns.length - 1]!);

  const pairId = a(event.srcAddress);
  let pair = await context.AmmPair.getOrThrow(pairId);
  let factory = await context.AmmFactory.getOrThrow(FACTORY_ADDRESS);
  let token0 = await context.Token.getOrThrow(pair.token0_id);
  let token1 = await context.Token.getOrThrow(pair.token1_id);

  const blockNumber = BigInt(event.block.number);
  const timestamp = BigInt(event.block.timestamp);
  const blockHash = a(event.block.hash ?? "0x");

  const token0Amount = convertTokenToDecimal(event.params.amount0Wei, token0.decimals);
  const token1Amount = convertTokenToDecimal(event.params.amount1Wei, token1.decimals);

  token0 = { ...token0, transactionCount: token0.transactionCount + ONE_BI };
  token1 = { ...token1, transactionCount: token1.transactionCount + ONE_BI };

  const amountTotalUSD = (await getTokenOraclePriceUSD(context, token0, blockNumber, blockHash))
    .times(token0Amount)
    .plus((await getTokenOraclePriceUSD(context, token1, blockNumber, blockHash)).times(token1Amount));

  factory = { ...factory, transactionCount: factory.transactionCount + ONE_BI };
  pair = { ...pair, transactionCount: pair.transactionCount + ONE_BI };

  context.Token.set(token0);
  context.Token.set(token1);
  context.AmmPair.set(pair);
  context.AmmFactory.set(factory);

  burn = { ...burn, amount0: token0Amount, amount1: token1Amount, logIndex: BigInt(event.logIndex), amountUSD: amountTotalUSD };
  context.AmmBurn.set(burn);

  if (burn.sender !== undefined && burn.sender !== null) {
    const pos = await createLiquidityPosition(context, event.srcAddress, burn.sender);
    await createLiquiditySnapshot(context, pos, blockNumber, timestamp);
  }
});

// ---------------------------------------------------------------------------
// Swap
// ---------------------------------------------------------------------------
indexer.onEvent({ contract: "AmmPair", event: "Swap" }, async ({ event, context }) => {
  const pairId = a(event.srcAddress);
  let pair = await context.AmmPair.getOrThrow(pairId);
  let token0 = await context.Token.getOrThrow(pair.token0_id);
  let token1 = await context.Token.getOrThrow(pair.token1_id);

  const blockNumber = BigInt(event.block.number);
  const timestamp = BigInt(event.block.timestamp);
  const blockHash = a(event.block.hash ?? "0x");

  const amount0In = convertTokenToDecimal(event.params.amount0In, token0.decimals);
  const amount1In = convertTokenToDecimal(event.params.amount1In, token1.decimals);
  const amount0Out = convertTokenToDecimal(event.params.amount0Out, token0.decimals);
  const amount1Out = convertTokenToDecimal(event.params.amount1Out, token1.decimals);

  const amount0Total = amount0Out.plus(amount0In);
  const amount1Total = amount1Out.plus(amount1In);

  const token0PriceUSD = await getTokenOraclePriceUSD(context, token0, blockNumber, blockHash);
  const token1PriceUSD = await getTokenOraclePriceUSD(context, token1, blockNumber, blockHash);

  token0 = { ...token0, transactionCount: token0.transactionCount + ONE_BI };
  token1 = { ...token1, transactionCount: token1.transactionCount + ONE_BI };

  const volumeUSD = amount0In.times(token0PriceUSD).plus(amount1In.times(token1PriceUSD));
  pair = {
    ...pair,
    volumeUSD: pair.volumeUSD.plus(volumeUSD),
    volumeToken0: pair.volumeToken0.plus(amount0Total),
    volumeToken1: pair.volumeToken1.plus(amount1Total),
    transactionCount: pair.transactionCount + ONE_BI,
  };
  context.AmmPair.set(pair);

  let factory = await context.AmmFactory.getOrThrow(FACTORY_ADDRESS);
  factory = {
    ...factory,
    totalAmmVolumeUSD: factory.totalAmmVolumeUSD.plus(volumeUSD),
    transactionCount: factory.transactionCount + ONE_BI,
    ammTradeCount: factory.ammTradeCount + ONE_BI,
  };
  context.AmmPair.set(pair);
  context.Token.set(token0);
  context.Token.set(token1);
  context.AmmFactory.set(factory);

  const transaction = await getOrCreateTransaction(context, event.transaction.hash, blockNumber, timestamp);
  const tradeId = `${a(event.transaction.hash)}-${transaction.intermittentAmmTrades.length.toString()}`;
  context.AmmTrade.set({
    id: tradeId,
    transaction_id: transaction.id,
    pair_id: pair.id,
    timestamp: transaction.timestamp,
    sender: a(event.params.sender),
    amount0In,
    amount1In,
    amount0Out,
    amount1Out,
    to: a(event.params.to),
    from: a(event.transaction.from ?? ADDRESS_ZERO),
    logIndex: BigInt(event.logIndex),
    serialId: factory.ammTradeCount,
    amountUSD: volumeUSD,
  });

  context.Transaction.set({ ...transaction, intermittentAmmTrades: transaction.intermittentAmmTrades.concat([tradeId]) });
});
