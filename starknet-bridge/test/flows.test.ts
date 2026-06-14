import { describe, it, expect } from "vitest";
import { createTestIndexer } from "envio";

// ETH bridge pair (index 0 of the rendered mainnet registry).
const ETH_L1 = "0xae0Ee0A63A2cE6BaeEFFE56e7714FB4EFE48D419";
const ETH_L1_LC = ETH_L1.toLowerCase();
const ETH_L2 =
  "0x073314940630fd6dcda0d772d4c972c4e0a9946bef9dabf4ef84eda8ef542b82";
const ETH_L2_FELT =
  0x073314940630fd6dcda0d772d4c972c4e0a9946bef9dabf4ef84eda8ef542b82n;

describe("deposit flow (LogMessageToL2 -> ConsumedMessageToL2)", () => {
  it("LogMessageToL2 creates DepositEvent + UnfinishedDeposit with exact payload-derived ids", async () => {
    const indexer = createTestIndexer();

    const l2Recipient =
      0x01abc0000000000000000000000000000000000000000000000000000000beefn;
    const amountLow = 1_000_000_000_000_000_000n; // 1e18
    const amountHigh = 0n;
    const payload = [l2Recipient, amountLow, amountHigh];
    const txHash =
      "0xdeadbeef00000000000000000000000000000000000000000000000000000001";

    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "StarknetMessaging",
              event: "LogMessageToL2",
              srcAddress: "0xc662c410C0ECf747543f5bA90660f6ABeBD9C8c4",
              logIndex: 7,
              params: {
                from_address: ETH_L1 as `0x${string}`,
                to_address: ETH_L2_FELT,
                selector: 1n,
                payload,
                nonce: 0n,
              },
              block: { number: 13620400, timestamp: 1_637_000_000 },
              transaction: { hash: txHash as `0x${string}` },
            },
          ],
        },
      },
    });

    const depositId = `${txHash}-7`;
    const dep = await indexer.DepositEvent.getOrThrow(depositId);
    expect({
      id: dep.id,
      bridgeAddressL1: dep.bridgeAddressL1,
      bridgeAddressL2: dep.bridgeAddressL2,
      l2Recipient: dep.l2Recipient,
      amount: dep.amount,
      status: dep.status,
      createdAtBlock: dep.createdAtBlock,
      createdTxHash: dep.createdTxHash,
      finishedAtBlock: dep.finishedAtBlock,
      finishedTxHash: dep.finishedTxHash,
    }).toEqual({
      id: depositId,
      bridgeAddressL1: ETH_L1_LC,
      bridgeAddressL2: ETH_L2,
      l2Recipient:
        "0x01abc0000000000000000000000000000000000000000000000000000000beef",
      amount: 1_000_000_000_000_000_000n,
      status: "PENDING",
      createdAtBlock: 13620400n,
      createdTxHash: txHash,
      finishedAtBlock: undefined,
      finishedTxHash: undefined,
    });

    const unfinishedId =
      "0xae0ee0a63a2ce6baeeffe56e7714fb4efe48d419-0x1abc0000000000000000000000000000000000000000000000000000000beef-0xde0b6b3a7640000-0x0";
    const unf = await indexer.UnfinishedDeposit.getOrThrow(unfinishedId);
    expect(unf.depositEvents).toEqual([depositId]);
  });

  it("ConsumedMessageToL2 finishes the deposit and pops it off the queue", async () => {
    const indexer = createTestIndexer();

    const l2Recipient =
      0x01abc0000000000000000000000000000000000000000000000000000000beefn;
    const payload = [l2Recipient, 1_000_000_000_000_000_000n, 0n];
    const createTx =
      "0xdeadbeef00000000000000000000000000000000000000000000000000000001";
    const finishTx =
      "0xdeadbeef00000000000000000000000000000000000000000000000000000002";

    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "StarknetMessaging",
              event: "LogMessageToL2",
              logIndex: 7,
              params: {
                from_address: ETH_L1 as `0x${string}`,
                to_address: ETH_L2_FELT,
                selector: 1n,
                payload,
                nonce: 0n,
              },
              block: { number: 13620400, timestamp: 1_637_000_000 },
              transaction: { hash: createTx as `0x${string}` },
            },
            {
              contract: "StarknetMessaging",
              event: "ConsumedMessageToL2",
              logIndex: 2,
              params: {
                from_address: ETH_L1 as `0x${string}`,
                to_address: ETH_L2_FELT,
                selector: 1n,
                payload,
                nonce: 0n,
              },
              block: { number: 13620500, timestamp: 1_637_000_500 },
              transaction: { hash: finishTx as `0x${string}` },
            },
          ],
        },
      },
    });

    const depositId = `${createTx}-7`;
    const dep = await indexer.DepositEvent.getOrThrow(depositId);
    expect({
      status: dep.status,
      finishedAtBlock: dep.finishedAtBlock,
      finishedAtDate: dep.finishedAtDate,
      finishedTxHash: dep.finishedTxHash,
    }).toEqual({
      status: "FINISHED",
      finishedAtBlock: 13620500n,
      finishedAtDate: 1_637_000_500n,
      finishedTxHash: finishTx,
    });

    const unfinishedId =
      "0xae0ee0a63a2ce6baeeffe56e7714fb4efe48d419-0x1abc0000000000000000000000000000000000000000000000000000000beef-0xde0b6b3a7640000-0x0";
    const unf = await indexer.UnfinishedDeposit.getOrThrow(unfinishedId);
    expect(unf.depositEvents).toEqual([]); // sliced off after finish
  });

  it("ignores non-bridge messages (L2 target not in registry)", async () => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "StarknetMessaging",
              event: "LogMessageToL2",
              logIndex: 0,
              params: {
                from_address: ETH_L1 as `0x${string}`,
                to_address: 0x123n, // not a registered L2 bridge
                selector: 1n,
                payload: [1n, 2n, 0n],
                nonce: 0n,
              },
              block: { number: 13620400, timestamp: 1_637_000_000 },
              transaction: {
                hash: "0x00000000000000000000000000000000000000000000000000000000000000ff" as `0x${string}`,
              },
            },
          ],
        },
      },
    });
    const dep = await indexer.DepositEvent.get(
      "0x00000000000000000000000000000000000000000000000000000000000000ff-0",
    );
    expect(dep).toBeUndefined();
  });
});

