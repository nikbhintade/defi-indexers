/**
 * Ported from src/sdk/snapshots.ts (SnapshotManager) + the activityCounter
 * helper from constants.ts. Functional/context-based: createSnapshots builds &
 * persists the 5 snapshots from current market/protocol state (mirroring the
 * SnapshotManager constructor); the updater functions mutate the in-memory
 * SnapshotSet and re-persist.
 *
 * Snapshot bucket ids use graph-ts `Bytes.fromI32(hours/days)` semantics
 * (4-byte LE hex) via utils/graphBytes.
 */
import type { Context } from "../context";
import {
  BigDecimal,
  type FinancialsDailySnapshot,
  type InterestRate,
  type LendingProtocol,
  type Market,
  type MarketDailySnapshot,
  type MarketHourlySnapshot,
  type UsageMetricsDailySnapshot,
  type UsageMetricsHourlySnapshot,
  type _ActiveAccount,
} from "envio";
import {
  BIGDECIMAL_ZERO,
  INT_ONE,
  INT_ZERO,
  PositionSide,
  SECONDS_PER_DAY,
  SECONDS_PER_HOUR,
  TransactionType,
} from "./constants";
import { getProtocol } from "../initializers/protocol";
import { hexConcat, i32Bytes } from "../utils/graphBytes";

type Ev = { block: { number: bigint; timestamp: bigint } };


export type SnapshotSet = {
  marketHourly: MarketHourlySnapshot;
  marketDaily: MarketDailySnapshot;
  financial: FinancialsDailySnapshot;
  usageDaily: UsageMetricsDailySnapshot;
  usageHourly: UsageMetricsHourlySnapshot;
  days: number;
  hours: number;
};

/**
 * activityCounter (constants.ts). Creates the _ActiveAccount marker; returns 1
 * if newly active in the interval, else 0. LIQUIDATEE w/o txType returns 0.
 */
async function activityCounter(
  context: Context,
  account: string,
  transactionType: string,
  useTransactionType: boolean,
  intervalID: number,
  marketID: string | null = null,
): Promise<number> {
  let activityID = account.toLowerCase() + "-" + intervalID.toString();
  if (marketID) {
    activityID = activityID + "-" + marketID.toLowerCase();
  }
  if (useTransactionType) {
    activityID = activityID + "-" + transactionType;
  }
  const existing = await context._ActiveAccount.get(activityID);
  if (!existing) {
    if (!useTransactionType && transactionType === TransactionType.LIQUIDATEE) {
      return INT_ZERO;
    }
    context._ActiveAccount.set({ id: activityID });
    return INT_ONE;
  }
  return INT_ZERO;
}

async function getSnapshotRates(
  context: Context,
  market: Market,
  rates: string[],
  timeSuffix: string,
): Promise<string[]> {
  const snapshotRates: string[] = [];
  for (const rateId of rates) {
    const rate = await context.InterestRate.get(rateId);
    if (!rate) continue;
    const snapshotRateId = rateId + "-" + timeSuffix;
    context.InterestRate.set({
      id: snapshotRateId,
      rate: rate.rate,
      side: rate.side,
      type: rate.type,
      market_id: market.id,
    });
    snapshotRates.push(snapshotRateId);
  }
  return snapshotRates;
}

