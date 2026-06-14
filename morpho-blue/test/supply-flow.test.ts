/**
 * Offline test: CreateMarket then Supply. Verifies the Morpho shares<->assets
 * math (toAssetsDown with virtual shares/assets), Position creation, the market
 * supply totals, and a PositionSnapshot — all with exact asserted values.
 *
 * Collateral token is left unpriced (price 0) so amountUSD math is exercised
 * without extra chainlink mocks; the share math is the focus.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTestIndexer } from "envio";
import { setCallMock, type CallMockRule } from "../src/effects/calls";

const MORPHO = "0xbbbbbbbbbb9cc5e90e3b3af64bdaf62c37eeffcb";
const MARKET_ID = "0x" + "cd".repeat(32);
const LOAN = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"; // USDC
// collateral not present in any pricing map -> price 0 (no extra feed mocks)
const COLLATERAL = "0x3333333333333333333333333333333333333333";
const ORACLE = "0x1111111111111111111111111111111111111111";
// IRM zero so updateInterestRates short-circuits (totalBorrow stays 0 anyway).
const IRM = "0x0000000000000000000000000000000000000000";
const SUPPLIER = "0x4444444444444444444444444444444444444444";
const USDC_FEED = "0x8fffffd4afb6115b954bd326cbe7b4ba576818f6";

const TX = "0x" + "11".repeat(32);

const str = (value: string) => ({ kind: "string", value }) as const;
const num = (value: number) => ({ kind: "number", value }) as const;
const tuple = (value: Array<string | number>) => ({ kind: "tuple", value }) as const;

afterEach(() => setCallMock(undefined));

describe("Supply flow", () => {
  it("CreateMarket + Supply updates Market/Position/snapshot with exact shares math", async () => {
    const rules: CallMockRule[] = [
      { fn: "symbol", to: LOAN, result: str("USDC") },
      { fn: "name", to: LOAN, result: str("USD Coin") },
      { fn: "decimals", to: LOAN, result: num(6) },
      { fn: "symbol", to: COLLATERAL, result: str("CLT") },
      { fn: "name", to: COLLATERAL, result: str("Collateral") },
      { fn: "decimals", to: COLLATERAL, result: num(18) },
      // USDC USD chainlink feed: $1.00 (answer 1e8, decimals 8)
      { fn: "latestRoundData", to: USDC_FEED, result: tuple(["0", "100000000", "0", "0", "0"]) },
      { fn: "decimals", to: USDC_FEED, result: num(8) },
    ];
    setCallMock({ strict: true, rules });

    // First supply on a fresh market: Morpho mints shares = assets * 1e6.
    const assets = 1_000_000_000n; // 1000 USDC (6dp)
    const shares = 1_000_000_000n * 1_000_000n; // 1000e6 * 1e6 = 1e15

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
                  lltv: 860000000000000000n,
                },
              },
              block: { number: 18883124, timestamp: 1703607600 },
            },
            {
              contract: "MorphoBlue",
              event: "Supply",
              srcAddress: MORPHO as `0x${string}`,
              params: {
                id: MARKET_ID,
                caller: SUPPLIER as `0x${string}`,
                onBehalf: SUPPLIER as `0x${string}`,
                assets,
                shares,
              },
              block: { number: 18883200, timestamp: 1703608000 },
              transaction: { hash: TX as `0x${string}`, nonce: 7n, gasPrice: 5n, gas: 21000n },
              logIndex: 3,
            },
          ],
        },
      },
    });

    // market totals updated after the position
    const market = await indexer.Market.getOrThrow(MARKET_ID);
    expect(market.totalSupply).toBe(assets);
    expect(market.totalSupplyShares).toBe(shares);

    // Position id = {account}-{market}-SUPPLIER-0
    const posId = SUPPLIER + "-" + MARKET_ID + "-SUPPLIER-0";
    const position = await indexer.Position.getOrThrow(posId);
    expect(position.side).toBe("SUPPLIER");
    expect(position.shares).toBe(shares);
    // balance = toAssetsDown(shares, 0, 0) = shares*(0+1) / (0+1e6) = 1e15/1e6 = 1e9
    expect(position.balance).toBe(1_000_000_000n);
    // principal = assets
    expect(position.principal).toBe(assets);
    expect(position.depositCount).toBe(1);
    expect(position.account_id).toBe(SUPPLIER);
    expect(position.asset_id).toBe(LOAN);
    expect(position.isCollateral).toBe(false);

    // position counter
    const counter = await indexer._PositionCounter.getOrThrow(
      SUPPLIER + "-" + MARKET_ID + "-SUPPLIER",
    );
    expect(counter.nextCount).toBe(0);

    // Deposit event entity exists (id = hash.concatI32(logIndex).concatI32(0))
    const deposits = await indexer.Deposit.getAll();
    expect(deposits.length).toBe(1);
    expect(deposits[0]!.amount).toBe(assets);
    expect(deposits[0]!.shares).toBe(shares);
    expect(deposits[0]!.isCollateral).toBe(false);
    // canonical reconciliation: Deposit.rates are cloned from market.rates at
    // the event timestamp ({rateId}-{timestamp}). Supply happened at ts 1703608000.
    expect(deposits[0]!.rates).toEqual([
      MARKET_ID + "-supply-1703608000",
      MARKET_ID + "-borrow-1703608000",
    ]);
    // cloned InterestRate snapshots exist
    const clonedSupply = await indexer.InterestRate.getOrThrow(
      MARKET_ID + "-supply-1703608000",
    );
    expect(clonedSupply.side).toBe("LENDER");

    // PositionSnapshot recorded
    const snapId = posId + "-" + TX + "-3";
    const snap = await indexer.PositionSnapshot.getOrThrow(snapId);
    expect(snap.balance).toBe(1_000_000_000n);
    expect(snap.logIndex).toBe(3);

    // account opened a position
    const account = await indexer.Account.getOrThrow(SUPPLIER);
    expect(account.positionCount).toBe(1);
    expect(account.openPositionCount).toBe(1);

    // protocol deposit count bumped
    const protocol = await indexer.LendingProtocol.getOrThrow(MORPHO);
    expect(protocol.depositCount).toBe(1);
    expect(protocol.transactionCount).toBe(1);
  });
});
