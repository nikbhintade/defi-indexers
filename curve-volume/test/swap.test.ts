/**
 * Offline test of the swap flow: a TokenExchange on a seeded pool produces a
 * SwapEvent, updates hourly/daily/weekly SwapVolumeSnapshots, Candles, the
 * PriceFeed and the pool's cumulative volume.
 *
 * The pool is seeded so the swap path needs no eth_calls (assetType 0 ->
 * USDT-pegged pricing, no lending/meta tokens) and the Platform is seeded
 * with latestPoolSnapshot equal to the swap's day bucket so
 * takePoolSnapshots returns early (its eth_call heavy path is exercised
 * against a live RPC during validation runs instead).
 */
import { afterEach, describe, expect, it } from "vitest";
import { BigDecimal, createTestIndexer, type Pool } from "envio";
import { setCallMock } from "../src/effects/calls";

const POOL = "0x1234123412341234123412341234123412341234";
const DAI = "0x6b175474e89094c44da98b954eedeac495271d0f";
const USDT = "0xdac17f958d2ee523a2206206994597c13d831ec7";
const BUYER = "0xabcdabcdabcdabcdabcdabcdabcdabcdabcdabcd";
const TX1 = "0x" + "aa".repeat(32);
const TX2 = "0x" + "bb".repeat(32);

const TS1 = 1700000000; // hour bucket 1699999200, day bucket 1699920000, week bucket 1699488000
const DAY_BUCKET = 1699920000n;
const HOUR_BUCKET = 1699999200n;
const WEEK_BUCKET = 1699488000n;
const HOUR_ID = Math.floor(TS1 / 3600); // 472222

const ZERO = new BigDecimal("0");

function seedPool(): Pool {
  return {
    id: POOL,
    address: POOL,
    platform_id: "Curve",
    name: "Curve.fi DAI/USDT",
    symbol: "crvDAIUSDT",
    metapool: false,
    lpToken: POOL,
    basePool: "0x0000000000000000000000000000000000000000",
    coins: [DAI, USDT],
    coinDecimals: [18n, 6n],
    coinNames: ["DAI", "USDT"],
    assetType: 0,
    poolType: "REGISTRY_V1",
    c128: false,
    isV2: false,
    isRebasing: false,
    cumulativeVolume: ZERO,
    cumulativeVolumeUSD: ZERO,
    cumulativeFeesUSD: ZERO,
    virtualPrice: ZERO,
    baseApr: ZERO,
    creationDate: 1603800000n,
    creationTx: "0x" + "00".repeat(32),
    creationBlock: 11154000n,
  };
}

afterEach(() => setCallMock(undefined));

