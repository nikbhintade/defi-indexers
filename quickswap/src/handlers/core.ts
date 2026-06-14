/**
 * Port of mappings/core.ts (handleTransfer, handleSync, handleMint, handleBurn,
 * handleSwap).
 *
 * Faithfully preserved quirks (see MIGRATION.md):
 * - handleTransfer's burn branch fires on `to == ADDRESS_ZERO` ALONE (unlike
 *   some Uniswap-V2 forks that also require `from == pair.id`).
 * - handleSync computes bundle.ethPrice / derived prices *before* saving the
 *   pair, so for the pricing pair the store still holds the previous sync's
 *   reserves/prices (graph-node entity-cache staleness).
 * - a Burn entity reused from the "direct send to pair" path keeps
 *   `needsComplete: true` and its original `liquidity` forever.
 * - `trackedAmountUSD === ZERO_BD` in handleSwap is the AssemblyScript identity
 *   comparison against the shared ZERO_BD sentinel returned by getTrackedVolumeUSD.
 * - UniswapDayData.totalVolume{ETH,USD} are initialized to 0 and never
 *   accumulated (original behaviour).
 * - blacklist short-circuits in handleMint/handleBurn/handleSwap (after txn/
 *   array bookkeeping has begun, mirroring the original's early `return`).
 * - LP positions/snapshots use Pair.balanceOf(account) pinned to the event block.
 */
import { BigDecimal, indexer, type Burn, type EvmOnEventContext, type Mint, type Transaction } from "envio";
import { ADDRESS_ZERO, BI_18, convertTokenToDecimal, FACTORY_ADDRESS, low, ONE_BI, ZERO_BD } from "../utils";
import {
  findEthPerToken,
  getEthPriceInUSD,
  getTrackedLiquidityUSD,
  getTrackedVolumeUSD,
  isOnBlacklist,
} from "../pricing";
import { updatePairDayData, updatePairHourData, updateTokenDayData, updateUniswapDayData } from "../dayUpdates";
import { createLiquidityPosition, createLiquiditySnapshot } from "../services/liquidity";
import { pairBalanceOf } from "../effects/contracts";

async function isCompleteMint(context: EvmOnEventContext, mintId: string): Promise<boolean> {
  // original: MintEvent.load(mintId).sender !== null (crashes if missing)
  return (await context.Mint.getOrThrow(mintId)).sender !== undefined; // sufficient checks
}

