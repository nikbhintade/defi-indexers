/**
 * Offline test of the MarketCreated flow.
 *
 * An EventLog1 with eventName="MarketCreated" must:
 *  - create a MarketInfo entity with the marketToken/index/long/short addresses
 *    decoded from the nested eventData struct (proving the EventData accessor +
 *    the eventData-struct decoding work), and
 *  - register the MarketTokenTemplate dynamic contract so that a subsequent
 *    Transfer (mint, from = zero address) on that market token updates
 *    MarketInfo.marketTokensSupply.
 *
 * No eth_calls are needed for this flow.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTestIndexer } from "envio";
import { setCallMock } from "../src/effects/calls";
import { buildEventData } from "./eventDataBuilder";

const MARKET = "0x70d95587d40a2caf56bd97485ab3eec10bee6336";
const INDEX = "0x82af49447d8a07e3bd95bd0d56f35241523fbab1"; // WETH
const LONG = "0x82af49447d8a07e3bd95bd0d56f35241523fbab1";
const SHORT = "0xaf88d065e77c8cc2239327c5edb3a432268e5831"; // USDC
const USER = "0xabcdabcdabcdabcdabcdabcdabcdabcdabcdabcd";

const TX1 = "0x" + "11".repeat(32);
const TX2 = "0x" + "22".repeat(32);
const ZERO = "0x0000000000000000000000000000000000000000";
const ZERO_BYTES32 = "0x" + "00".repeat(32);

afterEach(() => setCallMock(undefined));

describe("MarketCreated flow", () => {
  it("decodes eventData, creates MarketInfo and registers the MarketToken template", async () => {
    setCallMock({ strict: true, rules: [] }); // no eth_calls expected

    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        42161: {
          simulate: [
            {
              contract: "EventEmitter",
              event: "EventLog1",
              srcAddress: "0xc8ee91a54287db53897056e12d9819156d3822fb" as `0x${string}`,
              params: {
                msgSender: USER as `0x${string}`,
                eventName: "MarketCreated",
                eventNameHash: "MarketCreated",
                topic1: ZERO_BYTES32,
                eventData: buildEventData({
                  address: {
                    marketToken: MARKET,
                    indexToken: INDEX,
                    longToken: LONG,
                    shortToken: SHORT,
                  },
                }),
              },
              block: { number: 107737800, timestamp: 1698042828 },
              transaction: { hash: TX1, from: USER, to: ZERO, transactionIndex: 0 },
            },
            // mint 1000e18 GM tokens to USER -> from == zero -> supply += value
            {
              contract: "MarketTokenTemplate",
              event: "Transfer",
              srcAddress: MARKET as `0x${string}`,
              params: { from: ZERO as `0x${string}`, to: USER as `0x${string}`, value: 1000n * 10n ** 18n },
              block: { number: 107737801, timestamp: 1698042830 },
              transaction: { hash: TX2, from: USER, to: MARKET, transactionIndex: 0 },
            },
          ],
        },
      },
    });

    const market = await indexer.MarketInfo.getOrThrow(MARKET);
    expect(market.id).toBe(MARKET);
    expect(market.marketToken).toBe(MARKET);
    expect(market.indexToken).toBe(INDEX);
    expect(market.longToken).toBe(LONG);
    expect(market.shortToken).toBe(SHORT);
    // the mint Transfer reached the registered template handler and bumped supply
    expect(market.marketTokensSupply).toBe(1000n * 10n ** 18n);
  });
});
