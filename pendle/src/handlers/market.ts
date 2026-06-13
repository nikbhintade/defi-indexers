/**
 * Port of src/pendle/market.ts (PendleMarket template handlers):
 * handleTransfer / handleSync (+ updateUserMarketData / redeemLpInterests /
 * updateMarketLiquidityMiningApr — the latter lives in services/liquidity-mining.ts).
 */
import { indexer, type Pair } from "envio";
import { ONE_BD, RONE, ZERO_BD, ZERO_BI, convertTokenToDecimal, low, toBD } from "../utils";
import { marketTotalSupply } from "../effects/contracts";
import { calcMarketWorthUSD, getLpPrice, loadUserMarketData } from "../services/helpers";
import { updateMarketLiquidityMiningApr } from "../services/liquidity-mining";

indexer.onEvent({ contract: "PendleMarket", event: "Transfer" }, async ({ event, context }) => {
  const block = event.block.number;
  let market = await context.Pair.getOrThrow(low(event.srcAddress));
  await updateMarketLiquidityMiningApr(context, block, BigInt(event.block.timestamp), market);
  // re-read after the APR update may have persisted yieldTokenHolderAddress
  market = await context.Pair.getOrThrow(low(event.srcAddress));

  const from = low(event.params.from);
  const to = low(event.params.to);
  let fromBalanceChange = ZERO_BI;
  let toBalanceChange = ZERO_BI;
  if (from == market.yieldTokenHolderAddress || to == market.yieldTokenHolderAddress) {
    // Stake & Withdraw — leave user's lp balance
  } else {
    fromBalanceChange = event.params.value * -1n;
    toBalanceChange = event.params.value;
  }
  if (fromBalanceChange === ZERO_BI && toBalanceChange === ZERO_BI) {
    return;
  }

  context.LpTransferEvent.set({
    id: low(event.transaction.hash).concat("-").concat(from).concat("-").concat(to),
    from,
    to,
    market: market.id,
    lpPrice: getLpPrice(market),
    amount: event.params.value,
    timestamp: BigInt(event.block.timestamp),
    block: BigInt(event.block.number),
  });

  await updateUserMarketData(context, low(event.params.from), low(event.srcAddress), fromBalanceChange);
  await updateUserMarketData(context, low(event.params.to), low(event.srcAddress), toBalanceChange);
});

async function updateUserMarketData(
  context: Parameters<Parameters<typeof indexer.onEvent>[1]>[0]["context"],
  user: string,
  market: string,
  change: bigint,
): Promise<void> {
  const pair = await context.Pair.getOrThrow(low(market));
  const ins = await loadUserMarketData(context, user, market);
  const lpPrice = getLpPrice(pair);

  const lpHolding = ins.lpHolding + change;
  let next = { ...ins, lpHolding, recordedUSDValue: lpPrice.times(toBD(lpHolding)) };

  if (change < ZERO_BI) {
    next = { ...next, capitalWithdrawn: next.capitalWithdrawn.plus(toBD(change).times(lpPrice)) };
  } else {
    next = { ...next, capitalProvided: next.capitalProvided.plus(toBD(change).times(lpPrice)) };
  }
  context.UserMarketData.set(next);
}

indexer.onEvent({ contract: "PendleMarket", event: "Sync" }, async ({ event, context }) => {
  const block = event.block.number;
  const pair0 = await context.Pair.getOrThrow(low(event.srcAddress));
  let token0 = await context.Token.getOrThrow(pair0.token0_id); // xyt
  let token1 = await context.Token.getOrThrow(pair0.token1_id); // baseToken

  // reset token total liquidity amounts
  token0 = { ...token0, totalLiquidity: token0.totalLiquidity.minus(pair0.reserve0) };
  token1 = { ...token1, totalLiquidity: token1.totalLiquidity.minus(pair0.reserve1) };

  const totalSupply = toBD((await marketTotalSupply(context.effect, low(event.srcAddress), block)) ?? 0n);
  const reserve0 = convertTokenToDecimal(event.params.reserve0, token0.decimals);
  const reserve1 = convertTokenToDecimal(event.params.reserve1, token1.decimals);

  const xytBalance = toBD(event.params.reserve0);
  const xytWeight_BI = event.params.weight0;
  const tokenBalance = toBD(event.params.reserve1);
  const tokenWeight_BI = RONE - xytWeight_BI;

  const xytWeight_BD = toBD(xytWeight_BI);
  const tokenWeight_BD = toBD(tokenWeight_BI);

  const xytDecimal = token0.decimals;
  const baseDecimal = token1.decimals;

  let token0Price = ZERO_BD;
  let token1Price = ZERO_BD;
  if (!reserve0.eq(ZERO_BD) && !reserve1.eq(ZERO_BD)) {
    const rawXytPrice = tokenBalance.times(xytWeight_BD).div(tokenWeight_BD.times(xytBalance));
    // original: BigInt.fromI32(10).pow((xytDecimal - baseDecimal) as u8). For
    // mainnet markets xytDecimal == baseDecimal (=> multiplier 1). If the
    // difference is negative, AssemblyScript's u8 cast wraps; we instead apply
    // the mathematically sensible reciprocal and document the deviation.
    const diff = xytDecimal - baseDecimal;
    const multipledBy = diff >= 0n ? toBD(10n ** diff) : ONE_BD.div(toBD(10n ** -diff));
    token0Price = rawXytPrice.times(multipledBy);
    token1Price = ONE_BD;
  }

  // now correctly set liquidity amounts for each token
  token0 = { ...token0, totalLiquidity: token0.totalLiquidity.plus(reserve0) };
  token1 = { ...token1, totalLiquidity: token1.totalLiquidity.plus(reserve1) };

  let pair: Pair = {
    ...pair0,
    totalSupply,
    reserve0,
    reserve1,
    token0WeightRaw: xytWeight_BI,
    token1WeightRaw: tokenWeight_BI,
    token0Price,
    token1Price,
  };
  // save entities
  pair = { ...pair, reserveUSD: await calcMarketWorthUSD(context, block, pair) };
  pair = { ...pair, lpPriceUSD: getLpPrice(pair) };
  pair = { ...pair, lpStaked: ZERO_BD, lpStakedUSD: ZERO_BD, lpAPR: ZERO_BD };
  context.Pair.set(pair);

  await updateMarketLiquidityMiningApr(context, block, BigInt(event.block.timestamp), pair);

  context.Token.set(token0);
  context.Token.set(token1);
});
