/**
 * Offline test of the V1 core token flow:
 *   1. Submitted (first stake — 1:1 ether/shares, totals bootstrap)
 *   2. mint Transfer (from 0x0) — reads the Submission for shares, credits holder
 *   3. Submitted #2 — ratio share math against the running totals
 *   4. mint Transfer #2
 *   5. regular Transfer — moves shares between two holders, updates balances
 *
 * Asserts Totals, Shares, Holder, Stats, LidoSubmission and LidoTransfer with
 * exact values. No eth_calls needed (V1 Submit/Transfer paths are pure).
 */
import { describe, expect, it } from "vitest";
import { createTestIndexer } from "envio";

const TX1 = "0x" + "11".repeat(32);
const TX2 = "0x" + "22".repeat(32);
const TX3 = "0x" + "33".repeat(32);
const ALICE = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const BOB = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const ZERO = "0x0000000000000000000000000000000000000000";
const ETH = 10n ** 18n;

describe("V1 submit + transfer flow", () => {
  it("bootstraps totals, mints shares, and moves balances between holders", async () => {
    const indexer = createTestIndexer();

    await indexer.process({
      chains: {
        1: {
          simulate: [
            // 1) Alice stakes 10 ETH (first ever -> 1:1)
            {
              contract: "Lido",
              event: "Submitted",
              logIndex: 0,
              params: {
                sender: ALICE as `0x${string}`,
                amount: 10n * ETH,
                referral: ZERO as `0x${string}`,
              },
              block: { number: 11473300, timestamp: 1606824000 },
              transaction: { hash: TX1, transactionIndex: 0 },
            },
            // 2) mint Transfer 0x0 -> Alice (10 stETH), reads Submission@logIndex-1
            {
              contract: "Lido",
              event: "Transfer",
              logIndex: 1,
              params: {
                from: ZERO as `0x${string}`,
                to: ALICE as `0x${string}`,
                value: 10n * ETH,
              },
              block: { number: 11473300, timestamp: 1606824000 },
              transaction: { hash: TX1, transactionIndex: 0 },
            },
            // 3) Bob stakes 30 ETH -> shares = 30 * 10 / 10 = 30 (ratio == 1)
            {
              contract: "Lido",
              event: "Submitted",
              logIndex: 0,
              params: {
                sender: BOB as `0x${string}`,
                amount: 30n * ETH,
                referral: ZERO as `0x${string}`,
              },
              block: { number: 11473400, timestamp: 1606824100 },
              transaction: { hash: TX2, transactionIndex: 0 },
            },
            // 4) mint Transfer 0x0 -> Bob (30 stETH)
            {
              contract: "Lido",
              event: "Transfer",
              logIndex: 1,
              params: {
                from: ZERO as `0x${string}`,
                to: BOB as `0x${string}`,
                value: 30n * ETH,
              },
              block: { number: 11473400, timestamp: 1606824100 },
              transaction: { hash: TX2, transactionIndex: 0 },
            },
            // 5) Alice transfers 4 stETH to Bob (regular transfer)
            {
              contract: "Lido",
              event: "Transfer",
              logIndex: 0,
              params: {
                from: ALICE as `0x${string}`,
                to: BOB as `0x${string}`,
                value: 4n * ETH,
              },
              block: { number: 11473500, timestamp: 1606824200 },
              transaction: { hash: TX3, transactionIndex: 0 },
            },
          ],
        },
      },
    });

    // ---- Totals: 40 ETH pooled, 40 shares ----
    const totals = await indexer.Totals.getOrThrow("");
    expect(totals.totalPooledEther).toBe(40n * ETH);
    expect(totals.totalShares).toBe(40n * ETH);

    // ---- Submissions ----
    const sub1 = await indexer.LidoSubmission.getOrThrow(`${TX1}-0`);
    expect(sub1.shares).toBe(10n * ETH);
    expect(sub1.sharesBefore).toBe(0n);
    expect(sub1.sharesAfter).toBe(10n * ETH);
    expect(sub1.totalPooledEtherBefore).toBe(0n);
    expect(sub1.totalPooledEtherAfter).toBe(10n * ETH);
    expect(sub1.balanceAfter).toBe(10n * ETH);

    const sub2 = await indexer.LidoSubmission.getOrThrow(`${TX2}-0`);
    expect(sub2.shares).toBe(30n * ETH); // 30 * 10 / 10
    expect(sub2.sharesAfter).toBe(30n * ETH);
    expect(sub2.totalSharesBefore).toBe(10n * ETH);
    expect(sub2.totalSharesAfter).toBe(40n * ETH);

    // ---- Shares after the 4-stETH Alice->Bob transfer ----
    const aliceShares = await indexer.Shares.getOrThrow(ALICE);
    const bobShares = await indexer.Shares.getOrThrow(BOB);
    // Alice minted 10, sent 4 (shares = 4 * 40 / 40 = 4) -> 6
    expect(aliceShares.shares).toBe(6n * ETH);
    // Bob minted 30, received 4 -> 34
    expect(bobShares.shares).toBe(34n * ETH);

    // ---- Holders / Stats ----
    const alice = await indexer.Holder.getOrThrow(ALICE);
    const bob = await indexer.Holder.getOrThrow(BOB);
    expect(alice.hasBalance).toBe(true);
    expect(bob.hasBalance).toBe(true);
    const stats = await indexer.Stats.getOrThrow("");
    expect(stats.uniqueHolders).toBe(2n);
    expect(stats.uniqueAnytimeHolders).toBe(2n);

    // ---- The regular transfer entity ----
    const xfer = await indexer.LidoTransfer.getOrThrow(`${TX3}-0`);
    expect(xfer.from).toBe(ALICE);
    expect(xfer.to).toBe(BOB);
    expect(xfer.value).toBe(4n * ETH);
    expect(xfer.shares).toBe(4n * ETH);
    expect(xfer.totalPooledEther).toBe(40n * ETH);
    expect(xfer.totalShares).toBe(40n * ETH);
    expect(xfer.sharesBeforeDecrease).toBe(10n * ETH);
    expect(xfer.sharesAfterDecrease).toBe(6n * ETH);
    expect(xfer.sharesBeforeIncrease).toBe(30n * ETH);
    expect(xfer.sharesAfterIncrease).toBe(34n * ETH);
    expect(xfer.balanceAfterDecrease).toBe(6n * ETH);
    expect(xfer.balanceAfterIncrease).toBe(34n * ETH);
  });
});
