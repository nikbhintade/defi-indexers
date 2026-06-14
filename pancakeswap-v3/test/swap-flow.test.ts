/**
 * Offline test of the Initialize + Mint + Swap flow on the WBNB-USDT 500 pool
 * (the wNativeStablePool used by getEthPriceInUSD). Asserts exact values for
 * pool price/tick/liquidity/sqrtPrice/TVL, bundle ETH price, token derived
 * prices, the Mint-created Tick entities (liquidityGross/Net) and a PoolDayData.
 *
 * Numbers (USDT = token0, WBNB = token1, both 18 decimals):
 *  - Initialize sqrtPriceX96 = 2^96 (raw price 1), tick = 0. handleInitialize
 *    does NOT compute token0Price (stays 0), so the bundle stays 0 here.
 *  - Mint range [-60, 60), amount 1_000_000, amounts 1000 USDT / 10 WBNB.
 *    pool.tick (0) is in range -> liquidity = 1_000_000.
 *  - Swap: 1 WBNB in / 1 USDT out, post sqrtPriceX96 = 2^96 (tick 0). The swap
 *    computes token0Price = token1Price = 1, then getEthPriceInUSD reads the
 *    freshly-set pool.token0Price = 1 -> ethPriceUSD = 1. USDT (stablecoin)
 *    derivedETH = 1, WBNB (wNative) derivedETH = 1.
 *  - Post-swap TVL token0 = 1000 - 1 = 999, token1 = 10 + 1 = 11,
 *    totalValueLockedETH = 999*1 + 11*1 = 1010, USD = 1010.
 */
import { afterEach, describe, expect, it } from "vitest";
import { BigDecimal, createTestIndexer } from "envio";
import { setCallMock, type CallMockRule } from "../src/effects/calls";
import { bigDecimalExponated, safeDiv } from "../src/utils/index";

const USDT = "0x55d398326f99059ff775485246999027b3197955"; // token0, stablecoin + whitelist
const WBNB = "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c"; // token1, wNative + whitelist
const POOL = "0x36696169c63e42cd08ce11f5deebbcebae652050"; // WBNB-USDT 500 (wNativeStablePool)
const SENDER = "0x1111111111111111111111111111111111111111";
const OWNER = "0x2222222222222222222222222222222222222222";
const RECIP = "0x3333333333333333333333333333333333333333";
const FROM = "0x4444444444444444444444444444444444444444";
const TX1 = ("0x" + "aa".repeat(32)) as `0x${string}`;
const TX2 = ("0x" + "bb".repeat(32)) as `0x${string}`;

const E18 = 10n ** 18n;
const Q96 = 2n ** 96n;

const str = (value: string) => ({ kind: "string", value }) as const;
const num = (value: number) => ({ kind: "number", value }) as const;
const big = (value: string) => ({ kind: "bigint", value }) as const;
const revert = { kind: "revert" } as const;

afterEach(() => setCallMock(undefined));

