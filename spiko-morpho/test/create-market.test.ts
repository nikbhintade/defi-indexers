/**
 * Offline test: MorphoBlue.CreateMarket creates the Market + LendingProtocol
 * (+ Oracle, InterestRate, _MarketList) entities. Token metadata eth_calls are
 * mocked via setCallMock (no RPC).
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTestIndexer } from "envio";
import { setCallMock, type CallMockRule } from "../src/effects/calls";

const MORPHO = "0xbbbbbbbbbb9cc5e90e3b3af64bdaf62c37eeffcb";
// market id (bytes32) — checksum-free lowercase hex
const MARKET_ID = "0x" + "ab".repeat(32);
const LOAN = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"; // USDC (6dp, "USD" symbol)
const COLLATERAL = "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599"; // WBTC (8dp)
const ORACLE = "0x1111111111111111111111111111111111111111";
const IRM = "0x2222222222222222222222222222222222222222";
const LLTV = 860000000000000000n; // 86%

const str = (value: string) => ({ kind: "string", value }) as const;
const num = (value: number) => ({ kind: "number", value }) as const;

afterEach(() => setCallMock(undefined));

describe("CreateMarket", () => {
  it("creates Market + LendingProtocol + Oracle + rates", async () => {
    const rules: CallMockRule[] = [
      { fn: "symbol", to: LOAN, result: str("USDC") },
      { fn: "name", to: LOAN, result: str("USD Coin") },
      { fn: "decimals", to: LOAN, result: num(6) },
      { fn: "symbol", to: COLLATERAL, result: str("WBTC") },
      { fn: "name", to: COLLATERAL, result: str("Wrapped BTC") },
      { fn: "decimals", to: COLLATERAL, result: num(8) },
    ];
    setCallMock({ strict: true, rules });

    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "MorphoBlue",
              event: "CreateMarket",
              srcAddress: MORPHO as `0x${string}`,
              params: {
                id: MARKET_ID,
                marketParams: {
                  loanToken: LOAN as `0x${string}`,
                  collateralToken: COLLATERAL as `0x${string}`,
                  oracle: ORACLE as `0x${string}`,
                  irm: IRM as `0x${string}`,
                  lltv: LLTV,
                },
              },
              block: { number: 18883124, timestamp: 1703607600 },
            },
          ],
        },
      },
    });

    // protocol singleton
    const protocol = await indexer.LendingProtocol.getOrThrow(MORPHO);
    expect(protocol.name).toBe("Morpho Blue");
    expect(protocol.slug).toBe("morpho-blue");
    expect(protocol.network).toBe("MAINNET");
    expect(protocol.totalPoolCount).toBe(1);

    // market
    const market = await indexer.Market.getOrThrow(MARKET_ID);
    expect(market.id).toBe(MARKET_ID);
    expect(market.protocol_id).toBe(MORPHO);
    expect(market.name).toBe("USDC / WBTC");
    expect(market.inputToken_id).toBe(COLLATERAL);
    expect(market.borrowedToken_id).toBe(LOAN);
    expect(market.lltv).toBe(LLTV);
    expect(market.irm).toBe(IRM);
    // maximumLTV = 0.86
    expect(market.maximumLTV.toString()).toBe("0.86");
    expect(market.totalSupply.toString()).toBe("0");
    expect(market.totalSupplyShares.toString()).toBe("0");
    expect(market.rates).toEqual([MARKET_ID + "-supply", MARKET_ID + "-borrow"]);

    // tokens
    const loan = await indexer.Token.getOrThrow(LOAN);
    expect(loan.symbol).toBe("USDC");
    expect(loan.decimals).toBe(6);
    const coll = await indexer.Token.getOrThrow(COLLATERAL);
    expect(coll.decimals).toBe(8);

    // oracle: id = marketId + oracleAddress, isUSD because loan symbol has "USD"
    const oracle = await indexer.Oracle.getOrThrow(MARKET_ID + ORACLE.slice(2));
    expect(oracle.oracleAddress).toBe(ORACLE);
    expect(oracle.isUSD).toBe(true);

    // interest rates
    const supplyRate = await indexer.InterestRate.getOrThrow(MARKET_ID + "-supply");
    expect(supplyRate.side).toBe("LENDER");
    expect(supplyRate.type).toBe("VARIABLE");

    // _MarketList
    const list = await indexer._MarketList.getOrThrow(MORPHO);
    expect(list.markets).toEqual([MARKET_ID]);
  });
});
