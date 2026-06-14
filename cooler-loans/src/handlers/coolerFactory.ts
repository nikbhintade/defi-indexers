/**
 * Port of src/cooler-factory.ts: loan request/rescind/clear/default/repay/extend.
 *
 * The subgraph binds the per-borrower Cooler contract via eth_call
 * (`Cooler.bind(event.params.cooler)`) — there are NO Cooler templates; the
 * CoolerFactory re-emits every Cooler event with the cooler address as a param.
 * So all "Cooler" reads are effects, no dynamic registration is needed.
 *
 * Timeseries event ids: the subgraph used auto-ids (`new X(1)`); ported to
 * `txHash-logIndex`. Request/clear/rescind event ids match the subgraph
 * (`cooler-requestId` / `cooler-loanId`). Documented in MIGRATION.md.
 */
import { indexer, BigDecimal } from "envio";
import type { CoolerLoan, CoolerLoanRequest } from "envio";
import { getISO8601DateStringFromTimestamp, low, toDecimal } from "../utils";
import {
  getOrCreateClearinghouse,
  populateClearinghouseSnapshot,
  getGOhmPrice,
  type Ctx,
} from "../services/clearinghouse";
import { getBorrowerStats, updateBorrowerStats, updateLoanExtensionStats, type StatsCtx } from "../services/stats";
import * as C from "../effects/contracts";

const ZERO = new BigDecimal(0);

const requestRecordId = (cooler: string, requestId: bigint) => `${low(cooler)}-${requestId.toString()}`;
const loanRecordId = (cooler: string, loanId: bigint) => `${low(cooler)}-${loanId.toString()}`;

// Contract INTEREST_RATE constant for interestForLoan (0.5% = 5e15), matching the subgraph.
const INTEREST_RATE = 5000000000000000n;
const YEAR_IN_SECONDS = BigInt(365 * 24 * 60 * 60);
const ONE_E18 = 1000000000000000000n;
function interestForLoan(principal: bigint, duration: bigint): bigint {
  const interestPercent = (INTEREST_RATE * duration) / YEAR_IN_SECONDS;
  return (principal * interestPercent) / ONE_E18;
}

function snapshotId(clearinghouse: string, block: number, logIndex: number): string {
  return `${clearinghouse}-${block}-${logIndex}`;
}

// === Request handling ===

indexer.onEvent(
  { contract: "CoolerFactory", event: "RequestLoan" },
  async ({ event, context }) => {
    const ctx = context as unknown as Ctx;
    const cooler = low(event.params.cooler);
    const block = event.block.number;
    const requestId = event.params.reqID;

    const debtToken = await C.coolerDebt(ctx.effect, cooler);
    const debtDecimals = debtToken === null ? 18 : (await C.erc20Decimals(ctx.effect, debtToken)) ?? 18;
    const request = await C.coolerGetRequest(ctx.effect, cooler, requestId, block);
    const owner = await C.coolerOwner(ctx.effect, cooler);
    const collateralToken = await C.coolerCollateral(ctx.effect, cooler);

    const requestRecord: CoolerLoanRequest = {
      id: requestRecordId(cooler, requestId),
      createdBlock: BigInt(block),
      createdTimestamp: BigInt(event.block.timestamp),
      createdTransaction: low(event.transaction.hash),
      cooler,
      requestId,
      borrower: owner ?? "",
      collateralToken: collateralToken ?? "",
      debtToken: debtToken ?? "",
      amount: toDecimal(request?.amount ?? 0n, debtDecimals),
      interestPercentage: toDecimal(request?.interest ?? 0n, debtDecimals),
      loanToCollateralRatio: toDecimal(request?.loanToCollateral ?? 0n, debtDecimals),
      durationSeconds: request?.duration ?? 0n,
      isRescinded: false,
    };
    context.CoolerLoanRequest.set(requestRecord);

    context.RequestLoanEvent.set({
      id: requestRecordId(cooler, requestId),
      date: getISO8601DateStringFromTimestamp(BigInt(event.block.timestamp)),
      blockNumber: BigInt(block),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
      request_id: requestRecord.id,
    });
  },
);

