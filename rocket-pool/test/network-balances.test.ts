/**
 * Offline test of the network balances flow (handleBalancesUpdated).
 * Simulates a BalancesUpdated event, mocks the four eth_calls
 * (deposit pool balance/excess, rETH total collateral/exchange rate) via
 * ROCKET_POOL_CALL_MOCK, and asserts the produced NetworkStakerBalanceCheckpoint
 * field values exactly, plus the protocol pointer and the RocketETHDailySnapshot.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTestIndexer } from "envio";
import { setCallMock } from "../src/effects";
import {
  ROCKET_TOKEN_RETH_CONTRACT_ADDRESS,
  ROCKET_DEPOSIT_POOL_CONTRACT_ADDRESS,
  ROCKETPOOL_PROTOCOL_ROOT_ID,
} from "../src/constants";

const ETH = 10n ** 18n;
const TX = "0x" + "ab".repeat(32);

afterEach(() => setCallMock(undefined));

describe("network balances flow", () => {
  it("creates a NetworkStakerBalanceCheckpoint with exact values", async () => {
    // depositPoolBalance = 50 ETH (waiting in deposit pool)
    // depositPoolExcess  = 10 ETH
    // totalCollateral    = 100 ETH -> stakerETHInRocketETHContract = 100 - 10 = 90 ETH
    // exchangeRate       = 1.05e18
    setCallMock({
      strict: false,
      rules: [
        {
          fn: "getBalance",
          to: ROCKET_DEPOSIT_POOL_CONTRACT_ADDRESS,
          result: { kind: "bigint", value: (50n * ETH).toString() },
        },
        {
          fn: "getExcessBalance",
          to: ROCKET_DEPOSIT_POOL_CONTRACT_ADDRESS,
          result: { kind: "bigint", value: (10n * ETH).toString() },
        },
        {
          fn: "getTotalCollateral",
          to: ROCKET_TOKEN_RETH_CONTRACT_ADDRESS,
          result: { kind: "bigint", value: (100n * ETH).toString() },
        },
        {
          fn: "getExchangeRate",
          to: ROCKET_TOKEN_RETH_CONTRACT_ADDRESS,
          result: { kind: "bigint", value: (1050000000000000000n).toString() },
        },
      ],
    });

    const indexer = createTestIndexer();

    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "RocketNetworkBalances",
              event: "BalancesUpdated",
              logIndex: 7,
              params: {
                block: 13325300n,
                totalEth: 200n * ETH, // stakerETHInProtocol
                stakingEth: 150n * ETH, // stakerETHActivelyStaking
                rethSupply: 190n * ETH, // totalRETHSupply
                time: 1633000000n,
              },
              block: { number: 13325300, timestamp: 1633000000 },
              transaction: { hash: TX },
            },
          ],
        },
      },
    });

    const id = `${TX}-7`;
    const cp = await indexer.NetworkStakerBalanceCheckpoint.getOrThrow(id);
    expect(cp.stakerETHActivelyStaking).toBe(150n * ETH);
    expect(cp.stakerETHWaitingInDepositPool).toBe(50n * ETH);
    expect(cp.stakerETHInRocketETHContract).toBe(90n * ETH);
    expect(cp.stakerETHInProtocol).toBe(200n * ETH);
    expect(cp.totalRETHSupply).toBe(190n * ETH);
    expect(cp.rETHExchangeRate).toBe(1050000000000000000n);
    expect(cp.averageStakerETHRewards).toBe(0n);
    expect(cp.stakersWithAnRETHBalance).toBe(0n);
    expect(cp.previousCheckpointId).toBeUndefined();
    expect(cp.nextCheckpointId).toBeUndefined();
    expect(cp.block).toBe(13325300n);
    expect(cp.blockTime).toBe(1633000000n);

    // protocol pointer updated
    const protocol = await indexer.RocketPoolProtocol.getOrThrow(
      ROCKETPOOL_PROTOCOL_ROOT_ID
    );
    expect(protocol.lastNetworkStakerBalanceCheckPoint).toBe(id);

    // no daily snapshot on the first checkpoint (no previous checkpoint)
    const snapshotId = (1633000000n / 86400n).toString();
    const snap = await indexer.RocketETHDailySnapshot.get(snapshotId);
    expect(snap).toBeUndefined();
  });

  it("chains a second checkpoint and writes a daily snapshot", async () => {
    setCallMock({
      strict: false,
      rules: [
        {
          fn: "getBalance",
          result: { kind: "bigint", value: (1n * ETH).toString() },
        },
        {
          fn: "getExcessBalance",
          result: { kind: "bigint", value: "0" },
        },
        {
          fn: "getTotalCollateral",
          result: { kind: "bigint", value: (10n * ETH).toString() },
        },
        {
          fn: "getExchangeRate",
          result: { kind: "bigint", value: (1100000000000000000n).toString() },
        },
      ],
    });

    const indexer = createTestIndexer();
    const t0 = 1633000000;
    const t1 = t0 + 100; // same UTC day

    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "RocketNetworkBalances",
              event: "BalancesUpdated",
              logIndex: 1,
              params: {
                block: 1n,
                totalEth: 10n * ETH,
                stakingEth: 9n * ETH,
                rethSupply: 9n * ETH,
                time: BigInt(t0),
              },
              block: { number: 100, timestamp: t0 },
              transaction: { hash: TX },
            },
            {
              contract: "RocketNetworkBalances",
              event: "BalancesUpdated",
              logIndex: 2,
              params: {
                block: 2n,
                totalEth: 11n * ETH,
                stakingEth: 10n * ETH,
                rethSupply: 9n * ETH,
                time: BigInt(t1),
              },
              block: { number: 200, timestamp: t1 },
              transaction: { hash: TX },
            },
          ],
        },
      },
    });

    const cp1 = await indexer.NetworkStakerBalanceCheckpoint.getOrThrow(
      `${TX}-1`
    );
    const cp2 = await indexer.NetworkStakerBalanceCheckpoint.getOrThrow(
      `${TX}-2`
    );
    // previous/next links wired
    expect(cp1.nextCheckpointId).toBe(`${TX}-2`);
    expect(cp2.previousCheckpointId).toBe(`${TX}-1`);

    // daily snapshot written on the second checkpoint (previousCheckpoint exists)
    const snapshotId = (BigInt(t1) / 86400n).toString();
    const snap = await indexer.RocketETHDailySnapshot.getOrThrow(snapshotId);
    expect(snap.totalRETHSupply).toBe(9n * ETH);
    expect(snap.rETHExchangeRate).toBe(1100000000000000000n);
    expect(snap.stakerETHActivelyStaking).toBe(10n * ETH);
    expect(snap.block).toBe(200n);
    expect(snap.blockTime).toBe(BigInt(t1));
  });
});
