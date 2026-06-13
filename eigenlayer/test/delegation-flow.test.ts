/**
 * Offline test (a): OperatorRegistered + StakerDelegated + Deposit +
 * OperatorSharesIncreased flow.
 *
 * Asserts Operator (delegationApprover/earningsReceiver/metadata), Staker
 * (delegatedTo), StakerDelegationChange, OperatorShares (cumulative) and
 * OperatorShareDelta with exact values.
 */
import { describe, expect, it } from "vitest";
import { createTestIndexer } from "envio";

const OPERATOR = "0xaAaA000000000000000000000000000000000001";
const APPROVER = "0xbBbB000000000000000000000000000000000002";
const RECEIVER = "0xcCcC000000000000000000000000000000000003";
const STAKER = "0xdDdD000000000000000000000000000000000004";
const TOKEN = "0xeEeE000000000000000000000000000000000005";
const STRATEGY = "0xfFfF000000000000000000000000000000000006";
const TX1 = "0x" + "11".repeat(32);
const TX2 = "0x" + "22".repeat(32);
const TX3 = "0x" + "33".repeat(32);
const TX4 = "0x" + "44".repeat(32);

const lc = (x: string) => x.toLowerCase();

describe("operator registration + delegation + shares flow", () => {
  it("creates Operator/Staker/Delegation/OperatorShares with exact values", async () => {
    const indexer = createTestIndexer();

    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "DelegationManager",
              event: "OperatorRegistered",
              logIndex: 0,
              params: {
                operator: OPERATOR,
                operatorDetails: {
                  earningsReceiver: RECEIVER,
                  delegationApprover: APPROVER,
                  stakerOptOutWindowBlocks: 50400n,
                },
              },
              block: { number: 17445600, timestamp: 1686900000 },
              transaction: { hash: TX1 },
            },
            {
              contract: "DelegationManager",
              event: "OperatorMetadataURIUpdated",
              logIndex: 1,
              params: {
                operator: OPERATOR,
                metadataURI: "https://example.com/operator.json",
              },
              block: { number: 17445601, timestamp: 1686900012 },
              transaction: { hash: TX2 },
            },
            {
              contract: "DelegationManager",
              event: "StakerDelegated",
              logIndex: 0,
              params: { staker: STAKER, operator: OPERATOR },
              block: { number: 17445610, timestamp: 1686900120 },
              transaction: { hash: TX3 },
            },
            {
              contract: "StrategyManager",
              event: "Deposit",
              logIndex: 2,
              params: {
                staker: STAKER,
                token: TOKEN,
                strategy: STRATEGY,
                shares: 1000n,
              },
              block: { number: 17445611, timestamp: 1686900132 },
              transaction: { hash: TX4 },
            },
            {
              contract: "DelegationManager",
              event: "OperatorSharesIncreased",
              logIndex: 3,
              params: {
                operator: OPERATOR,
                staker: STAKER,
                strategy: STRATEGY,
                shares: 1000n,
              },
              block: { number: 17445611, timestamp: 1686900132 },
              transaction: { hash: TX4 },
            },
            {
              contract: "DelegationManager",
              event: "OperatorSharesIncreased",
              logIndex: 5,
              params: {
                operator: OPERATOR,
                staker: STAKER,
                strategy: STRATEGY,
                shares: 500n,
              },
              block: { number: 17445620, timestamp: 1686900240 },
              transaction: { hash: TX4 },
            },
          ],
        },
      },
    });

    // ---- Operator ----
    const op = await indexer.Operator.getOrThrow(lc(OPERATOR));
    expect(op.delegationApprover).toBe(lc(APPROVER));
    expect(op.earningsReceiver).toBe(lc(RECEIVER));
    expect(op.stakerOptOutWindowBlocks).toBe(50400n);
    expect(op.metadataURI).toBe("https://example.com/operator.json");
    expect(op.registeredAtBlock).toBe(17445600n);
    expect(op.registeredAtTransactionHash).toBe(lc(TX1));

    // ---- Staker delegated to operator ----
    const st = await indexer.Staker.getOrThrow(lc(STAKER));
    expect(st.delegated).toBe(true);
    expect(st.delegatedTo_id).toBe(lc(OPERATOR));

    // ---- StakerDelegationChange event record ----
    const change = await indexer.StakerDelegationChange.getOrThrow(
      `${lc(TX3)}-0`,
    );
    expect(change.staker).toBe(lc(STAKER));
    expect(change.operator).toBe(lc(OPERATOR));
    expect(change.delegated).toBe(true);

    // ---- Deposit + StakerShares cumulative ----
    const dep = await indexer.Deposit.getOrThrow(`${lc(TX4)}-2`);
    expect(dep.staker).toBe(lc(STAKER));
    expect(dep.token).toBe(lc(TOKEN));
    expect(dep.strategy).toBe(lc(STRATEGY));
    expect(dep.shares).toBe(1000n);

    const stakerShares = await indexer.StakerShares.getOrThrow(
      `${lc(STAKER)}-${lc(STRATEGY)}`,
    );
    expect(stakerShares.shares).toBe(1000n);
    expect(stakerShares.staker_id).toBe(lc(STAKER));

    // ---- OperatorShares cumulative (1000 + 500) ----
    const opShares = await indexer.OperatorShares.getOrThrow(
      `${lc(OPERATOR)}-${lc(STRATEGY)}`,
    );
    expect(opShares.shares).toBe(1500n);
    expect(opShares.operator_id).toBe(lc(OPERATOR));
    expect(opShares.strategy).toBe(lc(STRATEGY));
    expect(opShares.lastUpdateBlockNumber).toBe(17445620n);

    // ---- OperatorShareDelta records (two increases) ----
    const d1 = await indexer.OperatorShareDelta.getOrThrow(
      `${lc(TX4)}-3-${lc(OPERATOR)}-${lc(STRATEGY)}-${lc(STAKER)}`,
    );
    expect(d1.shares).toBe(1000n);
    const d2 = await indexer.OperatorShareDelta.getOrThrow(
      `${lc(TX4)}-5-${lc(OPERATOR)}-${lc(STRATEGY)}-${lc(STAKER)}`,
    );
    expect(d2.shares).toBe(500n);
  });
});