indexer.onEvent(
  { contract: "Pair", event: "Transfer" },
  async ({ event, context }) => {
    const from = low(event.params.from);
    const to = low(event.params.to);

    // ignore initial transfers for first adds
    if (to == ADDRESS_ZERO && event.params.value === 1000n) {
      return;
    }

    const pairId = low(event.srcAddress);
    let pair = await context.Pair.getOrThrow(pairId);

    // liquidity token amount being transferred
    const value = convertTokenToDecimal(event.params.value, BI_18);

    // get or create transaction
    const txHash = low(event.transaction.hash);
    let transaction = await context.Transaction.get(txHash);
    if (transaction === undefined) {
      transaction = {
        id: txHash,
        blockNumber: BigInt(event.block.number),
        timestamp: BigInt(event.block.timestamp),
        mints: [],
        burns: [],
        swaps: [],
      };
    }

    // mints (local snapshot, like the original's `let mints = transaction.mints`)
    const mints = [...transaction.mints];
    if (from == ADDRESS_ZERO) {
      // update total supply
      pair = { ...pair, totalSupply: pair.totalSupply.plus(value) };
      context.Pair.set(pair);

      // create new mint if no mints so far or if last one is done already
      if (mints.length === 0 || (await isCompleteMint(context, mints[mints.length - 1]!))) {
        const mint: Mint = {
          id: txHash.concat("-").concat(mints.length.toString()),
          transaction_id: transaction.id,
          pair_id: pair.id,
          to: to,
          liquidity: value,
          timestamp: transaction.timestamp,
          sender: undefined,
          amount0: undefined,
          amount1: undefined,
          logIndex: undefined,
          amountUSD: undefined,
          feeTo: undefined,
          feeLiquidity: undefined,
        };
        context.Mint.set(mint);

        // update mints in transaction
        transaction = { ...transaction, mints: mints.concat([mint.id]) };
        context.Transaction.set(transaction);
      }
    }

    // case where direct send first on ETH withdrawls
    if (to == pair.id) {
      const burns = [...transaction.burns];
      const burn: Burn = {
        id: txHash.concat("-").concat(burns.length.toString()),
        transaction_id: transaction.id,
        pair_id: pair.id,
        liquidity: value,
        timestamp: transaction.timestamp,
        to: to,
        sender: from,
        needsComplete: true,
        amount0: undefined,
        amount1: undefined,
        logIndex: undefined,
        amountUSD: undefined,
        feeTo: undefined,
        feeLiquidity: undefined,
      };
      context.Burn.set(burn);

      burns.push(burn.id);
      transaction = { ...transaction, burns };
      context.Transaction.set(transaction);
    }

    // burn
    if (to == ADDRESS_ZERO) {
      pair = { ...pair, totalSupply: pair.totalSupply.minus(value) };
      context.Pair.set(pair);

      // this is a new instance of a logical burn
      const burns = [...transaction.burns];
      let burn: Burn;
      if (burns.length > 0) {
        const currentBurn = await context.Burn.getOrThrow(burns[burns.length - 1]!);
        if (currentBurn.needsComplete) {
          burn = currentBurn;
        } else {
          burn = {
            id: txHash.concat("-").concat(burns.length.toString()),
            transaction_id: transaction.id,
            needsComplete: false,
            pair_id: pair.id,
            liquidity: value,
            timestamp: transaction.timestamp,
            to: undefined,
            sender: undefined,
            amount0: undefined,
            amount1: undefined,
            logIndex: undefined,
            amountUSD: undefined,
            feeTo: undefined,
            feeLiquidity: undefined,
          };
        }
      } else {
        burn = {
          id: txHash.concat("-").concat(burns.length.toString()),
          transaction_id: transaction.id,
          needsComplete: false,
          pair_id: pair.id,
          liquidity: value,
          timestamp: transaction.timestamp,
          to: undefined,
          sender: undefined,
          amount0: undefined,
          amount1: undefined,
          logIndex: undefined,
          amountUSD: undefined,
          feeTo: undefined,
          feeLiquidity: undefined,
        };
      }

      // if this logical burn included a fee mint, account for this
      if (mints.length !== 0 && !(await isCompleteMint(context, mints[mints.length - 1]!))) {
        const mint = await context.Mint.getOrThrow(mints[mints.length - 1]!);
        burn = { ...burn, feeTo: mint.to, feeLiquidity: mint.liquidity };
        // remove the logical mint
        context.Mint.deleteUnsafe(mints[mints.length - 1]!);
        // update the transaction
        mints.pop();
        transaction = { ...transaction, mints: [...mints] };
        context.Transaction.set(transaction);
      }
      context.Burn.set(burn);
      // if accessing last one, replace it
      if (burn.needsComplete) {
        burns[burns.length - 1] = burn.id;
      }
      // else add new one
      else {
        burns.push(burn.id);
      }
      transaction = { ...transaction, burns };
      context.Transaction.set(transaction);
    }

    // LP position tracking (uses Pair.balanceOf pinned to the event block)
    if (from != ADDRESS_ZERO && from != pair.id) {
      const fromPos = await createLiquidityPosition(context, pairId, from);
      const bal = await pairBalanceOf(context.effect, pairId, from, event.block.number);
      const fromUpdated = { ...fromPos, liquidityTokenBalance: convertTokenToDecimal(bal ?? 0n, BI_18) };
      context.LiquidityPosition.set(fromUpdated);
      await createLiquiditySnapshot(context, fromUpdated, event.block.number, event.block.timestamp);
    }

    if (to != ADDRESS_ZERO && to != pair.id) {
      const toPos = await createLiquidityPosition(context, pairId, to);
      const bal = await pairBalanceOf(context.effect, pairId, to, event.block.number);
      const toUpdated = { ...toPos, liquidityTokenBalance: convertTokenToDecimal(bal ?? 0n, BI_18) };
      context.LiquidityPosition.set(toUpdated);
      await createLiquiditySnapshot(context, toUpdated, event.block.number, event.block.timestamp);
    }

    context.Transaction.set(transaction);
  },
);

