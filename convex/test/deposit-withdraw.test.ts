/**
 * Offline test of the deposit / withdraw accounting flow on a SEEDED pool.
 *
 * Asserts exact Pool tvl / curveTvlRatio and DailyPoolSnapshot deposit &
 * withdrawal volumes / values. The pricing eth_calls are mocked: a USD pool
 * (assetType 0) so the LP USD price equals the Curve virtual price, and the
 * reward pool's `periodFinish` is in the past so the CRV/CVX apr branch is
 * skipped (aprs = 0, independent of token prices).
 *
 * Numbers (deposit 200 LP, withdraw 50 LP, vPrice = 1.05, LP supply = 1000):
 *   after deposit:  balance 200, curveTvlRatio 0.2,  tvl 200*1.05 = 210
 *   after withdraw: balance 150, curveTvlRatio 0.15, tvl 150*1.05 = 157.5
 *   snapshot.depositValue   = amount(=200e18) * 1.05   (subgraph stores the raw
 *                             token amount * price, NOT decimal-adjusted)
 *   snapshot.withdrawalValue= amount(=50e18)  * 1.05
 */
import { afterEach, describe, expect, it } from "vitest";
import { BigDecimal, createTestIndexer, type Pool } from "envio";
import { setCallMock, type CallMockRule, type MockResult } from "../src/effects/calls";

const BOOSTER = "0xf403c135812408bfbe8713b5a23a04b3d48aae31";
const REGISTRY = "0x90e00ace148ca3b23ac1bc8c240c2a7dd9c2d7f5";
const SWAP = "0xbebc44782c7db0a1a60cb6fe97d0b483032ff1c7"; // 3pool -> assetType 0
const LP = "0x6c3f90f043a72fa612cbac8115ee7e52bde6e490";
const CRV_REWARDS = "0x689440f2ff927e1f24c72f1087e1faf471ece1c8";
const USER = "0xabcdabcdabcdabcdabcdabcdabcdabcdabcdabcd";
const TX1 = "0x" + "aa".repeat(32);
const TX2 = "0x" + "bb".repeat(32);
const TS = 1620000000;
const DAY_BUCKET = (BigInt(TS) / 86400n) * 86400n;

const ZERO = new BigDecimal("0");
const big = (value: bigint): MockResult => ({ kind: "bigint", value: value.toString() });

function seedPool(): Pool {
  return {
    id: "0",
    poolid: 0n,
    platform_id: "Convex",
    name: "3pool",
    lpToken: LP,
    lpTokenBalance: 0n,
    lpTokenUSDPrice: ZERO,
    token: "0x30d9410ed1d5da1f6c8391af5338c93ab8d4035c",
    gauge: "0xc5cfada84e902ad92dd40194f0883ad49639b023",
    crvRewardsPool: CRV_REWARDS,
    swap: SWAP,
    stash: "0x0000000000000000000000000000000000000000",
    stashVersion: 0n,
    stashMinorVersion: 0n,
    active: true,
    isV2: false,
    isLending: false,
    creationBlock: 12450000n,
    creationDate: 1619000000n,
    tvl: ZERO,
    curveTvlRatio: ZERO,
    crvApr: ZERO,
    cvxApr: ZERO,
    extraRewardsApr: ZERO,
    baseApr: ZERO,
    rawBaseApr: ZERO,
    assetType: 0,
    coins: ["0x6b175474e89094c44da98b954eedeac495271d0f"],
    extras: [],
  };
}

const baseRules: CallMockRule[] = [
  // ensurePoolsUpTo: poolLength == seeded poolCount (1) -> no new pools
  { fn: "poolLength", to: BOOSTER, result: big(1n) },
  // getLpTokenSupply
  { fn: "totalSupply", to: LP, result: big(1000n * 10n ** 18n) },
  // getLpTokenVirtualPrice -> 1.05
  { fn: "get_virtual_price_from_lp_token", to: REGISTRY, args: [LP], result: big(105n * 10n ** 16n) },
  // getPoolApr reward-pool reads; periodFinish in the past -> crv/cvx apr branch skipped
  { fn: "periodFinish", to: CRV_REWARDS, result: big(0n) },
  { fn: "totalSupply", to: CRV_REWARDS, result: big(0n) },
  { fn: "rewardRate", to: CRV_REWARDS, result: big(0n) },
];

