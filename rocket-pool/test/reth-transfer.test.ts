/**
 * Offline test of the rETH transfer/mint flow (handleTransfer).
 * Mocks rocketTokenRETH.getExchangeRate() via ROCKET_POOL_CALL_MOCK and asserts
 * Staker balances, avg-entry weighting, the RocketETHTransaction entity, and the
 * protocol's active-staker accounting with exact values.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTestIndexer } from "envio";
import { setCallMock } from "../src/effects";
import { ROCKETPOOL_PROTOCOL_ROOT_ID } from "../src/constants";

const ETH = 10n ** 18n;
const TX1 = "0x" + "11".repeat(32);
const TX2 = "0x" + "22".repeat(32);
const ZERO = "0x0000000000000000000000000000000000000000";
const ALICE = "0x1111111111111111111111111111111111111111";
const BOB = "0x2222222222222222222222222222222222222222";

afterEach(() => setCallMock(undefined));

describe("rETH transfer/mint flow", () => {
  it("mints rETH to a staker and tracks balances + protocol state", async () => {
    const RATE = 1050000000000000000n; // 1.05 ETH/rETH
    setCallMock({
      strict: false,
      rules: [
        { fn: "getExchangeRate", result: { kind: "bigint", value: RATE.toString() } },
      ],
    });

    const indexer = createTestIndexer();

    await indexer.process({
      chains: {
        1: {
          simulate: [
            // Mint: from zero address to Alice, 100 rETH
            {
              contract: "RocketTokenRETH",
              event: "Transfer",
              logIndex: 0,
              params: { from: ZERO, to: ALICE, value: 100n * ETH },
              block: { number: 13325400, timestamp: 1633100000 },
              transaction: { hash: TX1 },
            },
          ],
        },
      },
    });

    // Alice received 100 rETH; avg entry = exchange rate (fresh mint).
    const alice = await indexer.Staker.getOrThrow(ALICE);
    expect(alice.rETHBalance).toBe(100n * ETH);
    expect(alice.avgEntry).toBe(RATE);
    expect(alice.AvgEntryTime).toBe(1633100000n);
    expect(alice.block).toBe(13325400n);

    // The zero-address staker is created but its balance is never stored.
    const zeroStaker = await indexer.Staker.getOrThrow(ZERO);
    expect(zeroStaker.rETHBalance).toBe(0n);

    // RocketETHTransaction recorded.
    const txEntity = await indexer.RocketETHTransaction.getOrThrow(`${TX1}-0`);
    expect(txEntity.from_id).toBe(ZERO);
    expect(txEntity.to_id).toBe(ALICE);
    expect(txEntity.amount).toBe(100n * ETH);
    expect(txEntity.transactionHash).toBe(TX1);
    expect(txEntity.block).toBe(13325400n);

    // Protocol: Alice active, zero address not counted (balance 0).
    const protocol = await indexer.RocketPoolProtocol.getOrThrow(
      ROCKETPOOL_PROTOCOL_ROOT_ID
    );
    expect(protocol.stakers).toContain(ALICE);
    expect(protocol.stakers).toContain(ZERO);
    expect(protocol.activeStakers).toContain(ALICE);
    expect(protocol.activeStakers).not.toContain(ZERO);
    expect(protocol.stakersWithAnRETHBalance).toBe(1n);
  });

  it("transfers rETH between stakers and updates active-staker counts", async () => {
    const RATE = 1000000000000000000n; // 1.0 for simple arithmetic
    setCallMock({
      strict: false,
      rules: [
        { fn: "getExchangeRate", result: { kind: "bigint", value: RATE.toString() } },
      ],
    });

    const indexer = createTestIndexer();

    await indexer.process({
      chains: {
        1: {
          simulate: [
            // Mint 100 rETH to Alice
            {
              contract: "RocketTokenRETH",
              event: "Transfer",
              logIndex: 0,
              params: { from: ZERO, to: ALICE, value: 100n * ETH },
              block: { number: 1, timestamp: 1000 },
              transaction: { hash: TX1 },
            },
            // Alice transfers all 100 rETH to Bob
            {
              contract: "RocketTokenRETH",
              event: "Transfer",
              logIndex: 0,
              params: { from: ALICE, to: BOB, value: 100n * ETH },
              block: { number: 2, timestamp: 2000 },
              transaction: { hash: TX2 },
            },
          ],
        },
      },
    });

    const alice = await indexer.Staker.getOrThrow(ALICE);
    const bob = await indexer.Staker.getOrThrow(BOB);
    expect(alice.rETHBalance).toBe(0n);
    // full exit zeroes avg entry
    expect(alice.avgEntry).toBe(0n);
    expect(alice.AvgEntryTime).toBe(0n);
    expect(bob.rETHBalance).toBe(100n * ETH);
    expect(bob.avgEntry).toBe(RATE);

    const protocol = await indexer.RocketPoolProtocol.getOrThrow(
      ROCKETPOOL_PROTOCOL_ROOT_ID
    );
    // Alice no longer active, Bob active; net count back to 1.
    expect(protocol.activeStakers).not.toContain(ALICE);
    expect(protocol.activeStakers).toContain(BOB);
    expect(protocol.stakersWithAnRETHBalance).toBe(1n);
  });
});
