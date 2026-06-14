/**
 * Ported from liquity/dev packages/subgraph/src/types/TroveOperation.ts.
 *
 * On-chain `operation` params are uint8 -> delivered by HyperIndex as bigint.
 * The enum ordinals match the Liquity contracts:
 *   BorrowerOperation { openTrove=0, closeTrove=1, adjustTrove=2 }
 *   TroveManagerOperation { applyPendingRewards=0, liquidateInNormalMode=1,
 *                           liquidateInRecoveryMode=2, redeemCollateral=3 }
 */

export function getTroveOperationFromBorrowerOperation(operation: bigint): string {
  switch (operation) {
    case 0n:
      return "openTrove";
    case 1n:
      return "closeTrove";
    case 2n:
      return "adjustTrove";
  }
  return "unreached";
}

export function isBorrowerOperation(troveOperation: string): boolean {
  return (
    troveOperation === "openTrove" ||
    troveOperation === "closeTrove" ||
    troveOperation === "adjustTrove"
  );
}

export function getTroveOperationFromTroveManagerOperation(operation: bigint): string {
  switch (operation) {
    case 0n:
      return "accrueRewards";
    case 1n:
      return "liquidateInNormalMode";
    case 2n:
      return "liquidateInRecoveryMode";
    case 3n:
      return "redeemCollateral";
  }
  return "unreached";
}

export function isLiquidation(troveOperation: string): boolean {
  return (
    troveOperation === "liquidateInNormalMode" ||
    troveOperation === "liquidateInRecoveryMode"
  );
}

export function isRecoveryModeLiquidation(troveOperation: string): boolean {
  return troveOperation === "liquidateInRecoveryMode";
}

export function isRedemption(troveOperation: string): boolean {
  return troveOperation === "redeemCollateral";
}
