/**
 * Offline test of the market-creation flow: Configurator.SetFactory registers
 * the Comet template (contractRegister), then the Comet proxy's Upgraded
 * event creates Market / MarketConfiguration / MarketRewardConfiguration /
 * MarketAccounting / Token / BaseToken / CollateralToken / Protocol /
 * ProtocolAccounting / Usage / snapshot entities with all eth_calls mocked
 * via COMPOUND_V3_CALL_MOCK (no RPC).
 *
 * Entity ids are asserted against hardcoded hex to lock in the graph-ts
 * Bytes byte layouts (LE-minimal BigInt bytes, utf8 suffixes, concat order).
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTestIndexer } from "envio";
import { setCallMock, type CallMockRule } from "../src/effects/calls";
import {
  accountingRules,
  COMET,
  COMP,
  CONFIGURATOR,
  configRules,
  EXTENSION_DELEGATE,
  FACTORY,
  GOVERNOR,
  IMPLEMENTATION,
  PAUSE_GUARDIAN,
  REWARDS,
  USDC,
  USDC_FEED,
  WBTC,
  WBTC_FEED,
} from "./fixtures";

const B0 = 15999990;
const B1 = 16000000;
const TS1 = 1668000000; // hour 463333 -> LE bytes "e51107", day 19305 -> "694b", week 2757 -> "c50a"

const noPrefix = (a: string) => a.slice(2);

// expected ids (byte-for-byte)
const BASE_TOKEN_ID = "0x" + noPrefix(COMET) + noPrefix(USDC);
const COLLATERAL_TOKEN_ID = "0x" + noPrefix(COMET) + noPrefix(WBTC) + "434f4c"; // utf8 "COL"
const MARKET_COLLATERAL_BALANCE_ID = noPrefix(COLLATERAL_TOKEN_ID) !== "" ? COLLATERAL_TOKEN_ID + "42414c" : ""; // + utf8 "BAL"
const REWARD_CONFIG_ID = "0x" + noPrefix(COMET) + noPrefix(REWARDS);
const MARKET_CUMULATIVE_USAGE_ID = "0x4d41524b45545f43554d554c4154495645" + noPrefix(COMET); // utf8 "MARKET_CUMULATIVE" ++ market
const PROTOCOL_CUMULATIVE_USAGE_ID = "0x50524f544f434f4c5f43554d554c4154495645"; // utf8 "PROTOCOL_CUMULATIVE"
const HOUR_BYTES = "e51107"; // BigInt 463333 LE
const DAY_BYTES = "694b"; // BigInt 19305 LE
const WEEK_BYTES = "c50a"; // BigInt 2757 LE
const BLOCK_BYTES = "0024f400"; // BigInt 16000000 LE (+ sign byte)
const CONFIG_SNAPSHOT_ID = "0x" + BLOCK_BYTES + "01"; // block ++ logIndex(1)

afterEach(() => setCallMock(undefined));

describe("market creation flow (SetFactory -> Comet Upgraded)", () => {
  it("creates Market/Protocol/Token entities with exact values and byte-exact ids", async () => {
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
        totalSupply: 1000000000000n,
      }),
    ];
    setCallMock({ strict: true, rules });

    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "Configurator",
              event: "SetFactory",
              srcAddress: CONFIGURATOR as `0x${string}`,
              logIndex: 1,
              params: {
                // checksummed on purpose: ids must be lowercased
                cometProxy: "0xc3d688B66703497DAA19211EEdff47f25384cdc3" as `0x${string}`,
                oldFactory: "0x0000000000000000000000000000000000000000" as `0x${string}`,
                newFactory: FACTORY as `0x${string}`,
              },
              block: { number: B0, timestamp: TS1 - 120 },
            },
            {
              contract: "Comet",
              event: "Upgraded",
              srcAddress: COMET as `0x${string}`,
              logIndex: 1,
              params: { implementation: IMPLEMENTATION as `0x${string}` },
              block: { number: B1, timestamp: TS1 },
            },
          ],
        },
      },
    });

    // ---- Market ----
    const market = await indexer.Market.getOrThrow(COMET);
    expect(market.cometProxy).toBe(COMET);
    expect(market.protocol_id).toBe(CONFIGURATOR);
    expect(market.creationBlockNumber).toBe(16000000n);
    expect(market.configuration_id).toBe(COMET);
    expect(market.accounting_id).toBe(COMET);
    expect(market.rewardConfiguration_id).toBe(REWARD_CONFIG_ID);
    expect(market.cumulativeUsage_id).toBe(MARKET_CUMULATIVE_USAGE_ID);

    // ---- MarketConfiguration ----
    const config = await indexer.MarketConfiguration.getOrThrow(COMET);
    expect(config.market_id).toBe(COMET);
    expect(config.name).toBe("Compound USDC");
    expect(config.symbol).toBe("cUSDCv3");
    expect(config.factory).toBe(FACTORY);
    expect(config.governor).toBe(GOVERNOR);
    expect(config.pauseGuardian).toBe(PAUSE_GUARDIAN);
    expect(config.extensionDelegate).toBe(EXTENSION_DELEGATE);
    expect(config.cometImplementation).toBe(IMPLEMENTATION);
    expect(config.lastConfigurationUpdateBlockNumber).toBe(16000000n);
    expect(config.supplyKink.toString()).toBe("0.8");
    expect(config.borrowKink.toString()).toBe("0.9");
    expect(config.supplyPerSecondInterestRateSlopeLow).toBe(1030568239n);
    expect(config.supplyPerSecondInterestRateSlopeHigh).toBe(12683916793n);
    expect(config.supplyPerSecondInterestRateBase).toBe(0n);
    expect(config.borrowPerSecondInterestRateSlopeLow).toBe(1109842719n);
    expect(config.borrowPerSecondInterestRateSlopeHigh).toBe(7610350076n);
    expect(config.borrowPerSecondInterestRateBase).toBe(475646879n);
    expect(config.storeFrontPriceFactor).toBe(600000000000000000n);
    expect(config.trackingIndexScale).toBe(1000000000000000n);
    expect(config.baseTrackingSupplySpeed).toBe(12500000000n);
    expect(config.baseTrackingBorrowSpeed).toBe(6250000000n);
    expect(config.baseMinForRewards).toBe(100000000000n);
    expect(config.baseBorrowMin).toBe(100000000n);
    expect(config.targetReserves).toBe(5000000000000n);
    expect(config.baseToken_id).toBe(BASE_TOKEN_ID);
    expect(config.collateralTokens).toEqual([COLLATERAL_TOKEN_ID]);

    // ---- Tokens ----
    const usdc = await indexer.Token.getOrThrow(USDC);
    expect(usdc.name).toBe("USD Coin");
    expect(usdc.symbol).toBe("USDC");
    expect(usdc.decimals).toBe(6);
    expect(usdc.lastPriceUsd.toString()).toBe("0"); // generic Token price never set for base tokens

    const comp = await indexer.Token.getOrThrow(COMP);
    expect(comp.symbol).toBe("COMP");
    expect(comp.decimals).toBe(18);
    expect(comp.lastPriceUsd.toString()).toBe("50"); // generic chainlink oracle path
    expect(comp.lastPriceBlockNumber).toBe(16000000n);

    const baseToken = await indexer.BaseToken.getOrThrow(BASE_TOKEN_ID);
    expect(baseToken.market_id).toBe(COMET);
    expect(baseToken.token_id).toBe(USDC);
    expect(baseToken.priceFeed).toBe(USDC_FEED);
    expect(baseToken.creationBlockNumber).toBe(16000000n);
    expect(baseToken.lastPriceUsd.toString()).toBe("1");
    expect(baseToken.lastPriceBlockNumber).toBe(16000000n);

    const collateralToken = await indexer.CollateralToken.getOrThrow(COLLATERAL_TOKEN_ID);
    expect(collateralToken.market_id).toBe(COMET);
    expect(collateralToken.token_id).toBe(WBTC);
    expect(collateralToken.priceFeed).toBe(WBTC_FEED);
    expect(collateralToken.borrowCollateralFactor.toString()).toBe("0.7");
    expect(collateralToken.liquidateCollateralFactor.toString()).toBe("0.77");
    expect(collateralToken.liquidationFactor.toString()).toBe("0.95");
    expect(collateralToken.supplyCap).toBe(1200000000000n);
    expect(collateralToken.lastPriceUsd.toString()).toBe("20000");
    expect(collateralToken.lastPriceBlockNumber).toBe(16000000n);

    // ---- MarketRewardConfiguration (V2 reverted -> V1 fallback) ----
    const rewardConfig = await indexer.MarketRewardConfiguration.getOrThrow(REWARD_CONFIG_ID);
    expect(rewardConfig.tokenAddress).toBe(COMP);
    expect(rewardConfig.rescaleFactor).toBe(1000000000000n);
    expect(rewardConfig.shouldUpscale).toBe(true);
    expect(rewardConfig.multiplier).toBe(1000000000000000000n); // V1 default

    // ---- MarketAccounting ----
    const accounting = await indexer.MarketAccounting.getOrThrow(COMET);
    expect(accounting.lastAccountingUpdatedBlockNumber).toBe(16000000n);
    expect(accounting.baseSupplyIndex).toBe(1001000000000000n);
    expect(accounting.baseBorrowIndex).toBe(1001500000000000n);
    expect(accounting.trackingSupplyIndex).toBe(1000000000000n);
    expect(accounting.trackingBorrowIndex).toBe(2000000000000n);
    expect(accounting.lastAccrualTime).toBe(1668000000n);
    expect(accounting.totalBasePrincipalSupply).toBe(1000000000000n);
    expect(accounting.totalBasePrincipalBorrow).toBe(500000000000n);
    expect(accounting.baseReserveBalance).toBe(250000000000n);
    expect(accounting.totalBaseSupply).toBe(1000000000000n);
    expect(accounting.totalBaseBorrow).toBe(500000000000n);
    expect(accounting.utilization.toString()).toBe("0.5");
    expect(accounting.supplyApr.toString()).toBe("0.063072"); // 2e9 * 31536000 / 1e18
    expect(accounting.borrowApr.toString()).toBe("0.094608"); // 3e9 * 31536000 / 1e18
    expect(accounting.totalBaseSupplyUsd.toString()).toBe("1000000");
    expect(accounting.totalBaseBorrowUsd.toString()).toBe("500000");
    expect(accounting.baseReserveBalanceUsd.toString()).toBe("250000");
    // 12.5e9 speed -> 1.08 COMP/day * $50 = $54/day; 54/1,000,000 * 365 = 0.01971
    expect(accounting.rewardSupplyApr.toString()).toBe("0.01971");
    // 6.25e9 speed -> 0.54 COMP/day * $50 = $27/day; 27/500,000 * 365 = 0.01971
    expect(accounting.rewardBorrowApr.toString()).toBe("0.01971");
    expect(accounting.netSupplyApr.toString()).toBe("0.082782");
    expect(accounting.netBorrowApr.toString()).toBe("0.074898");
    expect(accounting.rewardTokenUsdPrice.toString()).toBe("50");
    expect(accounting.collateralBalanceUsd.toString()).toBe("60000000"); // 3,000 WBTC * $20,000
    expect(accounting.collateralReservesBalanceUsd.toString()).toBe("20000"); // 1 WBTC
    expect(accounting.totalReserveBalanceUsd.toString()).toBe("270000");
    expect(accounting.collateralization.toString()).toBe("2");
    expect(accounting.collateralBalances).toEqual([MARKET_COLLATERAL_BALANCE_ID]);

    // ---- MarketCollateralBalance ----
    const mcb = await indexer.MarketCollateralBalance.getOrThrow(MARKET_COLLATERAL_BALANCE_ID);
    expect(mcb.collateralToken_id).toBe(COLLATERAL_TOKEN_ID);
    expect(mcb.market_id).toBe(COMET);
    expect(mcb.balance).toBe(300000000000n);
    expect(mcb.reserves).toBe(100000000n);
    expect(mcb.balanceUsd.toString()).toBe("60000000");
    expect(mcb.reservesUsd.toString()).toBe("20000");

    // ---- Protocol ----
    const protocol = await indexer.Protocol.getOrThrow(CONFIGURATOR);
    expect(protocol.configuratorProxy).toBe(CONFIGURATOR);
    expect(protocol.configuratorImplementation).toBeUndefined(); // only set by Configurator.Upgraded
    expect(protocol.markets).toEqual([COMET]);
    expect(protocol.accounting_id).toBe(CONFIGURATOR);
    expect(protocol.cumulativeUsage_id).toBe(PROTOCOL_CUMULATIVE_USAGE_ID);

    // Original quirk preserved: protocol accounting was computed while
    // protocol.markets was still empty (market added after), so it is zero.
    const protocolAccounting = await indexer.ProtocolAccounting.getOrThrow(CONFIGURATOR);
    expect(protocolAccounting.lastUpdatedBlock).toBe(16000000n);
    expect(protocolAccounting.totalSupplyUsd.toString()).toBe("0");
    expect(protocolAccounting.totalBorrowUsd.toString()).toBe("0");
    expect(protocolAccounting.collateralBalanceUsd.toString()).toBe("0");

    // ---- Periodic snapshots (byte-exact ids) ----
    const hourly = await indexer.HourlyMarketAccounting.getOrThrow("0x" + noPrefix(COMET) + HOUR_BYTES);
    expect(hourly.hour).toBe(463333n);
    expect(hourly.timestamp).toBe(1668000000n);
    expect(hourly.market_id).toBe(COMET);
    // original quirk: copy id = market ++ (market ++ hour)
    expect(hourly.accounting_id).toBe("0x" + noPrefix(COMET) + noPrefix(COMET) + HOUR_BYTES);

    const accountingCopy = await indexer.MarketAccounting.getOrThrow(hourly.accounting_id);
    expect(accountingCopy.baseSupplyIndex).toBe(1001000000000000n);
    expect(accountingCopy.totalBaseSupplyUsd.toString()).toBe("1000000");
    // deep-copied collateral balance snapshot: balId ++ block ++ logIndex
    expect(accountingCopy.collateralBalances).toEqual([MARKET_COLLATERAL_BALANCE_ID + BLOCK_BYTES + "01"]);

    const daily = await indexer.DailyMarketAccounting.getOrThrow("0x" + noPrefix(COMET) + DAY_BYTES);
    expect(daily.day).toBe(19305n);
    const weekly = await indexer.WeeklyMarketAccounting.getOrThrow("0x" + noPrefix(COMET) + WEEK_BYTES);
    expect(weekly.week).toBe(2757n);

    const hourlyProtocol = await indexer.HourlyProtocolAccounting.getOrThrow("0x" + HOUR_BYTES);
    expect(hourlyProtocol.accounting_id).toBe("0x" + noPrefix(CONFIGURATOR) + HOUR_BYTES);
    expect(hourlyProtocol.protocol_id).toBe(CONFIGURATOR);

    // ---- Market configuration snapshot (block ++ logIndex id) ----
    const configSnapshotContainer = await indexer.MarketConfigurationSnapshot.getOrThrow(CONFIG_SNAPSHOT_ID);
    expect(configSnapshotContainer.market_id).toBe(COMET);
    expect(configSnapshotContainer.configuration_id).toBe(CONFIG_SNAPSHOT_ID);
    const configSnapshot = await indexer.MarketConfiguration.getOrThrow(CONFIG_SNAPSHOT_ID);
    expect(configSnapshot.name).toBe("Compound USDC");
    expect(configSnapshot.collateralTokens).toEqual([COLLATERAL_TOKEN_ID + BLOCK_BYTES + "01"]);
    const collateralTokenSnapshot = await indexer.CollateralToken.getOrThrow(COLLATERAL_TOKEN_ID + BLOCK_BYTES + "01");
    expect(collateralTokenSnapshot.borrowCollateralFactor.toString()).toBe("0.7");

    // ---- Usage bootstrap ----
    const protocolUsage = await indexer.Usage.getOrThrow(PROTOCOL_CUMULATIVE_USAGE_ID);
    expect(protocolUsage.interactionCount).toBe(0n);
    const marketUsage = await indexer.Usage.getOrThrow(MARKET_CUMULATIVE_USAGE_ID);
    expect(marketUsage.uniqueUsersCount).toBe(0n);
  });
});