indexer.onEvent(
  { contract: "Pair", event: "Sync" },
  async ({ event, context }) => {
    const pairId = low(event.srcAddress);
    let pair = await context.Pair.getOrThrow(pairId);
    let token0 = await context.Token.getOrThrow(pair.token0_id);
    let token1 = await context.Token.getOrThrow(pair.token1_id);
    let uniswap = await context.UniswapFactory.getOrThrow(FACTORY_ADDRESS);

    // reset factory liquidity by subtracting only tracked liquidity
    uniswap = { ...uniswap, totalLiquidityETH: uniswap.totalLiquidityETH.minus(pair.trackedReserveETH) };

    // reset token total liquidity amounts
    token0 = { ...token0, totalLiquidity: token0.totalLiquidity.minus(pair.reserve0) };
    token1 = { ...token1, totalLiquidity: token1.totalLiquidity.minus(pair.reserve1) };

    const reserve0 = convertTokenToDecimal(event.params.reserve0, token0.decimals);
    const reserve1 = convertTokenToDecimal(event.params.reserve1, token1.decimals);
    pair = {
      ...pair,
      reserve0,
      reserve1,
      token0Price: !reserve1.eq(ZERO_BD) ? reserve0.div(reserve1) : ZERO_BD,
      token1Price: !reserve0.eq(ZERO_BD) ? reserve1.div(reserve0) : ZERO_BD,
    };

    // NOTE: pair not saved yet — getEthPriceInUSD / findEthPerToken read the
    // pre-sync state of this pair from the store, like graph-node did.
    let bundle = await context.Bundle.getOrThrow("1");
    bundle = { ...bundle, ethPrice: await getEthPriceInUSD(context) };
    context.Bundle.set(bundle);

    const t0DerivedETH = await findEthPerToken(context, token0);
    token0 = { ...token0, derivedETH: t0DerivedETH };
    context.Token.set(token0);

    const t1DerivedETH = await findEthPerToken(context, token1);
    token1 = { ...token1, derivedETH: t1DerivedETH };
    context.Token.set(token1);

    // get tracked liquidity - will be 0 if neither is in whitelist
    let trackedLiquidityETH: BigDecimal;
    if (!bundle.ethPrice.eq(ZERO_BD)) {
      trackedLiquidityETH = getTrackedLiquidityUSD(pair.reserve0, token0, pair.reserve1, token1, bundle).div(
        bundle.ethPrice,
      );
    } else {
      trackedLiquidityETH = ZERO_BD;
    }

    // use derived amounts within pair
    const reserveETH = pair.reserve0
      .times(token0.derivedETH as BigDecimal)
      .plus(pair.reserve1.times(token1.derivedETH as BigDecimal));
    pair = {
      ...pair,
      trackedReserveETH: trackedLiquidityETH,
      reserveETH,
      reserveUSD: reserveETH.times(bundle.ethPrice),
    };

    // use tracked amounts globally
    const totalLiquidityETH = uniswap.totalLiquidityETH.plus(trackedLiquidityETH);
    uniswap = {
      ...uniswap,
      totalLiquidityETH,
      totalLiquidityUSD: totalLiquidityETH.times(bundle.ethPrice),
    };

    // now correctly set liquidity amounts for each token
    token0 = { ...token0, totalLiquidity: token0.totalLiquidity.plus(pair.reserve0) };
    token1 = { ...token1, totalLiquidity: token1.totalLiquidity.plus(pair.reserve1) };

    // save entities
    context.Pair.set(pair);
    context.UniswapFactory.set(uniswap);
    context.Token.set(token0);
    context.Token.set(token1);
  },
);