export async function createSnapshots(
  context: Context,
  market: Market,
  event: Ev,
): Promise<SnapshotSet> {
  const protocol = await getProtocol(context);
  const hours = Math.trunc(Number(event.block.timestamp) / SECONDS_PER_HOUR);
  const days = Math.trunc(Number(event.block.timestamp) / SECONDS_PER_DAY);

  // ---- market hourly ----
  const mhId = hexConcat(market.id, i32Bytes(hours));
  let mh = await context.MarketHourlySnapshot.get(mhId);
  if (!mh) {
    mh = {
      id: mhId,
      hours,
      protocol_id: protocol.id,
      market_id: market.id,
      relation: market.relation,
      hourlySupplySideRevenueUSD: BIGDECIMAL_ZERO,
      hourlyProtocolSideRevenueUSD: BIGDECIMAL_ZERO,
      hourlyTotalRevenueUSD: BIGDECIMAL_ZERO,
      hourlyDepositUSD: BIGDECIMAL_ZERO,
      hourlyBorrowUSD: BIGDECIMAL_ZERO,
      hourlyLiquidateUSD: BIGDECIMAL_ZERO,
      hourlyWithdrawUSD: BIGDECIMAL_ZERO,
      hourlyRepayUSD: BIGDECIMAL_ZERO,
      hourlyTransferUSD: BIGDECIMAL_ZERO,
      hourlyFlashloanUSD: BIGDECIMAL_ZERO,
      blockNumber: 0n,
      timestamp: 0n,
      inputTokenBalance: 0n,
      inputTokenPriceUSD: BIGDECIMAL_ZERO,
      outputTokenSupply: undefined,
      outputTokenPriceUSD: undefined,
      exchangeRate: undefined,
      rates: undefined,
      reserves: undefined,
      variableBorrowedTokenBalance: undefined,
      stableBorrowedTokenBalance: undefined,
      totalValueLockedUSD: BIGDECIMAL_ZERO,
      cumulativeSupplySideRevenueUSD: BIGDECIMAL_ZERO,
      cumulativeProtocolSideRevenueUSD: BIGDECIMAL_ZERO,
      cumulativeTotalRevenueUSD: BIGDECIMAL_ZERO,
      totalDepositBalanceUSD: BIGDECIMAL_ZERO,
      cumulativeDepositUSD: BIGDECIMAL_ZERO,
      totalBorrowBalanceUSD: BIGDECIMAL_ZERO,
      cumulativeBorrowUSD: BIGDECIMAL_ZERO,
      cumulativeLiquidateUSD: BIGDECIMAL_ZERO,
    };
  }
  mh = {
    ...mh,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
    inputTokenBalance: market.inputTokenBalance,
    inputTokenPriceUSD: market.inputTokenPriceUSD,
    rates: market.rates
      ? await getSnapshotRates(context, market, market.rates.slice(), hours.toString())
      : undefined,
    reserves: market.reserves,
    variableBorrowedTokenBalance: market.variableBorrowedTokenBalance,
    totalValueLockedUSD: market.totalValueLockedUSD,
    cumulativeSupplySideRevenueUSD: market.cumulativeSupplySideRevenueUSD,
    cumulativeProtocolSideRevenueUSD: market.cumulativeProtocolSideRevenueUSD,
    cumulativeTotalRevenueUSD: market.cumulativeTotalRevenueUSD,
    totalDepositBalanceUSD: market.totalDepositBalanceUSD,
    cumulativeDepositUSD: market.cumulativeDepositUSD,
    totalBorrowBalanceUSD: market.totalBorrowBalanceUSD,
    cumulativeBorrowUSD: market.cumulativeBorrowUSD,
    cumulativeLiquidateUSD: market.cumulativeLiquidateUSD,
  };
  context.MarketHourlySnapshot.set(mh);

  // ---- market daily ----
  const mdId = hexConcat(market.id, i32Bytes(days));
  let md = await context.MarketDailySnapshot.get(mdId);
  if (!md) {
    md = {
      id: mdId,
      days,
      protocol_id: protocol.id,
      market_id: market.id,
      relation: market.relation,
      dailySupplySideRevenueUSD: BIGDECIMAL_ZERO,
      dailyProtocolSideRevenueUSD: BIGDECIMAL_ZERO,
      dailyTotalRevenueUSD: BIGDECIMAL_ZERO,
      dailyDepositUSD: BIGDECIMAL_ZERO,
      dailyNativeDeposit: 0n,
      dailyBorrowUSD: BIGDECIMAL_ZERO,
      dailyNativeBorrow: 0n,
      dailyLiquidateUSD: BIGDECIMAL_ZERO,
      dailyNativeLiquidate: 0n,
      dailyWithdrawUSD: BIGDECIMAL_ZERO,
      dailyNativeWithdraw: 0n,
      dailyRepayUSD: BIGDECIMAL_ZERO,
      dailyNativeRepay: 0n,
      dailyTransferUSD: BIGDECIMAL_ZERO,
      dailyNativeTransfer: 0n,
      dailyFlashloanUSD: BIGDECIMAL_ZERO,
      dailyNativeFlashloan: 0n,
      dailyActiveUsers: INT_ZERO,
      dailyActiveDepositors: INT_ZERO,
      dailyActiveBorrowers: INT_ZERO,
      dailyActiveLiquidators: INT_ZERO,
      dailyActiveLiquidatees: INT_ZERO,
      dailyActiveTransferrers: INT_ZERO,
      dailyActiveFlashloaners: INT_ZERO,
      dailyDepositCount: INT_ZERO,
      dailyWithdrawCount: INT_ZERO,
      dailyBorrowCount: INT_ZERO,
      dailyRepayCount: INT_ZERO,
      dailyLiquidateCount: INT_ZERO,
      dailyTransferCount: INT_ZERO,
      dailyFlashloanCount: INT_ZERO,
      dailyActiveLendingPositionCount: INT_ZERO,
      dailyActiveBorrowingPositionCount: INT_ZERO,
      blockNumber: 0n,
      timestamp: 0n,
      inputTokenBalance: 0n,
      inputTokenPriceUSD: BIGDECIMAL_ZERO,
      outputTokenSupply: undefined,
      outputTokenPriceUSD: undefined,
      exchangeRate: undefined,
      rates: undefined,
      reserves: undefined,
      reserveFactor: undefined,
      variableBorrowedTokenBalance: undefined,
      totalValueLockedUSD: BIGDECIMAL_ZERO,
      cumulativeSupplySideRevenueUSD: BIGDECIMAL_ZERO,
      cumulativeProtocolSideRevenueUSD: BIGDECIMAL_ZERO,
      cumulativeTotalRevenueUSD: BIGDECIMAL_ZERO,
      revenueDetail_id: undefined,
      totalDepositBalanceUSD: BIGDECIMAL_ZERO,
      cumulativeDepositUSD: BIGDECIMAL_ZERO,
      totalBorrowBalanceUSD: BIGDECIMAL_ZERO,
      cumulativeBorrowUSD: BIGDECIMAL_ZERO,
      cumulativeLiquidateUSD: BIGDECIMAL_ZERO,
      cumulativeTransferUSD: BIGDECIMAL_ZERO,
      cumulativeFlashloanUSD: BIGDECIMAL_ZERO,
      positionCount: INT_ZERO,
      openPositionCount: INT_ZERO,
      closedPositionCount: INT_ZERO,
      lendingPositionCount: INT_ZERO,
      borrowingPositionCount: INT_ZERO,
    };
  }
  md = {
    ...md,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
    inputTokenBalance: market.inputTokenBalance,
    inputTokenPriceUSD: market.inputTokenPriceUSD,
    rates: market.rates
      ? await getSnapshotRates(context, market, market.rates.slice(), days.toString())
      : undefined,
    reserves: market.reserves,
    variableBorrowedTokenBalance: market.variableBorrowedTokenBalance,
    totalValueLockedUSD: market.totalValueLockedUSD,
    cumulativeSupplySideRevenueUSD: market.cumulativeSupplySideRevenueUSD,
    cumulativeProtocolSideRevenueUSD: market.cumulativeProtocolSideRevenueUSD,
    cumulativeTotalRevenueUSD: market.cumulativeTotalRevenueUSD,
    totalDepositBalanceUSD: market.totalDepositBalanceUSD,
    cumulativeDepositUSD: market.cumulativeDepositUSD,
    totalBorrowBalanceUSD: market.totalBorrowBalanceUSD,
    cumulativeBorrowUSD: market.cumulativeBorrowUSD,
    cumulativeLiquidateUSD: market.cumulativeLiquidateUSD,
    cumulativeTransferUSD: market.cumulativeTransferUSD,
    cumulativeFlashloanUSD: market.cumulativeFlashloanUSD,
    positionCount: market.positionCount,
    openPositionCount: market.openPositionCount,
    closedPositionCount: market.closedPositionCount,
    lendingPositionCount: market.lendingPositionCount,
    borrowingPositionCount: market.borrowingPositionCount,
  };
  context.MarketDailySnapshot.set(md);

  // ---- financials daily ----
  const fdId = hexConcat(i32Bytes(days));
  let fd = await context.FinancialsDailySnapshot.get(fdId);
  if (!fd) {
    fd = {
      id: fdId,
      days,
      protocol_id: protocol.id,
      dailySupplySideRevenueUSD: BIGDECIMAL_ZERO,
      dailyProtocolSideRevenueUSD: BIGDECIMAL_ZERO,
      dailyTotalRevenueUSD: BIGDECIMAL_ZERO,
      dailyDepositUSD: BIGDECIMAL_ZERO,
      dailyBorrowUSD: BIGDECIMAL_ZERO,
      dailyLiquidateUSD: BIGDECIMAL_ZERO,
      dailyWithdrawUSD: BIGDECIMAL_ZERO,
      dailyRepayUSD: BIGDECIMAL_ZERO,
      dailyTransferUSD: BIGDECIMAL_ZERO,
      dailyFlashloanUSD: BIGDECIMAL_ZERO,
      blockNumber: 0n,
      timestamp: 0n,
      totalValueLockedUSD: BIGDECIMAL_ZERO,
      cumulativeSupplySideRevenueUSD: BIGDECIMAL_ZERO,
      cumulativeProtocolSideRevenueUSD: BIGDECIMAL_ZERO,
      cumulativeTotalRevenueUSD: BIGDECIMAL_ZERO,
      revenueDetail_id: undefined,
      totalDepositBalanceUSD: BIGDECIMAL_ZERO,
      cumulativeDepositUSD: BIGDECIMAL_ZERO,
      totalBorrowBalanceUSD: BIGDECIMAL_ZERO,
      cumulativeBorrowUSD: BIGDECIMAL_ZERO,
      cumulativeLiquidateUSD: BIGDECIMAL_ZERO,
    };
  }
  fd = {
    ...fd,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
    totalValueLockedUSD: protocol.totalValueLockedUSD,
    cumulativeSupplySideRevenueUSD: protocol.cumulativeSupplySideRevenueUSD,
    cumulativeProtocolSideRevenueUSD: protocol.cumulativeProtocolSideRevenueUSD,
    cumulativeTotalRevenueUSD: protocol.cumulativeTotalRevenueUSD,
    totalDepositBalanceUSD: protocol.totalDepositBalanceUSD,
    cumulativeDepositUSD: protocol.cumulativeDepositUSD,
    totalBorrowBalanceUSD: protocol.totalBorrowBalanceUSD,
    cumulativeBorrowUSD: protocol.cumulativeBorrowUSD,
    cumulativeLiquidateUSD: protocol.cumulativeLiquidateUSD,
  };
  context.FinancialsDailySnapshot.set(fd);

  // ---- usage daily ----
  const udId = hexConcat(i32Bytes(days));
  let ud = await context.UsageMetricsDailySnapshot.get(udId);
  if (!ud) {
    ud = {
      id: udId,
      days,
      protocol_id: protocol.id,
      dailyActiveUsers: INT_ZERO,
      dailyActiveDepositors: INT_ZERO,
      dailyActiveBorrowers: INT_ZERO,
      dailyActiveLiquidators: INT_ZERO,
      dailyActiveLiquidatees: INT_ZERO,
      dailyTransactionCount: INT_ZERO,
      dailyDepositCount: INT_ZERO,
      dailyWithdrawCount: INT_ZERO,
      dailyBorrowCount: INT_ZERO,
      dailyRepayCount: INT_ZERO,
      dailyLiquidateCount: INT_ZERO,
      dailyTransferCount: INT_ZERO,
      dailyFlashloanCount: INT_ZERO,
      dailyActivePositions: INT_ZERO,
      cumulativeUniqueUsers: INT_ZERO,
      cumulativeUniqueDepositors: INT_ZERO,
      cumulativeUniqueBorrowers: INT_ZERO,
      cumulativeUniqueLiquidators: INT_ZERO,
      cumulativeUniqueLiquidatees: INT_ZERO,
      cumulativePositionCount: INT_ZERO,
      openPositionCount: INT_ZERO,
      totalPoolCount: INT_ZERO,
      blockNumber: 0n,
      timestamp: 0n,
    };
  }
  ud = {
    ...ud,
    cumulativeUniqueUsers: protocol.cumulativeUniqueUsers,
    cumulativeUniqueDepositors: protocol.cumulativeUniqueDepositors,
    cumulativeUniqueBorrowers: protocol.cumulativeUniqueBorrowers,
    cumulativeUniqueLiquidators: protocol.cumulativeUniqueLiquidators,
    cumulativeUniqueLiquidatees: protocol.cumulativeUniqueLiquidatees,
    cumulativePositionCount: protocol.cumulativePositionCount,
    openPositionCount: protocol.openPositionCount,
    totalPoolCount: protocol.totalPoolCount,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
  };
  context.UsageMetricsDailySnapshot.set(ud);

  // ---- usage hourly ----
  const uhId = hexConcat(i32Bytes(hours));
  let uh = await context.UsageMetricsHourlySnapshot.get(uhId);
  if (!uh) {
    uh = {
      id: uhId,
      hours,
      protocol_id: protocol.id,
      hourlyActiveUsers: INT_ZERO,
      hourlyTransactionCount: INT_ZERO,
      hourlyDepositCount: INT_ZERO,
      hourlyWithdrawCount: INT_ZERO,
      hourlyBorrowCount: INT_ZERO,
      hourlyRepayCount: INT_ZERO,
      hourlyLiquidateCount: INT_ZERO,
      cumulativeUniqueUsers: INT_ZERO,
      blockNumber: 0n,
      timestamp: 0n,
    };
  }
  uh = {
    ...uh,
    cumulativeUniqueUsers: protocol.cumulativeUniqueUsers,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
  };
  context.UsageMetricsHourlySnapshot.set(uh);

  return {
    marketHourly: mh,
    marketDaily: md,
    financial: fd,
    usageDaily: ud,
    usageHourly: uh,
    days,
    hours,
  };
}

