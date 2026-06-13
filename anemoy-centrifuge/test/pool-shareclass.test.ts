/**
 * Offline test (a): pool + share-class creation flow.
 *   HubRegistry.NewPool   -> Pool (+ Account, PoolManager.isHubManager)
 *   HubRegistry.NewAsset  -> AssetRegistration (+ Asset for ISO currency)
 *   ShareClassManager.AddShareClass -> Token
 * Asserts exact entity values and id construction (no eth_calls involved).
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTestIndexer } from "envio";
import { setCallMock } from "../src/effects/calls";

const MANAGER = "0xAbcdAbcdAbcdAbcdAbcdAbcdAbcdAbcdAbcdAbcd";
const POOL_ID = 281474976710662n; // JTRSY-style poolId
const USD = 840n; // ISO currency code for US Dollar (< 1000 -> 18 decimals)
const SC_ID = "0x00010000000000060000000000000001"; // bytes16 share class id
const TX = "0x" + "11".repeat(32);
const BLOCK = 24319335;
const TS = 1769000000;

afterEach(() => setCallMock(undefined));

describe("pool + share class creation", () => {
  it("NewPool/NewAsset/AddShareClass create Pool, Asset, Token with exact values", async () => {
    const indexer = createTestIndexer();

    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "HubRegistry",
              event: "NewAsset",
              logIndex: 0,
              params: { assetId: USD, decimals: 6n },
              block: { number: BLOCK, timestamp: TS },
            },
            {
              contract: "HubRegistry",
              event: "NewPool",
              logIndex: 1,
              params: { poolId: POOL_ID, manager: MANAGER as `0x${string}`, currency: USD },
              block: { number: BLOCK, timestamp: TS },
            },
            {
              contract: "ShareClassManager",
              event: "AddShareClass",
              logIndex: 2,
              params: {
                poolId: POOL_ID,
                scId: SC_ID as `0x${string}`,
                index: 1n,
                name: "Anemoy Treasury Fund",
                symbol: "JTRSY",
                salt: ("0x" + "00".repeat(32)) as `0x${string}`,
              },
              block: { number: BLOCK, timestamp: TS },
            },
          ],
        },
      },
    });

    // ---- Pool ----
    const pool = await indexer.Pool.getOrThrow(String(POOL_ID));
    expect(pool.centrifugeId).toBe("1");
    expect(pool.isActive).toBe(true);
    expect(pool.currency).toBe(USD);
    expect(pool.decimals).toBe(18); // ISO currency -> 18
    expect(pool.createdAtBlock).toBe(BLOCK);

    // ---- Account + PoolManager (manager from NewPool) ----
    const acct = await indexer.Account.getOrThrow(MANAGER.toLowerCase());
    expect(acct.address).toBe(MANAGER.toLowerCase());

    const pmId = `${MANAGER.toLowerCase()}-1-${POOL_ID}`;
    const pm = await indexer.PoolManager.getOrThrow(pmId);
    expect(pm.isHubManager).toBe(true);
    expect(pm.isBalancesheetManager).toBe(false);
    expect(pm.poolId).toBe(POOL_ID);

    // ---- AssetRegistration + Asset (ISO) ----
    const ar = await indexer.AssetRegistration.getOrThrow(`${USD}-1`);
    expect(ar.assetId).toBe(USD);
    expect(ar.centrifugeId).toBe("1");

    const asset = await indexer.Asset.getOrThrow(String(USD));
    expect(asset.decimals).toBe(6);
    expect(asset.symbol).toBe("USD");
    expect(asset.name).toBe("United States Dollar");

    // ---- Token (share class) ----
    const token = await indexer.Token.getOrThrow(SC_ID.toLowerCase());
    expect(token.poolId).toBe(POOL_ID);
    expect(token.centrifugeId).toBe("1");
    expect(token.name).toBe("Anemoy Treasury Fund");
    expect(token.symbol).toBe("JTRSY");
    expect(token.isActive).toBe(true);
    expect(token.index).toBe(1);
    expect(token.decimals).toBe(18); // inherits pool decimals
    expect(token.totalIssuance).toBe(0n);
  });
});