indexer.onEvent(
  { contract: "Pair", event: "Mint" },
  async ({ event, context }) => {
    // original crashes when the transaction entity is missing (Transfer always
    // precedes Mint in the same tx, so it never is).
    const transaction = await context.Transaction.getOrThrow(low(event.transaction.hash));
    const mints = transaction.mints;
    let mint = await context.Mint.getOrThrow(mints[mints.length - 1]!);

    const pairId = low(event.srcAddress);
    let pair = await context.Pair.getOrThrow(pairId);
    let uniswap = await context.UniswapFactory.getOrThrow(FACTORY_ADDRESS);

    let token0 = await context.Token.getOrThrow(pair.token0_id);
    let token1 = await context.Token.getOrThrow(pair.token1_id);

    if (isOnBlacklist(token0.id) || isOnBlacklist(token1.id)) {
      return;
    }

    // update exchange info (except balances, sync will cover that)
    const token0Amount = convertTokenToDecimal(event.params.amount0, token0.decimals);
    const token1Amount = convertTokenToDecimal(event.params.amount1, token1.decimals);

    // update txn counts
    token0 = { ...token0, txCount: token0.txCount + ONE_BI };
    token1 = { ...token1, txCount: token1.txCount + ONE_BI };

    // get new amounts of USD and ETH for tracking
    const bundle = await context.Bundle.getOrThrow("1");
    const amountTotalUSD = (token1.derivedETH as BigDecimal)
      .times(token1Amount)
      .plus((token0.derivedETH as BigDecimal).times(token0Amount))
      .times(bundle.ethPrice);

    // update txn counts
    pair = { ...pair, txCount: pair.txCount + ONE_BI };
    uniswap = { ...uniswap, txCount: uniswap.txCount + ONE_BI };

    // save entities
    context.Token.set(token0);
    context.Token.set(token1);
    context.Pair.set(pair);
    context.UniswapFactory.set(uniswap);

    mint = {
      ...mint,
      sender: low(event.params.sender),
      amount0: token0Amount,
      amount1: token1Amount,
      logIndex: BigInt(event.logIndex),
      amountUSD: amountTotalUSD,
    };
    context.Mint.set(mint);

    await updatePairDayData(context, pairId, event.block.timestamp);
    await updatePairHourData(context, pairId, event.block.timestamp);
    await updateUniswapDayData(context, event.block.timestamp);
    await updateTokenDayData(context, token0, event.block.timestamp);
    await updateTokenDayData(context, token1, event.block.timestamp);
  },
);

indexer.onEvent(
  { contract: "Pair", event: "Burn" },
  async ({ event, context }) => {
    const transaction = await context.Transaction.get(low(event.transaction.hash));
    if (transaction === undefined) {
      return;
    }

    const burns = transaction.burns;
    let burn = await context.Burn.getOrThrow(burns[burns.length - 1]!);

    const pairId = low(event.srcAddress);
    let pair = await context.Pair.getOrThrow(pairId);
    let uniswap = await context.UniswapFactory.getOrThrow(FACTORY_ADDRESS);

    // update token info
    let token0 = await context.Token.getOrThrow(pair.token0_id);
    let token1 = await context.Token.getOrThrow(pair.token1_id);

    if (isOnBlacklist(token0.id) || isOnBlacklist(token1.id)) {
      return;
    }

    const token0Amount = convertTokenToDecimal(event.params.amount0, token0.decimals);
    const token1Amount = convertTokenToDecimal(event.params.amount1, token1.decimals);

    // update txn counts
    token0 = { ...token0, txCount: token0.txCount + ONE_BI };
    token1 = { ...token1, txCount: token1.txCount + ONE_BI };

    // get new amounts of USD and ETH for tracking
    const bundle = await context.Bundle.getOrThrow("1");
    const amountTotalUSD = (token1.derivedETH as BigDecimal)
      .times(token1Amount)
      .plus((token0.derivedETH as BigDecimal).times(token0Amount))
      .times(bundle.ethPrice);

    // update txn counts
    uniswap = { ...uniswap, txCount: uniswap.txCount + ONE_BI };
    pair = { ...pair, txCount: pair.txCount + ONE_BI };

    // update global counter and save
    context.Token.set(token0);
    context.Token.set(token1);
    context.Pair.set(pair);
    context.UniswapFactory.set(uniswap);

    // update burn
    // burn.sender = event.params.sender (commented out in the original)
    burn = {
      ...burn,
      amount0: token0Amount,
      amount1: token1Amount,
      // burn.to = event.params.to (commented out in the original)
      logIndex: BigInt(event.logIndex),
      amountUSD: amountTotalUSD,
    };
    context.Burn.set(burn);

    await updatePairDayData(context, pairId, event.block.timestamp);
    await updatePairHourData(context, pairId, event.block.timestamp);
    await updateUniswapDayData(context, event.block.timestamp);
    await updateTokenDayData(context, token0, event.block.timestamp);
    await updateTokenDayData(context, token1, event.block.timestamp);
  },
);

