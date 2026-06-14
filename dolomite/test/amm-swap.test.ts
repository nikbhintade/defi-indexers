/**
 * Offline test of the Dolomite AMM side:
 *  1. Two markets added (tokens created).
 *  2. AmmFactory.PairCreated registers the AmmPair template + creates the pair.
 *  3. Pair Sync sets reserves + token prices.
 *  4. Pair Swap updates pair/token/factory volume + creates an AmmTrade.
 * Asserts exact reserve/price/volume values. eth_calls mocked via DOLOMITE_CALL_MOCK.
 *
 * Dynamic registration runs in-process: the test indexer executes
 * contractRegister for PairCreated, so AmmPair events on the new address are
 * delivered without manual seeding.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTestIndexer } from "envio";
import { setCallMock, type CallMockRule } from "../src/effects/calls.js";
import { FACTORY, MARGIN, TOKEN_A, TOKEN_B, adminRules, tokenMeta, json, big } from "./fixtures.js";

const CHAIN = 42161;
const PAIR = "0x3333333333333333333333333333333333333333";
const TRADER = "0xcccccccccccccccccccccccccccccccccccccccc";
const ROUTER = "0xdddddddddddddddddddddddddddddddddddddddd";

const ONE_E18 = 1000000000000000000n;
const ONE_E6 = 1000000n;
// price market 0 (TOKEN_A, 18 dec): (36-18)=18 dec -> 2.0 USD
const PRICE_A = 2n * ONE_E18;
// price market 1 (TOKEN_B, 6 dec): (36-6)=30 dec -> 1.0 USD
const PRICE_B = 10n ** 30n;

afterEach(() => setCallMock(undefined));

describe("Dolomite AMM PairCreated + Sync + Swap", () => {
  it("registers the pair template and tracks reserves/volume with exact values", async () => {
    const rules: CallMockRule[] = [
      ...adminRules(),
      ...tokenMeta(TOKEN_A, "Token A", "TKA", 18),
      ...tokenMeta(TOKEN_B, "Token B", "TKB", 6),
      { fn: "getNumMarkets", to: MARGIN, result: big(2n) },
      { fn: "getMarketPrice", to: MARGIN, args: ["0"], result: json({ value: PRICE_A.toString() }) },
      { fn: "getMarketPrice", to: MARGIN, args: ["1"], result: json({ value: PRICE_B.toString() }) },
    ];
    setCallMock({ strict: true, rules });

    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        [CHAIN]: {
          simulate: [
            {
              contract: "MarginAdmin",
              event: "LogAddMarket",
              srcAddress: MARGIN as `0x${string}`,
              logIndex: 0,
              params: { marketId: 0n, token: TOKEN_A as `0x${string}` },
              block: { number: 28220369, timestamp: 1700000000, hash: "0x" + "b0".repeat(32) },
              transaction: { hash: "0x" + "e0".repeat(32) },
            },
            {
              contract: "MarginAdmin",
              event: "LogAddMarket",
              srcAddress: MARGIN as `0x${string}`,
              logIndex: 0,
              params: { marketId: 1n, token: TOKEN_B as `0x${string}` },
              block: { number: 28220370, timestamp: 1700000100, hash: "0x" + "b1".repeat(32) },
              transaction: { hash: "0x" + "e1".repeat(32) },
            },
            {
              contract: "AmmFactory",
              event: "PairCreated",
              srcAddress: FACTORY as `0x${string}`,
              logIndex: 0,
              params: { token0: TOKEN_A as `0x${string}`, token1: TOKEN_B as `0x${string}`, pair: PAIR as `0x${string}`, pairIndex: 1n },
              block: { number: 28220371, timestamp: 1700000200, hash: "0x" + "b2".repeat(32) },
              transaction: { hash: "0x" + "e2".repeat(32) },
            },
            {
              contract: "AmmPair",
              event: "Sync",
              srcAddress: PAIR as `0x${string}`,
              logIndex: 0,
              params: { reserve0: 100n * ONE_E18, reserve1: 200n * ONE_E6 },
              block: { number: 28220372, timestamp: 1700000300, hash: "0x" + "b3".repeat(32) },
            },
            {
              contract: "AmmPair",
              event: "Swap",
              srcAddress: PAIR as `0x${string}`,
              logIndex: 0,
              params: {
                sender: ROUTER as `0x${string}`,
                amount0In: 10n * ONE_E18, // 10 TOKEN_A in
                amount1In: 0n,
                amount0Out: 0n,
                amount1Out: 20n * ONE_E6, // 20 TOKEN_B out
                to: TRADER as `0x${string}`,
              },
              block: { number: 28220373, timestamp: 1700000400, hash: "0x" + "b4".repeat(32) },
              transaction: { hash: "0x" + "e4".repeat(32), from: TRADER as `0x${string}` },
            },
          ],
        },
      },
    });

    // pair created + template registered (Sync/Swap handled => pair exists with reserves)
    const pair = await indexer.AmmPair.getOrThrow(PAIR);
    expect(pair.token0_id).toBe(TOKEN_A);
    expect(pair.token1_id).toBe(TOKEN_B);
    // reserves after Sync: 100 / 200
    expect(pair.reserve0.toString()).toBe("100");
    expect(pair.reserve1.toString()).toBe("200");
    // token0Price = reserve0/reserve1 = 0.5 ; token1Price = 2
    expect(pair.token0Price.toString()).toBe("0.5");
    expect(pair.token1Price.toString()).toBe("2");

    // Swap volume: volumeUSD = amount0In*priceA + amount1In*priceB = 10*2 + 0 = 20
    expect(pair.volumeUSD.toString()).toBe("20");
    expect(pair.volumeToken0.toString()).toBe("10");
    expect(pair.volumeToken1.toString()).toBe("20");
    expect(pair.transactionCount).toBe(1n);

    // AmmTrade entity
    const trade = await indexer.AmmTrade.getOrThrow(`0x${"e4".repeat(32)}-0`);
    expect(trade.amount0In.toString()).toBe("10");
    expect(trade.amount1Out.toString()).toBe("20");
    expect(trade.amountUSD.toString()).toBe("20");
    expect(trade.to).toBe(TRADER);
    expect(trade.from).toBe(TRADER);

    // factory counters
    const factory = await indexer.AmmFactory.getOrThrow(FACTORY);
    expect(factory.pairCount).toBe(1);
    expect(factory.ammTradeCount).toBe(1n);
    expect(factory.totalAmmVolumeUSD.toString()).toBe("20");

    // reverse lookups for pricing graph
    const lookup = await indexer.AmmPairReverseLookup.getOrThrow(`${TOKEN_A}-${TOKEN_B}`);
    expect(lookup.pair_id).toBe(PAIR);
  });
});
