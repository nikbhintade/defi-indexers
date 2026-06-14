/**
 * Offline test of the Marketplace order-creation + stake flow.
 *  - CreateRewardReceiver (MERGE_ORDER path) creates the Order, OrderAction,
 *    Transaction, User and Stats; Marketplace.fee() is mocked.
 *  - StakeCoreProxy stakes CORE into the order: updates Stats.totalCoreStaked,
 *    Order stake/tier, OrderActionCount, StakedInOrder and User.coreStakedInOrder.
 * Asserts exact entity values.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTestIndexer } from "envio";
import { setCallMock, type CallMockRule } from "../src/effects/calls";

const MARKETPLACE = "0x04ea61c431f7934d51fed2acb2c5f942213f8967";
const OWNER = "0x1111111111111111111111111111111111111111";
const RECEIVER = "0x2222222222222222222222222222222222222222"; // order id
const CANDIDATE = "0x3333333333333333333333333333333333333333";

const TX1 = "0x" + "a1".repeat(32);
const TX2 = "0x" + "b2".repeat(32);
const TS = 1700000000;
const BLOCK = 19942500;

const big = (v: bigint) => ({ kind: "bigint", value: v.toString() }) as const;

// id = txHash.concatI32(logIndex) -> txHash + 8-hex logIndex
const idOf = (tx: string, logIndex: number) =>
  (tx + (logIndex >>> 0).toString(16).padStart(8, "0")).toLowerCase();
// Bytes.concat -> hex concatenation (drop 0x of subsequent parts)
const concat = (...p: string[]) =>
  ("0x" + p.map((x) => x.replace(/^0x/i, "")).join("")).toLowerCase();

afterEach(() => setCallMock(undefined));

describe("marketplace order + stake flow", () => {
  it("CreateRewardReceiver then StakeCoreProxy builds Order/StakedInOrder/OrderActionCount", async () => {
    const rules: CallMockRule[] = [
      { fn: "fee", to: MARKETPLACE, result: big(500n) },
    ];
    setCallMock({ strict: true, rules });

    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        1116: {
          simulate: [
            {
              contract: "Marketplace",
              event: "CreateRewardReceiver",
              srcAddress: MARKETPLACE as `0x${string}`,
              logIndex: 0,
              params: {
                from: OWNER as `0x${string}`,
                rewardReceiver: RECEIVER as `0x${string}`,
                portion: 7000n,
                time: BigInt(TS),
              },
              block: { number: BLOCK, timestamp: TS },
              transaction: { hash: TX1 },
            },
            {
              contract: "Marketplace",
              event: "StakeCoreProxy",
              srcAddress: MARKETPLACE as `0x${string}`,
              logIndex: 1,
              params: {
                receiver: RECEIVER as `0x${string}`,
                from: OWNER as `0x${string}`,
                candidate: CANDIDATE as `0x${string}`,
                value: 1000n,
              },
              block: { number: BLOCK + 1, timestamp: TS + 10 },
              transaction: { hash: TX2 },
            },
          ],
        },
      },
    });

    // ---- Order created by handleNewOrder ----
    const order = await indexer.Order.getOrThrow(RECEIVER);
    expect(order.owner).toBe(OWNER);
    expect(order.user_id).toBe(OWNER);
    expect(order.fee).toBe(500n);
    expect(order.rewardSharingPortion).toBe(7000n);
    expect(order.type).toBe("MERGE_ORDER");
    expect(order.btcAmount).toBe(0n);
    expect(order.bitcoinLockTx).toBe("0x0000000000000000000000000000000000000000");
    // after stake: stake=1, total=2 (created with total=1, +1 by handleOrderAction)
    expect(order.stake).toBe(1);
    expect(order.total).toBe(2);
    expect(order.realtimeStakeAmount).toBe(1000n);
    // btcAmount is 0 -> tier guarded to 0
    expect(order.realtimeTier).toBe(0n);

    // ---- OrderAction (create) id = TX1.concatI32(0) ----
    const createAction = await indexer.OrderAction.getOrThrow(idOf(TX1, 0));
    expect(createAction.type).toBe("CreateOrder");
    expect(createAction.from_id).toBe(OWNER);
    expect(createAction.order_id).toBe(RECEIVER);
    expect(createAction.totalCoreStaked).toBe(0n);

    // ---- OrderAction (stake) id = TX2.concatI32(1) ----
    const stakeAction = await indexer.OrderAction.getOrThrow(idOf(TX2, 1));
    expect(stakeAction.type).toBe("StakeCoreToOrder");
    expect(stakeAction.amount).toBe(1000n);
    expect(stakeAction.totalCoreStaked).toBe(1000n);

    // ---- Stats ----
    const stats = await indexer.Stats.getOrThrow("b14g");
    expect(stats.totalCoreStaked).toBe(1000n);
    expect(stats.totalStaker).toBe(1); // OWNER created once

    // ---- OrderActionCount id = receiver.concat(user.id) ----
    const oac = await indexer.OrderActionCount.getOrThrow(concat(RECEIVER, OWNER));
    expect(oac.stake).toBe(1);
    expect(oac.total).toBe(1);
    expect(oac.user_id).toBe(OWNER);
    expect(oac.order_id).toBe(RECEIVER);

    // ---- StakedInOrder id = receiver.concat(user.id).concat(candidate) ----
    const sio = await indexer.StakedInOrder.getOrThrow(concat(RECEIVER, OWNER, CANDIDATE));
    expect(sio.amount).toBe(1000n);
    expect(sio.validator).toBe(CANDIDATE);
    expect(sio.order_id).toBe(RECEIVER);
    expect(sio.user_id).toBe(OWNER);

    // ---- User ----
    const user = await indexer.User.getOrThrow(OWNER);
    expect(user.coreStakedInOrder).toBe(1000n);

    // ---- Transaction (create) ----
    const tx = await indexer.Transaction.getOrThrow(idOf(TX1, 0));
    expect(tx.type).toBe("CreateOrder");
    expect(tx.toType).toBe("MergeMarketplace");
    expect(tx.amount).toBe(0n);
  });
});