indexer.onEvent(
  { contract: "CoolerFactory", event: "RescindRequest" },
  async ({ event, context }) => {
    const cooler = low(event.params.cooler);
    const requestId = event.params.reqID;
    const requestRecord = await context.CoolerLoanRequest.getOrThrow(
      requestRecordId(cooler, requestId),
      `Request not found with record id: ${requestRecordId(cooler, requestId)}`,
    );
    context.CoolerLoanRequest.set({ ...requestRecord, isRescinded: true });

    context.RescindLoanRequestEvent.set({
      id: requestRecordId(cooler, requestId),
      date: getISO8601DateStringFromTimestamp(BigInt(event.block.timestamp)),
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
      request_id: requestRecord.id,
    });
  },
);

// === Loan event handling ===

indexer.onEvent(
  { contract: "CoolerFactory", event: "ClearRequest" },
  async ({ event, context }) => {
    const ctx = context as unknown as Ctx;
    const sctx = context as unknown as StatsCtx;
    const cooler = low(event.params.cooler);
    const block = { number: event.block.number, timestamp: event.block.timestamp };
    const loanId = event.params.loanID;
    const requestId = event.params.reqID;

    const loanData = await C.coolerGetLoan(ctx.effect, cooler, loanId, block.number);
    const requestRecord = await context.CoolerLoanRequest.getOrThrow(
      requestRecordId(cooler, requestId),
      `Request not found with record id: ${requestRecordId(cooler, requestId)}`,
    );

    if (loanData === null) return;
    const clearinghouse = await getOrCreateClearinghouse(ctx, loanData.lender, block);
    if (clearinghouse === null) return;

    // populateLoan creates the BorrowerStats (unsaved) — mirrored by getBorrowerStats.
    await getBorrowerStats(sctx, requestRecord.borrower, clearinghouse.id);

    const loanRecord: CoolerLoan = {
      id: loanRecordId(cooler, loanId),
      createdBlock: BigInt(block.number),
      createdTimestamp: BigInt(block.timestamp),
      createdTransaction: low(event.transaction.hash),
      loanId,
      cooler,
      request_id: requestRecord.id,
      interest: toDecimal(loanData.interestDue, clearinghouse.reserveTokenDecimals),
      principal: toDecimal(loanData.principal, clearinghouse.reserveTokenDecimals),
      collateral: toDecimal(loanData.collateral, clearinghouse.collateralTokenDecimals),
      originalExpiryTimestamp: loanData.expiry,
      currentExpiryTimestamp: loanData.expiry,
      clearinghouse_id: clearinghouse.id,
      hasCallback: loanData.callback,
      borrower_id: requestRecord.borrower,
    };
    context.CoolerLoan.set(loanRecord);

    const snap = await populateClearinghouseSnapshot(ctx, loanData.lender, block, event.transaction.hash);
    if (snap !== null) {
      context.ClearinghouseSnapshot.set({ ...snap, id: snapshotId(clearinghouse.address, event.block.number, event.logIndex) });
    }

    context.ClearLoanRequestEvent.set({
      id: loanRecordId(cooler, loanId),
      date: getISO8601DateStringFromTimestamp(BigInt(event.block.timestamp)),
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
      loan_id: loanRecord.id,
      request_id: requestRecord.id,
    });

    await updateBorrowerStats(
      sctx,
      clearinghouse.id,
      requestRecord.borrower,
      true,
      true,
      false,
      false,
      BigInt(event.block.number),
      BigInt(event.block.timestamp),
      loanRecord.principal,
      loanRecord.interest,
      loanRecord.collateral,
    );
  },
);

