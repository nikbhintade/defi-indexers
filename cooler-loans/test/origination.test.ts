/**
 * Offline origination flow: RequestLoan -> ClearRequest on the V1 Clearinghouse.
 *
 * Mocks every eth_call the subgraph performs (Cooler getters, Clearinghouse
 * params + state reads, ERC20 decimals, Kernel/TRSRY, previewRedeem). Asserts
 * CoolerLoanRequest, CoolerLoan, ClearinghouseSnapshot, BorrowerStats and the
 * ClearinghouseCumulativeStats with exact values.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTestIndexer } from "envio";
import { setCallMock, type CallMockRule, type MockResult } from "../src/effects/calls";

const CH_V1 = "0xd6a6e8d9e82534bd65821142fccd91ec9cf31880"; // V1 clearinghouse (lender)
const COOLER = "0x1111111111111111111111111111111111111111";
const BORROWER = "0x2222222222222222222222222222222222222222";
const GOHM = "0x0ab87046fbb341d058f17cbc4c1133f25a20a52f";
const DAI = "0x6b175474e89094c44da98b954eedeac495271d0f";
const SDAI = "0x83f20f44975d03b1b09e64809b757c47f942beea";
const TRSRY = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const TX = "0x" + "ab".repeat(32);
const BLOCK = 18185800;
const TS = 1695000000; // 2023-09-18

const big = (v: bigint): MockResult => ({ kind: "bigint", value: v.toString() });
const num = (v: number): MockResult => ({ kind: "number", value: v });
const str = (v: string): MockResult => ({ kind: "string", value: v });
const bool = (v: boolean): MockResult => ({ kind: "bool", value: v });

// getRequest tuple: amount, interest, loanToCollateral, duration, active, requester
const REQUEST: MockResult = {
  kind: "tuple",
  value: [
    big(10000n * 10n ** 18n), // amount 10,000 DAI
    big(5n * 10n ** 15n), // interest 0.005 (0.5%)
    big(3000n * 10n ** 18n), // loanToCollateral 3000
    big(121n * 24n * 60n * 60n), // duration 121 days
    bool(true),
    str(BORROWER),
  ],
};

// getLoan tuple: request(tuple), principal, interestDue, collateral, expiry, lender, recipient, callback
const LOAN: MockResult = {
  kind: "tuple",
  value: [
    REQUEST,
    big(10000n * 10n ** 18n), // principal 10,000
    big(150n * 10n ** 18n), // interestDue 150
    big(3333333333333333333n), // collateral ~3.333 gOHM
    big(BigInt(TS) + BigInt(121 * 24 * 60 * 60)), // expiry
    str(CH_V1), // lender = clearinghouse
    str(BORROWER), // recipient
    bool(false), // callback
  ],
};

function baseRules(): CallMockRule[] {
  return [
    // ---- Cooler getters ----
    { fn: "debt", to: COOLER, result: str(DAI) },
    { fn: "owner", to: COOLER, result: str(BORROWER) },
    { fn: "collateral", to: COOLER, result: str(GOHM) },
    { fn: "getRequest", to: COOLER, result: REQUEST },
    { fn: "getLoan", to: COOLER, result: LOAN },
    // ---- token decimals ----
    { fn: "decimals", to: DAI, result: num(18) },
    { fn: "decimals", to: GOHM, result: num(18) },
    { fn: "decimals", to: SDAI, result: num(18) },
    // ---- Clearinghouse token getters (V1 path: gohm/dai/sdai) ----
    { fn: "gohm", to: CH_V1, result: str(GOHM) },
    { fn: "dai", to: CH_V1, result: str(DAI) },
    { fn: "sdai", to: CH_V1, result: str(SDAI) },
    // ---- Clearinghouse params ----
    { fn: "INTEREST_RATE", to: CH_V1, result: big(5n * 10n ** 15n) }, // 0.005
    { fn: "DURATION", to: CH_V1, result: big(BigInt(121 * 24 * 60 * 60)) },
    { fn: "FUND_CADENCE", to: CH_V1, result: big(BigInt(7 * 24 * 60 * 60)) },
    { fn: "FUND_AMOUNT", to: CH_V1, result: big(18000000n * 10n ** 18n) },
    { fn: "LOAN_TO_COLLATERAL", to: CH_V1, result: big(3000n * 10n ** 18n) },
    { fn: "factory", to: CH_V1, result: str("0xde3e735d37a8498ad2f141f603a6d0f976a6f772") },
    // ---- Clearinghouse state reads (snapshot) ----
    { fn: "active", to: CH_V1, result: bool(true) },
    { fn: "fundTime", to: CH_V1, result: big(BigInt(TS) + 1000n) },
    { fn: "interestReceivables", to: CH_V1, result: big(500n * 10n ** 18n) },
    { fn: "principalReceivables", to: CH_V1, result: big(20000n * 10n ** 18n) },
    // ---- balances ----
    { fn: "balanceOf", to: DAI, args: [CH_V1], result: big(1000n * 10n ** 18n) },
    { fn: "balanceOf", to: SDAI, args: [CH_V1], result: big(500n * 10n ** 18n) },
    { fn: "previewRedeem", to: SDAI, result: big(550n * 10n ** 18n) }, // catch-all sDAI->DAI
    // ---- Kernel / TRSRY ----
    { fn: "getModuleForKeycode", to: "0x2286d7f9639e8158fad1169e76d1fbc38247f54b", result: str(TRSRY) },
    { fn: "getReserveBalance", to: TRSRY, args: [DAI], result: big(2000000n * 10n ** 18n) },
    { fn: "getReserveBalance", to: TRSRY, args: [SDAI], result: big(1000000n * 10n ** 18n) },
    { fn: "reserveDebt", to: TRSRY, args: [DAI, CH_V1], result: big(0n) },
    { fn: "reserveDebt", to: TRSRY, args: [SDAI, CH_V1], result: big(0n) },
  ];
}

afterEach(() => setCallMock(undefined));

describe("cooler origination flow", () => {
  it("RequestLoan + ClearRequest create the request, loan, snapshot and stats", async () => {
    setCallMock({ strict: true, rules: baseRules() });
    const indexer = createTestIndexer();

    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "CoolerFactory",
              event: "RequestLoan",
              srcAddress: "0xde3e735d37a8498ad2f141f603a6d0f976a6f772",
              logIndex: 1,
              params: {
                cooler: COOLER as `0x${string}`,
                collateral: GOHM as `0x${string}`,
                debt: DAI as `0x${string}`,
                reqID: 0n,
              },
              block: { number: BLOCK, timestamp: TS },
              transaction: { hash: TX },
            },
            {
              contract: "CoolerFactory",
              event: "ClearRequest",
              srcAddress: "0xde3e735d37a8498ad2f141f603a6d0f976a6f772",
              logIndex: 2,
              params: {
                cooler: COOLER as `0x${string}`,
                reqID: 0n,
                loanID: 0n,
              },
              block: { number: BLOCK, timestamp: TS },
              transaction: { hash: TX },
            },
          ],
        },
      },
    });

    // ---- CoolerLoanRequest ----
    const req = await indexer.CoolerLoanRequest.getOrThrow(`${COOLER}-0`);
    expect(req.borrower).toBe(BORROWER);
    expect(req.cooler).toBe(COOLER);
    expect(req.debtToken).toBe(DAI);
    expect(req.collateralToken).toBe(GOHM);
    expect(req.amount.toString()).toBe("10000");
    expect(req.interestPercentage.toString()).toBe("0.005");
    expect(req.loanToCollateralRatio.toString()).toBe("3000");
    expect(req.isRescinded).toBe(false);

    // ---- CoolerLoan ----
    const loan = await indexer.CoolerLoan.getOrThrow(`${COOLER}-0`);
    expect(loan.principal.toString()).toBe("10000");
    expect(loan.interest.toString()).toBe("150");
    expect(loan.collateral.toString()).toBe("3.333333333333333333");
    expect(loan.clearinghouse_id).toBe(CH_V1);
    expect(loan.borrower_id).toBe(BORROWER);
    expect(loan.hasCallback).toBe(false);

    // ---- Clearinghouse ----
    const ch = await indexer.Clearinghouse.getOrThrow(CH_V1);
    expect(ch.version).toBe("1.0");
    expect(ch.interestRate.toString()).toBe("0.005");
    expect(ch.loanToCollateral.toString()).toBe("3000");
    expect(ch.reserveTokenDecimals).toBe(18);

    // ---- ClearinghouseSnapshot (id = clearinghouse-block-logIndex) ----
    const snap = await indexer.ClearinghouseSnapshot.getOrThrow(`${CH_V1}-${BLOCK}-2`);
    expect(snap.isActive).toBe(true);
    expect(snap.interestReceivables.toString()).toBe("500");
    expect(snap.principalReceivables.toString()).toBe("20000");
    expect(snap.reserveBalance.toString()).toBe("1000");
    expect(snap.sReserveBalance.toString()).toBe("500");
    expect(snap.sReserveInReserveBalance.toString()).toBe("550");
    // treasury: 2,000,000 DAI, 1,000,000 sDAI (debt 0), previewRedeem(1e6 sDAI) = 550
    expect(snap.treasuryReserveBalance.toString()).toBe("2000000");
    expect(snap.treasurySReserveBalance.toString()).toBe("1000000");
    expect(snap.treasurySReserveInReserveBalance.toString()).toBe("550");
    expect(snap.date).toBe("2023-09-18");

    // ---- ClearLoanRequestEvent ----
    const clearEv = await indexer.ClearLoanRequestEvent.getOrThrow(`${COOLER}-0`);
    expect(clearEv.loan_id).toBe(`${COOLER}-0`);
    expect(clearEv.request_id).toBe(`${COOLER}-0`);

    // ---- BorrowerStats (new first loan) ----
    const bs = await indexer.BorrowerStats.getOrThrow(BORROWER);
    expect(bs.totalLoans).toBe(1);
    expect(bs.activeLoans).toBe(1);
    expect(bs.currentBorrowed.toString()).toBe("10000");
    expect(bs.currentInterestDue.toString()).toBe("150");
    expect(bs.currentCollateral.toString()).toBe("3.333333333333333333");
    expect(bs.maxActiveLoans).toBe(1);
    expect(bs.maxBorrowedValue.toString()).toBe("10000");

    // ---- ClearinghouseCumulativeStats ----
    const cum = await indexer.ClearinghouseCumulativeStats.getOrThrow(CH_V1);
    expect(cum.totalLoans).toBe(1);
    expect(cum.currentActiveLoans).toBe(1);
    expect(cum.totalUniqueBorrowers).toBe(1);
    expect(cum.currentActiveBorrowers).toBe(1);
    expect(cum.totalLoopers).toBe(0);
  });
});