afterEach(() => setCallMock(undefined));

describe("deposit / withdraw flow (seeded pool)", () => {
  it("updates pool tvl and snapshot accounting with exact values", async () => {
    setCallMock({ rules: baseRules });

    const indexer = createTestIndexer();
    indexer.Platform.set({
      id: "Convex",
      bribeFee: 400n,
      poolCount: 1n,
      totalCrvRevenueToLpProviders: ZERO,
      totalCvxRevenueToLpProviders: ZERO,
      totalFxsRevenueToLpProviders: ZERO,
      totalCrvRevenueToCvxCrvStakers: ZERO,
      totalCvxRevenueToCvxCrvStakers: ZERO,
      totalThreeCrvRevenueToCvxCrvStakers: ZERO,
      totalFxsRevenueToCvxFxsStakers: ZERO,
      totalCrvRevenueToCvxStakers: ZERO,
      totalFxsRevenueToCvxStakers: ZERO,
      totalCrvRevenueToCallers: ZERO,
      totalFxsRevenueToCallers: ZERO,
      totalCrvRevenueToPlatform: ZERO,
      totalFxsRevenueToPlatform: ZERO,
      totalCrvRevenue: ZERO,
      totalFxsRevenue: ZERO,
      totalBribeRevenue: ZERO,
      totalOtherRevenue: ZERO,
    });
    indexer.Pool.set(seedPool());

    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "Booster",
              event: "Deposited",
              srcAddress: BOOSTER as `0x${string}`,
              logIndex: 1,
              params: { user: USER as `0x${string}`, poolid: 0n, amount: 200n * 10n ** 18n },
              block: { number: 12500000, timestamp: TS },
              transaction: { hash: TX1 },
            },
            {
              contract: "Booster",
              event: "Withdrawn",
              srcAddress: BOOSTER as `0x${string}`,
              logIndex: 1,
              params: { user: USER as `0x${string}`, poolid: 0n, amount: 50n * 10n ** 18n },
              block: { number: 12500001, timestamp: TS + 100 },
              transaction: { hash: TX2 },
            },
          ],
        },
      },
    });

    // ---- Pool after deposit (200) then withdraw (50) = 150 ----
    const pool = await indexer.Pool.getOrThrow("0");
    expect(pool.lpTokenBalance).toBe(150n * 10n ** 18n);
    // last write was the withdrawal: curveTvlRatio = 150 / 1000 = 0.15
    expect(pool.curveTvlRatio.toString()).toBe("0.15");
    // tvl = 150 * 1.05 = 157.5
    expect(pool.tvl.toString()).toBe("157.5");
    expect(pool.baseApr.toString()).toBe("0");

    // ---- DailyPoolSnapshot (id = name-pid-dayBucket) ----
    const snap = await indexer.DailyPoolSnapshot.getOrThrow(`3pool-0-${DAY_BUCKET.toString()}`);
    expect(snap.lpTokenVirtualPrice.toString()).toBe("1.05");
    expect(snap.lpTokenUSDPrice.toString()).toBe("1.05");
    // lpTokenBalance is captured at snapshot creation (deposit time) = 200
    expect(snap.lpTokenBalance).toBe(200n * 10n ** 18n);
    // deposit side
    expect(snap.depositCount).toBe(1n);
    expect(snap.depositVolume).toBe(200n * 10n ** 18n);
    // depositValue = amount * price (raw amount, NOT /1e18) = 200e18 * 1.05
    expect(snap.depositValue.toString()).toBe("210000000000000000000");
    // withdrawal side
    expect(snap.withdrawalCount).toBe(1n);
    expect(snap.withdrawalVolume).toBe(50n * 10n ** 18n);
    expect(snap.withdrawalValue.toString()).toBe("52500000000000000000");
    // tvl reflects the last (withdrawal) update
    expect(snap.tvl.toString()).toBe("157.5");

    // ---- Deposit / Withdrawal entities ----
    const deposit = await indexer.Deposit.getOrThrow(`${TX1}-1`);
    expect(deposit.amount).toBe(200n * 10n ** 18n);
    expect(deposit.poolid_id).toBe("0");
    const withdrawal = await indexer.Withdrawal.getOrThrow(`${TX2}-1`);
    expect(withdrawal.amount).toBe(50n * 10n ** 18n);
    expect(withdrawal.poolid_id).toBe("0");
  });
});
