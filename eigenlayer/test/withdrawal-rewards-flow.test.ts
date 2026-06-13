/**
 * Offline test (b): WithdrawalQueued -> WithdrawalCompleted lifecycle, plus an
 * AVS registration + RewardsSubmission + DistributionRoot flow. Asserts exact
 * values across the Withdrawal lifecycle and the rewards entities.
 */
import { describe, expect, it } from "vitest";
import { createTestIndexer } from "envio";

const STAKER = "0x1111000000000000000000000000000000000001";
const OPERATOR = "0x2222000000000000000000000000000000000002";
const WITHDRAWER = "0x3333000000000000000000000000000000000003";
const STRAT_A = "0x4444000000000000000000000000000000000004";
const STRAT_B = "0x5555000000000000000000000000000000000005";
const AVS = "0x6666000000000000000000000000000000000006";
const TOKEN = "0x7777000000000000000000000000000000000007";
const ROOT = "0x" + "ab".repeat(32);
const RHASH = "0x" + "cd".repeat(32);
const DROOT = "0x" + "ef".repeat(32);
const TXQ = "0x" + "aa".repeat(32);
const TXC = "0x" + "bb".repeat(32);
const TXR = "0x" + "cc".repeat(32);
const TXD = "0x" + "dd".repeat(32);
const TXA = "0x" + "ee".repeat(32);

const lc = (x: string) => x.toLowerCase();

describe("withdrawal lifecycle + AVS registration + rewards", () => {
  it("queues then completes a withdrawal and records rewards with exact values", async () => {
    const indexer = createTestIndexer();

    await indexer.process({
      chains: {
        1: {
          simulate: [
            // ---- AVS registration ----
            {
              contract: "AVSDirectory",
              event: "AVSMetadataURIUpdated",
              logIndex: 0,
              params: { avs: AVS, metadataURI: "ipfs://avs-metadata" },
              block: { number: 17445700, timestamp: 1686901000 },
              transaction: { hash: TXA },
            },
            {
              contract: "AVSDirectory",
              event: "OperatorAVSRegistrationStatusUpdated",
              logIndex: 1,
              params: { operator: OPERATOR, avs: AVS, status: 1n },
              block: { number: 17445700, timestamp: 1686901000 },
              transaction: { hash: TXA },
            },
            // ---- reward submission (2 strategies) ----
            {
              contract: "RewardsCoordinator",
              event: "AVSRewardsSubmissionCreated",
              logIndex: 0,
              params: {
                avs: AVS,
                submissionNonce: 0n,
                rewardsSubmissionHash: RHASH,
                rewardsSubmission: {
                  strategiesAndMultipliers: [
                    { strategy: STRAT_A, multiplier: 1000000000000000000n },
                    { strategy: STRAT_B, multiplier: 2000000000000000000n },
                  ],
                  token: TOKEN,
                  amount: 5000n,
                  startTimestamp: 1686900000n,
                  duration: 604800n,
                },
              },
              block: { number: 17445710, timestamp: 1686901100 },
              transaction: { hash: TXR },
            },
            // ---- distribution root ----
            {
              contract: "RewardsCoordinator",
              event: "DistributionRootSubmitted",
              logIndex: 0,
              params: {
                rootIndex: 0n,
                root: DROOT,
                rewardsCalculationEndTimestamp: 1686950000n,
                activatedAt: 1686960000n,
              },
              block: { number: 17445720, timestamp: 1686901200 },
              transaction: { hash: TXD },
            },
            // ---- withdrawal queued ----
            {
              contract: "DelegationManager",
              event: "WithdrawalQueued",
              logIndex: 4,
              params: {
                withdrawalRoot: ROOT,
                withdrawal: {
                  staker: STAKER,
                  delegatedTo: OPERATOR,
                  withdrawer: WITHDRAWER,
                  nonce: 7n,
                  startBlock: 17445730n,
                  strategies: [STRAT_A, STRAT_B],
                  shares: [100n, 200n],
                },
              },
              block: { number: 17445730, timestamp: 1686901300 },
              transaction: { hash: TXQ },
            },
            // ---- withdrawal completed ----
            {
              contract: "DelegationManager",
              event: "WithdrawalCompleted",
              logIndex: 2,
              params: { withdrawalRoot: ROOT },
              block: { number: 17445800, timestamp: 1686902000 },
              transaction: { hash: TXC },
            },
          ],
        },
      },
    });

    // ---- Withdrawal lifecycle ----
    const w = await indexer.Withdrawal.getOrThrow(lc(ROOT));
    expect(w.status).toBe("COMPLETED");
    expect(w.isSlashing).toBe(false);
    expect(w.staker).toBe(lc(STAKER));
    expect(w.delegatedTo).toBe(lc(OPERATOR));
    expect(w.withdrawer).toBe(lc(WITHDRAWER));
    expect(w.nonce).toBe(7n);
    expect(w.startBlock).toBe(17445730n);
    expect(w.strategies).toEqual([lc(STRAT_A), lc(STRAT_B)]);
    expect(w.shares).toEqual(["100", "200"]);
    expect(w.queuedBlockNumber).toBe(17445730n);
    expect(w.queuedTransactionHash).toBe(lc(TXQ));
    expect(w.queuedLogIndex).toBe(4);
    expect(w.completedBlockNumber).toBe(17445800n);
    expect(w.completedTransactionHash).toBe(lc(TXC));
    expect(w.completedLogIndex).toBe(2);

    // ---- AVS + AvsOperator ----
    const avs = await indexer.Avs.getOrThrow(lc(AVS));
    expect(avs.metadataURI).toBe("ipfs://avs-metadata");

    const reg = await indexer.AvsOperator.getOrThrow(`${lc(OPERATOR)}-${lc(AVS)}`);
    expect(reg.registered).toBe(true);
    expect(reg.operator).toBe(lc(OPERATOR));
    expect(reg.avs).toBe(lc(AVS));

    const regChange = await indexer.AvsOperatorStateChange.getOrThrow(
      `${lc(TXA)}-1`,
    );
    expect(regChange.status).toBe(1);
    expect(regChange.registered).toBe(true);

    // ---- RewardSubmission (one row per strategy index) ----
    const rs0 = await indexer.RewardSubmission.getOrThrow(`${lc(RHASH)}-0`);
    expect(rs0.avs).toBe(lc(AVS));
    expect(rs0.token).toBe(lc(TOKEN));
    expect(rs0.amount).toBe(5000n);
    expect(rs0.strategy).toBe(lc(STRAT_A));
    expect(rs0.strategyIndex).toBe(0n);
    expect(rs0.multiplier).toBe(1000000000000000000n);
    expect(rs0.startTimestamp).toBe(1686900000n);
    expect(rs0.duration).toBe(604800n);
    expect(rs0.endTimestamp).toBe(1686900000n + 604800n);
    expect(rs0.rewardType).toBe("avs");
    expect(rs0.isForAll).toBe(false);

    const rs1 = await indexer.RewardSubmission.getOrThrow(`${lc(RHASH)}-1`);
    expect(rs1.strategy).toBe(lc(STRAT_B));
    expect(rs1.strategyIndex).toBe(1n);
    expect(rs1.multiplier).toBe(2000000000000000000n);

    // ---- DistributionRoot ----
    const dr = await indexer.SubmittedDistributionRoot.getOrThrow("0");
    expect(dr.root).toBe(lc(DROOT));
    expect(dr.rootIndex).toBe(0n);
    expect(dr.rewardsCalculationEndTimestamp).toBe(1686950000n);
    expect(dr.activatedAt).toBe(1686960000n);
  });
});
