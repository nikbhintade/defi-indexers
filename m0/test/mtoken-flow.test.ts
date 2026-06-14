/**
 * Offline test of the MToken earning-enable / index-update flow.
 *
 * NOTE: the M0 `protocol` subgraph does NOT track MToken transfers or holder
 * balances — its MToken mappings only record event entities (StartedEarning,
 * StoppedEarning, IndexUpdated, Authorization*). So this test walks the
 * earning-enable path: StartedEarning then IndexUpdated, asserting the
 * MTokenStartedEarning and MTokenIndexUpdated entities with exact ids/values.
 * (See MIGRATION.md "Gaps" — MToken balance accounting lives in the separate
 * `stateful-m-token` subgraph, out of scope here.)
 *
 * These handlers are pure (no eth_calls), so no mock is needed.
 */
import { describe, expect, it } from "vitest";
import { createTestIndexer } from "envio";

const MTOKEN = "0x866a2bf4e572cbcf37d5071a7a58503bfb36be1b";
const ACCOUNT = "0x3333333333333333333333333333333333333333";

const TX1 = "0x" + "c1".repeat(32);
const TX2 = "0x" + "c2".repeat(32);
const B1 = 19818450;
const TS1 = 1714000050;

// concatI32: tx hash hex + logIndex as 8 lowercase hex digits.
function eventId(txHash: string, logIndex: number): string {
  return txHash.toLowerCase() + (logIndex >>> 0).toString(16).padStart(8, "0");
}

describe("MToken earning-enable / index-update flow", () => {
  it("stores MTokenStartedEarning and MTokenIndexUpdated with exact values", async () => {
    const indexer = createTestIndexer();

    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "MToken",
              event: "StartedEarning",
              srcAddress: MTOKEN as `0x${string}`,
              logIndex: 1,
              params: { account: ACCOUNT as `0x${string}` },
              block: { number: B1, timestamp: TS1, hash: "0x" + "d1".repeat(32) },
              transaction: { hash: TX1 },
            },
            {
              contract: "MToken",
              event: "IndexUpdated",
              srcAddress: MTOKEN as `0x${string}`,
              logIndex: 2,
              params: {
                index: 1_100000000000000000n, // 1.1 in 1e18 fixed point
                rate: 415n, // bps
              },
              block: { number: B1, timestamp: TS1, hash: "0x" + "d1".repeat(32) },
              transaction: { hash: TX2 },
            },
          ],
        },
      },
    });

    // ---- MTokenStartedEarning ----
    const earning = await indexer.MTokenStartedEarning.getOrThrow(
      eventId(TX1, 1),
    );
    expect(earning.account).toBe(ACCOUNT);
    expect(earning.blockNumber).toBe(BigInt(B1));
    expect(earning.blockTimestamp).toBe(BigInt(TS1));
    expect(earning.transactionHash).toBe(TX1);

    // ---- MTokenIndexUpdated ----
    const idx = await indexer.MTokenIndexUpdated.getOrThrow(eventId(TX2, 2));
    expect(idx.index).toBe(1_100000000000000000n);
    expect(idx.rate).toBe(415n);
    expect(idx.blockNumber).toBe(BigInt(B1));
    expect(idx.transactionHash).toBe(TX2);
  });
});
