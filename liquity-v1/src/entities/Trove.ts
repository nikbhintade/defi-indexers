/**
 * Ported from liquity/dev packages/subgraph/src/entities/Trove.ts.
 * Trove id = owner address (lowercase hex).
 */
import { BigDecimal } from "envio";
import type { EvmOnEventContext as handlerContext, Trove, TroveChange } from "envio";

import {
  decimalize,
  BIGINT_SCALING_FACTOR,
  BIGINT_ZERO,
  DECIMAL_ZERO,
} from "../utils/bignumbers";
import { a } from "../utils/constants";
import { calculateCollateralRatio } from "../utils/collateralRatio";

import { isLiquidation, isRedemption } from "../types/TroveOperation";

import {
  decreaseNumberOfLiquidatedTroves,
  decreaseNumberOfRedeemedTroves,
  decreaseNumberOfTrovesClosedByOwner,
  increaseNumberOfLiquidatedTroves,
  increaseNumberOfRedeemedTroves,
  increaseNumberOfOpenTroves,
  increaseNumberOfTrovesClosedByOwner,
  getLastChangeSequenceNumber,
  getGlobal,
} from "./Global";
import { beginChange, initChange, finishChange, type ChangeCommon } from "./Change";
import { getCurrentPrice, updateSystemStateByTroveChange } from "./SystemState";
import { getCurrentLiquidation } from "./Liquidation";
import { getCurrentRedemption } from "./Redemption";
import { getUser } from "./User";

async function getTrove(context: handlerContext, _user: string): Promise<Trove> {
  const id = a(_user);
  const troveOrNull = await context.Trove.get(id);

  if (troveOrNull != null) {
    return troveOrNull;
  } else {
    const owner = await getUser(context, _user);
    const newTrove: Trove = {
      id,
      owner_id: owner.id,
      collateral: DECIMAL_ZERO,
      debt: DECIMAL_ZERO,
      // Avoid using setTroveStatus, because newTrove's status is not yet initialized
      status: "open",
      rawCollateral: BIGINT_ZERO,
      rawDebt: BIGINT_ZERO,
      rawStake: BIGINT_ZERO,
      rawSnapshotOfTotalRedistributedCollateral: BIGINT_ZERO,
      rawSnapshotOfTotalRedistributedDebt: BIGINT_ZERO,
      collateralRatioSortKey: undefined,
    };
    await increaseNumberOfOpenTroves(context);

    context.User.set({ ...owner, trove_id: newTrove.id });

    return newTrove;
  }
}

/** Mutates+persists a trove's status, keeping the global counters in sync. */
async function setTroveStatus(
  context: handlerContext,
  trove: Trove,
  status: string,
): Promise<Trove> {
  const statusBefore = trove.status;

  if (status !== statusBefore) {
    if (status === "open") {
      if (statusBefore === "closedByOwner") {
        await decreaseNumberOfTrovesClosedByOwner(context);
      } else if (statusBefore === "closedByLiquidation") {
        await decreaseNumberOfLiquidatedTroves(context);
      } else if (statusBefore === "closedByRedemption") {
        await decreaseNumberOfRedeemedTroves(context);
      }
    } else if (status === "closedByOwner") {
      await increaseNumberOfTrovesClosedByOwner(context);
    } else if (status === "closedByLiquidation") {
      await increaseNumberOfLiquidatedTroves(context);
    } else if (status === "closedByRedemption") {
      await increaseNumberOfRedeemedTroves(context);
    }

    return { ...trove, status: status as Trove["status"] };
  }

  return trove;
}

async function createTroveChange(
  context: handlerContext,
  event: ChangeCommon,
): Promise<TroveChange> {
  const sequenceNumber = await beginChange(context);
  const base = await initChange(context, event, sequenceNumber);
  return {
    id: sequenceNumber.toString(),
    sequenceNumber,
    transaction_id: base.transaction_id,
    systemStateBefore_id: base.systemStateBefore_id,
    systemStateAfter_id: base.systemStateBefore_id, // set in finish
    trove_id: "",
    troveOperation: "openTrove",
    collateralBefore: DECIMAL_ZERO,
    collateralChange: DECIMAL_ZERO,
    collateralAfter: DECIMAL_ZERO,
    debtBefore: DECIMAL_ZERO,
    debtChange: DECIMAL_ZERO,
    debtAfter: DECIMAL_ZERO,
    borrowingFee: undefined,
    collateralRatioBefore: undefined,
    collateralRatioAfter: undefined,
    liquidation_id: undefined,
    redemption_id: undefined,
  };
}

async function finishTroveChange(
  context: handlerContext,
  troveChange: TroveChange,
): Promise<void> {
  const after = await finishChange(context);
  context.TroveChange.set({ ...troveChange, systemStateAfter_id: after });
}

