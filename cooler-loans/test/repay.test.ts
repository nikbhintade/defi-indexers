/**
 * Offline repay flow: RequestLoan -> ClearRequest -> RepayLoan (full repayment)
 * on the V1 Clearinghouse. Asserts the RepayLoanEvent split, the zeroed loan,
 * the borrower stats and the cumulative repaid-loan counters.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTestIndexer } from "envio";
import { setCallMock, type CallMockRule, type MockResult } from "../src/effects/calls";

const CH_V1 = "0xd6a6e8d9e82534bd65821142fccd91ec9cf31880";
const FACTORY = "0xde3e735d37a8498ad2f141f603a6d0f976a6f772";
const COOLER = "0x1111111111111111111111111111111111111111";
const BORROWER = "0x2222222222222222222222222222222222222222";
const GOHM = "0x0ab87046fbb341d058f17cbc4c1133f25a20a52f";
const DAI = "0x6b175474e89094c44da98b954eedeac495271d0f";
const SDAI = "0x83f20f44975d03b1b09e64809b757c47f942beea";
const TRSRY = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const KERNEL = "0x2286d7f9639e8158fad1169e76d1fbc38247f54b";

const TX1 = "0x" + "ab".repeat(32);
const TX2 = "0x" + "cd".repeat(32);
const BLOCK = 18185800;
const TS = 1695000000;
const REPAY_BLOCK = 18185900;
const REPAY_TS = TS + 86400;

const big = (v: bigint): MockResult => ({ kind: "bigint", value: v.toString() });
const num = (v: number): MockResult => ({ kind: "number", value: v });
const str = (v: string): MockResult => ({ kind: "string", value: v });
const bool = (v: boolean): MockResult => ({ kind: "bool", value: v });

const EXPIRY = BigInt(TS) + BigInt(121 * 24 * 60 * 60);

const REQUEST: MockResult = {
  kind: "tuple",
  value: [big(10000n * 10n ** 18n), big(5n * 10n ** 15n), big(3000n * 10n ** 18n), big(BigInt(121 * 24 * 60 * 60)), bool(true), str(BORROWER)],
};
const LOAN: MockResult = {
  kind: "tuple",
  value: [
    REQUEST,
    big(10000n * 10n ** 18n),
    big(150n * 10n ** 18n),
    big(3333333333333333333n),
    big(EXPIRY),
    str(CH_V1),
    str(BORROWER),
    bool(false),
  ],
};

function rules(): CallMockRule[] {
  return [
    { fn: "debt", to: COOLER, result: str(DAI) },
    { fn: "owner", to: COOLER, result: str(BORROWER) },
    { fn: "collateral", to: COOLER, result: str(GOHM) },
    { fn: "getRequest", to: COOLER, result: REQUEST },
    { fn: "getLoan", to: COOLER, result: LOAN },
    { fn: "decimals", to: DAI, result: num(18) },
    { fn: "decimals", to: GOHM, result: num(18) },
    { fn: "decimals", to: SDAI, result: num(18) },
    { fn: "gohm", to: CH_V1, result: str(GOHM) },
    { fn: "dai", to: CH_V1, result: str(DAI) },
    { fn: "sdai", to: CH_V1, result: str(SDAI) },
    { fn: "INTEREST_RATE", to: CH_V1, result: big(5n * 10n ** 15n) },
    { fn: "DURATION", to: CH_V1, result: big(BigInt(121 * 24 * 60 * 60)) },
    { fn: "FUND_CADENCE", to: CH_V1, result: big(BigInt(7 * 24 * 60 * 60)) },
    { fn: "FUND_AMOUNT", to: CH_V1, result: big(18000000n * 10n ** 18n) },
    { fn: "LOAN_TO_COLLATERAL", to: CH_V1, result: big(3000n * 10n ** 18n) },
    { fn: "factory", to: CH_V1, result: str(FACTORY) },
    { fn: "active", to: CH_V1, result: bool(true) },
    { fn: "fundTime", to: CH_V1, result: big(BigInt(TS) + 1000n) },
    { fn: "interestReceivables", to: CH_V1, result: big(500n * 10n ** 18n) },
    { fn: "principalReceivables", to: CH_V1, result: big(20000n * 10n ** 18n) },
    { fn: "balanceOf", to: DAI, args: [CH_V1], result: big(1000n * 10n ** 18n) },
    { fn: "balanceOf", to: SDAI, args: [CH_V1], result: big(500n * 10n ** 18n) },
    { fn: "previewRedeem", to: SDAI, result: big(550n * 10n ** 18n) },
    { fn: "getModuleForKeycode", to: KERNEL, result: str(TRSRY) },
    { fn: "getReserveBalance", to: TRSRY, args: [DAI], result: big(2000000n * 10n ** 18n) },
    { fn: "getReserveBalance", to: TRSRY, args: [SDAI], result: big(1000000n * 10n ** 18n) },
    { fn: "reserveDebt", to: TRSRY, args: [DAI, CH_V1], result: big(0n) },
    { fn: "reserveDebt", to: TRSRY, args: [SDAI, CH_V1], result: big(0n) },
  ];
}

afterEach(() => setCallMock(undefined));

describe("cooler repay flow", () => {
  it("full repayment zeroes the loan, updates borrower + cumulative stats", async () => {
    setCallMock({ strict: true, rules: rules() });
    const indexer = createTestIndexer();

    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "CoolerFactory",
              event: "RequestLoan",
              srcAddress: FACTORY as `0x${string}`,
              logIndex: 1,
              params: { cooler: COOLER as `0x${string}`, collateral: GOHM as `0x${string}`, debt: DAI as `0x${string}`, reqID: 0n },
              block: { number: BLOCK, timestamp: TS },
              transaction: { hash: TX1 },
            },
            {
              contract: "CoolerFactory",
              event: "ClearRequest",
              srcAddress: FACTORY as `0x${string}`,
              logIndex: 2,
              params: { cooler: COOLER as `0x${string}`, reqID: 0n, loanID: 0n },
              block: { number: BLOCK, timestamp: TS },
              transaction: { hash: TX1 },
            },
            {
              contract: "CoolerFactory",
              event: "RepayLoan",
              srcAddress: FACTORY as `0x${string}`,
              logIndex: 1,
              params: { cooler: COOLER as `0x${string}`, loanID: 0n, amount: 10150n * 10n ** 18n }, // full = principal + interest
              block: { number: REPAY_BLOCK, timestamp: REPAY_TS },
              transaction: { hash: TX2 },
            },
          ],
        },
      },
    });

    // ---- RepayLoanEvent (id = txhash-logIndex) ----
    const repay = await indexer.RepayLoanEvent.getOrThrow(`${TX2}-1`);
    expect(repay.amountPaid.toString()).toBe("10150");
    expect(repay.interestPaid.toString()).toBe("150"); // capped at outstanding interest
    expect(repay.principalPaid.toString()).toBe("10000");
    expect(repay.loan_id).toBe(`${COOLER}-0`);
    expect(repay.secondsToExpiry.toString()).toBe((EXPIRY - BigInt(REPAY_TS)).toString());

    // ---- CoolerLoan zeroed by full repayment ----
    const loan = await indexer.CoolerLoan.getOrThrow(`${COOLER}-0`);
    expect(loan.principal.toString()).toBe("0");
    expect(loan.interest.toString()).toBe("0");
    expect(loan.collateral.toString()).toBe("0");

    // ---- BorrowerStats: repaid in full -> no active loans, balances zeroed ----
    const bs = await indexer.BorrowerStats.getOrThrow(BORROWER);
    expect(bs.totalLoans).toBe(1);
    expect(bs.activeLoans).toBe(0);
    expect(bs.totalRepaidLoans).toBe(1);
    expect(bs.currentBorrowed.toString()).toBe("0");
    expect(bs.currentInterestDue.toString()).toBe("0");
    expect(bs.currentCollateral.toString()).toBe("0");

    // ---- ClearinghouseCumulativeStats ----
    const cum = await indexer.ClearinghouseCumulativeStats.getOrThrow(CH_V1);
    expect(cum.totalLoans).toBe(1);
    expect(cum.currentActiveLoans).toBe(0);
    expect(cum.totalRepaidLoans).toBe(1);
    expect(cum.currentActiveBorrowers).toBe(0);

    // ---- repay snapshot recorded ----
    const snap = await indexer.ClearinghouseSnapshot.getOrThrow(`${CH_V1}-${REPAY_BLOCK}-1`);
    expect(snap.isActive).toBe(true);
    expect(snap.reserveBalance.toString()).toBe("1000");
  });
});
