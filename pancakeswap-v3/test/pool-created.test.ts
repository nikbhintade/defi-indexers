/**
 * Offline test of handlePoolCreated: PoolCreated creates the Factory singleton
 * + Bundle, both Token entities (ERC20 metadata eth_calls mocked via
 * PANCAKE_V3_CALL_MOCK including a bytes32 fallback and the reverted-decimals
 * -> 0 quirk), the Pool entity, the whitelistPools wiring, and registers the
 * Pool template (verified by a subsequent Initialize updating the pool). No RPC.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTestIndexer } from "envio";
import { setCallMock, type CallMockRule } from "../src/effects/calls";

const FACTORY = "0x0bfbcf9fa4f9c56b0f40a671ad40e0805a091865";
const USDT = "0x55d398326f99059ff775485246999027b3197955"; // whitelisted + stablecoin
const WBNB = "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c"; // whitelisted
const POOL = "0x36696169c63e42cd08ce11f5deebbcebae652050"; // WBNB-USDT 500 (wNativeStablePool)
const NONWL = "0xdddd00000000000000000000000000000000dddd"; // not whitelisted
const POOL2 = "0xeeee00000000000000000000000000000000eeee";

const str = (value: string) => ({ kind: "string", value }) as const;
const num = (value: number) => ({ kind: "number", value }) as const;
const big = (value: string) => ({ kind: "bigint", value }) as const;
const revert = { kind: "revert" } as const;
const toBytes32 = (s: string) => ("0x" + Buffer.from(s, "utf8").toString("hex").padEnd(64, "0")) as string;

const Q96 = 2n ** 96n;

afterEach(() => setCallMock(undefined));

describe("pool creation flow", () => {
  it("PoolCreated creates Factory/Bundle/Tokens/Pool and registers the Pool template", async () => {
    const rules: CallMockRule[] = [
      { fn: "symbol", to: USDT, result: str("USDT") },
      { fn: "name", to: USDT, result: str("Tether USD") },
      { fn: "decimals", to: USDT, result: num(18) },
      { fn: "totalSupply", to: USDT, result: big("1000000000000000000000") },
      { fn: "symbol", to: WBNB, result: str("WBNB") },
      { fn: "name", to: WBNB, result: str("Wrapped BNB") },
      { fn: "decimals", to: WBNB, result: num(18) },
      { fn: "totalSupply", to: WBNB, result: big("0") },
      // second pool: non-whitelisted token whose string calls revert
      { fn: "symbol", to: NONWL, result: revert },
      { fn: "symbolBytes32", to: NONWL, result: revert },
      { fn: "name", to: NONWL, result: revert },
      { fn: "nameBytes32", to: NONWL, result: str(toBytes32("Mystery")) },
      { fn: "decimals", to: NONWL, result: revert }, // -> 0 quirk
      { fn: "totalSupply", to: NONWL, result: revert }, // -> 0
      // Initialize triggers no eth_calls (token prices use store only).
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
              // token0 = USDT, token1 = WBNB; checksum-cased on purpose
              params: {
                token0: USDT.toUpperCase().replace("0X", "0x") as `0x${string}`,
                token1: WBNB as `0x${string}`,
                fee: 500n,
                tickSpacing: 10n,
                pool: POOL.toUpperCase().replace("0X", "0x") as `0x${string}`,
              },
              logIndex: 1,
              block: { number: 26956207, timestamp: 1660000000 },
            },
            // second pool pairs WBNB (token0) with a non-whitelisted token1
            {
              contract: "Factory",
              event: "PoolCreated",
              params: {
                token0: WBNB as `0x${string}`,
                token1: NONWL as `0x${string}`,
                fee: 2500n,
                tickSpacing: 50n,
                pool: POOL2 as `0x${string}`,
              },
              logIndex: 2,
              block: { number: 26956208, timestamp: 1660000005 },
            },
            // Pool template must have been registered for POOL: this Initialize
            // mutates the pool created above.
            {
              contract: "Pool",
              event: "Initialize",
              srcAddress: POOL,
              params: { sqrtPriceX96: Q96, tick: 0n },
              logIndex: 1,
              block: { number: 26956300, timestamp: 1660000300 },
            },
          ],
        },
      },
    });

    const factory = await indexer.Factory.getOrThrow(FACTORY);
    expect(factory.poolCount).toBe(2n);
    expect(factory.txCount).toBe(0n);
    expect(factory.owner).toBe("0x0000000000000000000000000000000000000000");
    expect(factory.totalValueLockedUSD.toString()).toBe("0");

    const bundle = await indexer.Bundle.getOrThrow("1");
    expect(bundle.ethPriceUSD.toString()).toBe("0");

    const usdt = await indexer.Token.getOrThrow(USDT);
    expect(usdt.symbol).toBe("USDT");
    expect(usdt.name).toBe("Tether USD");
    expect(usdt.decimals).toBe(18n);
    expect(usdt.totalSupply).toBe(1000000000000000000000n);
    // USDT is token0 in POOL, WBNB (whitelisted) is token1 -> USDT gets the pool
    expect(usdt.whitelistPools).toEqual([POOL]);

    const wbnb = await indexer.Token.getOrThrow(WBNB);
    expect(wbnb.symbol).toBe("WBNB");
    // WBNB is token1 in POOL (USDT whitelisted) AND token0 in POOL2 (NONWL not
    // whitelisted -> no pool added there). So WBNB gets only POOL.
    expect(wbnb.whitelistPools).toEqual([POOL]);

    const mystery = await indexer.Token.getOrThrow(NONWL);
    expect(mystery.symbol).toBe("unknown");
    expect(mystery.name).toBe("Mystery"); // bytes32 fallback
    expect(mystery.decimals).toBe(0n); // reverted -> 0
    // WBNB (token0, whitelisted) -> POOL2 is added to NONWL (token1)
    expect(mystery.whitelistPools).toEqual([POOL2]);

    const pool = await indexer.Pool.getOrThrow(POOL);
    expect(pool.token0_id).toBe(USDT);
    expect(pool.token1_id).toBe(WBNB);
    expect(pool.feeTier).toBe(500n);
    expect(pool.feeProtocol).toBe(222825800n); // 500 -> 222825800
    expect(pool.createdAtBlockNumber).toBe(26956207n);
    expect(pool.liquidity).toBe(0n);

    // Pool template was registered: Initialize set sqrtPrice + tick on POOL.
    expect(pool.sqrtPrice).toBe(Q96);
    expect(pool.tick).toBe(0n);

    const pool2 = await indexer.Pool.getOrThrow(POOL2);
    expect(pool2.feeTier).toBe(2500n);
    expect(pool2.feeProtocol).toBe(209718400n);
  });
});