export async function updateSnapshotUsageData(
  context: Context,
  snaps: SnapshotSet,
  market: Market,
  transactionType: string,
  account: string,
): Promise<void> {
  let ud = { ...snaps.usageDaily };
  let md = { ...snaps.marketDaily };
  let uh = { ...snaps.usageHourly };

  ud.dailyActiveUsers += await activityCounter(
    context, account, transactionType, false, snaps.days,
  );
  md.dailyActiveUsers += await activityCounter(
    context, account, transactionType, false, snaps.days, market.id,
  );
  uh.hourlyActiveUsers += await activityCounter(
    context, account, transactionType, false, snaps.hours,
  );
  if (
    transactionType === TransactionType.DEPOSIT ||
    transactionType === TransactionType.DEPOSIT_COLLATERAL
  ) {
    ud.dailyActiveDepositors += await activityCounter(
      context, account, transactionType, true, snaps.days,
    );
    md.dailyActiveDepositors += await activityCounter(
      context, account, transactionType, true, snaps.days, market.id,
    );
  }
  if (transactionType === TransactionType.BORROW) {
    ud.dailyActiveBorrowers += await activityCounter(
      context, account, transactionType, true, snaps.days,
    );
    md.dailyActiveBorrowers += await activityCounter(
      context, account, transactionType, true, snaps.days,
    );
  }
  if (transactionType === TransactionType.LIQUIDATOR) {
    ud.dailyActiveLiquidators += await activityCounter(
      context, account, transactionType, true, snaps.days,
    );
    md.dailyActiveLiquidators += await activityCounter(
      context, account, transactionType, true, snaps.days, market.id,
    );
  }
  if (transactionType === TransactionType.LIQUIDATEE) {
    ud.dailyActiveLiquidatees += await activityCounter(
      context, account, transactionType, true, snaps.days,
    );
    md.dailyActiveLiquidatees += await activityCounter(
      context, account, transactionType, true, snaps.days, market.id,
    );
  }
  if (transactionType === TransactionType.FLASHLOAN) {
    md.dailyActiveFlashloaners += await activityCounter(
      context, account, transactionType, true, snaps.days, market.id,
    );
  }
  context.MarketDailySnapshot.set(md);
  context.UsageMetricsDailySnapshot.set(ud);
  context.UsageMetricsHourlySnapshot.set(uh);
  snaps.usageDaily = ud;
  snaps.marketDaily = md;
  snaps.usageHourly = uh;
}