describe("WBNB-USDT initialize + mint + swap flow", () => {
  it("updates pool price/tick/liquidity/TVL, token prices, ticks and day datas with exact values", async () => {
    const rules: CallMockRule[] = [
      { fn: "symbol", to: USDT, result: str("USDT") },
      { fn: "name", to: USDT, result: str("Tether USD") },
      { fn: "decimals", to: USDT, result: num(18) },
      { fn: "totalSupply", to: USDT, result: big("0") },
      { fn: "symbol", to: WBNB, result: str("WBNB") },
      { fn: "name", to: WBNB, result: str("Wrapped BNB") },
      { fn: "decimals", to: WBNB, result: num(18) },
      { fn: "totalSupply", to: WBNB, result: big("0") },
      // pool state reads during Swap/Mint: keep fee growth + ticks reverting/0.
      { fn: "feeGrowthGlobal0X128", result: big("0") },
      { fn: "feeGrowthGlobal1X128", result: big("0") },
      { fn: "ticks", result: revert },
    ];
    setCallMock({ strict: true, rules });

    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        56: {
          simulate: [
            {
              contract: "Factory",
              event: "PoolCreated",
              params: {
                token0: USDT as `0x${string}`,
                token1: WBNB as `0x${string}`,
                fee: 500n,
                tickSpacing: 10n,
                pool: POOL as `0x${string}`,
              },
              logIndex: 1,
              block: { number: 26956207, timestamp: 1660000000 },
            },
            {
              contract: "Pool",
              event: "Initialize",
              srcAddress: POOL,
              params: { sqrtPriceX96: Q96, tick: 0n },
              logIndex: 1,
              block: { number: 26956300, timestamp: 1660000300 },
            },
            {
              contract: "Pool",
              event: "Mint",
              srcAddress: POOL,
              params: {
                sender: SENDER,
                owner: OWNER,
                tickLower: -60n,
                tickUpper: 60n,
                amount: 1_000_000n,
                amount0: 1000n * E18,
                amount1: 10n * E18,
              },
              logIndex: 2,
              block: { number: 26956400, timestamp: 1660000400 },
              transaction: { hash: TX1, from: FROM },
            },
            {
              contract: "Pool",
              event: "Swap",
              srcAddress: POOL,
              params: {
                sender: SENDER,
                recipient: RECIP,
                amount0: -1n * E18, // 1 USDT out
                amount1: 1n * E18, // 1 WBNB in
                sqrtPriceX96: Q96,
                liquidity: 1_000_000n,
                tick: 0n,
                protocolFeesToken0: 0n,
                protocolFeesToken1: 0n,
              },
              logIndex: 3,
              block: { number: 26956500, timestamp: 1660000500 },
              transaction: { hash: TX2, from: FROM },
            },
          ],
        },
      },
    });

    // ---- Pool ----
    const pool = await indexer.Pool.getOrThrow(POOL);
    expect(pool.sqrtPrice).toBe(Q96);
    expect(pool.tick).toBe(0n);
    expect(pool.liquidity).toBe(1_000_000n);
    expect(pool.token0Price.toString()).toBe("1");
    expect(pool.token1Price.toString()).toBe("1");
    expect(pool.volumeToken0.toString()).toBe("1");
    expect(pool.volumeToken1.toString()).toBe("1");
    expect(pool.volumeUSD.toString()).toBe("0");
    expect(pool.totalValueLockedToken0.toString()).toBe("999");
    expect(pool.totalValueLockedToken1.toString()).toBe("11");
    expect(pool.totalValueLockedETH.toString()).toBe("1010");
    expect(pool.totalValueLockedUSD.toString()).toBe("1010");
    // txCount: Mint (+1) + Swap (+1)
    expect(pool.txCount).toBe(2n);
    expect(pool.liquidityProviderCount).toBe(1n);

    // ---- Bundle ----
    const bundle = await indexer.Bundle.getOrThrow("1");
    expect(bundle.ethPriceUSD.toString()).toBe("1");

    // ---- Tokens ----
    const usdt = await indexer.Token.getOrThrow(USDT);
    expect(usdt.derivedETH.toString()).toBe("1"); // stablecoin: 1/ethPriceUSD
    expect(usdt.derivedUSD.toString()).toBe("1");
    expect(usdt.totalValueLocked.toString()).toBe("999");
    expect(usdt.volume.toString()).toBe("1");

    const wbnb = await indexer.Token.getOrThrow(WBNB);
    expect(wbnb.derivedETH.toString()).toBe("1"); // wNative
    expect(wbnb.derivedUSD.toString()).toBe("1");
    expect(wbnb.totalValueLocked.toString()).toBe("11");
    expect(wbnb.volume.toString()).toBe("1");

    // ---- Factory ----
    const factory = await indexer.Factory.getOrThrow("0x0bfbcf9fa4f9c56b0f40a671ad40e0805a091865");
    // volumeETH = adjustedEth(1+1=... actually 1*0 + 1*1 = 1) / 2 = 0.5 (ethPrice
    // was still 0 at volume calc time, so volumeUSD stays 0).
    expect(factory.totalVolumeETH.toString()).toBe("0.5");
    expect(factory.totalVolumeUSD.toString()).toBe("0");
    // txCount: Mint + Swap
    expect(factory.txCount).toBe(2n);
    expect(factory.totalValueLockedUSD.toString()).toBe("1010");

    // ---- Ticks (from Mint) ----
    const lower = await indexer.Tick.getOrThrow(`${POOL}#-60`);
    expect(lower.liquidityGross).toBe(1_000_000n);
    expect(lower.liquidityNet).toBe(1_000_000n);
    expect(lower.tickIdx).toBe(-60n);
    expect(lower.pool_id).toBe(POOL);
    const price0Lower = bigDecimalExponated(new BigDecimal("1.0001"), -60n);
    expect(lower.price0.toString()).toBe(price0Lower.toString());
    expect(lower.price1.toString()).toBe(safeDiv(new BigDecimal("1"), price0Lower).toString());

    const upper = await indexer.Tick.getOrThrow(`${POOL}#60`);
    expect(upper.liquidityGross).toBe(1_000_000n);
    expect(upper.liquidityNet).toBe(-1_000_000n);

    // ---- Mint entity ----
    const mint = await indexer.Mint.getOrThrow(`${TX1.toLowerCase()}#1`);
    expect(mint.owner).toBe(OWNER);
    expect(mint.sender).toBe(SENDER);
    expect(mint.origin).toBe(FROM);
    expect(mint.amount).toBe(1_000_000n);
    expect(mint.amount0.toString()).toBe("1000");
    expect(mint.amount1.toString()).toBe("10");
    expect(mint.tickLower).toBe(-60n);
    expect(mint.tickUpper).toBe(60n);

    // ---- Swap entity ----
    const swap = await indexer.Swap.getOrThrow(`${TX2.toLowerCase()}#2`);
    expect(swap.amount0.toString()).toBe("-1");
    expect(swap.amount1.toString()).toBe("1");
    expect(swap.amountUSD.toString()).toBe("0");
    expect(swap.tick).toBe(0n);
    expect(swap.sqrtPriceX96).toBe(Q96);
    expect(swap.recipient).toBe(RECIP);

    // ---- PoolDayData ----
    const dayId = Math.floor(1660000500 / 86400);
    const poolDay = await indexer.PoolDayData.getOrThrow(`${POOL}-${dayId}`);
    expect(poolDay.token0Price.toString()).toBe("1");
    expect(poolDay.volumeToken0.toString()).toBe("1");
    expect(poolDay.volumeToken1.toString()).toBe("1");
    expect(poolDay.tvlUSD.toString()).toBe("1010");
  });
});
