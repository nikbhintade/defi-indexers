/**
 * Offline test of handleNewPair: PairCreated creates the UniswapFactory
 * singleton + Bundle, both Token entities (ERC20 metadata eth_calls mocked via
 * QUICKSWAP_CALL_MOCK, including the bytes32 fallback, the reverted-decimals → 0
 * quirk and totalSupply), the Pair entity and (for whitelist-paired tokens) the
 * per-token `whitelist` arrays. No RPC.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTestIndexer } from "envio";
import { setCallMock, type CallMockRule } from "../src/effects/calls";

const FACTORY = "0x5757371414417b8c6caad45baef941abc7d3ab32";
// USDC is a whitelist token; TKB is not. Pairing them means TKB.whitelist gets
// the pair address (because token0/USDC is whitelisted).
const USDC = "0x2791bca1f2de4661ed88a30c99a7a9449aa84174";
const TKB = "0xbbbb00000000000000000000000000000000bbbb";
const PAIR = "0xcccc00000000000000000000000000000000cccc";

const str = (value: string) => ({ kind: "string", value }) as const;
const num = (value: number) => ({ kind: "number", value }) as const;
const big = (value: string) => ({ kind: "bigint", value }) as const;
const revert = { kind: "revert" } as const;

/** right-padded bytes32 hex of a UTF-8 string (what ERC20NameBytes returns) */
const toBytes32 = (s: string) => ("0x" + Buffer.from(s, "utf8").toString("hex").padEnd(64, "0")) as string;

afterEach(() => setCallMock(undefined));

describe("pair creation flow", () => {
  it("PairCreated creates Factory/Bundle/Tokens/Pair (string metadata, bytes32 fallback, decimals quirk, whitelist)", async () => {
    const rules: CallMockRule[] = [
      // USDC: plain string-returning ERC20
      { fn: "name", to: USDC, result: str("USD Coin (PoS)") },
      { fn: "symbol", to: USDC, result: str("USDC") },
      { fn: "decimals", to: USDC, result: num(6) },
      { fn: "totalSupply", to: USDC, result: big("1000000000000") },
      // TKB: string calls revert; name has a bytes32 fallback, symbol does not
      // (-> "unknown"); decimals reverts (-> 0, the AssemblyScript
      // null-coercion quirk); totalSupply reverts (-> 0).
      { fn: "name", to: TKB, result: revert },
      { fn: "nameBytes32", to: TKB, result: str(toBytes32("Bytes Name")) },
      { fn: "symbol", to: TKB, result: revert },
      { fn: "symbolBytes32", to: TKB, result: revert },
      { fn: "decimals", to: TKB, result: revert },
      { fn: "totalSupply", to: TKB, result: revert },
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
              // checksummed/uppercased on purpose: ids must be lowercased
              params: {
                token0: USDC.toUpperCase().replace("0X", "0x") as `0x${string}`,
                token1: TKB as `0x${string}`,
                pair: PAIR.toUpperCase().replace("0X", "0x") as `0x${string}`,
                pairIndex: 1n,
              },
              block: { number: 5485000, timestamp: 1600000000 },
            },
          ],
        },
      },
    });

    // UniswapFactory singleton (id = lowercase factory address)
    const factory = await indexer.UniswapFactory.getOrThrow(FACTORY);
    expect(factory.pairCount).toBe(1);
    expect(factory.txCount).toBe(0n);
    expect(factory.totalVolumeUSD.toString()).toBe("0");
    expect(factory.totalVolumeETH.toString()).toBe("0");
    expect(factory.untrackedVolumeUSD.toString()).toBe("0");
    expect(factory.totalLiquidityUSD.toString()).toBe("0");
    expect(factory.totalLiquidityETH.toString()).toBe("0");

    // Bundle created alongside the factory
    const bundle = await indexer.Bundle.getOrThrow("1");
    expect(bundle.ethPrice.toString()).toBe("0");

    // USDC token: generic string metadata
    const usdc = await indexer.Token.getOrThrow(USDC);
    expect(usdc.name).toBe("USD Coin (PoS)");
    expect(usdc.symbol).toBe("USDC");
    expect(usdc.decimals).toBe(6n);
    expect(usdc.totalSupply).toBe(1000000000000n);
    expect(usdc.derivedETH?.toString()).toBe("0");
    expect(usdc.tradeVolume.toString()).toBe("0");
    expect(usdc.totalLiquidity.toString()).toBe("0");
    expect(usdc.txCount).toBe(0n);
    // USDC is whitelisted but its partner (TKB) is not, so USDC.whitelist stays empty
    expect(usdc.whitelist).toEqual([]);

    // TKB: bytes32 name fallback, symbol "unknown", reverted decimals -> 0,
    // reverted totalSupply -> 0; whitelist gets the pair (partner USDC is whitelisted)
    const tokenB = await indexer.Token.getOrThrow(TKB);
    expect(tokenB.name).toBe("Bytes Name");
    expect(tokenB.symbol).toBe("unknown");
    expect(tokenB.decimals).toBe(0n);
    expect(tokenB.totalSupply).toBe(0n);
    expect(tokenB.whitelist).toEqual([PAIR]);

    // Pair entity (lowercase id, createdAt fields, zeroed stats)
    const pair = await indexer.Pair.getOrThrow(PAIR);
    expect(pair.token0_id).toBe(USDC);
    expect(pair.token1_id).toBe(TKB);
    expect(pair.txCount).toBe(0n);
    expect(pair.reserve0.toString()).toBe("0");
    expect(pair.reserve1.toString()).toBe("0");
    expect(pair.trackedReserveETH.toString()).toBe("0");
    expect(pair.reserveETH.toString()).toBe("0");
    expect(pair.reserveUSD.toString()).toBe("0");
    expect(pair.totalSupply.toString()).toBe("0");
    expect(pair.token0Price.toString()).toBe("0");
    expect(pair.token1Price.toString()).toBe("0");
    expect(pair.liquidityProviderCount).toBe(0n);
    expect(pair.createdAtBlockNumber).toBe(5485000n);
    expect(pair.createdAtTimestamp).toBe(1600000000n);
  });
});