export function updateSnapshotTransactionData(
  context: Context,
  snaps: SnapshotSet,
  transactionType: string,
  amount: bigint,
  amountUSD: BigDecimal,
): void {
  let md = { ...snaps.marketDaily };
  let mh = { ...snaps.marketHourly };
  let fd = { ...snaps.financial };
  let ud = { ...snaps.usageDaily };
  let uh = { ...snaps.usageHourly };

  if (
    transactionType === TransactionType.DEPOSIT ||
    transactionType === TransactionType.DEPOSIT_COLLATERAL
  ) {
    md.dailyDepositUSD = md.dailyDepositUSD.plus(amountUSD);
    md.dailyNativeDeposit = md.dailyNativeDeposit + amount;
    mh.hourlyDepositUSD = mh.hourlyDepositUSD.plus(amountUSD);
    fd.dailyDepositUSD = fd.dailyDepositUSD.plus(amountUSD);
    ud.dailyDepositCount += INT_ONE;
    uh.hourlyDepositCount += INT_ONE;
  } else if (
    transactionType === TransactionType.WITHDRAW ||
    transactionType === TransactionType.WITHDRAW_COLLATERAL
  ) {
    md.dailyWithdrawUSD = md.dailyWithdrawUSD.plus(amountUSD);
    md.dailyNativeWithdraw = md.dailyNativeWithdraw + amount;
    mh.hourlyWithdrawUSD = mh.hourlyWithdrawUSD.plus(amountUSD);
    fd.dailyWithdrawUSD = fd.dailyWithdrawUSD.plus(amountUSD);
    ud.dailyWithdrawCount += INT_ONE;
    uh.hourlyWithdrawCount += INT_ONE;
  } else if (transactionType === TransactionType.BORROW) {
    md.dailyBorrowUSD = md.dailyBorrowUSD.plus(amountUSD);
    md.dailyNativeBorrow = md.dailyNativeBorrow + amount;
    mh.hourlyBorrowUSD = mh.hourlyBorrowUSD.plus(amountUSD);
    fd.dailyBorrowUSD = fd.dailyBorrowUSD.plus(amountUSD);
    ud.dailyBorrowCount += INT_ONE;
    uh.hourlyBorrowCount += INT_ONE;
  } else if (transactionType === TransactionType.REPAY) {
    md.dailyRepayUSD = md.dailyRepayUSD.plus(amountUSD);
    md.dailyNativeRepay = md.dailyNativeRepay + amount;
    mh.hourlyRepayUSD = mh.hourlyRepayUSD.plus(amountUSD);
    fd.dailyRepayUSD = fd.dailyRepayUSD.plus(amountUSD);
    ud.dailyRepayCount += INT_ONE;
    uh.hourlyRepayCount += INT_ONE;
  } else if (transactionType === TransactionType.LIQUIDATE) {
    md.dailyLiquidateUSD = md.dailyLiquidateUSD.plus(amountUSD);
    md.dailyNativeLiquidate = md.dailyNativeLiquidate + amount;
    mh.hourlyLiquidateUSD = mh.hourlyLiquidateUSD.plus(amountUSD);
    fd.dailyLiquidateUSD = fd.dailyLiquidateUSD.plus(amountUSD);
    ud.dailyLiquidateCount += INT_ONE;
    uh.hourlyLiquidateCount += INT_ONE;
  } else if (transactionType === TransactionType.FLASHLOAN) {
    md.dailyFlashloanUSD = md.dailyFlashloanUSD.plus(amountUSD);
    md.dailyNativeFlashloan = md.dailyNativeFlashloan + amount;
    mh.hourlyFlashloanUSD = mh.hourlyFlashloanUSD.plus(amountUSD);
    fd.dailyFlashloanUSD = fd.dailyFlashloanUSD.plus(amountUSD);
    ud.dailyFlashloanCount += INT_ONE;
  } else {
    return;
  }
  ud.dailyTransactionCount += INT_ONE;
  uh.hourlyTransactionCount += INT_ONE;

  context.UsageMetricsDailySnapshot.set(ud);
  context.UsageMetricsHourlySnapshot.set(uh);
  context.MarketDailySnapshot.set(md);
  context.MarketHourlySnapshot.set(mh);
  context.FinancialsDailySnapshot.set(fd);
  snaps.marketDaily = md;
  snaps.marketHourly = mh;
  snaps.financial = fd;
  snaps.usageDaily = ud;
  snaps.usageHourly = uh;
}

/**
 * addDailyActivePosition (called from position.ts). Creates a fresh snapshot
 * set for the event, bumps the daily active lending/borrowing position count.
 */
export async function addDailyActivePosition(
  context: Context,
  market: Market,
  event: Ev,
  side: string,
): Promise<void> {
  const snaps = await createSnapshots(context, market, event);
  let md = { ...snaps.marketDaily };
  if (side === PositionSide.BORROWER) {
    md.dailyActiveBorrowingPositionCount += INT_ONE;
  }
  if (side === PositionSide.COLLATERAL || side === PositionSide.SUPPLIER) {
    md.dailyActiveLendingPositionCount += INT_ONE;
  }
  context.MarketDailySnapshot.set(md);
}
