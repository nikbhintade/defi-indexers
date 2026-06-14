/**
 * Port of src/stats.ts (BorrowerStats + ClearinghouseCumulativeStats
 * accounting). The graph-node `log.error` validation branches are preserved as
 * comments / no-op guards (they never mutate persisted state except the one
 * "Fix the state" line, which is kept).
 */
import { BigDecimal } from "envio";
import type { BorrowerStats, ClearinghouseCumulativeStats } from "envio";
import { low, ZERO_BD } from "../utils";

export type StatsCtx = {
  BorrowerStats: { get: (id: string) => Promise<BorrowerStats | undefined>; set: (e: BorrowerStats) => void };
  ClearinghouseCumulativeStats: {
    get: (id: string) => Promise<ClearinghouseCumulativeStats | undefined>;
    set: (e: ClearinghouseCumulativeStats) => void;
  };
};

export async function getBorrowerStats(
  context: StatsCtx,
  borrower: string,
  clearinghouse: string,
): Promise<BorrowerStats> {
  const id = low(borrower);
  const existing = await context.BorrowerStats.get(id);
  if (existing !== undefined) return existing;
  return {
    id,
    borrower: id,
    clearinghouse_id: clearinghouse,
    totalLoans: 0,
    totalDefaultedLoans: 0,
    totalRepaidLoans: 0,
    activeLoans: 0,
    maxActiveLoans: 0,
    maxBorrowedValue: ZERO_BD,
    currentBorrowed: ZERO_BD,
    currentInterestDue: ZERO_BD,
    currentCollateral: ZERO_BD,
    totalLoanExtensions: 0,
    lastUpdateBlock: 0n,
    lastUpdateTimestamp: 0n,
  };
}

export async function getOrCreateCumulativeStats(
  context: StatsCtx,
  clearinghouse: string,
): Promise<ClearinghouseCumulativeStats> {
  const existing = await context.ClearinghouseCumulativeStats.get(clearinghouse);
  if (existing !== undefined) return existing;
  return {
    id: clearinghouse,
    clearinghouse_id: clearinghouse,
    totalUniqueBorrowers: 0,
    totalLoopers: 0,
    currentActiveBorrowers: 0,
    currentActiveLoopers: 0,
    totalLoans: 0,
    currentActiveLoans: 0,
    totalDefaultedLoans: 0,
    totalRepaidLoans: 0,
    totalLoanExtensions: 0,
    lastUpdateBlock: 0n,
    lastUpdateTimestamp: 0n,
  };
}

export async function updateBorrowerStats(
  context: StatsCtx,
  clearinghouse: string,
  borrower: string,
  isNewLoan: boolean,
  isActive: boolean,
  isNewDefault: boolean,
  isNewRepayment: boolean,
  block: bigint,
  timestamp: bigint,
  principalDelta: BigDecimal,
  interestDelta: BigDecimal,
  collateralDelta: BigDecimal,
): Promise<void> {
  const stats = { ...(await getOrCreateCumulativeStats(context, clearinghouse)) };
  const borrowerStats = { ...(await getBorrowerStats(context, borrower, clearinghouse)) };

  borrowerStats.currentBorrowed = borrowerStats.currentBorrowed.plus(principalDelta);
  borrowerStats.currentInterestDue = borrowerStats.currentInterestDue.plus(interestDelta);
  borrowerStats.currentCollateral = borrowerStats.currentCollateral.plus(collateralDelta);

  if (isNewLoan) {
    stats.totalLoans += 1;
    stats.currentActiveLoans += 1;

    if (borrowerStats.totalLoans === 0) {
      stats.totalUniqueBorrowers += 1;
    } else if (borrowerStats.totalLoans === 1) {
      stats.totalLoopers += 1;
    }

    borrowerStats.totalLoans += 1;
    borrowerStats.activeLoans += 1;

    if (borrowerStats.activeLoans === 1) {
      stats.currentActiveBorrowers += 1;
    } else if (borrowerStats.activeLoans === 2) {
      stats.currentActiveLoopers += 1;
    }

    if (borrowerStats.activeLoans > borrowerStats.maxActiveLoans) {
      borrowerStats.maxActiveLoans = borrowerStats.activeLoans;
    }

    const currentValue = borrowerStats.currentBorrowed;
    if (currentValue.gt(borrowerStats.maxBorrowedValue)) {
      borrowerStats.maxBorrowedValue = currentValue;
    }
  }

  if (!isActive) {
    if (stats.currentActiveLoans > 0) {
      stats.currentActiveLoans -= 1;
    }
    if (borrowerStats.activeLoans > 0) {
      borrowerStats.activeLoans -= 1;
      if (borrowerStats.activeLoans === 0) {
        if (stats.currentActiveBorrowers > 0) {
          stats.currentActiveBorrowers -= 1;
        }
        if (stats.currentActiveLoopers > 0 && borrowerStats.totalLoans > 1) {
          stats.currentActiveLoopers -= 1;
        }
      }
    }
  }

  // Preserved "Fix the state" guard from the subgraph (the only validation
  // branch that mutates persisted state).
  if (stats.currentActiveBorrowers > stats.currentActiveLoans) {
    stats.currentActiveBorrowers = stats.currentActiveLoans;
  }

  if (isNewDefault) {
    if (stats.currentActiveLoans >= 0) {
      stats.totalDefaultedLoans += 1;
      borrowerStats.totalDefaultedLoans += 1;
    }
  } else if (isNewRepayment) {
    if (stats.currentActiveLoans >= 0) {
      if (
        stats.totalRepaidLoans + 1 <= stats.totalLoans &&
        borrowerStats.totalRepaidLoans + 1 <= borrowerStats.totalLoans
      ) {
        stats.totalRepaidLoans += 1;
        borrowerStats.totalRepaidLoans += 1;
      }
      // else: subgraph only logs an error, no state change.
    }
  }

  stats.lastUpdateBlock = block;
  stats.lastUpdateTimestamp = timestamp;
  borrowerStats.lastUpdateBlock = block;
  borrowerStats.lastUpdateTimestamp = timestamp;

  context.ClearinghouseCumulativeStats.set(stats);
  context.BorrowerStats.set(borrowerStats);
}

export async function updateLoanExtensionStats(
  context: StatsCtx,
  clearinghouse: string,
  borrower: string,
  newInterest: BigDecimal,
  block: bigint,
  timestamp: bigint,
): Promise<void> {
  const stats = { ...(await getOrCreateCumulativeStats(context, clearinghouse)) };
  const borrowerStats = { ...(await getBorrowerStats(context, borrower, clearinghouse)) };

  stats.totalLoanExtensions += 1;
  borrowerStats.totalLoanExtensions += 1;
  borrowerStats.currentInterestDue = borrowerStats.currentInterestDue.plus(newInterest);

  stats.lastUpdateBlock = block;
  stats.lastUpdateTimestamp = timestamp;
  borrowerStats.lastUpdateBlock = block;
  borrowerStats.lastUpdateTimestamp = timestamp;

  context.ClearinghouseCumulativeStats.set(stats);
  context.BorrowerStats.set(borrowerStats);
}
