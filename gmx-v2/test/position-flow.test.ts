/**
 * Offline test of a position increase + fees + execution flow.
 *
 * Sequence (all via the generic EventEmitter dispatcher):
 *   1. OraclePriceUpdate (EventLog1)  -> TokenPrice for the index token
 *   2. MarketCreated (EventLog1)      -> MarketInfo
 *   3. OrderCreated (EventLog2)       -> Order (MarketIncrease) + OrderCreated TradeAction
 *   4. PositionIncrease (EventLog1)   -> PositionIncrease + margin VolumeInfo + PositionVolumeInfo + UserStat
 *   5. PositionFeesCollected (EventLog1) -> PositionFeesInfo + CollectedMarketFeesInfo + PositionFeesInfoWithPeriod
 *   6. OrderExecuted (EventLog1)      -> OrderExecuted TradeAction (reads PositionIncrease + PositionFeesInfo)
 *
 * Block 107737800 < Reader deploy block (112723064) so getMarketTokenPrice is
 * skipped (returns 0) and no RPC is touched; strict mock catches any stray call.
 * Timestamp is before the trading-incentives start, so incentives stats are
 * skipped — keeping the assertions focused on trade / fees / volume parity.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTestIndexer } from "envio";
import { setCallMock } from "../src/effects/calls";
import { buildEventData } from "./eventDataBuilder";

const MARKET = "0x70d95587d40a2caf56bd97485ab3eec10bee6336";
const INDEX = "0x82af49447d8a07e3bd95bd0d56f35241523fbab1"; // WETH
const LONG = INDEX;
const SHORT = "0xaf88d065e77c8cc2239327c5edb3a432268e5831"; // USDC
const COLLATERAL = SHORT;
const ACCOUNT = "0xabcdabcdabcdabcdabcdabcdabcdabcdabcdabcd";
const RECEIVER = ACCOUNT;
const CALLBACK = "0x0000000000000000000000000000000000000000";

const ORDER_KEY = "0x" + "ab".repeat(32);
const POSITION_KEY = "0x" + "cd".repeat(32);
const ZERO_BYTES32 = "0x" + "00".repeat(32);
const ZERO = "0x0000000000000000000000000000000000000000";

const TX = "0x" + "11".repeat(32);

const TS = 1698042828; // 2023-10-23, before trading-incentives start (1700006400)
const SIZE_DELTA_USD = 1000n * 10n ** 30n; // 1000 USD (1e30 precision)
const INDEX_MIN = 1500n * 10n ** 12n;
const INDEX_MAX = 1501n * 10n ** 12n;
const COLLATERAL_PRICE = 10n ** 24n; // USDC ~ $1 in 1e30-per-1e6 terms
const POSITION_FEE_AMOUNT = 5n * 10n ** 6n; // 5 USDC
const FEE_AMOUNT_FOR_POOL = 3n * 10n ** 6n;
const BORROWING_FEE_AMOUNT = 1n * 10n ** 6n;
const FUNDING_FEE_AMOUNT = 2n * 10n ** 6n;

function emitter<E extends "EventLog1" | "EventLog2">(
  eventName: string,
  eventData: ReturnType<typeof buildEventData>,
  contract: "EventEmitter",
  event: E,
  topics: { topic1?: string; topic2?: string } = {},
  blockNumber = 107737800,
) {
  return {
    contract,
    event,
    srcAddress: "0xc8ee91a54287db53897056e12d9819156d3822fb" as `0x${string}`,
    params: {
      msgSender: ACCOUNT as `0x${string}`,
      eventName,
      eventNameHash: eventName,
      topic1: topics.topic1 ?? ZERO_BYTES32,
      ...(event === "EventLog2" ? { topic2: topics.topic2 ?? ZERO_BYTES32 } : {}),
      eventData,
    },
    block: { number: blockNumber, timestamp: TS },
    transaction: {
      hash: TX,
      from: ACCOUNT as `0x${string}`,
      to: ZERO as `0x${string}`,
      transactionIndex: 0,
    },
  };
}

afterEach(() => setCallMock(undefined));

describe("position + fees + execution flow", () => {
  it("produces Order, PositionIncrease, fees, volume, and trade-action entities with exact values", async () => {
    setCallMock({ strict: true, rules: [] }); // block < reader deploy -> no eth_calls

    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        42161: {
          simulate: [
            // 1. price for index token
            emitter(
              "OraclePriceUpdate",
              buildEventData({ address: { token: INDEX }, uint: { minPrice: INDEX_MIN, maxPrice: INDEX_MAX, timestamp: BigInt(TS), priceSourceType: 2n } }),
              "EventEmitter",
              "EventLog1",
            ),
            // 2. market
            emitter(
              "MarketCreated",
              buildEventData({ address: { marketToken: MARKET, indexToken: INDEX, longToken: LONG, shortToken: SHORT } }),
              "EventEmitter",
              "EventLog1",
            ),
            // 3. order created (MarketIncrease = orderType 2)
            emitter(
              "OrderCreated",
              buildEventData({
                address: { account: ACCOUNT, receiver: RECEIVER, callbackContract: CALLBACK, market: MARKET, initialCollateralToken: COLLATERAL },
                addressArray: { swapPath: [] },
                uint: {
                  sizeDeltaUsd: SIZE_DELTA_USD,
                  initialCollateralDeltaAmount: 200n * 10n ** 6n,
                  triggerPrice: 0n,
                  acceptablePrice: 0n,
                  callbakGasLimit: 0n,
                  minOutputAmount: 0n,
                  executionFee: 0n,
                  orderType: 2n,
                },
                bool: { isLong: true, shouldUnwrapNativeToken: false, isFrozen: false },
                bytes32: { key: ORDER_KEY },
              }),
              "EventEmitter",
              "EventLog2",
            ),
            // 4. position increase
            emitter(
              "PositionIncrease",
              buildEventData({
                address: { account: ACCOUNT, market: MARKET, collateralToken: COLLATERAL },
                uint: {
                  "collateralTokenPrice.min": COLLATERAL_PRICE,
                  "collateralTokenPrice.max": COLLATERAL_PRICE,
                  sizeInUsd: SIZE_DELTA_USD,
                  sizeInTokens: 0n,
                  collateralAmount: 200n * 10n ** 6n,
                  sizeDeltaUsd: SIZE_DELTA_USD,
                  sizeDeltaInTokens: 0n,
                  borrowingFactor: 0n,
                  priceImpactDiffUsd: 0n,
                  executionPrice: INDEX_MIN,
                  orderType: 2n,
                },
                int: {
                  collateralDeltaAmount: 200n * 10n ** 6n,
                  longTokenFundingAmountPerSize: 0n,
                  shortTokenFundingAmountPerSize: 0n,
                  priceImpactAmount: 0n,
                  priceImpactUsd: 0n,
                  basePnlUsd: 0n,
                },
                bool: { isLong: true },
                bytes32: { orderKey: ORDER_KEY, positionKey: POSITION_KEY },
              }),
              "EventEmitter",
              "EventLog1",
            ),
            // 5. position fees collected
            emitter(
              "PositionFeesCollected",
              buildEventData({
                address: { market: MARKET, collateralToken: COLLATERAL, trader: ACCOUNT, affiliate: ZERO },
                uint: {
                  "collateralTokenPrice.min": COLLATERAL_PRICE,
                  "collateralTokenPrice.max": COLLATERAL_PRICE,
                  positionFeeAmount: POSITION_FEE_AMOUNT,
                  positionFeeAmountForPool: FEE_AMOUNT_FOR_POOL,
                  borrowingFeeAmount: BORROWING_FEE_AMOUNT,
                  fundingFeeAmount: FUNDING_FEE_AMOUNT,
                  liquidationFeeAmount: 0n,
                  feeAmountForPool: FEE_AMOUNT_FOR_POOL,
                  borrowingFeeUsd: 0n,
                  totalRebateAmount: 0n,
                  totalRebateFactor: 0n,
                  traderDiscountAmount: 0n,
                  affiliateRewardAmount: 0n,
                },
                bytes32: { orderKey: ORDER_KEY },
              }),
              "EventEmitter",
              "EventLog1",
            ),
            // 6. order executed (MarketIncrease -> position increase trade action)
            emitter(
              "OrderExecuted",
              buildEventData({ bytes32: { key: ORDER_KEY } }),
              "EventEmitter",
              "EventLog1",
            ),
          ],
        },
      },
    });

    // ---- Order ----
    const order = await indexer.Order.getOrThrow(ORDER_KEY);
    expect(order.account).toBe(ACCOUNT);
    expect(order.marketAddress).toBe(MARKET);
    expect(order.orderType).toBe(2n);
    expect(order.isLong).toBe(true);
    expect(order.status).toBe("Executed");
    expect(order.sizeDeltaUsd).toBe(SIZE_DELTA_USD);

    // ---- PositionIncrease ----
    const inc = await indexer.PositionIncrease.getOrThrow(ORDER_KEY);
    expect(inc.positionKey).toBe(POSITION_KEY);
    expect(inc.account).toBe(ACCOUNT);
    expect(inc.collateralTokenAddress).toBe(COLLATERAL);
    expect(inc.sizeDeltaUsd).toBe(SIZE_DELTA_USD);
    expect(inc.executionPrice).toBe(INDEX_MIN);

    // ---- PositionFeesInfo ----
    const fees = await indexer.PositionFeesInfo.getOrThrow(ORDER_KEY + ":PositionFeesCollected");
    expect(fees.positionFeeAmount).toBe(POSITION_FEE_AMOUNT);
    expect(fees.borrowingFeeAmount).toBe(BORROWING_FEE_AMOUNT);
    expect(fees.fundingFeeAmount).toBe(FUNDING_FEE_AMOUNT);
    // feeUsdForPool = feeAmountForPool * collateralTokenPrice.min
    expect(fees.feeUsdForPool).toBe(FEE_AMOUNT_FOR_POOL * COLLATERAL_PRICE);

    // ---- CollectedMarketFeesInfo (total) ----
    const collected = await indexer.CollectedMarketFeesInfo.getOrThrow(MARKET + ":total");
    expect(collected.feeUsdForPool).toBe(FEE_AMOUNT_FOR_POOL * COLLATERAL_PRICE);
    expect(collected.cummulativeFeeUsdForPool).toBe(FEE_AMOUNT_FOR_POOL * COLLATERAL_PRICE);
    // poolValue was 0 (pre-reader block) -> feeUsdPerPoolValue stays 0
    expect(collected.feeUsdPerPoolValue).toBe(0n);

    // ---- PositionFeesInfoWithPeriod (total) ----
    const period = await indexer.PositionFeesInfoWithPeriod.getOrThrow("total");
    expect(period.totalPositionFeeAmount).toBe(POSITION_FEE_AMOUNT);
    // positionFeeUsd = positionFeeAmount * collateralTokenPrice.min
    expect(period.totalPositionFeeUsd).toBe(POSITION_FEE_AMOUNT * COLLATERAL_PRICE);
    expect(period.totalPositionFeeAmountForPool).toBe(FEE_AMOUNT_FOR_POOL);

    // ---- VolumeInfo: margin volume = sizeDeltaUsd ----
    const totalVol = await indexer.VolumeInfo.getOrThrow("total");
    expect(totalVol.volumeUsd).toBe(SIZE_DELTA_USD);
    expect(totalVol.marginVolumeUsd).toBe(SIZE_DELTA_USD);

    // ---- PositionVolumeInfo (collateral:index:total) ----
    const posVol = await indexer.PositionVolumeInfo.getOrThrow(COLLATERAL + ":" + INDEX + ":total");
    expect(posVol.volumeUsd).toBe(SIZE_DELTA_USD);

    // ---- UserStat: one margin position ----
    const userStat = await indexer.UserStat.getOrThrow("total");
    expect(userStat.totalPositionCount).toBe(1);
    expect(userStat.uniqueUsers).toBe(1);

    // ---- TradeActions: OrderCreated then OrderExecuted ----
    // OrderExecuted TradeAction (position increase) reads index price + fees.
    const execEventId = TX + ":5"; // logIndex 5 (6th simulated event, 0-based)
    const execAction = await indexer.TradeAction.getOrThrow(execEventId);
    expect(execAction.eventName).toBe("OrderExecuted");
    expect(execAction.orderKey).toBe(ORDER_KEY);
    expect(execAction.indexTokenPriceMin).toBe(INDEX_MIN);
    expect(execAction.indexTokenPriceMax).toBe(INDEX_MAX);
    expect(execAction.positionFeeAmount).toBe(POSITION_FEE_AMOUNT);
    expect(execAction.sizeDeltaUsd).toBe(SIZE_DELTA_USD);

    const createdEventId = TX + ":2"; // OrderCreated was the 3rd event (logIndex 2)
    const createdAction = await indexer.TradeAction.getOrThrow(createdEventId);
    expect(createdAction.eventName).toBe("OrderCreated");
    expect(createdAction.orderType).toBe(2n);
  });
});
