/**
 * Offline test (b): the tracking flow — Transfer / Borrow / Repay updating
 * TrackingVaultBalance + TrackingActiveAccount, including the EVC sub-account
 * linking via addressPrefix (first 19 bytes).
 *
 * Scenario on a single EulerVault:
 *   - OWNER (sub-account 0x..00) receives 1000 shares  -> deposit
 *   - SUB   (sub-account 0x..01) receives 500 shares   -> deposit
 *     Both share the same 19-byte prefix => same TrackingActiveAccount.
 *   - OWNER borrows (debt 200)                          -> borrow added
 *   - OWNER repays (debt back to 0)                     -> borrow removed
 *
 * Asserts exact balance/debt values and the deposits/borrows arrays on the
 * shared TrackingActiveAccount, with the trackingId = account ++ vault.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTestIndexer } from "envio";
import { setCallMock } from "../src/effects/calls";

const VAULT = "0x2222222222222222222222222222222222222222";
// Shared 19-byte prefix; differ only in the last byte (EVC sub-account id).
const OWNER = "0x3333333333333333333333333333333333333300";
const SUB = "0x3333333333333333333333333333333333333301";
const PREFIX = "0x33333333333333333333333333333333333333"; // 38 hex = 19 bytes
const ZERO = "0x0000000000000000000000000000000000000000";
const TX = "0x00000000000000000000000000000000000000000000000000000000000000cd";

const big = (value: bigint) => ({ kind: "bigint", value: value.toString() }) as const;

const idOf = (account: string) => account + VAULT.slice(2);

afterEach(() => setCallMock(undefined));

describe("tracking flow with sub-account linking", () => {
  it("Transfer/Borrow/Repay updates balances, debts and the shared active account", async () => {
    // trackActions re-reads live balance/debt from the vault at each event
    // block, so each phase runs as its own process() call with a mock that
    // reflects that block's post-event state.
    const indexer = createTestIndexer();

    // ---- Phase 1: OWNER receives 1000 shares (mint Transfer) ----
    setCallMock({
      strict: true,
      rules: [
        { fn: "balanceOf", to: VAULT, args: [OWNER], result: big(1000n) },
        { fn: "debtOf", to: VAULT, args: [OWNER], result: big(0n) },
      ],
    });
    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "EulerVault",
              event: "Transfer",
              srcAddress: VAULT as `0x${string}`,
              logIndex: 1,
              params: { from: ZERO as `0x${string}`, to: OWNER as `0x${string}`, value: 1000n },
              block: { number: 20529300, timestamp: 1724001000 },
              transaction: { hash: TX as `0x${string}` },
            },
          ],
        },
      },
    });

    // ---- Phase 2: SUB receives 500 shares ----
    setCallMock({
      strict: true,
      rules: [
        { fn: "balanceOf", to: VAULT, args: [SUB], result: big(500n) },
        { fn: "debtOf", to: VAULT, args: [SUB], result: big(0n) },
      ],
    });
    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "EulerVault",
              event: "Transfer",
              srcAddress: VAULT as `0x${string}`,
              logIndex: 1,
              params: { from: ZERO as `0x${string}`, to: SUB as `0x${string}`, value: 500n },
              block: { number: 20529310, timestamp: 1724001100 },
              transaction: { hash: TX as `0x${string}` },
            },
          ],
        },
      },
    });

    // ---- Phase 3: OWNER borrows 200 ----
    setCallMock({
      strict: true,
      rules: [
        { fn: "balanceOf", to: VAULT, args: [OWNER], result: big(1000n) },
        { fn: "debtOf", to: VAULT, args: [OWNER], result: big(200n) },
      ],
    });
    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "EulerVault",
              event: "Borrow",
              srcAddress: VAULT as `0x${string}`,
              logIndex: 1,
              params: { account: OWNER as `0x${string}`, assets: 200n },
              block: { number: 20529320, timestamp: 1724001200 },
              transaction: { hash: TX as `0x${string}` },
            },
          ],
        },
      },
    });

    // After borrow: OWNER has a deposit and a borrow; SUB only a deposit.
    {
      const active = await indexer.TrackingActiveAccount.getOrThrow(PREFIX);
      expect(active.addressPrefix).toBe(PREFIX);
      // both sub-accounts deposited; order = OWNER then SUB
      expect(active.deposits).toEqual([idOf(OWNER), idOf(SUB)]);
      expect(active.borrows).toEqual([idOf(OWNER)]);

      const ownerBal = await indexer.TrackingVaultBalance.getOrThrow(idOf(OWNER));
      expect(ownerBal.balance).toBe(1000n);
      expect(ownerBal.debt).toBe(200n);
      expect(ownerBal.addressPrefix).toBe(PREFIX);

      const subBal = await indexer.TrackingVaultBalance.getOrThrow(idOf(SUB));
      expect(subBal.balance).toBe(500n);
      expect(subBal.debt).toBe(0n);
      expect(subBal.addressPrefix).toBe(PREFIX);
    }

    // ---- Phase 4: OWNER repays -> debt 0, borrow removed ----
    setCallMock({
      strict: true,
      rules: [
        { fn: "balanceOf", to: VAULT, args: [OWNER], result: big(1000n) },
        { fn: "debtOf", to: VAULT, args: [OWNER], result: big(0n) },
      ],
    });
    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "EulerVault",
              event: "Repay",
              srcAddress: VAULT as `0x${string}`,
              logIndex: 1,
              params: { account: OWNER as `0x${string}`, assets: 200n },
              block: { number: 20529330, timestamp: 1724001300 },
              transaction: { hash: TX as `0x${string}` },
            },
          ],
        },
      },
    });

    const active = await indexer.TrackingActiveAccount.getOrThrow(PREFIX);
    // borrow removed (debt back to 0, but a previous debt existed); deposits kept
    expect(active.deposits).toEqual([idOf(OWNER), idOf(SUB)]);
    expect(active.borrows).toEqual([]);
    expect(active.blockNumber).toBe(20529330n);
    expect(active.blockTimestamp).toBe(1724001300n);
    expect(active.transactionHash).toBe(TX);

    const ownerBal = await indexer.TrackingVaultBalance.getOrThrow(idOf(OWNER));
    expect(ownerBal.balance).toBe(1000n);
    expect(ownerBal.debt).toBe(0n);
    expect(ownerBal.blockNumber).toBe(20529330n);
  });
});
