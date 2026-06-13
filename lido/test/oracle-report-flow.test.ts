/**
 * Offline test of the V1 LegacyOracle report flow (handleCompleted):
 * derives rewards from the previous OracleCompleted, computes shares-to-mint,
 * the fee split (insurance/operators/treasury-dust), the per-node-operator
 * share distribution (getRewardsDistribution mocked via LIDO_CALL_MOCK), and
 * the v1 APR. Asserts Totals, TotalReward, NodeOperatorsShares and
 * OracleCompleted with exact values.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTestIndexer } from "envio";
import { setCallMock } from "../src/effects";
import { NOS_ADDRESS } from "../src/constants";

const TX = "0x" + "ab".repeat(32);
const ETH = 10n ** 18n;
const OP = "0x1111111111111111111111111111111111111111";
const T0 = 1606824000;
const T1 = T0 + 86400; // +1 day

afterEach(() => setCallMock(undefined));

describe("V1 oracle report flow", () => {
  it("computes rewards, fee split, NO shares and v1 APR on Completed", async () => {
    const sharesToOperators = 495540138751238850n;
    setCallMock({
      strict: false,
      rules: [
        {
          fn: "getRewardsDistribution",
          to: NOS_ADDRESS,
          result: {
            kind: "tuple",
            // [recipients[], shares[], nosFee] — bigints encoded as "<n>n"
            value: [[OP], [`${sharesToOperators}n`], "0n"],
          },
        },
      ],
    });

    const indexer = createTestIndexer();

    // Seed protocol state: 1000 ETH pooled, 1000 shares (1:1), 10% fee split
    // 0/5000/5000 (treasury/insurance/operators).
    indexer.Totals.set({
      id: "",
      totalPooledEther: 1000n * ETH,
      totalShares: 1000n * ETH,
      maxPositivePooledEtherDrift: 0n,
    });
    indexer.CurrentFees.set({
      id: "",
      feeBasisPoints: 1000n,
      treasuryFeeBasisPoints: 0n,
      insuranceFeeBasisPoints: 5000n,
      operatorsFeeBasisPoints: 5000n,
    });
    // Previous oracle report (id "1"): 10 validators, 320 ETH beacon balance.
    indexer.Stats.set({
      id: "",
      uniqueHolders: 0n,
      uniqueAnytimeHolders: 0n,
      lastOracleCompletedId: 1n,
    });
    indexer.OracleCompleted.set({
      id: "1",
      epochId: 100n,
      beaconBalance: 320n * ETH,
      beaconValidators: 10n,
      block: 11473000n,
      blockTime: BigInt(T0),
      transactionHash: "0x" + "00".repeat(32),
      logIndex: 0n,
    });

    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "LegacyOracle",
              event: "Completed",
              logIndex: 5,
              params: {
                epochId: 110n,
                beaconBalance: 330n * ETH, // +10 ETH rewards
                beaconValidators: 10n, // no new validators
              },
              block: { number: 11473800, timestamp: T1 },
              transaction: {
                hash: TX,
                from: "0x9999999999999999999999999999999999999999",
                transactionIndex: 3,
              },
            },
          ],
        },
      },
    });

    // ---- new OracleCompleted (id "2") ----
    const completed = await indexer.OracleCompleted.getOrThrow("2");
    expect(completed.beaconBalance).toBe(330n * ETH);
    expect(completed.beaconValidators).toBe(10n);
    const stats = await indexer.Stats.getOrThrow("");
    expect(stats.lastOracleCompletedId).toBe(2n);

    // ---- Totals ----
    const totals = await indexer.Totals.getOrThrow("");
    expect(totals.totalPooledEther).toBe(1010n * ETH); // +10 reward
    expect(totals.totalShares).toBe(1000n * ETH + 991080277502477700n);

    // ---- TotalReward ----
    const tr = await indexer.TotalReward.getOrThrow(TX);
    expect(tr.totalRewards).toBe(10n * ETH);
    expect(tr.totalRewardsWithFees).toBe(10n * ETH);
    expect(tr.mevFee).toBe(0n);
    expect(tr.feeBasis).toBe(1000n);
    expect(tr.shares2mint).toBe(991080277502477700n);
    expect(tr.sharesToInsuranceFund).toBe(495540138751238850n);
    expect(tr.sharesToOperators).toBe(495540138751238850n);
    expect(tr.sharesToTreasury).toBe(0n); // treasuryFeeBasisPoints == 0
    expect(tr.dustSharesToTreasury).toBe(0n); // shares2mint - ins - ops = 0
    expect(tr.totalPooledEtherBefore).toBe(1000n * ETH);
    expect(tr.totalPooledEtherAfter).toBe(1010n * ETH);
    expect(tr.totalSharesBefore).toBe(1000n * ETH);
    expect(tr.totalSharesAfter).toBe(1000n * ETH + 991080277502477700n);
    expect(tr.timeElapsed).toBe(86400n);
    expect(tr.aprRaw.toString()).toBe("365");
    expect(tr.aprBeforeFees.toString()).toBe("365");
    expect(tr.apr.toString()).toBe("328.5");

    // ---- per-operator shares ----
    const nos = await indexer.NodeOperatorsShares.getOrThrow(`${TX}-${OP}`);
    expect(nos.address).toBe(OP);
    expect(nos.shares).toBe(sharesToOperators);
    expect(nos.totalReward_id).toBe(TX);
  });
});
