/**
 * Offline test of the MinterGateway minter activation + mint flow.
 *
 * Simulates MinterActivated then MintExecuted on the MinterGateway. Each
 * handler stores its event entity and then runs `handleMinterAttributes`,
 * which performs 5 aggregate reads + 4 per-minter reads (all mocked via
 * M0_CALL_MOCK, block-pinned) and writes the *OwedM timeseries (keyed by
 * block.hash), the daily snapshot, and the 4 per-minter entities (keyed by
 * `minter-blockNumber`). Asserts exact entity ids and values.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTestIndexer } from "envio";
import { setCallMock, type CallMockRule } from "../src/effects/calls";

const GATEWAY = "0xf7f9638cb444d65e5a40bf5ff98ebe4ff319f04e";
const MINTER = "0x1111111111111111111111111111111111111111";
const CALLER = "0x2222222222222222222222222222222222222222";

// Distinct tx hashes / block hashes per event.
const TX1 = "0x" + "a1".repeat(32);
const TX2 = "0x" + "a2".repeat(32);
const BLOCKHASH1 = "0x" + "b1".repeat(32);
const BLOCKHASH2 = "0x" + "b2".repeat(32);

const B1 = 19818500;
const B2 = 19818800;
const TS1 = 1714000000;
const TS2 = 1714000300; // same UTC day as TS1

const E18 = 10n ** 18n;

function big(value: bigint) {
  return { kind: "bigint", value: value.toString() } as const;
}

// concatI32: tx hash hex + logIndex as 8 lowercase hex digits.
function eventId(txHash: string, logIndex: number): string {
  return txHash.toLowerCase() + (logIndex >>> 0).toString(16).padStart(8, "0");
}

afterEach(() => setCallMock(undefined));

describe("minter activation + mint flow", () => {
  it("stores event entities and the timeseries / per-minter attribute entities", async () => {
    // Reads at block B1 (activation): minter just activated, nothing owed yet.
    // Reads at block B2 (mint): minter now owes M.
    const rules: CallMockRule[] = [
      // ---- B1 aggregate reads ----
      { fn: "principalOfTotalActiveOwedM", to: GATEWAY, block: B1, result: big(0n) },
      { fn: "totalOwedM", to: GATEWAY, block: B1, result: big(0n) },
      { fn: "totalActiveOwedM", to: GATEWAY, block: B1, result: big(0n) },
      { fn: "totalInactiveOwedM", to: GATEWAY, block: B1, result: big(0n) },
      { fn: "excessOwedM", to: GATEWAY, block: B1, result: big(0n) },
      // ---- B1 per-minter reads ----
      { fn: "activeOwedMOf", to: GATEWAY, args: [MINTER], block: B1, result: big(0n) },
      { fn: "inactiveOwedMOf", to: GATEWAY, args: [MINTER], block: B1, result: big(0n) },
      { fn: "principalOfActiveOwedMOf", to: GATEWAY, args: [MINTER], block: B1, result: big(0n) },
      { fn: "collateralOf", to: GATEWAY, args: [MINTER], block: B1, result: big(0n) },
      // ---- B2 aggregate reads ----
      { fn: "principalOfTotalActiveOwedM", to: GATEWAY, block: B2, result: big(900n * E18) },
      { fn: "totalOwedM", to: GATEWAY, block: B2, result: big(1000n * E18) },
      { fn: "totalActiveOwedM", to: GATEWAY, block: B2, result: big(1000n * E18) },
      { fn: "totalInactiveOwedM", to: GATEWAY, block: B2, result: big(0n) },
      { fn: "excessOwedM", to: GATEWAY, block: B2, result: big(5n * E18) },
      // ---- B2 per-minter reads ----
      { fn: "activeOwedMOf", to: GATEWAY, args: [MINTER], block: B2, result: big(1000n * E18) },
      { fn: "inactiveOwedMOf", to: GATEWAY, args: [MINTER], block: B2, result: big(0n) },
      { fn: "principalOfActiveOwedMOf", to: GATEWAY, args: [MINTER], block: B2, result: big(900n * E18) },
      { fn: "collateralOf", to: GATEWAY, args: [MINTER], block: B2, result: big(2000n * E18) },
    ];
    setCallMock({ strict: true, rules });

    const indexer = createTestIndexer();

    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "MinterGateway",
              event: "MinterActivated",
              srcAddress: GATEWAY as `0x${string}`,
              logIndex: 0,
              params: {
                minter: MINTER as `0x${string}`,
                caller: CALLER as `0x${string}`,
              },
              block: { number: B1, timestamp: TS1, hash: BLOCKHASH1 },
              transaction: { hash: TX1 },
            },
            {
              contract: "MinterGateway",
              event: "MintExecuted",
              srcAddress: GATEWAY as `0x${string}`,
              logIndex: 3,
              params: {
                mintId: 7n,
                minter: MINTER as `0x${string}`,
                principalAmount: 900n * E18,
                amount: 1000n * E18,
              },
              block: { number: B2, timestamp: TS2, hash: BLOCKHASH2 },
              transaction: { hash: TX2 },
            },
          ],
        },
      },
    });

    // ---- MinterActivated event entity ----
    const activated = await indexer.MinterActivated.getOrThrow(eventId(TX1, 0));
    expect(activated.minter).toBe(MINTER);
    expect(activated.caller).toBe(CALLER);
    expect(activated.blockNumber).toBe(BigInt(B1));
    expect(activated.blockTimestamp).toBe(BigInt(TS1));
    expect(activated.transactionHash).toBe(TX1);

    // ---- MintExecuted event entity ----
    const mint = await indexer.MintExecuted.getOrThrow(eventId(TX2, 3));
    expect(mint.mintId).toBe(7n);
    expect(mint.minter).toBe(MINTER);
    expect(mint.principalAmount).toBe(900n * E18);
    expect(mint.amount).toBe(1000n * E18);
    expect(mint.blockNumber).toBe(BigInt(B2));

    // ---- timeseries at B1: all reads were 0 -> NO timeseries written
    //      (createTimeseriesEntity only writes when amount > 0), but the daily
    //      snapshot IS written (no >0 guard, amount=0). ----
    expect(await indexer.TotalActiveOwedM.get(BLOCKHASH1)).toBeUndefined();
    expect(await indexer.TotalOwedM.get(BLOCKHASH1)).toBeUndefined();

    // ---- timeseries at B2 (keyed by block.hash) ----
    const totalOwed = await indexer.TotalOwedM.getOrThrow(BLOCKHASH2);
    expect(totalOwed.amount).toBe(1000n * E18);
    expect(totalOwed.blockNumber).toBe(BigInt(B2));
    expect(totalOwed.blockTimestamp).toBe(BigInt(TS2));

    const totalActive = await indexer.TotalActiveOwedM.getOrThrow(BLOCKHASH2);
    expect(totalActive.amount).toBe(1000n * E18);

    const principalTotal =
      await indexer.PrincipalOfTotalActiveOwedM.getOrThrow(BLOCKHASH2);
    expect(principalTotal.amount).toBe(900n * E18);

    const excess = await indexer.TotalExcessOwedM.getOrThrow(BLOCKHASH2);
    expect(excess.amount).toBe(5n * E18);

    // TotalInactiveOwedM at B2 was 0 -> not written.
    expect(await indexer.TotalInactiveOwedM.get(BLOCKHASH2)).toBeUndefined();

    // ---- daily snapshot: id = day number; both events share the same day ----
    const day1 = (BigInt(TS1) / 86400n).toString();
    const day2 = (BigInt(TS2) / 86400n).toString();
    expect(day1).toBe(day2);
    const snap = await indexer.TotalActiveOwedMDailySnapshot.getOrThrow(day2);
    // last write wins (B2): amount = 1000, timestamp = day*86400
    expect(snap.amount).toBe(1000n * E18);
    expect(snap.timestamp).toBe(BigInt(day2) * 86400n);
    expect(snap.blockNumber).toBe(BigInt(B2));

    // ---- per-minter attribute entities (id = minter-blockNumber) ----
    const activeOwed = await indexer.MinterActiveOwedMOf.getOrThrow(
      `${MINTER}-${B2}`,
    );
    expect(activeOwed.minter).toBe(MINTER);
    expect(activeOwed.amount).toBe(1000n * E18);
    expect(activeOwed.blockNumber).toBe(BigInt(B2));

    const principalOf = await indexer.MinterPrincipalOfActiveOwedMOf.getOrThrow(
      `${MINTER}-${B2}`,
    );
    expect(principalOf.amount).toBe(900n * E18);

    const collateral = await indexer.MinterCollateralOf.getOrThrow(
      `${MINTER}-${B2}`,
    );
    expect(collateral.amount).toBe(2000n * E18);

    // At B1 every per-minter read was 0; the subgraph guard is `if (amount)`,
    // which in graph-ts is TRUTHY for BigInt(0) (a non-null object) — so the
    // entity IS written with amount 0. Our port mirrors this (null-only skip).
    const activeOwedB1 = await indexer.MinterActiveOwedMOf.getOrThrow(
      `${MINTER}-${B1}`,
    );
    expect(activeOwedB1.amount).toBe(0n);
  });
});
