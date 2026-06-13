/**
 * Offline test (b): validator-added then cluster-deposit flow.
 *
 * Seeds DAOValues + four Operators via OperatorAdded, then ValidatorAdded
 * (creates Cluster + Validator, bumps owner/dao/operator counters and the
 * cluster snapshot), then ClusterDeposited (re-applies the snapshot from the
 * event's cluster tuple). Asserts Cluster, Validator and the ClusterDeposited
 * snapshot event with exact values.
 *
 * At v1.2.0 the cluster fee asset is SSV, so clusterUsesEthFees() is false and
 * effectiveBalanceETH stays 0.
 */
import { describe, expect, it } from "vitest";
import { createTestIndexer } from "envio";

const CONTRACT = "0xdd9bc35ae942ef0cfa76930954a156b3ff30a4e1";
const OWNER = "0x2222222222222222222222222222222222222222" as `0x${string}`;
const OPOWNER = "0x3333333333333333333333333333333333333333" as `0x${string}`;
const PUBKEY = "0xdeadbeef";
const SHARES = "0xc0ffee";
const TXADD = "0x" + "0a".repeat(32);
const TXVAL = "0x" + "0b".repeat(32);
const TXDEP = "0x" + "0c".repeat(32);

const OP_IDS = [1n, 2n, 3n, 4n];

function operatorAddedItem(operatorId: bigint, logIndex: number) {
  return {
    contract: "SSVNetwork" as const,
    event: "OperatorAdded" as const,
    logIndex,
    params: {
      operatorId,
      owner: OPOWNER,
      publicKey: "0x01",
      fee: 1000000000n,
    },
    block: { number: 17507481, timestamp: 1687000000 },
    transaction: { hash: TXADD },
  };
}

describe("validator-added + cluster-deposit flow", () => {
  it("creates cluster + validator with the snapshot, then deposits", async () => {
    const indexer = createTestIndexer();

    // cluster snapshot tuple delivered with ValidatorAdded
    const clusterTupleVal = {
      validatorCount: 1n,
      networkFeeIndex: 10n,
      index: 20n,
      active: true,
      balance: 5000000000n,
    };
    // cluster snapshot tuple delivered with ClusterDeposited
    const clusterTupleDep = {
      validatorCount: 1n,
      networkFeeIndex: 11n,
      index: 21n,
      active: true,
      balance: 9000000000n,
    };

    await indexer.process({
      chains: {
        1: {
          simulate: [
            operatorAddedItem(1n, 0),
            operatorAddedItem(2n, 1),
            operatorAddedItem(3n, 2),
            operatorAddedItem(4n, 3),
            {
              contract: "SSVNetwork",
              event: "ValidatorAdded",
              logIndex: 0,
              params: {
                owner: OWNER,
                operatorIds: OP_IDS,
                publicKey: PUBKEY,
                shares: SHARES,
                cluster: clusterTupleVal,
              },
              block: { number: 17507500, timestamp: 1687000100 },
              transaction: { hash: TXVAL },
            },
            {
              contract: "SSVNetwork",
              event: "ClusterDeposited",
              logIndex: 0,
              params: {
                owner: OWNER,
                operatorIds: OP_IDS,
                value: 4000000000n,
                cluster: clusterTupleDep,
              },
              block: { number: 17507600, timestamp: 1687000200 },
              transaction: { hash: TXDEP },
            },
          ],
        },
      },
    });

    const clusterId = `${OWNER}-1-2-3-4`;

    // ---- ValidatorAdded event entity ----
    const vAdded = await indexer.ValidatorAdded.getOrThrow(`${TXVAL}-00000`);
    expect(vAdded.publicKey).toBe(PUBKEY);
    expect(vAdded.shares).toBe(SHARES);
    expect(vAdded.cluster_id).toBe(clusterId);
    expect(vAdded.cluster_balance).toBe(5000000000n);
    expect(vAdded.operatorIds).toEqual(OP_IDS);

    // ---- Validator entity ----
    const validator = await indexer.Validator.getOrThrow(PUBKEY);
    expect(validator.owner_id).toBe(OWNER);
    expect(validator.cluster_id).toBe(clusterId);
    expect(validator.removed).toBe(false);
    expect(validator.shares).toBe(SHARES);
    expect(validator.operators).toEqual(["1", "2", "3", "4"]);

    // ---- Cluster after deposit (snapshot re-applied from ClusterDeposited) ----
    const cluster = await indexer.Cluster.getOrThrow(clusterId);
    expect(cluster.owner_id).toBe(OWNER);
    expect(cluster.operatorIds).toEqual(OP_IDS);
    expect(cluster.validatorCount).toBe(1n);
    expect(cluster.feeAsset).toBe("SSV");
    // effectiveBalance: 0 + 32 (from ValidatorAdded), unchanged by deposit
    expect(cluster.effectiveBalance).toBe(32n);
    // vUnits = 32 * 100000 / 32 = 100000
    expect(cluster.vUnits).toBe(100000n);
    // snapshot reflects the ClusterDeposited tuple (latest event)
    expect(cluster.networkFeeIndex).toBe(11n);
    expect(cluster.index).toBe(21n);
    expect(cluster.active).toBe(true);
    expect(cluster.balance).toBe(9000000000n);
    expect(cluster.lastUpdateTransactionHash).toBe(TXDEP);

    // ---- ClusterDeposited snapshot event ----
    const dep = await indexer.ClusterDeposited.getOrThrow(`${TXDEP}-00000`);
    expect(dep.value).toBe(4000000000n);
    expect(dep.cluster_balance).toBe(9000000000n);
    expect(dep.cluster_networkFeeIndex).toBe(11n);

    // ---- Owner account counters ----
    const owner = await indexer.Account.getOrThrow(OWNER);
    expect(owner.nonce).toBe(1n);
    expect(owner.validatorCount).toBe(1n);
    expect(owner.effectiveBalance).toBe(32n);

    // ---- DAOValues counters ----
    const dao = await indexer.DAOValues.getOrThrow(CONTRACT);
    expect(dao.totalValidators).toBe(1n);
    expect(dao.validatorsAdded).toBe(1n);
    expect(dao.totalEffectiveBalance).toBe(32n);
    expect(dao.effectiveBalanceETH).toBe(0n); // SSV-fee cluster
    expect(dao.totalOperators).toBe(4n);

    // ---- each operator validatorCount incremented ----
    for (const id of ["1", "2", "3", "4"]) {
      const op = await indexer.Operator.getOrThrow(id);
      expect(op.validatorCount).toBe(1n);
    }
  });
});
