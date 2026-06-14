/**
 * Offline test of the DolomiteMargin core par/wei/index accounting:
 *  1. LogAddMarket creates Token/InterestIndex/OraclePrice/TotalPar (effects mocked)
 *  2. LogDeposit credits the user's MarginAccount: MarginAccountTokenValue.valuePar,
 *     TotalPar.supplyPar, Token.supplyLiquidity(+USD), DolomiteMargin counters.
 *  3. LogWithdraw debits part of it.
 * Asserts exact par/wei/USD values. All eth_calls mocked via DOLOMITE_CALL_MOCK.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTestIndexer } from "envio";
import { setCallMock, type CallMockRule } from "../src/effects/calls.js";
import { MARGIN, TOKEN_A, USER, adminRules, tokenMeta, json, big } from "./fixtures.js";

const CHAIN = 42161;
const B0 = 28220369; // add market
const B1 = 28220400; // deposit
const B2 = 28220500; // withdraw
const H0 = "0x" + "a0".repeat(32);
const H1 = "0x" + "a1".repeat(32);
const H2 = "0x" + "a2".repeat(32);
const TX0 = "0x" + "f0".repeat(32);
const TX1 = "0x" + "f1".repeat(32);
const TX2 = "0x" + "f2".repeat(32);

const ONE_E18 = 1000000000000000000n;
const PRICE_1USD = 1000000000000000000n; // (36 - 18) decimals => 1.0 USD

const ACCOUNT_ID = `${USER}-0`;
const TOKEN_VALUE_ID = `${USER}-0-0`;

afterEach(() => setCallMock(undefined));

describe("DolomiteMargin deposit + withdraw accounting", () => {
  it("tracks par/wei/index balances with exact values", async () => {
    const rules: CallMockRule[] = [
      ...adminRules(),
      ...tokenMeta(TOKEN_A, "Token A", "TKA", 18),
      { fn: "getNumMarkets", to: MARGIN, result: big(1n) },
      // getMarketPrice for market 0, any block
      { fn: "getMarketPrice", to: MARGIN, args: ["0"], result: json({ value: PRICE_1USD.toString() }) },
    ];
    setCallMock({ strict: true, rules });

    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        [CHAIN]: {
          simulate: [
            {
              contract: "MarginAdmin",
              event: "LogAddMarket",
              srcAddress: MARGIN as `0x${string}`,
              logIndex: 0,
              params: { marketId: 0n, token: TOKEN_A as `0x${string}` },
              block: { number: B0, timestamp: 1700000000, hash: H0 },
              transaction: { hash: TX0 },
            },
            {
              contract: "MarginCore",
              event: "LogDeposit",
              srcAddress: MARGIN as `0x${string}`,
              logIndex: 0,
              params: {
                accountOwner: USER as `0x${string}`,
                accountNumber: 0n,
                market: 0n,
                update: { deltaWei: { sign: true, value: 100n * ONE_E18 }, newPar: { sign: true, value: 100n * ONE_E18 } },
                from: USER as `0x${string}`,
              },
              block: { number: B1, timestamp: 1700001000, hash: H1 },
              transaction: { hash: TX1 },
            },
            {
              contract: "MarginCore",
              event: "LogWithdraw",
              srcAddress: MARGIN as `0x${string}`,
              logIndex: 0,
              params: {
                accountOwner: USER as `0x${string}`,
                accountNumber: 0n,
                market: 0n,
                // withdraw 40 -> newPar 60, deltaWei -40
                update: { deltaWei: { sign: false, value: 40n * ONE_E18 }, newPar: { sign: true, value: 60n * ONE_E18 } },
                to: USER as `0x${string}`,
              },
              block: { number: B2, timestamp: 1700002000, hash: H2 },
              transaction: { hash: TX2 },
            },
          ],
        },
      },
    });

    // Token created with metadata
    const token = await indexer.Token.getOrThrow(TOKEN_A);
    expect(token.symbol).toBe("TKA");
    expect(token.decimals).toBe(18n);
    expect(token.marketId).toBe(0n);

    // Index initialised at 1.0
    const index = await indexer.InterestIndex.getOrThrow(TOKEN_A);
    expect(index.supplyIndex.toString()).toBe("1");
    expect(index.borrowIndex.toString()).toBe("1");

    // Deposit entity
    const deposit = await indexer.Deposit.getOrThrow(`${TX1}-0`);
    expect(deposit.amountDeltaWei.toString()).toBe("100");
    expect(deposit.amountDeltaPar.toString()).toBe("100");
    expect(deposit.amountUSDDeltaWei.toString()).toBe("100");

    // After deposit + withdraw: token value par = 60
    const tv = await indexer.MarginAccountTokenValue.getOrThrow(TOKEN_VALUE_ID);
    expect(tv.valuePar.toString()).toBe("60");

    // TotalPar reflects net supply 60
    const totalPar = await indexer.TotalPar.getOrThrow(TOKEN_A);
    expect(totalPar.supplyPar.toString()).toBe("60");
    expect(totalPar.borrowPar.toString()).toBe("0");

    // Token liquidity (index 1.0 -> wei == par) and USD (price 1.0)
    const tokenAfter = await indexer.Token.getOrThrow(TOKEN_A);
    expect(tokenAfter.supplyLiquidity.toString()).toBe("60");
    expect(tokenAfter.supplyLiquidityUSD.toString()).toBe("60");

    // Withdrawal entity (abs delta 40)
    const withdrawal = await indexer.Withdrawal.getOrThrow(`${TX2}-0`);
    expect(withdrawal.amountDeltaWei.toString()).toBe("40");
    expect(withdrawal.amountDeltaPar.toString()).toBe("-40");

    // MarginAccount supply token tracked
    const account = await indexer.MarginAccount.getOrThrow(ACCOUNT_ID);
    expect(account.hasSupplyValue).toBe(true);
    expect(account.supplyTokens).toContain(TOKEN_A);

    // DolomiteMargin counters: 1 user, 2 actions (deposit + withdraw)
    const dm = await indexer.DolomiteMargin.getOrThrow(MARGIN);
    expect(dm.userCount).toBe(1n);
    expect(dm.actionCount).toBe(2n);
    expect(dm.numberOfMarkets).toBe(1);
    expect(dm.supplyLiquidityUSD.toString()).toBe("60");
  });
});
