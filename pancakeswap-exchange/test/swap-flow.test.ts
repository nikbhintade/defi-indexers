/**
 * Offline test of the full WBNB-BUSD flow against the real BSC pricing pair
 * address (0x58f8…dc16, the BUSD_WBNB_PAIR used by getBnbPriceInUSD):
 *
 *   PairCreated → Transfer(minimum-liquidity, skipped) → Transfer(mint) →
 *   Sync → Mint → Sync → Swap
 *
 * and asserts exact values for reserves, derived BNB/USD prices, tracked /
 * untracked volumes, Transaction/Mint/Swap entities and all day/hour datas —
 * including the graph-node staleness quirk: the bundle price and derived
 * token prices computed during a Sync of the pricing pair itself use the
 * *previous* sync's reserves (the pair is only saved at the end of
 * handleSync).
 *
 * Numbers (all 18-decimals):
 *  - sync1 reserves (100 WBNB, 32000 BUSD): bnbPrice still 0 (stale pair),
 *    token0Price=0.003125, token1Price=320 stored.
 *  - sync2 reserves (128 WBNB, 25000 BUSD): bnbPrice=320 (stale t1Price),
 *    BUSD derivedBNB=0.003125 (stale t0Price) → derivedUSD=1.
 *  - swap 28 WBNB in / 7000 BUSD out: tracked = (28·320 + 7000·1)/2 = 7980,
 *    fee = |8960 − 7000| = 1960, trackedBNB = 7980/320 = 24.9375.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTestIndexer } from "envio";
import { setCallMock, type CallMockRule } from "../src/effects/calls";

const FACTORY = "0xca143ce32fe78f1f7019d7d551a6402fc5350c73";
const WBNB = "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c"; // token0
const BUSD = "0xe9e7cea3dedca5984780bafc599bd69add087d56"; // token1
const PAIR = "0x58f876857a02d6762e0101bb5c46a8c1ed44dc16"; // BUSD_WBNB_PAIR (pricing pair)
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

afterEach(() => setCallMock(undefined));

describe("WBNB-BUSD sync + swap flow", () => {
  it("updates reserves, derived prices, volumes and day datas with exact values", async () => {
    const rules: CallMockRule[] = [
      { fn: "name", to: WBNB, result: str("Wrapped BNB") },
      { fn: "symbol", to: WBNB, result: str("WBNB") },
      { fn: "decimals", to: WBNB, result: num(18) },
      { fn: "name", to: BUSD, result: str("BUSD Token") },
      { fn: "symbol", to: BUSD, result: str("BUSD") },
      { fn: "decimals", to: BUSD, result: num(18) },
    ];
    setCallMock({ strict: true, rules });

    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        56: {
          simulate: [
            {
              contract: "Factory",
              event: "PairCreated",
              params: { token0: WBNB, token1: BUSD, pair: PAIR, pairIndex: 1n },
              logIndex: 1,
              block: { number: 6810000, timestamp: 1600000000 },
            },
            // ---- tx1: add initial liquidity (Transfer, Transfer, Sync, Mint) ----
            {
              contract: "Pair",
              event: "Transfer",
              srcAddress: PAIR,
              // MINIMUM_LIQUIDITY lock: to == zero && value == 1000 -> skipped
              params: { from: ZERO, to: ZERO, value: 1000n },
              logIndex: 1,
              block: { number: 6810100, timestamp: 1600000300 },
              transaction: { hash: TX1 },
            },
            {
              contract: "Pair",
              event: "Transfer",
              srcAddress: PAIR,
              params: { from: ZERO, to: LP, value: 1700n * E18 },
              logIndex: 2,
              block: { number: 6810100, timestamp: 1600000300 },
              transaction: { hash: TX1 },
            },
            {
              contract: "Pair",
              event: "Sync",
              srcAddress: PAIR,
              params: { reserve0: 100n * E18, reserve1: 32000n * E18 },
              logIndex: 3,
              block: { number: 6810100, timestamp: 1600000300 },
            },
            {
              contract: "Pair",
              event: "Mint",
              srcAddress: PAIR,
              params: { sender: ROUTER, amount0: 100n * E18, amount1: 32000n * E18 },
              logIndex: 4,
              block: { number: 6810100, timestamp: 1600000300 },
              transaction: { hash: TX1 },
            },
            // ---- tx2: swap 28 WBNB -> 7000 BUSD (Sync, Swap) ----
            {
              contract: "Pair",
              event: "Sync",
              srcAddress: PAIR,
              params: { reserve0: 128n * E18, reserve1: 25000n * E18 },
              logIndex: 1,
              block: { number: 6810200, timestamp: 1600000600 },
            },
            {
              contract: "Pair",
              event: "Swap",
              srcAddress: PAIR,
              params: {
                sender: ROUTER,
                amount0In: 28n * E18,
                amount1In: 0n,
                amount0Out: 0n,
                amount1Out: 7000n * E18,
                to: TRADER,
              },
              logIndex: 2,
              block: { number: 6810200, timestamp: 1600000600 },
              transaction: { hash: TX2, from: TRADER },
            },
          ],
        },
      },
    });

    // ---- Bundle: BNB price from the (stale) BUSD pair state of sync1 ----
    const bundle = await indexer.Bundle.getOrThrow("1");
    expect(bundle.bnbPrice.toString()).toBe("320");

    // ---- Tokens ----
    const wbnb = await indexer.Token.getOrThrow(WBNB);
    expect(wbnb.name).toBe("Wrapped BNB");
    expect(wbnb.symbol).toBe("WBNB");
    expect(wbnb.decimals).toBe(18n);
    expect(wbnb.derivedBNB?.toString()).toBe("1");
    expect(wbnb.derivedUSD?.toString()).toBe("320");
    expect(wbnb.totalLiquidity.toString()).toBe("128");
    expect(wbnb.tradeVolume.toString()).toBe("28");
    expect(wbnb.tradeVolumeUSD.toString()).toBe("7980");
    expect(wbnb.untrackedVolumeUSD.toString()).toBe("7980");
    expect(wbnb.totalTransactions).toBe(2n); // mint + swap

    const busd = await indexer.Token.getOrThrow(BUSD);
    expect(busd.derivedBNB?.toString()).toBe("0.003125"); // stale token0Price of sync1
    expect(busd.derivedUSD?.toString()).toBe("1");
    expect(busd.totalLiquidity.toString()).toBe("25000");
    expect(busd.tradeVolume.toString()).toBe("7000");
    expect(busd.tradeVolumeUSD.toString()).toBe("7980");
    expect(busd.untrackedVolumeUSD.toString()).toBe("7980");
    expect(busd.totalTransactions).toBe(2n);

    // ---- Pair ----
    const pair = await indexer.Pair.getOrThrow(PAIR);
    expect(pair.name).toBe("WBNB-BUSD");
    expect(pair.reserve0.toString()).toBe("128");
    expect(pair.reserve1.toString()).toBe("25000");
    expect(pair.token0Price.toString()).toBe("0.00512"); // 128/25000
    expect(pair.token1Price.toString()).toBe("195.3125"); // 25000/128
    expect(pair.totalSupply.toString()).toBe("1700");
    expect(pair.reserveBNB.toString()).toBe("206.125"); // 128*1 + 25000*0.003125
    expect(pair.reserveUSD.toString()).toBe("65960"); // 206.125*320
    expect(pair.trackedReserveBNB.toString()).toBe("206.125");
    expect(pair.volumeToken0.toString()).toBe("28");
    expect(pair.volumeToken1.toString()).toBe("7000");
    expect(pair.volumeUSD.toString()).toBe("7980");
    expect(pair.untrackedVolumeUSD.toString()).toBe("7980");
    expect(pair.totalTransactions).toBe(2n);

    // ---- PancakeFactory ----
    const factory = await indexer.PancakeFactory.getOrThrow(FACTORY);
    expect(factory.totalPairs).toBe(1n);
    expect(factory.totalTransactions).toBe(2n);
    expect(factory.totalVolumeUSD.toString()).toBe("7980");
    expect(factory.totalVolumeBNB.toString()).toBe("24.9375"); // 7980/320
    expect(factory.untrackedVolumeUSD.toString()).toBe("7980");
    expect(factory.totalLiquidityBNB.toString()).toBe("206.125");
    expect(factory.totalLiquidityUSD.toString()).toBe("65960");

    // ---- Transactions ----
    const tx1 = await indexer.Transaction.getOrThrow(TX1);
    expect(tx1.block).toBe(6810100n);
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
    expect(mint.amount0?.toString()).toBe("100");
    expect(mint.amount1?.toString()).toBe("32000");
    expect(mint.amountUSD?.toString()).toBe("0"); // bnbPrice was 0 at mint time
    expect(mint.logIndex).toBe(4n);
    expect(mint.timestamp).toBe(1600000300n);

    // ---- Swap entity ----
    const swap = await indexer.Swap.getOrThrow(`${TX2}-0`);
    expect(swap.pair_id).toBe(PAIR);
    expect(swap.transaction_id).toBe(TX2);
    expect(swap.sender).toBe(ROUTER);
    expect(swap.from).toBe(TRADER);
    expect(swap.to).toBe(TRADER);
    expect(swap.amount0In.toString()).toBe("28");
    expect(swap.amount1In.toString()).toBe("0");
    expect(swap.amount0Out.toString()).toBe("0");
    expect(swap.amount1Out.toString()).toBe("7000");
    expect(swap.amountUSD.toString()).toBe("7980"); // tracked (both whitelisted)
    expect(swap.amountFeeUSD.toString()).toBe("1960"); // |28*320 - 7000*1|
    expect(swap.logIndex).toBe(2n);
    expect(swap.timestamp).toBe(1600000600n);

    // ---- PancakeDayData ----
    const dayData = await indexer.PancakeDayData.getOrThrow(DAY_ID.toString());
    expect(dayData.date).toBe(DAY_ID * 86400); // 1599955200
    expect(dayData.dailyVolumeUSD.toString()).toBe("7980");
    expect(dayData.dailyVolumeBNB.toString()).toBe("24.9375");
    expect(dayData.dailyVolumeUntracked.toString()).toBe("7980");
    expect(dayData.totalVolumeUSD.toString()).toBe("0"); // original quirk: never accumulated
    expect(dayData.totalVolumeBNB.toString()).toBe("0"); // original quirk: never accumulated
    expect(dayData.totalLiquidityUSD.toString()).toBe("65960");
    expect(dayData.totalLiquidityBNB.toString()).toBe("206.125");
    expect(dayData.totalTransactions).toBe(2n);

    // ---- PairDayData ----
    const pairDayData = await indexer.PairDayData.getOrThrow(`${PAIR}-${DAY_ID}`);
    expect(pairDayData.date).toBe(DAY_ID * 86400);
    expect(pairDayData.pairAddress).toBe(PAIR);
    expect(pairDayData.token0_id).toBe(WBNB);
    expect(pairDayData.token1_id).toBe(BUSD);
    expect(pairDayData.reserve0.toString()).toBe("128");
    expect(pairDayData.reserve1.toString()).toBe("25000");
    expect(pairDayData.totalSupply.toString()).toBe("1700");
    expect(pairDayData.reserveUSD.toString()).toBe("65960");
    expect(pairDayData.dailyVolumeToken0.toString()).toBe("28");
    expect(pairDayData.dailyVolumeToken1.toString()).toBe("7000");
    expect(pairDayData.dailyVolumeUSD.toString()).toBe("7980");
    expect(pairDayData.dailyTxns).toBe(2n);

    // ---- PairHourData ----
    const pairHourData = await indexer.PairHourData.getOrThrow(`${PAIR}-${HOUR_ID}`);
    expect(pairHourData.hourStartUnix).toBe(HOUR_ID * 3600); // 1599998400
    expect(pairHourData.pair_id).toBe(PAIR);
    expect(pairHourData.reserve0.toString()).toBe("128");
    expect(pairHourData.reserve1.toString()).toBe("25000");
    expect(pairHourData.totalSupply.toString()).toBe("1700");
    expect(pairHourData.reserveUSD.toString()).toBe("65960");
    expect(pairHourData.hourlyVolumeToken0.toString()).toBe("28");
    expect(pairHourData.hourlyVolumeToken1.toString()).toBe("7000");
    expect(pairHourData.hourlyVolumeUSD.toString()).toBe("7980");
    expect(pairHourData.hourlyTxns).toBe(2n);

    // ---- TokenDayData ----
    const wbnbDay = await indexer.TokenDayData.getOrThrow(`${WBNB}-${DAY_ID}`);
    expect(wbnbDay.date).toBe(DAY_ID * 86400);
    expect(wbnbDay.token_id).toBe(WBNB);
    expect(wbnbDay.priceUSD.toString()).toBe("320");
    expect(wbnbDay.dailyVolumeToken.toString()).toBe("28");
    expect(wbnbDay.dailyVolumeBNB.toString()).toBe("28");
    expect(wbnbDay.dailyVolumeUSD.toString()).toBe("8960"); // 28 * 1 * 320
    expect(wbnbDay.dailyTxns).toBe(2n);
    expect(wbnbDay.totalLiquidityToken.toString()).toBe("128");
    expect(wbnbDay.totalLiquidityBNB.toString()).toBe("128");
    expect(wbnbDay.totalLiquidityUSD.toString()).toBe("40960");

    const busdDay = await indexer.TokenDayData.getOrThrow(`${BUSD}-${DAY_ID}`);
    expect(busdDay.priceUSD.toString()).toBe("1");
    expect(busdDay.dailyVolumeToken.toString()).toBe("7000");
    expect(busdDay.dailyVolumeBNB.toString()).toBe("21.875"); // 7000 * 0.003125
    expect(busdDay.dailyVolumeUSD.toString()).toBe("7000");
    expect(busdDay.dailyTxns).toBe(2n);
    expect(busdDay.totalLiquidityToken.toString()).toBe("25000");
    expect(busdDay.totalLiquidityBNB.toString()).toBe("78.125");
    expect(busdDay.totalLiquidityUSD.toString()).toBe("25000");
  });
});