export async function updateTrove(
  context: handlerContext,
  event: ChangeCommon & { transaction: { from: string | undefined } },
  operation: string,
  _borrower: string,
  _coll: bigint,
  _debt: bigint,
  stake: bigint,
): Promise<void> {
  const global = await getGlobal(context);
  let trove = await getTrove(context, _borrower);
  const newCollateral = decimalize(_coll);
  const newDebt = decimalize(_debt);

  if (newCollateral.eq(trove.collateral) && newDebt.eq(trove.debt)) {
    return;
  }

  let troveChange = await createTroveChange(context, event);
  const price = await getCurrentPrice(context);

  troveChange = {
    ...troveChange,
    trove_id: trove.id,
    troveOperation: operation as TroveChange["troveOperation"],
    collateralBefore: trove.collateral,
    debtBefore: trove.debt,
    collateralRatioBefore: calculateCollateralRatio(trove.collateral, trove.debt, price) ?? undefined,
  };

  trove = { ...trove, collateral: newCollateral, debt: newDebt };

  troveChange = {
    ...troveChange,
    collateralAfter: trove.collateral,
    debtAfter: trove.debt,
    collateralRatioAfter: calculateCollateralRatio(trove.collateral, trove.debt, price) ?? undefined,
  };

  troveChange = {
    ...troveChange,
    collateralChange: troveChange.collateralAfter.minus(troveChange.collateralBefore),
    debtChange: troveChange.debtAfter.minus(troveChange.debtBefore),
  };

  if (isLiquidation(operation)) {
    const currentLiquidation = await getCurrentLiquidation(context, event);
    troveChange = { ...troveChange, liquidation_id: currentLiquidation.id };
  }

  if (isRedemption(operation)) {
    const currentRedemption = await getCurrentRedemption(context, event);
    troveChange = { ...troveChange, redemption_id: currentRedemption.id };
  }

  await updateSystemStateByTroveChange(context, troveChange);
  await finishTroveChange(context, troveChange);

  trove = {
    ...trove,
    rawCollateral: _coll,
    rawDebt: _debt,
    rawStake: stake,
  };

  if (stake !== BIGINT_ZERO) {
    trove = {
      ...trove,
      rawSnapshotOfTotalRedistributedCollateral: global.rawTotalRedistributedCollateral,
      rawSnapshotOfTotalRedistributedDebt: global.rawTotalRedistributedDebt,
      collateralRatioSortKey:
        (_debt * BIGINT_SCALING_FACTOR) / stake - global.rawTotalRedistributedDebt,
    };
  } else {
    trove = {
      ...trove,
      rawSnapshotOfTotalRedistributedCollateral: BIGINT_ZERO,
      rawSnapshotOfTotalRedistributedDebt: BIGINT_ZERO,
      collateralRatioSortKey: undefined,
    };
  }

  if (_coll === BIGINT_ZERO) {
    if (isLiquidation(operation)) {
      trove = await setTroveStatus(context, trove, "closedByLiquidation");
    } else if (isRedemption(operation)) {
      trove = await setTroveStatus(context, trove, "closedByRedemption");
    } else {
      trove = await setTroveStatus(context, trove, "closedByOwner");
    }
  } else {
    trove = await setTroveStatus(context, trove, "open");
  }

  context.Trove.set(trove);
}

export async function setBorrowingFeeOfLastTroveChange(
  context: handlerContext,
  _LUSDFee: bigint,
): Promise<void> {
  const lastChangeSequenceNumber = await getLastChangeSequenceNumber(context);

  const lastTroveChange = await context.TroveChange.get(lastChangeSequenceNumber.toString());
  if (lastTroveChange != null) {
    context.TroveChange.set({ ...lastTroveChange, borrowingFee: decimalize(_LUSDFee) });
  }
}

export async function applyRedistributionToTroveBeforeLiquidation(
  context: handlerContext,
  event: ChangeCommon & { transaction: { from: string | undefined } },
  _borrower: string,
): Promise<void> {
  const global = await getGlobal(context);
  const trove = await getTrove(context, _borrower);

  const redistributedCollateral =
    ((global.rawTotalRedistributedCollateral - trove.rawSnapshotOfTotalRedistributedCollateral) *
      trove.rawStake) /
    BIGINT_SCALING_FACTOR;

  const redistributedDebt =
    ((global.rawTotalRedistributedDebt - trove.rawSnapshotOfTotalRedistributedDebt) *
      trove.rawStake) /
    BIGINT_SCALING_FACTOR;

  await updateTrove(
    context,
    event,
    "accrueRewards",
    _borrower,
    trove.rawCollateral + redistributedCollateral,
    trove.rawDebt + redistributedDebt,
    BIGINT_ZERO, // No need to calculate new stake, because we know the Trove is being liquidated
  );
}

export { BigDecimal };