indexer.onEvent(
  { contract: "CoolerFactory", event: "DefaultLoan" },
  async ({ event, context }) => {
    const ctx = context as unknown as Ctx;
    const sctx = context as unknown as StatsCtx;
    const cooler = low(event.params.cooler);
    const block = { number: event.block.number, timestamp: event.block.timestamp };
    const loanId = event.params.loanID;

    const loanData = await C.coolerGetLoan(ctx.effect, cooler, loanId, block.number);
    const loanRecord = await context.CoolerLoan.getOrThrow(
      loanRecordId(cooler, loanId),
      `Loan not found with record id: ${loanRecordId(cooler, loanId)}`,
    );

    const collateralPrice = await getGOhmPrice(ctx, block.number);
    const collateralValue = loanRecord.collateral.times(collateralPrice);

    const collateralToken = await C.coolerCollateral(ctx.effect, cooler);
    const collateralDecimals = collateralToken === null ? 18 : (await C.erc20Decimals(ctx.effect, collateralToken)) ?? 18;

    const expiry = loanData?.expiry ?? loanRecord.currentExpiryTimestamp;
    context.ClaimDefaultedLoanEvent.set({
      id: `${low(event.transaction.hash)}-${event.logIndex}`,
      timestamp: BigInt(event.block.timestamp),
      date: getISO8601DateStringFromTimestamp(BigInt(event.block.timestamp)),
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
      collateralQuantityClaimed: toDecimal(event.params.amount, collateralDecimals),
      collateralPrice,
      collateralValueClaimed: collateralValue,
      defaultedPrincipal: loanRecord.principal,
      loan_id: loanRecord.id,
      secondsSinceExpiry: BigInt(event.block.timestamp) - expiry,
    });

    const snap = loanData === null ? null : await populateClearinghouseSnapshot(ctx, loanData.lender, block, event.transaction.hash);

    // Update the loan record (zero it out). Capture pre-default values for the
    // borrower-stats deltas (the subgraph negates *after* zeroing -> deltas are 0).
    context.CoolerLoan.set({ ...loanRecord, principal: ZERO, interest: ZERO, collateral: ZERO });

    if (snap !== null && loanData !== null) {
      context.ClearinghouseSnapshot.set({ ...snap, id: snapshotId(low(loanData.lender), event.block.number, event.logIndex) });
    }

    // NOTE: preserved subgraph bug — loanRecord is zeroed before the .neg()
    // deltas are computed, so all three deltas are 0 (loanRecord is mutated
    // in-memory by `.principal = zero()` etc. before being read again).
    await updateBorrowerStats(
      sctx,
      loanRecord.clearinghouse_id,
      loanRecord.borrower_id,
      false,
      false,
      true,
      false,
      BigInt(event.block.number),
      BigInt(event.block.timestamp),
      ZERO.negated(),
      ZERO.negated(),
      ZERO.negated(),
    );
  },
);