indexer.onEvent(
  { contract: "Pair", event: "Swap" },
  async ({ event, context }) => {
    const pairId = low(event.srcAddress);
    let pair = await context.Pair.getOrThrow(pairId);
    let token0 = await context.Token.getOrThrow(pair.token0_id);
    let token1 = await context.Token.getOrThrow(pair.token1_id);

    if (isOnBlacklist(token0.id) || isOnBlacklist(token1.id)) {
      return;
    }

    const amount0In = convertTokenToDecimal(event.params.amount0In, token0.decimals);
    const amount1In = convertTokenToDecimal(event.params.amount1In, token1.decimals);
    const amount0Out = convertTokenToDecimal(event.params.amount0Out, token0.decimals);
    const amount1Out = convertTokenToDecimal(event.params.amount1Out, token1.decimals);

    // totals for volume updates
    const amount0Total = amount0Out.plus(amount0In);
    const amount1Total = amount1Out.plus(amount1In);

    // ETH/USD prices
    const bundle = await context.Bundle.getOrThrow("1");

    // get total amounts of derived USD and ETH for tracking
    const derivedAmountETH = (token1.derivedETH as BigDecimal)
      .times(amount1Total)
      .plus((token0.derivedETH as BigDecimal).times(amount0Total))
      .div(new BigDecimal("2"));
    const derivedAmountUSD = derivedAmountETH.times(bundle.ethPrice);

    // only accounts for volume through white listed tokens
    const trackedAmountUSD = getTrackedVolumeUSD(amount0Total, token0, amount1Total, token1, bundle);

    let trackedAmountETH: BigDecimal;
    if (bundle.ethPrice.eq(ZERO_BD)) {
      trackedAmountETH = ZERO_BD;
    } else {
      trackedAmountETH = trackedAmountUSD.div(bundle.ethPrice);
    }

    // update token0 global volume and token liquidity stats
    token0 = {
      ...token0,
      tradeVolume: token0.tradeVolume.plus(amount0In.plus(amount0Out)),
      tradeVolumeUSD: token0.tradeVolumeUSD.plus(trackedAmountUSD),
      untrackedVolumeUSD: token0.untrackedVolumeUSD.plus(derivedAmountUSD),
    };

    // update token1 global volume and token liquidity stats
    token1 = {
      ...token1,
      tradeVolume: token1.tradeVolume.plus(amount1In.plus(amount1Out)),
      tradeVolumeUSD: token1.tradeVolumeUSD.plus(trackedAmountUSD),
      untrackedVolumeUSD: token1.untrackedVolumeUSD.plus(derivedAmountUSD),
    };

    // update txn counts
    token0 = { ...token0, txCount: token0.txCount + ONE_BI };
    token1 = { ...token1, txCount: token1.txCount + ONE_BI };

    // update pair volume data, use tracked amount if we have it as its probably more accurate
    pair = {
      ...pair,
      volumeUSD: pair.volumeUSD.plus(trackedAmountUSD),
      volumeToken0: pair.volumeToken0.plus(amount0Total),
      volumeToken1: pair.volumeToken1.plus(amount1Total),
      untrackedVolumeUSD: pair.untrackedVolumeUSD.plus(derivedAmountUSD),
      txCount: pair.txCount + ONE_BI,
    };

    // update global values, only used tracked amounts for volume
    let uniswap = await context.UniswapFactory.getOrThrow(FACTORY_ADDRESS);
    uniswap = {
      ...uniswap,
      totalVolumeUSD: uniswap.totalVolumeUSD.plus(trackedAmountUSD),
      totalVolumeETH: uniswap.totalVolumeETH.plus(trackedAmountETH),
      untrackedVolumeUSD: uniswap.untrackedVolumeUSD.plus(derivedAmountUSD),
      txCount: uniswap.txCount + ONE_BI,
    };

    // save entities
    context.Pair.set(pair);
    context.Token.set(token0);
    context.Token.set(token1);
    context.UniswapFactory.set(uniswap);

    const txHash = low(event.transaction.hash);
    let transaction = await context.Transaction.get(txHash);
    if (transaction === undefined) {
      transaction = {
        id: txHash,
        blockNumber: BigInt(event.block.number),
        timestamp: BigInt(event.block.timestamp),
        mints: [],
        swaps: [],
        burns: [],
      } satisfies Transaction;
    }
    const swaps = [...transaction.swaps];
    const swapId = txHash.concat("-").concat(swaps.length.toString());

    // update swap event
    context.Swap.set({
      id: swapId,
      transaction_id: transaction.id,
      pair_id: pair.id,
      timestamp: transaction.timestamp,
      sender: low(event.params.sender),
      amount0In: amount0In,
      amount1In: amount1In,
      amount0Out: amount0Out,
      amount1Out: amount1Out,
      to: low(event.params.to),
      // `from` is always present on EVM transactions (optional only in envio's type)
      from: low(event.transaction.from!),
      logIndex: BigInt(event.logIndex),
      // use the tracked amount if we have it (=== is the original's
      // AssemblyScript reference comparison against the ZERO_BD sentinel)
      amountUSD: trackedAmountUSD === ZERO_BD ? derivedAmountUSD : trackedAmountUSD,
    });

    // update the transaction
    swaps.push(swapId);
    transaction = { ...transaction, swaps };
    context.Transaction.set(transaction);

    // update day entities
    let pairDayData = await updatePairDayData(context, pairId, event.block.timestamp);
    let pairHourData = await updatePairHourData(context, pairId, event.block.timestamp);
    let uniswapDayData = await updateUniswapDayData(context, event.block.timestamp);
    let token0DayData = await updateTokenDayData(context, token0, event.block.timestamp);
    let token1DayData = await updateTokenDayData(context, token1, event.block.timestamp);

    // swap specific updating
    uniswapDayData = {
      ...uniswapDayData,
      dailyVolumeUSD: uniswapDayData.dailyVolumeUSD.plus(trackedAmountUSD),
      dailyVolumeETH: uniswapDayData.dailyVolumeETH.plus(trackedAmountETH),
      dailyVolumeUntracked: uniswapDayData.dailyVolumeUntracked.plus(derivedAmountUSD),
    };
    context.UniswapDayData.set(uniswapDayData);

    // swap specific updating for pair
    pairDayData = {
      ...pairDayData,
      dailyVolumeToken0: pairDayData.dailyVolumeToken0.plus(amount0Total),
      dailyVolumeToken1: pairDayData.dailyVolumeToken1.plus(amount1Total),
      dailyVolumeUSD: pairDayData.dailyVolumeUSD.plus(trackedAmountUSD),
    };
    context.PairDayData.set(pairDayData);

    // update hourly pair data
    pairHourData = {
      ...pairHourData,
      hourlyVolumeToken0: pairHourData.hourlyVolumeToken0.plus(amount0Total),
      hourlyVolumeToken1: pairHourData.hourlyVolumeToken1.plus(amount1Total),
      hourlyVolumeUSD: pairHourData.hourlyVolumeUSD.plus(trackedAmountUSD),
    };
    context.PairHourData.set(pairHourData);

    // swap specific updating for token0
    token0DayData = {
      ...token0DayData,
      dailyVolumeToken: token0DayData.dailyVolumeToken.plus(amount0Total),
      dailyVolumeETH: token0DayData.dailyVolumeETH.plus(amount0Total.times(token0.derivedETH as BigDecimal)),
      dailyVolumeUSD: token0DayData.dailyVolumeUSD.plus(
        amount0Total.times(token0.derivedETH as BigDecimal).times(bundle.ethPrice),
      ),
    };
    context.TokenDayData.set(token0DayData);

    // swap specific updating for token1
    token1DayData = {
      ...token1DayData,
      dailyVolumeToken: token1DayData.dailyVolumeToken.plus(amount1Total),
      dailyVolumeETH: token1DayData.dailyVolumeETH.plus(amount1Total.times(token1.derivedETH as BigDecimal)),
      dailyVolumeUSD: token1DayData.dailyVolumeUSD.plus(
        amount1Total.times(token1.derivedETH as BigDecimal).times(bundle.ethPrice),
      ),
    };
    context.TokenDayData.set(token1DayData);
  },
);
