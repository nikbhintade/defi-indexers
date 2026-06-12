/**
 * Offline test of the registration flow:
 * AddressProvider.NewAddressIdentifier (id=0, main registry) -> Registry
 * entity + registry catch-up, then MainRegistry.PoolAdded -> Pool entity.
 *
 * All eth_calls are mocked via setCallMock (no RPC).
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTestIndexer } from "envio";
import { setCallMock, type CallMockRule } from "../src/effects/calls";

const REGISTRY = "0x90e00ace148ca3b23ac1bc8c240c2a7dd9c2d7f5";
const POOL = "0xbebc44782c7db0a1a60cb6fe97d0b483032ff1c7"; // 3pool
const LP = "0x6c3f90f043a72fa612cbac8115ee7e52bde6e490"; // 3Crv
const DAI = "0x6b175474e89094c44da98b954eedeac495271d0f";
const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const USDT = "0xdac17f958d2ee523a2206206994597c13d831ec7";

const TX1 = "0x" + "11".repeat(32);
const TX2 = "0x" + "22".repeat(32);

const COINS = [DAI, USDC, USDT];

const str = (value: string) => ({ kind: "string", value }) as const;
const num = (value: number) => ({ kind: "number", value }) as const;
const big = (value: bigint) => ({ kind: "bigint", value: value.toString() }) as const;

afterEach(() => setCallMock(undefined));

describe("registration flow", () => {
  it("AddressProvider -> registry -> PoolAdded creates Registry and Pool entities", async () => {
    const rules: CallMockRule[] = [
      // no pre-existing pools on the registry when it is added (catchUp no-op)
      { fn: "pool_count", result: big(0n) },
      // not a lending pool / not a metapool: unmatched calls revert by default
      { fn: "get_lp_token", to: REGISTRY, args: [POOL], result: str(LP) },
      { fn: "name", to: LP, result: str("Curve.fi DAI/USDC/USDT") },
      { fn: "symbol", to: LP, result: str("3Crv") },
      { fn: "symbol", to: DAI, result: str("DAI") },
      { fn: "symbol", to: USDC, result: str("USDC") },
      { fn: "symbol", to: USDT, result: str("USDT") },
      { fn: "decimals", to: DAI, result: num(18) },
      { fn: "decimals", to: USDC, result: num(6) },
      { fn: "decimals", to: USDT, result: num(6) },
      { fn: "coins", to: POOL, args: ["0"], result: str(DAI) },
      { fn: "coins", to: POOL, args: ["1"], result: str(USDC) },
      { fn: "coins", to: POOL, args: ["2"], result: str(USDT) },
    ];
    setCallMock({ rules });

    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "AddressProvider",
              event: "NewAddressIdentifier",
              params: { id: 0n, addr: REGISTRY as `0x${string}`, description: "Main Registry" },
              block: { number: 11154000, timestamp: 1603800000 },
              transaction: { hash: TX1 },
            },
            {
              contract: "MainRegistry",
              event: "PoolAdded",
              srcAddress: REGISTRY as `0x${string}`,
              params: { pool: POOL as `0x${string}`, rate_method_id: "0x" },
              block: { number: 11154100, timestamp: 1603801000 },
              transaction: { hash: TX2 },
            },
          ],
        },
      },
    });

    // Registry entity created by addAddress (id = registry address, lowercase)
    const registry = await indexer.Registry.getOrThrow(REGISTRY);
    expect(registry.id).toBe(REGISTRY);

    // Pool entity created by addRegistryPool -> createNewRegistryPool -> createNewPool
    const pool = await indexer.Pool.getOrThrow(POOL);
    expect(pool.address).toBe(POOL);
    expect(pool.name).toBe("Curve.fi DAI/USDC/USDT");
    expect(pool.symbol).toBe("3Crv");
    expect(pool.lpToken).toBe(LP);
    expect(pool.poolType).toBe("REGISTRY_V1");
    expect(pool.metapool).toBe(false);
    expect(pool.isV2).toBe(false);
    expect(pool.isRebasing).toBe(false);
    expect(pool.c128).toBe(false);
    expect(pool.basePool).toBe("0x0000000000000000000000000000000000000000");
    expect([...pool.coins]).toEqual(COINS);
    expect([...pool.coinNames]).toEqual(["DAI", "USDC", "USDT"]);
    expect([...pool.coinDecimals]).toEqual([18n, 6n, 6n]);
    // name contains "USD" -> stable asset type
    expect(pool.assetType).toBe(0);
    expect(pool.creationBlock).toBe(11154100n);
    expect(pool.creationDate).toBe(1603801000n);
    expect(pool.creationTx).toBe(TX2);
    expect(pool.cumulativeVolume.toString()).toBe("0");
    expect(pool.virtualPrice.toString()).toBe("0");

    // platform tracks the pool address
    const platform = await indexer.Platform.getOrThrow("Curve");
    expect([...platform.poolAddresses]).toEqual([POOL]);
  });

  it("does not recreate a registry that is added twice", async () => {
    setCallMock({ rules: [{ fn: "pool_count", result: big(0n) }] });

    const indexer = createTestIndexer();
    const result = await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "AddressProvider",
              event: "NewAddressIdentifier",
              params: { id: 0n, addr: REGISTRY as `0x${string}`, description: "Main Registry" },
              block: { number: 11154000, timestamp: 1603800000 },
              transaction: { hash: TX1 },
            },
            {
              contract: "AddressProvider",
              event: "AddressModified",
              params: { id: 0n, new_address: REGISTRY as `0x${string}`, version: 2n },
              block: { number: 11155000, timestamp: 1603810000 },
              transaction: { hash: TX2 },
            },
          ],
        },
      },
    });

    const registry = await indexer.Registry.getOrThrow(REGISTRY);
    expect(registry.id).toBe(REGISTRY);
    const registries = await indexer.Registry.getAll();
    expect(registries.length).toBe(1);
    expect(result.changes.length).toBeGreaterThan(0);
  });
});