indexer.onEvent(
  { contract: "CoolerFactory", event: "RepayLoan" },
  async ({ event, context }) => {
    const ctx = context as unknown as Ctx;
    const sctx = context as unknown as StatsCtx;
    const cooler = low(event.params.cooler);
    const block = { number: event.block.number, timestamp: event.block.timestamp };
    const loanId = event.params.loanID;

    const loanRecord = await context.CoolerLoan.getOrThrow(
      loanRecordId(cooler, loanId),
      `Loan not found with record id: ${loanRecordId(cooler, loanId)}`,
    );

    const debtToken = await C.coolerDebt(ctx.effect, cooler);
    const debtDecimals = debtToken === null ? 18 : (await C.erc20Decimals(ctx.effect, debtToken)) ?? 18;
    const amountPaid = toDecimal(event.params.amount, debtDecimals);

    if (amountPaid.eq(ZERO)) return;

    let interestPaid: BigDecimal;
    let principalPaid: BigDecimal;
    if (amountPaid.gt(loanRecord.interest)) {
      interestPaid = loanRecord.interest;
      principalPaid = amountPaid.minus(loanRecord.interest);
    } else {
      interestPaid = amountPaid;
      principalPaid = ZERO;
    }

    const snap = await populateClearinghouseSnapshot(ctx, loanRecord.clearinghouse_id, block, event.transaction.hash);
    if (snap !== null) {
      context.ClearinghouseSnapshot.set({ ...snap, id: snapshotId(low(loanRecord.clearinghouse_id), event.block.number, event.logIndex) });
    }

    context.RepayLoanEvent.set({
      id: `${low(event.transaction.hash)}-${event.logIndex}`,
      timestamp: BigInt(event.block.timestamp),
      date: getISO8601DateStringFromTimestamp(BigInt(event.block.timestamp)),
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
      amountPaid,
      principalPaid,
      interestPaid,
      loan_id: loanRecord.id,
      secondsToExpiry: loanRecord.currentExpiryTimestamp - BigInt(event.block.timestamp),
    });

    const isFullRepayment = amountPaid.eq(loanRecord.principal.plus(loanRecord.interest));
    let principalDelta: BigDecimal;
    let interestDelta: BigDecimal;
    let collateralDelta: BigDecimal;
    if (isFullRepayment) {
      principalDelta = loanRecord.principal.negated();
      interestDelta = loanRecord.interest.negated();
      collateralDelta = loanRecord.collateral.negated();
    } else if (amountPaid.gt(loanRecord.interest)) {
      interestDelta = loanRecord.interest.negated();
      principalDelta = amountPaid.minus(loanRecord.interest).negated();
      collateralDelta = loanRecord.collateral.times(principalDelta).div(loanRecord.principal);
    } else {
      interestDelta = amountPaid.negated();
      principalDelta = ZERO;
      collateralDelta = ZERO;
    }

    context.CoolerLoan.set({
      ...loanRecord,
      principal: loanRecord.principal.plus(principalDelta),
      interest: loanRecord.interest.plus(interestDelta),
      collateral: loanRecord.collateral.plus(collateralDelta),
    });

    await updateBorrowerStats(
      sctx,
      loanRecord.clearinghouse_id,
      loanRecord.borrower_id,
      false,
      !isFullRepayment,
      false,
      isFullRepayment,
      BigInt(event.block.number),
      BigInt(event.block.timestamp),
      principalDelta,
      interestDelta,
      collateralDelta,
    );
  },
);

indexer.onEvent(
  { contract: "CoolerFactory", event: "ExtendLoan" },
  async ({ event, context }) => {
    const ctx = context as unknown as Ctx;
    const sctx = context as unknown as StatsCtx;
    const cooler = low(event.params.cooler);
    const block = { number: event.block.number, timestamp: event.block.timestamp };
    const loanId = event.params.loanID;

    const loanData = await C.coolerGetLoan(ctx.effect, cooler, loanId, block.number);
    const loanRecord = await context.CoolerLoan.getOrThrow(
      loanRecordId(cooler, loanId),
      `Loan not found with record id: ${loanRecordId(cooler, loanId)}`,
    );

    const debtToken = await C.coolerDebt(ctx.effect, cooler);
    const debtDecimals = debtToken === null ? 18 : (await C.erc20Decimals(ctx.effect, debtToken)) ?? 18;

    const expiry = loanData?.expiry ?? loanRecord.currentExpiryTimestamp;
    const principal = loanData?.principal ?? 0n;
    const duration = loanData?.requestDuration ?? 0n;
    const interestBase = interestForLoan(principal, duration);
    const extensionInterest = toDecimal(interestBase * BigInt(event.params.times), debtDecimals);

    const snap = loanData === null ? null : await populateClearinghouseSnapshot(ctx, loanData.lender, block, event.transaction.hash);
    if (snap !== null && loanData !== null) {
      context.ClearinghouseSnapshot.set({ ...snap, id: snapshotId(low(loanData.lender), event.block.number, event.logIndex) });
    }

    context.CoolerLoan.set({ ...loanRecord, currentExpiryTimestamp: expiry });

    context.ExtendLoanEvent.set({
      id: `${low(event.transaction.hash)}-${event.logIndex}`,
      timestamp: BigInt(event.block.timestamp),
      date: getISO8601DateStringFromTimestamp(BigInt(event.block.timestamp)),
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
      periods: Number(event.params.times),
      loan_id: loanRecord.id,
      expiryTimestamp: expiry,
      interestDue: extensionInterest,
    });

    await updateLoanExtensionStats(
      sctx,
      loanRecord.clearinghouse_id,
      loanRecord.borrower_id,
      extensionInterest,
      BigInt(event.block.number),
      BigInt(event.block.timestamp),
    );
  },
);
