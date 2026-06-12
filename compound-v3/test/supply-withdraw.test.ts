/**
 * Offline test of the supply -> withdraw flow: a market is created via the
 * Comet Upgraded event (block B1), then Supply (B2) and Withdraw (B3) by the
 * same account update Position/Market/Protocol accounting, snapshots, usage
 * counters and Transaction/interaction entities. All eth_calls are mocked
 * (block-pinned rules per block) via COMPOUND_V3_CALL_MOCK.
 *
 * Deliberately asserts the original subgraph's staleness quirks:
 * - updatePositionAccounting reads the market accounting last *saved*, so the
 *   position baseBalance at block N uses block N-1's saved indices.
 * - updateProtocolAccounting aggregates the market accounting last saved, so
 *   after B3 the protocol totals equal the B2 market accounting.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTestIndexer } from "envio";
import { setCallMock, type CallMockRule } from "../src/effects/calls";
import {
  accountingRules,
  COMET,
  CONFIGURATOR,
  configRules,
  IMPLEMENTATION,
  json,
  USER,
  WBTC,
} from "./fixtures";

const B1 = 16000000;
const TS1 = 1668000000; // hour 463333
const B2 = 16000100;
const TS2 = 1668006000; // hour 463335 ("e71107"), day 19305 ("694b")
const B3 = 16000200;
const TS3 = 1668009600; // hour 463336 ("e81107"), day 19305

const TX2 = "0x" + "aa".repeat(32);
const TX3 = "0x" + "bb".repeat(32);

const noPrefix = (a: string) => a.slice(2);

const POSITION_ID = "0x" + noPrefix(COMET) + noPrefix(USER);
const COLLATERAL_TOKEN_ID = "0x" + noPrefix(COMET) + noPrefix(WBTC) + "434f4c";
const POSITION_COLLATERAL_BALANCE_ID = POSITION_ID + noPrefix(COLLATERAL_TOKEN_ID);
const PROTOCOL_CUMULATIVE_USAGE_ID = "0x50524f544f434f4c5f43554d554c4154495645";
const MARKET_CUMULATIVE_USAGE_ID = "0x4d41524b45545f43554d554c4154495645" + noPrefix(COMET);

afterEach(() => setCallMock(undefined));

describe("supply + withdraw flow", () => {
  it("updates Position/Market/Protocol accounting, snapshots and usage with exact values", async () => {
    const rules: CallMockRule[] = [
      ...configRules(),
      ...accountingRules(B1, {
        baseSupplyIndex: 1001000000000000n,
        baseBorrowIndex: 1001500000000000n,
        trackingSupplyIndex: 1000000000000n,
        trackingBorrowIndex: 2000000000000n,
        totalSupplyBase: 1000000000000n,
        totalBorrowBase: 500000000000n,
        lastAccrualTime: 1668000000n,
        reserves: 250000000000n,
        totalSupply: 1000000000000n, // $1,000,000
      }),
      ...accountingRules(B2, {
        baseSupplyIndex: 1002000000000000n,
        baseBorrowIndex: 1002500000000000n,
        trackingSupplyIndex: 1100000000000n,
        trackingBorrowIndex: 2100000000000n,
        totalSupplyBase: 1079000000000n,
        totalBorrowBase: 500000000000n,
        lastAccrualTime: 1668006000n,
        reserves: 251000000000n,
        totalSupply: 1080000000000n, // $1,080,000
      }),
      ...accountingRules(B3, {
        baseSupplyIndex: 1003000000000000n,
        baseBorrowIndex: 1003500000000000n,
        trackingSupplyIndex: 1200000000000n,
        trackingBorrowIndex: 2200000000000n,
        totalSupplyBase: 898000000000n,
        totalBorrowBase: 500000000000n,
        lastAccrualTime: 1668009600n,
        reserves: 252000000000n,
        totalSupply: 900000000000n, // $900,000
      }),
      // position state (principal +499 after supply, +299 after withdraw)
      { fn: "userBasic", to: COMET, args: [USER], block: B2, result: json(["499000000", "1000000000000", "100", "0", "0"]) },
      { fn: "userBasic", to: COMET, args: [USER], block: B3, result: json(["299000000", "1010000000000", "200", "0", "0"]) },
      { fn: "userCollateral", to: COMET, args: [USER, WBTC], result: json(["0", "0"]) },
    ];
    setCallMock({ strict: true, rules });

    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "Comet",
              event: "Upgraded",
              srcAddress: COMET as `0x${string}`,
              logIndex: 1,
              params: { implementation: IMPLEMENTATION as `0x${string}` },
              block: { number: B1, timestamp: TS1 },
            },
            {
              contract: "Comet",
              event: "Supply",
              srcAddress: COMET as `0x${string}`,
              logIndex: 1,
              params: {
                // checksummed on purpose: handlers must lowercase
                from: "0xABcdABcdABcDabcdaBcdabcdABcDAbcdAbCdAbCD" as `0x${string}`,
                dst: USER as `0x${string}`,
                amount: 500000000n, // 500 USDC
              },
              block: { number: B2, timestamp: TS2 },
              transaction: {
                hash: TX2,
                from: USER as `0x${string}`,
                to: COMET as `0x${string}`,
                gas: 300000n,
                gasPrice: 20000000000n, // 20 gwei
                gasUsed: 100000n,
              },
            },
            {
              contract: "Comet",
              event: "Withdraw",
              srcAddress: COMET as `0x${string}`,
              logIndex: 1,
              params: {
                src: USER as `0x${string}`,
                to: USER as `0x${string}`,
                amount: 200000000n, // 200 USDC
              },
              block: { number: B3, timestamp: TS3 },
              transaction: {
                hash: TX3,
                from: USER as `0x${string}`,
                to: COMET as `0x${string}`,
                gas: 300000n,
                gasPrice: 20000000000n,
                gasUsed: 80000n,
              },
            },
          ],
        },
      },
    });

    // ---- Account + Position ----
    const account = await indexer.Account.getOrThrow(USER);
    expect(account.address).toBe(USER);
    expect(account.creationBlockNumber).toBe(16000100n);

    const position = await indexer.Position.getOrThrow(POSITION_ID);
    expect(position.market_id).toBe(COMET);
    expect(position.account_id).toBe(USER);
    expect(position.creationBlockNumber).toBe(16000100n);
    expect(position.accounting_id).toBe(POSITION_ID);

    // ---- PositionAccounting (after withdraw at B3) ----
    const pa = await indexer.PositionAccounting.getOrThrow(POSITION_ID);
    expect(pa.lastUpdatedBlockNumber).toBe(16000200n);
    expect(pa.basePrincipal).toBe(299000000n);
    // Original staleness quirk: baseBalance at B3 uses the *stored* (B2)
    // baseSupplyIndex, since the handler's market accounting save happens last
    // 299000000 * 1002000000000000 / 1e15 = 299598000
    expect(pa.baseBalance).toBe(299598000n);
    expect(pa.baseTrackingIndex).toBe(1010000000000n);
    expect(pa.baseTrackingAccrued).toBe(200n);
    expect(pa.baseBalanceUsd.toString()).toBe("299.598");
    expect(pa.collateralBalanceUsd.toString()).toBe("0");
    expect(pa.collateralBalances).toEqual([POSITION_COLLATERAL_BALANCE_ID]);
    expect(pa.cumulativeBaseSupplied).toBe(500000000n);
    expect(pa.cumulativeBaseSuppliedUsd.toString()).toBe("500");
    expect(pa.cumulativeBaseWithdrawn).toBe(200000000n);
    expect(pa.cumulativeBaseWithdrawnUsd.toString()).toBe("200");
    expect(pa.cumulativeBaseDebtAbsorbed).toBe(0n);
    expect(pa.cumulativeGasUsedWei).toBe(180000n); // 100000 + 80000
    // (100000*20gwei = 0.002 ETH) * $1200 + (80000*20gwei = 0.0016 ETH) * $1200
    expect(pa.cumulativeGasUsedUsd.toString()).toBe("4.32");

    const pcb = await indexer.PositionCollateralBalance.getOrThrow(POSITION_COLLATERAL_BALANCE_ID);
    expect(pcb.balance).toBe(0n);
    expect(pcb.balanceUsd.toString()).toBe("0");
    expect(pcb.position_id).toBe(POSITION_ID);

    // ---- Transactions ----
    const tx2 = await indexer.Transaction.getOrThrow(TX2);
    expect(tx2.hash).toBe(TX2);
    expect(tx2.blockNumber).toBe(16000100n);
    expect(tx2.timestamp).toBe(1668006000n);
    expect(tx2.from).toBe(USER);
    expect(tx2.to).toBe(COMET);
    expect(tx2.gasLimit).toBe(300000n);
    expect(tx2.gasPrice).toBe(20000000000n);
    expect(tx2.gasUsed).toBe(100000n);
    expect(tx2.gasUsedUsd?.toString()).toBe("2.4");
    expect(tx2.supplyBaseInteractionCount).toBe(1);
    expect(tx2.withdrawBaseInteractionCount).toBe(0);

    const tx3 = await indexer.Transaction.getOrThrow(TX3);
    expect(tx3.gasUsed).toBe(80000n);
    expect(tx3.gasUsedUsd?.toString()).toBe("1.92");
    expect(tx3.withdrawBaseInteractionCount).toBe(1);

    // ---- Interactions (id = txHash ++ logIndexBytes) ----
    const supplyInteraction = await indexer.SupplyBaseInteraction.getOrThrow(TX2 + "01");
    expect(supplyInteraction.transaction_id).toBe(TX2);
    expect(supplyInteraction.market_id).toBe(COMET);
    expect(supplyInteraction.position_id).toBe(POSITION_ID);
    expect(supplyInteraction.supplier).toBe(USER); // lowercased
    expect(supplyInteraction.asset_id).toBe("0x" + noPrefix(COMET) + "a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48");
    expect(supplyInteraction.amount).toBe(500000000n);
    expect(supplyInteraction.amountUsd.toString()).toBe("500");

    const withdrawInteraction = await indexer.WithdrawBaseInteraction.getOrThrow(TX3 + "01");
    expect(withdrawInteraction.destination).toBe(USER);
    expect(withdrawInteraction.amount).toBe(200000000n);
    expect(withdrawInteraction.amountUsd.toString()).toBe("200");

    // ---- MarketAccounting (current, after B3) ----
    const ma = await indexer.MarketAccounting.getOrThrow(COMET);
    expect(ma.lastAccountingUpdatedBlockNumber).toBe(16000200n);
    expect(ma.baseSupplyIndex).toBe(1003000000000000n);
    expect(ma.baseBorrowIndex).toBe(1003500000000000n);
    expect(ma.trackingSupplyIndex).toBe(1200000000000n);
    expect(ma.totalBasePrincipalSupply).toBe(898000000000n);
    expect(ma.totalBaseSupply).toBe(900000000000n);
    expect(ma.totalBaseBorrow).toBe(500000000000n);
    expect(ma.totalBaseSupplyUsd.toString()).toBe("900000");
    expect(ma.baseReserveBalanceUsd.toString()).toBe("252000");
    expect(ma.supplyApr.toString()).toBe("0.063072");
    expect(ma.borrowApr.toString()).toBe("0.094608");
    // $54 rewards/day over $900,000: 54/900000*365 = 0.0219
    expect(ma.rewardSupplyApr.toString()).toBe("0.0219");
    expect(ma.rewardBorrowApr.toString()).toBe("0.01971");
    expect(ma.netSupplyApr.toString()).toBe("0.084972");
    expect(ma.netBorrowApr.toString()).toBe("0.074898");
    expect(ma.collateralization.toString()).toBe("1.8");
    expect(ma.totalReserveBalanceUsd.toString()).toBe("272000");

    // ---- ProtocolAccounting: aggregates the *last saved* market accounting
    // (B2 values after the B3 handler ran) — original staleness quirk ----
    const protoAcc = await indexer.ProtocolAccounting.getOrThrow(CONFIGURATOR);
    expect(protoAcc.lastUpdatedBlock).toBe(16000200n);
    expect(protoAcc.totalSupplyUsd.toString()).toBe("1080000");
    expect(protoAcc.totalBorrowUsd.toString()).toBe("500000");
    expect(protoAcc.reserveBalanceUsd.toString()).toBe("251000");
    expect(protoAcc.collateralBalanceUsd.toString()).toBe("60000000");
    expect(protoAcc.collateralReservesBalanceUsd.toString()).toBe("20000");
    expect(protoAcc.totalReserveBalanceUsd.toString()).toBe("271000");
    expect(protoAcc.avgSupplyApr.toString()).toBe("0.063072");
    expect(protoAcc.collateralization.toString()).toBe("2.16");

    // ---- Periodic market snapshots: B2 created a fresh hour bucket ----
    const hourlyB2 = await indexer.HourlyMarketAccounting.getOrThrow("0x" + noPrefix(COMET) + "e71107");
    expect(hourlyB2.hour).toBe(463335n);
    expect(hourlyB2.accounting_id).toBe("0x" + noPrefix(COMET) + noPrefix(COMET) + "e71107");
    const hourlyCopyB2 = await indexer.MarketAccounting.getOrThrow(hourlyB2.accounting_id);
    expect(hourlyCopyB2.baseSupplyIndex).toBe(1002000000000000n);
    expect(hourlyCopyB2.totalBaseSupplyUsd.toString()).toBe("1080000");

    const hourlyB3 = await indexer.HourlyMarketAccounting.getOrThrow("0x" + noPrefix(COMET) + "e81107");
    expect(hourlyB3.hour).toBe(463336n);

    // daily bucket was created at B1 and is not replaced
    const daily = await indexer.DailyMarketAccounting.getOrThrow("0x" + noPrefix(COMET) + "694b");
    expect(daily.accounting_id).toBe("0x" + noPrefix(COMET) + noPrefix(COMET) + "e51107");

    // ---- PositionAccountingSnapshots (position ++ block ++ logIndex) ----
    // 16000100 = 0xf42464 -> LE + sign byte = "6424f400"; logIndex 1 -> "01"
    const snapB2Id = POSITION_ID + "6424f400" + "01";
    const snapB2 = await indexer.PositionAccountingSnapshot.getOrThrow(snapB2Id);
    expect(snapB2.position_id).toBe(POSITION_ID);
    expect(snapB2.timestamp).toBe(1668006000n);
    expect(snapB2.accounting_id).toBe(snapB2Id);
    const snapB2Acc = await indexer.PositionAccounting.getOrThrow(snapB2Id);
    // manual retrigger overwrote the snapshot with the cumulatives included
    expect(snapB2Acc.cumulativeBaseSupplied).toBe(500000000n);
    expect(snapB2Acc.basePrincipal).toBe(499000000n);
    // B2 position update used the stored (B1) baseSupplyIndex:
    // 499000000 * 1001000000000000 / 1e15 = 499499000
    expect(snapB2Acc.baseBalance).toBe(499499000n);
    expect(snapB2Acc.collateralBalances).toEqual([POSITION_COLLATERAL_BALANCE_ID + "6424f400" + "01"]);

    // 16000200 = 0xf424c8 -> "c824f400"
    const snapB3Id = POSITION_ID + "c824f400" + "01";
    const snapB3Acc = await indexer.PositionAccounting.getOrThrow(snapB3Id);
    expect(snapB3Acc.cumulativeBaseWithdrawn).toBe(200000000n);
    expect(snapB3Acc.baseBalance).toBe(299598000n);

    // ---- Usage counters ----
    const protocolUsage = await indexer.Usage.getOrThrow(PROTOCOL_CUMULATIVE_USAGE_ID);
    expect(protocolUsage.uniqueUsersCount).toBe(1n);
    expect(protocolUsage.interactionCount).toBe(2n);
    expect(protocolUsage.supplyBaseCount).toBe(1n);
    expect(protocolUsage.withdrawBaseCount).toBe(1n);
    expect(protocolUsage.transferBaseCount).toBe(0n);

    const marketUsage = await indexer.Usage.getOrThrow(MARKET_CUMULATIVE_USAGE_ID);
    expect(marketUsage.uniqueUsersCount).toBe(1n);
    expect(marketUsage.interactionCount).toBe(2n);
    expect(marketUsage.supplyBaseCount).toBe(1n);
    expect(marketUsage.withdrawBaseCount).toBe(1n);

    // hourly usage buckets are distinct (B2 hour 463335, B3 hour 463336)
    const hourlyUsageB2 = await indexer.ProtocolHourlyUsage.getOrThrow("0xe71107");
    expect(hourlyUsageB2.usage_id).toBe("0x50524f544f434f4c5f484f5552" + "e71107"); // utf8 "PROTOCOL_HOUR" ++ hour
    const hourlyUsageB2Usage = await indexer.Usage.getOrThrow(hourlyUsageB2.usage_id);
    expect(hourlyUsageB2Usage.interactionCount).toBe(1n);
    expect(hourlyUsageB2Usage.supplyBaseCount).toBe(1n);
    expect(hourlyUsageB2Usage.withdrawBaseCount).toBe(0n);

    // daily usage bucket shared by both events (day 19305)
    const dailyUsage = await indexer.ProtocolDailyUsage.getOrThrow("0x694b");
    const dailyUsageUsage = await indexer.Usage.getOrThrow(dailyUsage.usage_id);
    expect(dailyUsage.usage_id).toBe("0x50524f544f434f4c5f444159" + "694b"); // utf8 "PROTOCOL_DAY" ++ day
    expect(dailyUsageUsage.interactionCount).toBe(2n);
    expect(dailyUsageUsage.uniqueUsersCount).toBe(1n);

    // market hourly usage: usage id == container id (market ++ hour)
    const marketHourlyUsage = await indexer.MarketHourlyUsage.getOrThrow("0x" + noPrefix(COMET) + "e71107");
    expect(marketHourlyUsage.usage_id).toBe("0x" + noPrefix(COMET) + "e71107");

    // _ActiveAccount unique-user markers (address ++ utf8 metadata)
    const activeCumulative = await indexer._ActiveAccount.getOrThrow(USER + "50524f544f434f4c"); // "PROTOCOL"
    expect(activeCumulative.id).toBe(USER + "50524f544f434f4c");
    // "MARKET" + market.id (0x-prefixed string!) + hour decimal string
    const marketMeta = "MARKET" + COMET + "463335";
    const activeMarketHour = await indexer._ActiveAccount.get(USER + Buffer.from(marketMeta, "utf8").toString("hex"));
    expect(activeMarketHour).toBeDefined();
  });
});
