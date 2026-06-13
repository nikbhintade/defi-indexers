/**
 * Offline test of the PendleMarket Sync flow on a seeded market (Pair +
 * token0/token1). Asserts the exact reserve / weight / spot-price accounting:
 *  - reserve0 / reserve1 (decimal-converted from the event)
 *  - token0WeightRaw / token1WeightRaw (weight0 and RONE - weight0)
 *  - token0Price (the AMM spot price derived purely from reserves & weights)
 *    and token1Price (= 1)
 *  - totalSupply (raw value as BigDecimal, from a mocked PendleMarket.totalSupply)
 *
 * No UniswapPool entities and no LiquidityMining are seeded, so the USD-priced
 * fields resolve to 0 (getUniswapTokenPrice -> 0; updateMarketLiquidityMiningApr
 * returns immediately for a market with no LM). token0Price is independent of
 * pricing and is the load-bearing exact value here.
 */
import { afterEach, describe, expect, it } from "vitest";
import { BigDecimal, createTestIndexer, type Pair, type Token } from "envio";
import { setCallMock, type CallMockRule } from "../src/effects/calls";

const MARKET = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
const YT = "0xbb00000000000000000000000000000000000002"; // token0 (xyt)
const BASE = "0xcc00000000000000000000000000000000000003"; // token1 (swapBase)

const RONE = 2n ** 40n;
const W0 = RONE / 2n; // equal weights -> 2^39
const E18 = 10n ** 18n;
const BLOCK = 12701000;
const TS = 1641000000;

const ZERO = new BigDecimal("0");
const big = (value: bigint) => ({ kind: "bigint", value: value.toString() }) as const;

function seedToken(over: Partial<Token> & { id: string }): Token {
  return {
    symbol: "",
    name: "",
    decimals: 18n,
    forgeId: undefined,
    underlyingAsset: undefined,
    totalSupply: 0n,
    tradeVolume: ZERO,
    tradeVolumeUSD: ZERO,
    mintVolume: ZERO,
    mintVolumeUSD: ZERO,
    redeemVolume: ZERO,
    redeemVolumeUSD: ZERO,
    txCount: 0n,
    totalLiquidity: ZERO,
    type: undefined,
    ...over,
  };
}

function seedPair(): Pair {
  return {
    id: MARKET,
    token0_id: YT,
    token1_id: BASE,
    token0WeightRaw: 0n,
    token1WeightRaw: 0n,
    liquidityProviderCount: 0n,
    createdAtTimestamp: BigInt(TS),
    createdAtBlockNumber: BigInt(BLOCK),
    txCount: 0n,
    feesToken0: ZERO,
    feesToken1: ZERO,
    feesUSD: ZERO,
    reserve0: ZERO,
    reserve1: ZERO,
    reserveUSD: ZERO,
    totalSupply: ZERO,
    volumeToken0: ZERO,
    volumeToken1: ZERO,
    volumeUSD: ZERO,
    token0Price: ZERO,
    token1Price: ZERO,
    lpStaked: ZERO,
    lpPriceUSD: ZERO,
    lpStakedUSD: ZERO,
    expiry: 1700000000n,
    liquidityMining_id: undefined,
    lpAPR: undefined,
    yieldTokenHolderAddress: undefined,
  };
}

afterEach(() => setCallMock(undefined));

describe("PendleMarket Sync flow", () => {
  it("updates Pair reserves, weights and spot prices with exact values", async () => {
    setCallMock({
      strict: true,
      // PendleMarket.totalSupply() (mock name "marketTotalSupply"); stored raw.
      rules: [{ fn: "marketTotalSupply", to: MARKET, result: big(1500n) }] as CallMockRule[],
    });

    const indexer = createTestIndexer();
    indexer.Token.set(seedToken({ id: YT, symbol: "YT", type: "yt", underlyingAsset: BASE }));
    indexer.Token.set(seedToken({ id: BASE, symbol: "BASE", type: "swapBase" }));
    indexer.Pair.set(seedPair());

    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "PendleMarket",
              event: "Sync",
              srcAddress: MARKET as `0x${string}`,
              logIndex: 1,
              params: {
                reserve0: 100n * E18, // xyt balance
                weight0: W0,
                reserve1: 200n * E18, // base balance
              },
              block: { number: BLOCK, timestamp: TS },
            },
          ],
        },
      },
    });

    const pair = await indexer.Pair.getOrThrow(MARKET);
    expect(pair.reserve0.toString()).toBe("100");
    expect(pair.reserve1.toString()).toBe("200");
    expect(pair.token0WeightRaw).toBe(W0);
    expect(pair.token1WeightRaw).toBe(RONE - W0);
    // rawXytPrice = (200 * W0) / ((RONE-W0) * 100) = 2 ; multiplier = 10^(18-18)=1
    expect(pair.token0Price.toString()).toBe("2");
    expect(pair.token1Price.toString()).toBe("1");
    // pair.totalSupply = raw totalSupply().toBigDecimal() (NOT decimal-scaled)
    expect(pair.totalSupply.toString()).toBe("1500");
    // no uniswap pools -> base price 0 -> reserveUSD / lpPriceUSD = 0
    expect(pair.reserveUSD.toString()).toBe("0");
    expect(pair.lpPriceUSD.toString()).toBe("0");
    // updateMarketLiquidityMiningApr resets these to 0 for an LM-less market
    expect(pair.lpStaked.toString()).toBe("0");
    expect(pair.lpStakedUSD.toString()).toBe("0");
    expect(pair.lpAPR?.toString()).toBe("0");

    // token totalLiquidity tracking: reserve added
    const yt = await indexer.Token.getOrThrow(YT);
    const base = await indexer.Token.getOrThrow(BASE);
    expect(yt.totalLiquidity.toString()).toBe("100");
    expect(base.totalLiquidity.toString()).toBe("200");
  });
});
