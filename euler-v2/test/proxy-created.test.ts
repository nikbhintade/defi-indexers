/**
 * Offline test (a): the factory -> template registration path.
 *
 * EulerVaultFactory.ProxyCreated must:
 *   1. create a Vault entity (id = proxy address lowercased, factory = factory),
 *   2. register the EulerVault template at the proxy address, which we verify
 *      by simulating a subsequent Transfer on that proxy and asserting the
 *      tracking entities it produces (proving the dynamic contract is live and
 *      the shared trackActions ran).
 *
 * All eth_calls (balanceOf / debtOf) are mocked via EULER_V2_CALL_MOCK.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTestIndexer } from "envio";
import { setCallMock, type CallMockRule } from "../src/effects/calls";

const FACTORY = "0x29a56a1b8214d9cf7c5561811750d5cbdb45cc8e";
const VAULT = "0x1111111111111111111111111111111111111111";
const HOLDER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa00";
const ZERO = "0x0000000000000000000000000000000000000000";
const TX = "0x00000000000000000000000000000000000000000000000000000000000000ab";

const big = (value: bigint) => ({ kind: "bigint", value: value.toString() }) as const;

afterEach(() => setCallMock(undefined));

describe("ProxyCreated -> Vault + EulerVault template", () => {
  it("creates the Vault entity and the registered template handles a Transfer", async () => {
    const rules: CallMockRule[] = [
      // mint: from = zero (skipped), to = HOLDER gets 1000 shares, no debt
      { fn: "balanceOf", to: VAULT, args: [HOLDER], result: big(1000n) },
      { fn: "debtOf", to: VAULT, args: [HOLDER], result: big(0n) },
    ];
    setCallMock({ strict: true, rules });

    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "EulerVaultFactory",
              event: "ProxyCreated",
              srcAddress: FACTORY as `0x${string}`,
              // checksum on purpose: id must be lowercased
              params: {
                proxy: "0x1111111111111111111111111111111111111111" as `0x${string}`,
                upgradeable: true,
                implementation: ZERO as `0x${string}`,
                trailingData: "0x" as `0x${string}`,
              },
              block: { number: 20529207, timestamp: 1724000000 },
            },
            {
              contract: "EulerVault",
              event: "Transfer",
              srcAddress: VAULT as `0x${string}`,
              logIndex: 1,
              params: {
                from: ZERO as `0x${string}`,
                to: HOLDER as `0x${string}`,
                value: 1000n,
              },
              block: { number: 20529210, timestamp: 1724000050 },
              transaction: { hash: TX as `0x${string}` },
            },
          ],
        },
      },
    });

    // Vault entity created by the factory handler.
    const vault = await indexer.Vault.getOrThrow(VAULT);
    expect(vault.id).toBe(VAULT);
    expect(vault.factory).toBe(FACTORY);

    // The registered EulerVault template handled the Transfer: HOLDER's balance
    // entry exists with the mocked balance; the zero `from` was skipped.
    const trackingId = HOLDER + VAULT.slice(2);
    const bal = await indexer.TrackingVaultBalance.getOrThrow(trackingId);
    expect(bal.account).toBe(HOLDER);
    expect(bal.vault).toBe(VAULT);
    expect(bal.balance).toBe(1000n);
    expect(bal.debt).toBe(0n);

    // addressPrefix = first 19 bytes (38 hex) of HOLDER.
    const prefix = "0x" + HOLDER.slice(2, 40);
    expect(bal.addressPrefix).toBe(prefix);

    const active = await indexer.TrackingActiveAccount.getOrThrow(prefix);
    expect(active.deposits).toEqual([trackingId]);
    expect(active.borrows).toEqual([]);

    // The zero `from` address must not have produced any entity.
    const zeroPrefix = "0x" + ZERO.slice(2, 40);
    expect(await indexer.TrackingActiveAccount.get(zeroPrefix)).toBeUndefined();
  });
});
