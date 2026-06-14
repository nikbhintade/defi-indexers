/**
 * Offline test of the full USDC-WMATIC flow against the real Polygon pricing
 * pair address (0x853e…670d, the USDC_WETH_PAIR used by getEthPriceInUSD):
 *
 *   PairCreated → Transfer(minimum-liquidity, skipped) → Transfer(mint) →
 *   Sync → Mint → Sync → Swap
 *
 * and asserts exact values for reserves, derived ETH(MATIC) prices, tracked /
 * untracked volumes, Transaction/Mint/Swap entities, LiquidityPosition/Snapshot
 * and all day/hour datas — including the graph-node staleness quirk: the bundle
 * price and derived token prices computed during a Sync of the pricing pair
 * itself use the *previous* sync's reserves (the pair is only saved at the end
 * of handleSync).
 *
 * Pricing pair layout (from pricing.ts): token0 = USDC, token1 = WMATIC; the
 * MATIC/USD price is usdcPair.token0Price (= USDC reserve / WMATIC reserve).
 *
 * Numbers (all mocked at 18 decimals for clean arithmetic):
 *  - sync1 reserves (32000 USDC, 100 WMATIC): ethPrice still 0 (stale pair),
 *    token0Price=320, token1Price=0.003125 stored.
 *  - sync2 reserves (25000 USDC, 128 WMATIC): ethPrice=320 (stale token0Price),
 *    USDC derivedETH=0.003125 (stale token1Price), WMATIC derivedETH=1.
 *  - swap 28 WMATIC in / 7000 USDC out: tracked = (7000·1 + 28·320)/2 = 7980,
 *    trackedETH = 7980/320 = 24.9375.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTestIndexer } from "envio";
import { setCallMock, type CallMockRule } from "../src/effects/calls";

const FACTORY = "0x5757371414417b8c6caad45baef941abc7d3ab32";
const USDC = "0x2791bca1f2de4661ed88a30c99a7a9449aa84174"; // token0 (whitelist)
const WMATIC = "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619"; // token1 (== WETH_ADDRESS, derivedETH==1)
const PAIR = "0x853ee4b2a13f8a742d64c8f088be7ba2131f670d"; // USDC_WETH_PAIR (pricing pair)
const ZERO = "0x0000000000000000000000000000000000000000";
const LP = "0x1111111111111111111111111111111111111111";
const ROUTER = "0x2222222222222222222222222222222222222222";
const TRADER = "0x3333333333333333333333333333333333333333";

const TX1 = ("0x" + "aa".repeat(32)) as `0x${string}`;
const TX2 = ("0x" + "bb".repeat(32)) as `0x${string}`;

const E18 = 10n ** 18n;
// 1600000300 / 86400 = 18518 (same day/hour for both txs)
const DAY_ID = 18518;
const HOUR_ID = 444444;

const str = (value: string) => ({ kind: "string", value }) as const;
const num = (value: number) => ({ kind: "number", value }) as const;
const big = (value: string) => ({ kind: "bigint", value }) as const;

afterEach(() => setCallMock(undefined));

describe("USDC-WMATIC sync + swap flow", () => {
  it("updates reserves, derived prices, volumes, LP positions and day datas with exact values", async () => {
    const rules: CallMockRule[] = [
      { fn: "name", to: USDC, result: str("USD Coin (PoS)") },
      { fn: "symbol", to: USDC, result: str("USDC") },
      { fn: "decimals", to: USDC, result: num(18) },
      { fn: "totalSupply", to: USDC, result: big("0") },
      { fn: "name", to: WMATIC, result: str("Wrapped Matic") },
      { fn: "symbol", to: WMATIC, result: str("WMATIC") },
      { fn: "decimals", to: WMATIC, result: num(18) },
      { fn: "totalSupply", to: WMATIC, result: big("0") },
      // LP balance fetched on the mint Transfer (to == LP)
      { fn: "balanceOf", to: PAIR, args: [LP], result: big((1700n * E18).toString()) },
    ];
    setCallMock({ strict: true, rules });

    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        137: {
          simulate: [
            {
              contract: "Factory",
              event: "PairCreated",
              params: { token0: USDC, token1: WMATIC, pair: PAIR, pairIndex: 1n },
              logIndex: 1,
              block: { number: 5485000, timestamp: 1600000000 },
            },
            // ---- tx1: add initial liquidity (Transfer, Transfer, Sync, Mint) ----
            {
              contract: "Pair",
              event: "Transfer",
              srcAddress: PAIR,
              // MINIMUM_LIQUIDITY lock: to == zero && value == 1000 -> skipped
              params: { from: ZERO, to: ZERO, value: 1000n },
              logIndex: 1,
              block: { number: 5485100, timestamp: 1600000300 },
              transaction: { hash: TX1 },
            },
            {
              contract: "Pair",
              event: "Transfer",
              srcAddress: PAIR,
              params: { from: ZERO, to: LP, value: 1700n * E18 },
              logIndex: 2,
              block: { number: 5485100, timestamp: 1600000300 },
              transaction: { hash: TX1 },
            },
            {
              contract: "Pair",
              event: "Sync",
              srcAddress: PAIR,
              params: { reserve0: 32000n * E18, reserve1: 100n * E18 },
              logIndex: 3,
              block: { number: 5485100, timestamp: 1600000300 },
            },
            {
              contract: "Pair",
              event: "Mint",
              srcAddress: PAIR,
              params: { sender: ROUTER, amount0: 32000n * E18, amount1: 100n * E18 },
              logIndex: 4,
              block: { number: 5485100, timestamp: 1600000300 },
              transaction: { hash: TX1 },
            },
            // ---- tx2: swap 28 WMATIC -> 7000 USDC (Sync, Swap) ----
            {
              contract: "Pair",
              event: "Sync",
              srcAddress: PAIR,
              params: { reserve0: 25000n * E18, reserve1: 128n * E18 },
              logIndex: 1,
              block: { number: 5485200, timestamp: 1600000600 },
            },
            {
              contract: "Pair",
              event: "Swap",
              srcAddress: PAIR,
              params: {
                sender: ROUTER,
                amount0In: 0n,
                amount1In: 28n * E18,
                amount0Out: 7000n * E18,
                amount1Out: 0n,
                to: TRADER,
              },
              logIndex: 2,
              block: { number: 5485200, timestamp: 1600000600 },
              transaction: { hash: TX2, from: TRADER },
            },
          ],
        },
      },
    });

    // ---- Bundle: MATIC price from the (stale) USDC pair state of sync1 ----
    const bundle = await indexer.Bundle.getOrThrow("1");
    expect(bundle.ethPrice.toString()).toBe("320");

    // ---- Tokens ----
    const usdc = await indexer.Token.getOrThrow(USDC);
    expect(usdc.name).toBe("USD Coin (PoS)");
    expect(usdc.symbol).toBe("USDC");
    expect(usdc.derivedETH?.toString()).toBe("0.003125"); // stale token1Price of sync1
    expect(usdc.totalLiquidity.toString()).toBe("25000");
    expect(usdc.tradeVolume.toString()).toBe("7000");
    expect(usdc.tradeVolumeUSD.toString()).toBe("7980");
    expect(usdc.untrackedVolumeUSD.toString()).toBe("7980");
    expect(usdc.txCount).toBe(2n); // mint + swap

    const wmatic = await indexer.Token.getOrThrow(WMATIC);
    expect(wmatic.derivedETH?.toString()).toBe("1");
    expect(wmatic.totalLiquidity.toString()).toBe("128");
    expect(wmatic.tradeVolume.toString()).toBe("28");
    expect(wmatic.tradeVolumeUSD.toString()).toBe("7980");
    expect(wmatic.untrackedVolumeUSD.toString()).toBe("7980");
    expect(wmatic.txCount).toBe(2n);

    // both whitelist tokens -> each carries the pair in its whitelist
    expect(usdc.whitelist).toEqual([PAIR]);
    expect(wmatic.whitelist).toEqual([PAIR]);

    // ---- Pair ----
    const pair = await indexer.Pair.getOrThrow(PAIR);
    expect(pair.reserve0.toString()).toBe("25000");
    expect(pair.reserve1.toString()).toBe("128");
    expect(pair.token0Price.toString()).toBe("195.3125"); // 25000/128
    expect(pair.token1Price.toString()).toBe("0.00512"); // 128/25000
    expect(pair.totalSupply.toString()).toBe("1700");
    expect(pair.reserveETH.toString()).toBe("206.125"); // 25000*0.003125 + 128*1
    expect(pair.reserveUSD.toString()).toBe("65960"); // 206.125*320
    expect(pair.trackedReserveETH.toString()).toBe("206.125");
    expect(pair.volumeToken0.toString()).toBe("7000");
    expect(pair.volumeToken1.toString()).toBe("28");
    expect(pair.volumeUSD.toString()).toBe("7980");
    expect(pair.untrackedVolumeUSD.toString()).toBe("7980");
    expect(pair.txCount).toBe(2n);
    // one LP got a position via the mint Transfer
    expect(pair.liquidityProviderCount).toBe(1n);

    // ---- UniswapFactory ----
    const factory = await indexer.UniswapFactory.getOrThrow(FACTORY);
    expect(factory.pairCount).toBe(1);
    expect(factory.txCount).toBe(2n);
    expect(factory.totalVolumeUSD.toString()).toBe("7980");
    expect(factory.totalVolumeETH.toString()).toBe("24.9375"); // 7980/320
    expect(factory.untrackedVolumeUSD.toString()).toBe("7980");
    expect(factory.totalLiquidityETH.toString()).toBe("206.125");
    expect(factory.totalLiquidityUSD.toString()).toBe("65960");

    // ---- Transactions ----
    const tx1 = await indexer.Transaction.getOrThrow(TX1);
    expect(tx1.blockNumber).toBe(5485100n);
    expect(tx1.timestamp).toBe(1600000300n);
    expect(tx1.mints).toEqual([`${TX1}-0`]);
    expect(tx1.burns).toEqual([]);
    expect(tx1.swaps).toEqual([]);

    const tx2 = await indexer.Transaction.getOrThrow(TX2);
    expect(tx2.mints).toEqual([]);
    expect(tx2.swaps).toEqual([`${TX2}-0`]);

    // ---- Mint entity: id = txhash-"-"-(index in transaction.mints) ----
    const mint = await indexer.Mint.getOrThrow(`${TX1}-0`);
    expect(mint.pair_id).toBe(PAIR);
    expect(mint.transaction_id).toBe(TX1);
    expect(mint.to).toBe(LP);
    expect(mint.liquidity.toString()).toBe("1700");
    expect(mint.sender).toBe(ROUTER);
    expect(mint.amount0?.toString()).toBe("32000");
    expect(mint.amount1?.toString()).toBe("100");
    expect(mint.amountUSD?.toString()).toBe("0"); // ethPrice was 0 at mint time
    expect(mint.logIndex).toBe(4n);
    expect(mint.timestamp).toBe(1600000300n);

    // ---- Swap entity (no amountFeeUSD in QuickSwap schema) ----
    const swap = await indexer.Swap.getOrThrow(`${TX2}-0`);
    expect(swap.pair_id).toBe(PAIR);
    expect(swap.transaction_id).toBe(TX2);
    expect(swap.sender).toBe(ROUTER);
    expect(swap.from).toBe(TRADER);
    expect(swap.to).toBe(TRADER);
    expect(swap.amount0In.toString()).toBe("0");
    expect(swap.amount1In.toString()).toBe("28");
    expect(swap.amount0Out.toString()).toBe("7000");
    expect(swap.amount1Out.toString()).toBe("0");
    expect(swap.amountUSD.toString()).toBe("7980"); // tracked (both whitelisted)
    expect(swap.logIndex).toBe(2n);
    expect(swap.timestamp).toBe(1600000600n);

    // ---- LiquidityPosition + Snapshot (from the mint Transfer to LP) ----
    const lpPos = await indexer.LiquidityPosition.getOrThrow(`${PAIR}-${LP}`);
    expect(lpPos.user_id).toBe(LP);
    expect(lpPos.pair_id).toBe(PAIR);
    expect(lpPos.liquidityTokenBalance.toString()).toBe("1700"); // balanceOf mock / 1e18

    const snapshot = await indexer.LiquidityPositionSnapshot.getOrThrow(`${PAIR}-${LP}1600000300`);
    expect(snapshot.pair_id).toBe(PAIR);
    expect(snapshot.user_id).toBe(LP);
    expect(snapshot.liquidityPosition_id).toBe(`${PAIR}-${LP}`);
    expect(snapshot.block).toBe(5485100);
    expect(snapshot.timestamp).toBe(1600000300);
    expect(snapshot.liquidityTokenBalance.toString()).toBe("1700");
    // snapshot taken during the mint Transfer, before Sync -> prices/reserves all 0
    expect(snapshot.token0PriceUSD.toString()).toBe("0");
    expect(snapshot.token1PriceUSD.toString()).toBe("0");
    expect(snapshot.reserve0.toString()).toBe("0");
    expect(snapshot.reserve1.toString()).toBe("0");
    expect(snapshot.reserveUSD.toString()).toBe("0");
    expect(snapshot.liquidityTokenTotalSupply.toString()).toBe("1700");

    // NOTE: the original's createUser() is commented out in handleTransfer, so
    // no User entity is created — user_id is a dangling reference (parity).
    const user = await indexer.User.get(LP);
    expect(user).toBeUndefined();

    // ---- UniswapDayData ----
    const dayData = await indexer.UniswapDayData.getOrThrow(DAY_ID.toString());
    expect(dayData.date).toBe(DAY_ID * 86400); // 1599955200
    expect(dayData.dailyVolumeUSD.toString()).toBe("7980");
    expect(dayData.dailyVolumeETH.toString()).toBe("24.9375");
    expect(dayData.dailyVolumeUntracked.toString()).toBe("7980");
    expect(dayData.totalVolumeUSD.toString()).toBe("0"); // original quirk: never accumulated
    expect(dayData.totalVolumeETH.toString()).toBe("0"); // original quirk: never accumulated
    expect(dayData.totalLiquidityUSD.toString()).toBe("65960");
    expect(dayData.totalLiquidityETH.toString()).toBe("206.125");
    expect(dayData.txCount).toBe(2n);

    // ---- PairDayData ----
    const pairDayData = await indexer.PairDayData.getOrThrow(`${PAIR}-${DAY_ID}`);
    expect(pairDayData.date).toBe(DAY_ID * 86400);
    expect(pairDayData.pairAddress).toBe(PAIR);
    expect(pairDayData.token0_id).toBe(USDC);
    expect(pairDayData.token1_id).toBe(WMATIC);
    expect(pairDayData.reserve0.toString()).toBe("25000");
    expect(pairDayData.reserve1.toString()).toBe("128");
    expect(pairDayData.totalSupply.toString()).toBe("1700");
    expect(pairDayData.reserveUSD.toString()).toBe("65960");
    expect(pairDayData.dailyVolumeToken0.toString()).toBe("7000");
    expect(pairDayData.dailyVolumeToken1.toString()).toBe("28");
    expect(pairDayData.dailyVolumeUSD.toString()).toBe("7980");
    expect(pairDayData.dailyTxns).toBe(2n);

    // ---- PairHourData (no totalSupply field in QuickSwap schema) ----
    const pairHourData = await indexer.PairHourData.getOrThrow(`${PAIR}-${HOUR_ID}`);
    expect(pairHourData.hourStartUnix).toBe(HOUR_ID * 3600); // 1599998400
    expect(pairHourData.pair_id).toBe(PAIR);
    expect(pairHourData.reserve0.toString()).toBe("25000");
    expect(pairHourData.reserve1.toString()).toBe("128");
    expect(pairHourData.reserveUSD.toString()).toBe("65960");
    expect(pairHourData.hourlyVolumeToken0.toString()).toBe("7000");
    expect(pairHourData.hourlyVolumeToken1.toString()).toBe("28");
    expect(pairHourData.hourlyVolumeUSD.toString()).toBe("7980");
    expect(pairHourData.hourlyTxns).toBe(2n);

    // ---- TokenDayData ----
    const usdcDay = await indexer.TokenDayData.getOrThrow(`${USDC}-${DAY_ID}`);
    expect(usdcDay.date).toBe(DAY_ID * 86400);
    expect(usdcDay.token_id).toBe(USDC);
    expect(usdcDay.priceUSD.toString()).toBe("1"); // 0.003125 * 320
    expect(usdcDay.dailyVolumeToken.toString()).toBe("7000");
    expect(usdcDay.dailyVolumeETH.toString()).toBe("21.875"); // 7000 * 0.003125
    expect(usdcDay.dailyVolumeUSD.toString()).toBe("7000"); // 7000 * 0.003125 * 320
    expect(usdcDay.dailyTxns).toBe(2n);
    expect(usdcDay.totalLiquidityToken.toString()).toBe("25000");
    expect(usdcDay.totalLiquidityETH.toString()).toBe("78.125"); // 25000 * 0.003125
    expect(usdcDay.totalLiquidityUSD.toString()).toBe("25000");

    const wmaticDay = await indexer.TokenDayData.getOrThrow(`${WMATIC}-${DAY_ID}`);
    expect(wmaticDay.priceUSD.toString()).toBe("320");
    expect(wmaticDay.dailyVolumeToken.toString()).toBe("28");
    expect(wmaticDay.dailyVolumeETH.toString()).toBe("28"); // 28 * 1
    expect(wmaticDay.dailyVolumeUSD.toString()).toBe("8960"); // 28 * 1 * 320
    expect(wmaticDay.dailyTxns).toBe(2n);
    expect(wmaticDay.totalLiquidityToken.toString()).toBe("128");
    expect(wmaticDay.totalLiquidityETH.toString()).toBe("128");
    expect(wmaticDay.totalLiquidityUSD.toString()).toBe("40960");
  });
});
