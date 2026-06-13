/**
 * Offline test (a): operator registration + fee declaration/execution.
 *
 * At the start block the DAOValues version defaults to "v1.2.0", so
 * usesEthFeeRegime() === false (SSV-fee regime). OperatorAdded therefore writes
 * the declared fee into feeSSV and seeds `fee` with the default ETH fee
 * (1_778_800_000) because the declared fee is non-zero.
 *
 * Asserts Operator + DAOValues + OperatorAdded event entity with exact values.
 */
import { describe, expect, it } from "vitest";
import { createTestIndexer } from "envio";

const CONTRACT = "0xdd9bc35ae942ef0cfa76930954a156b3ff30a4e1"; // lowercase
const OWNER = "0x1111111111111111111111111111111111111111" as `0x${string}`;
const PUBKEY = "0xabcdef";
const TX1 = "0x" + "11".repeat(32);
const TX2 = "0x" + "22".repeat(32);
const TX3 = "0x" + "33".repeat(32);

const DEFAULT_OPERATOR_ETH_FEE = 1_778_800_000n;

describe("operator registration + fee flow (SSV-fee regime)", () => {
  it("creates Operator/DAOValues on add, then declares and executes a fee", async () => {
    const indexer = createTestIndexer();

    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "SSVNetwork",
              event: "OperatorAdded",
              logIndex: 0,
              params: {
                operatorId: 7n,
                owner: OWNER,
                publicKey: PUBKEY,
                fee: 1000000000n,
              },
              block: { number: 17507481, timestamp: 1687000000 },
              transaction: { hash: TX1 },
            },
            {
              contract: "SSVNetwork",
              event: "OperatorFeeDeclared",
              logIndex: 0,
              params: {
                owner: OWNER,
                operatorId: 7n,
                blockNumber: 17507490n,
                fee: 2000000000n,
              },
              block: { number: 17507500, timestamp: 1687000100 },
              transaction: { hash: TX2 },
            },
            {
              contract: "SSVNetwork",
              event: "OperatorFeeExecuted",
              logIndex: 0,
              params: {
                owner: OWNER,
                operatorId: 7n,
                blockNumber: 17507510n,
                fee: 2000000000n,
              },
              block: { number: 17507600, timestamp: 1687000200 },
              transaction: { hash: TX3 },
            },
          ],
        },
      },
    });

    // ---- OperatorAdded event entity ----
    const added = await indexer.OperatorAdded.getOrThrow(`${TX1}-00000`);
    expect(added.operatorId).toBe(7n);
    expect(added.owner).toBe(OWNER);
    expect(added.publicKey).toBe(PUBKEY);
    expect(added.fee).toBe(1000000000n);
    expect(added.blockNumber).toBe(17507481n);

    // ---- Account created ----
    const account = await indexer.Account.getOrThrow(OWNER);
    expect(account.nonce).toBe(0n);
    expect(account.feeRecipient).toBe(OWNER);

    // ---- DAOValues created + counters ----
    const dao = await indexer.DAOValues.getOrThrow(CONTRACT);
    expect(dao.version).toBe("v1.2.0");
    expect(dao.totalOperators).toBe(1n);
    expect(dao.totalAccounts).toBe(1n);
    expect(dao.operatorsAdded).toBe(1n);

    // ---- Operator after add (SSV regime: fee=default ETH fee, feeSSV=declared) ----
    const op = await indexer.Operator.getOrThrow("7");
    expect(op.operatorId).toBe(7n);
    expect(op.owner_id).toBe(OWNER);
    expect(op.publicKey).toBe(PUBKEY);
    expect(op.removed).toBe(false);
    // declared fee 1e9 != 0 -> fee seeded to DEFAULT_OPERATOR_ETH_FEE
    expect(op.fee).toBe(DEFAULT_OPERATOR_ETH_FEE);
    expect(op.feeSSV).toBe(2000000000n); // updated by FeeExecuted below
    expect(op.feeIndexBlockNumber).toBe(0n);
    // OperatorAdded set feeIndexBlockNumberSSV=17507481; FeeExecuted moved it to 17507600
    expect(op.feeIndexBlockNumberSSV).toBe(17507600n);
    // declaredSSVFee set to 2e9 by FeeDeclared, then reset to 0 by FeeExecuted
    expect(op.declaredSSVFee).toBe(0n);
    expect(op.declaredFee).toBe(0n);
    // feeIndexSSV = 0 + (17507600 - 17507481) * feeSSV(at exec time = 0n initial? )
    // At OperatorAdded feeSSV was 1e9; FeeExecuted computes index BEFORE updating feeSSV:
    //   feeIndexSSV += (17507600 - 17507481) * 1000000000
    expect(op.feeIndexSSV).toBe((17507600n - 17507481n) * 1000000000n);
    expect(op.lastUpdateTransactionHash).toBe(TX3);

    // ---- OperatorFeeDeclared / Executed event entities ----
    const declared = await indexer.OperatorFeeDeclared.getOrThrow(`${TX2}-00000`);
    expect(declared.fee).toBe(2000000000n);
    expect(declared.operatorId).toBe(7n);
    // subgraph quirk: blockNumber stored is event.block.number, not params.blockNumber
    expect(declared.blockNumber).toBe(17507500n);

    const executed = await indexer.OperatorFeeExecuted.getOrThrow(`${TX3}-00000`);
    expect(executed.fee).toBe(2000000000n);
    expect(executed.blockNumber).toBe(17507600n);
  });
});