describe("swap flow", () => {
  it("TokenExchange produces SwapEvent, volume snapshots, candles and price feed", async () => {
    // the seeded path must not hit the RPC at all: strict mode throws on any call
    setCallMock({ strict: true, rules: [] });

    const indexer = createTestIndexer();
    indexer.Platform.set({
      id: "Curve",
      poolAddresses: [POOL],
      latestPoolSnapshot: DAY_BUCKET, // skip takePoolSnapshots
    });
    indexer.Pool.set(seedPool());

    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "CurvePool",
              event: "TokenExchange",
              srcAddress: POOL as `0x${string}`,
              params: {
                buyer: BUYER as `0x${string}`,
                sold_id: 0n,
                tokens_sold: 1000n * 10n ** 18n, // 1000 DAI
                bought_id: 1n,
                tokens_bought: 998n * 10n ** 6n, // 998 USDT
              },
              block: { number: 18000000, timestamp: TS1 },
              transaction: { hash: TX1, gas: 300000n, gasUsed: 150000n },
            },
            {
              contract: "CurvePool",
              event: "TokenExchange",
              srcAddress: POOL as `0x${string}`,
              params: {
                buyer: BUYER as `0x${string}`,
                sold_id: 0n,
                tokens_sold: 500n * 10n ** 18n, // 500 DAI
                bought_id: 1n,
                tokens_bought: 502n * 10n ** 6n, // 502 USDT
              },
              block: { number: 18000001, timestamp: TS1 + 100 },
              transaction: { hash: TX2, gas: 400000n, gasUsed: 160000n },
            },
          ],
        },
      },
    });

    // ---- SwapEvent (id = txhash + '-' + amountBought) ----
    const swap1 = await indexer.SwapEvent.getOrThrow(TX1 + "-998");
    expect(swap1.pool_id).toBe(POOL);
    expect(swap1.block).toBe(18000000n);
    expect(swap1.buyer).toBe(BUYER);
    expect(swap1.tokenSold).toBe(DAI);
    expect(swap1.tokenBought).toBe(USDT);
    expect(swap1.amountSold.toString()).toBe("1000");
    expect(swap1.amountBought.toString()).toBe("998");
    // assetType 0 -> USDT snapshot price of 1, no depeg feeds yet
    expect(swap1.amountSoldUSD.toString()).toBe("1000");
    expect(swap1.amountBoughtUSD.toString()).toBe("998");
    expect(swap1.gasLimit).toBe(300000n);
    expect(swap1.gasUsed).toBe(150000n);
    expect(swap1.timestamp).toBe(BigInt(TS1));

    const swap2 = await indexer.SwapEvent.getOrThrow(TX2 + "-502");
    expect(swap2.amountSold.toString()).toBe("500");

    // ---- USDT TokenSnapshot priced at 1 for the hour ----
    const tokenSnapshot = await indexer.TokenSnapshot.getOrThrow(USDT + "-" + HOUR_BUCKET.toString());
    expect(tokenSnapshot.price.toString()).toBe("1");
    expect(tokenSnapshot.token).toBe(USDT);

    // ---- SwapVolumeSnapshots: hourly / daily / weekly ----
    // swap1: amountSoldUSD = 1000 (no feed yet), volume = (1000+998)/2 = 999
    // swap2: DAI is priced via the PriceFeed left by swap1 (0.998) ->
    //        amountSoldUSD = 500 * 0.998 = 499, volumeUSD = (499+502)/2 = 500.5
    for (const [period, bucket] of [
      [3600n, HOUR_BUCKET],
      [86400n, DAY_BUCKET],
      [604800n, WEEK_BUCKET],
    ] as const) {
      const snap = await indexer.SwapVolumeSnapshot.getOrThrow(
        POOL + "-" + period.toString() + "-" + bucket.toString(),
      );
      expect(snap.pool_id).toBe(POOL);
      expect(snap.period).toBe(period);
      expect(snap.timestamp).toBe(bucket);
      expect(snap.count).toBe(2n);
      expect(snap.amountSold.toString()).toBe("1500");
      expect(snap.amountBought.toString()).toBe("1500");
      expect(snap.amountSoldUSD.toString()).toBe("1499"); // 1000 + 499
      expect(snap.amountBoughtUSD.toString()).toBe("1500"); // 998 + 502
      expect(snap.volume.toString()).toBe("1500");
      expect(snap.volumeUSD.toString()).toBe("1499.5"); // 999 + 500.5
    }

    // ---- Candles (id = pool-token0-token1-timeid-period, pair sorted) ----
    // DAI < USDT lexicographically; price = amountSold / amountBought
    const candle = await indexer.Candle.getOrThrow(
      POOL + "-" + DAI + "-" + USDT + "-" + HOUR_ID.toString() + "-3600",
    );
    expect(candle.token0).toBe(DAI);
    expect(candle.token1).toBe(USDT);
    expect(candle.txs).toBe(2n);
    expect(candle.timestamp).toBe(BigInt(TS1)); // first swap's timestamp
    expect(candle.lastBlock).toBe(18000001n);
    expect(candle.open.toFixed(6)).toBe("1.002004"); // 1000/998
    expect(candle.close.toFixed(6)).toBe("0.996016"); // 500/502
    expect(candle.high.toFixed(6)).toBe("1.002004");
    expect(candle.low.toFixed(6)).toBe("0.996016");
    // amounts follow the call order (tokenBought first), not the sorted pair
    expect(candle.token0TotalAmount.toString()).toBe("1500"); // 998 + 502 (bought)
    expect(candle.token1TotalAmount.toString()).toBe("1500"); // 1000 + 500 (sold)

    // ---- PriceFeed (id = pool-tokenSold-tokenBought) ----
    const feed = await indexer.PriceFeed.getOrThrow(POOL + "-" + DAI + "-" + USDT);
    expect(feed.fromIndex).toBe(0);
    expect(feed.toIndex).toBe(1);
    expect(feed.isUnderlying).toBe(false);
    expect(feed.price.toFixed(3)).toBe("1.004"); // last swap: 502/500
    expect(feed.lastBlock).toBe(18000001n);
    expect(feed.lastUpdated).toBe(BigInt(TS1 + 100));

    // ---- Pool cumulative volume ----
    const pool = await indexer.Pool.getOrThrow(POOL);
    expect(pool.cumulativeVolume.toString()).toBe("1500");
    expect(pool.cumulativeVolumeUSD.toString()).toBe("1499.5");
  });
});
