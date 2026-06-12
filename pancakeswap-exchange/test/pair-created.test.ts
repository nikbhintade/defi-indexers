/**
 * Offline test of handlePairCreated: PairCreated creates the PancakeFactory
 * singleton + Bundle, both Token entities (ERC20 metadata eth_calls mocked
 * via PANCAKE_EXCHANGE_CALL_MOCK, including the bytes32 fallback and the
 * reverted-decimals → 0 quirk), the Pair entity and the PairTokenLookup
 * rows. No RPC.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTestIndexer } from "envio";
import { setCallMock, type CallMockRule } from "../src/effects/calls";

const FACTORY = "0xca143ce32fe78f1f7019d7d551a6402fc5350c73";
const TKA = "0xaaaa00000000000000000000000000000000aaaa";
const TKB = "0xbbbb00000000000000000000000000000000bbbb";
const PAIR = "0xcccc00000000000000000000000000000000cccc";

const str = (value: string) => ({ kind: "string", value }) as const;
const num = (value: number) => ({ kind: "number", value }) as const;
const revert = { kind: "revert" } as const;

/** right-padded bytes32 hex of a UTF-8 string (what ERC20NameBytes returns) */
const toBytes32 = (s: string) => ("0x" + Buffer.from(s, "utf8").toString("hex").padEnd(64, "0")) as string;

afterEach(() => setCallMock(undefined));

describe("pair creation flow", () => {
  it("PairCreated creates Factory/Bundle/Tokens/Pair (string metadata, bytes32 fallback, decimals quirk)", async () => {
    const rules: CallMockRule[] = [
      // TKA: plain string-returning ERC20
      { fn: "name", to: TKA, result: str("Token A") },
      { fn: "symbol", to: TKA, result: str("TKA") },
      { fn: "decimals", to: TKA, result: num(18) },
      // TKB: string calls revert; name has a bytes32 fallback, symbol does
      // not (-> "unknown"); decimals reverts (-> 0, the AssemblyScript
      // null-coercion quirk).
      { fn: "name", to: TKB, result: revert },
      { fn: "nameBytes32", to: TKB, result: str(toBytes32("Bytes Name")) },
      { fn: "symbol", to: TKB, result: revert },
      { fn: "symbolBytes32", to: TKB, result: revert },
      { fn: "decimals", to: TKB, result: revert },
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
              // checksummed/uppercased on purpose: ids must be lowercased
              params: {
                token0: TKA.toUpperCase().replace("0X", "0x") as `0x${string}`,
                token1: TKB as `0x${string}`,
                pair: PAIR.toUpperCase().replace("0X", "0x") as `0x${string}`,
                pairIndex: 1n,
              },
              block: { number: 6810000, timestamp: 1600000000 },
            },
          ],
        },
      },
    });

    // PancakeFactory singleton (id = lowercase factory address)
    const factory = await indexer.PancakeFactory.getOrThrow(FACTORY);
    expect(factory.totalPairs).toBe(1n);
    expect(factory.totalTransactions).toBe(0n);
    expect(factory.totalVolumeUSD.toString()).toBe("0");
    expect(factory.totalVolumeBNB.toString()).toBe("0");
    expect(factory.untrackedVolumeUSD.toString()).toBe("0");
    expect(factory.totalLiquidityUSD.toString()).toBe("0");
    expect(factory.totalLiquidityBNB.toString()).toBe("0");

    // Bundle created alongside the factory
    const bundle = await indexer.Bundle.getOrThrow("1");
    expect(bundle.bnbPrice.toString()).toBe("0");

    // Token A: generic string metadata
    const tokenA = await indexer.Token.getOrThrow(TKA);
    expect(tokenA.name).toBe("Token A");
    expect(tokenA.symbol).toBe("TKA");
    expect(tokenA.decimals).toBe(18n);
    expect(tokenA.derivedBNB?.toString()).toBe("0");
    expect(tokenA.derivedUSD?.toString()).toBe("0");
    expect(tokenA.tradeVolume.toString()).toBe("0");
    expect(tokenA.tradeVolumeUSD.toString()).toBe("0");
    expect(tokenA.untrackedVolumeUSD.toString()).toBe("0");
    expect(tokenA.totalLiquidity.toString()).toBe("0");
    expect(tokenA.totalTransactions).toBe(0n);

    // Token B: bytes32 name fallback, symbol "unknown", reverted decimals -> 0
    const tokenB = await indexer.Token.getOrThrow(TKB);
    expect(tokenB.name).toBe("Bytes Name");
    expect(tokenB.symbol).toBe("unknown");
    expect(tokenB.decimals).toBe(0n);

    // Pair entity (lowercase id, name from symbols)
    const pair = await indexer.Pair.getOrThrow(PAIR);
    expect(pair.token0_id).toBe(TKA);
    expect(pair.token1_id).toBe(TKB);
    expect(pair.name).toBe("TKA-unknown");
    expect(pair.totalTransactions).toBe(0n);
    expect(pair.reserve0.toString()).toBe("0");
    expect(pair.reserve1.toString()).toBe("0");
    expect(pair.trackedReserveBNB.toString()).toBe("0");
    expect(pair.reserveBNB.toString()).toBe("0");
    expect(pair.reserveUSD.toString()).toBe("0");
    expect(pair.totalSupply.toString()).toBe("0");
    expect(pair.volumeToken0.toString()).toBe("0");
    expect(pair.volumeToken1.toString()).toBe("0");
    expect(pair.volumeUSD.toString()).toBe("0");
    expect(pair.untrackedVolumeUSD.toString()).toBe("0");
    expect(pair.token0Price.toString()).toBe("0");
    expect(pair.token1Price.toString()).toBe("0");
    expect(pair.block).toBe(6810000n);
    expect(pair.timestamp).toBe(1600000000n);

    // PairTokenLookup rows (port-internal getPair replacement, both orderings)
    const lookupAB = await indexer.PairTokenLookup.getOrThrow(`${TKA}-${TKB}`);
    expect(lookupAB.pair_id).toBe(PAIR);
    const lookupBA = await indexer.PairTokenLookup.getOrThrow(`${TKB}-${TKA}`);
    expect(lookupBA.pair_id).toBe(PAIR);
  });
});