describe("withdrawal flow (LogMessageToL1 -> ConsumedMessageToL1)", () => {
  it("creates then finishes a WithdrawalEvent with exact asserted values", async () => {
    const indexer = createTestIndexer();

    // payload[1]=l1Recipient, payload[2]=amountLow, payload[3]=amountHigh
    const l1Recipient = 0x00000000000000000000000000000000cafe0001n;
    const payload = [0n, l1Recipient, 2_500_000n, 0n];
    const createTx =
      "0x00000000000000000000000000000000000000000000000000000000000000aa";
    const finishTx =
      "0x00000000000000000000000000000000000000000000000000000000000000bb";

    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "StarknetMessaging",
              event: "LogMessageToL1",
              logIndex: 3,
              params: {
                from_address: ETH_L2_FELT, // L2 bridge (uint256)
                to_address: ETH_L1 as `0x${string}`, // L1 bridge (address)
                payload,
              },
              block: { number: 13630000, timestamp: 1_637_100_000 },
              transaction: { hash: createTx as `0x${string}` },
            },
            {
              contract: "StarknetMessaging",
              event: "ConsumedMessageToL1",
              logIndex: 1,
              params: {
                from_address: ETH_L2_FELT,
                to_address: ETH_L1 as `0x${string}`,
                payload,
              },
              block: { number: 13630100, timestamp: 1_637_100_500 },
              transaction: { hash: finishTx as `0x${string}` },
            },
          ],
        },
      },
    });

    const withdrawalId = `${createTx}-3`;
    const w = await indexer.WithdrawalEvent.getOrThrow(withdrawalId);
    expect({
      id: w.id,
      bridgeAddressL1: w.bridgeAddressL1,
      bridgeAddressL2: w.bridgeAddressL2,
      l1Recipient: w.l1Recipient,
      amount: w.amount,
      status: w.status,
      createdAtBlock: w.createdAtBlock,
      createdTxHash: w.createdTxHash,
      finishedAtBlock: w.finishedAtBlock,
      finishedAtDate: w.finishedAtDate,
      finishedTxHash: w.finishedTxHash,
    }).toEqual({
      id: withdrawalId,
      bridgeAddressL1: ETH_L1_LC,
      bridgeAddressL2: ETH_L2,
      l1Recipient: "0x00000000000000000000000000000000cafe0001",
      amount: 2_500_000n,
      status: "FINISHED",
      createdAtBlock: 13630000n,
      createdTxHash: createTx,
      finishedAtBlock: 13630100n,
      finishedAtDate: 1_637_100_500n,
      finishedTxHash: finishTx,
    });

    const unfinishedId =
      "0xae0ee0a63a2ce6baeeffe56e7714fb4efe48d419-0x0-0xcafe0001-0x2625a0-0x0";
    const unf = await indexer.UnfinishedWithdrawal.getOrThrow(unfinishedId);
    expect(unf.withdrawalEvents).toEqual([]); // popped after finish
  });
});
