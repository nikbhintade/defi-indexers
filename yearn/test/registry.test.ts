/**
 * Offline test (a): Registry.NewVault -> Vault entity created + Vault template
 * registered. All eth_calls (vault metadata + token metadata) are mocked via
 * setCallMock (no RPC). Asserts exact entity field values.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTestIndexer } from "envio";
import { setCallMock, type CallMockRule } from "../src/effects/calls";

const REGISTRY = "0xe15461b18ee31b7379019dc523231c57d1cbc18c";
const VAULT = "0xa696a63cc78dffa1a63e9e50587c197387ff6c7e";
const WANT = "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599"; // WBTC
const TOKEN = "0x000000000000000000000000ffffffffffffffff"; // arbitrary deployer/token indexed

const TX1 = "0x" + "ab".repeat(32);

const str = (value: string) => ({ kind: "string", value }) as const;
const num = (value: number) => ({ kind: "number", value }) as const;
const big = (value: bigint) => ({ kind: "bigint", value: value.toString() }) as const;
const addr = (value: string) => ({ kind: "address", value }) as const;
const bool = (value: boolean) => ({ kind: "bool", value }) as const;

afterEach(() => setCallMock(undefined));

function vaultRules(): CallMockRule[] {
  return [
    // createNewVaultFromAddress: vault.token()
    { fn: "token", to: VAULT, result: addr(WANT) },
    // getOrCreateToken(WANT)
    { fn: "decimals", to: WANT, result: num(8) },
    { fn: "name", to: WANT, result: str("Wrapped BTC") },
    { fn: "symbol", to: WANT, result: str("WBTC") },
    // getOrCreateToken(VAULT) (share token)
    { fn: "decimals", to: VAULT, result: num(8) },
    { fn: "name", to: VAULT, result: str("WBTC yVault") },
    { fn: "symbol", to: VAULT, result: str("yvWBTC") },
    // vault metadata
    { fn: "managementFee", to: VAULT, result: big(200n) },
    { fn: "performanceFee", to: VAULT, result: big(2000n) },
    { fn: "rewards", to: VAULT, result: addr("0x1111111111111111111111111111111111111111") },
    { fn: "management", to: VAULT, result: addr("0x2222222222222222222222222222222222222222") },
    { fn: "guardian", to: VAULT, result: addr("0x3333333333333333333333333333333333333333") },
    { fn: "governance", to: VAULT, result: addr("0x4444444444444444444444444444444444444444") },
    { fn: "depositLimit", to: VAULT, result: big(10000n) },
    { fn: "activation", to: VAULT, result: big(1620000000n) },
    { fn: "apiVersion", to: VAULT, result: str("0.3.5") },
    { fn: "emergencyShutdown", to: VAULT, result: bool(false) },
  ];
}

describe("registry NewVault flow", () => {
  it("creates a Vault entity with exact field values and a Registry", async () => {
    setCallMock({ rules: vaultRules() });

    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "Registry",
              event: "NewVault",
              srcAddress: REGISTRY as `0x${string}`,
              params: {
                token: TOKEN as `0x${string}`,
                deployment_id: 0n,
                vault: VAULT as `0x${string}`,
                api_version: "0.3.5",
              },
              block: { number: 12341475, timestamp: 1620100000 },
              transaction: { hash: TX1, transactionIndex: 5 },
            },
          ],
        },
      },
    });

    // Registry entity
    const registry = await indexer.Registry.getOrThrow(REGISTRY);
    expect(registry.id).toBe(REGISTRY);
    expect(registry.blockNumber).toBe(12341475n);
    expect(registry.timestamp).toBe(1620100000n * 1000n);

    // Vault entity
    const vault = await indexer.Vault.getOrThrow(VAULT);
    expect(vault.id).toBe(VAULT);
    expect(vault.token_id).toBe(WANT);
    expect(vault.shareToken_id).toBe(VAULT);
    expect(vault.registry_id).toBe(REGISTRY);
    expect(vault.classification).toBe("Endorsed");
    expect(vault.apiVersion).toBe("0.3.5");
    expect(vault.managementFeeBps).toBe(200);
    expect(vault.performanceFeeBps).toBe(2000);
    expect(vault.rewards).toBe("0x1111111111111111111111111111111111111111");
    expect(vault.management).toBe("0x2222222222222222222222222222222222222222");
    expect(vault.guardian).toBe("0x3333333333333333333333333333333333333333");
    expect(vault.governance).toBe("0x4444444444444444444444444444444444444444");
    expect(vault.depositLimit).toBe(10000n);
    expect(vault.activation).toBe(1620000000n);
    expect(vault.activationBlockNumber).toBe(12341475n);
    expect(vault.emergencyShutdown).toBe(false);
    expect(vault.isTemplateListening).toBe(true);
    expect(vault.type).toBe(99999999n);
    expect([...vault.tags]).toEqual([]);
    expect([...vault.strategyIds]).toEqual([]);
    expect([...vault.withdrawalQueue]).toEqual([]);
    expect(vault.balanceTokens).toBe(0n);
    expect(vault.sharesSupply).toBe(0n);
    expect(vault.availableDepositLimit).toBe(0n);
    expect(vault.latestUpdate_id).toBeUndefined();

    // want + share Token entities
    const want = await indexer.Token.getOrThrow(WANT);
    expect(want.decimals).toBe(8);
    expect(want.symbol).toBe("WBTC");
    const share = await indexer.Token.getOrThrow(VAULT);
    expect(share.symbol).toBe("yvWBTC");

    // Transaction entity
    const tx = await indexer.Transaction.getOrThrow(TX1.toLowerCase() + "-0");
    expect(tx.index).toBe(5n);
    expect(tx.blockNumber).toBe(12341475n);
  });

  it("NewExperimentalVault classifies as Experimental", async () => {
    setCallMock({ rules: vaultRules() });
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "Registry",
              event: "NewExperimentalVault",
              srcAddress: REGISTRY as `0x${string}`,
              params: {
                token: TOKEN as `0x${string}`,
                deployer: TOKEN as `0x${string}`,
                vault: VAULT as `0x${string}`,
                api_version: "0.3.5",
              },
              block: { number: 12341470, timestamp: 1620090000 },
              transaction: { hash: TX1, transactionIndex: 1 },
            },
          ],
        },
      },
    });
    const vault = await indexer.Vault.getOrThrow(VAULT);
    expect(vault.classification).toBe("Experimental");
  });
});
