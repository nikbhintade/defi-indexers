/**
 * Ported from liquity/dev packages/subgraph/src/entities/StabilityDeposit.ts.
 * StabilityDeposit id = depositor address (lowercase hex).
 */
import { BigDecimal } from "envio";
import type { EvmOnEventContext as handlerContext, StabilityDeposit, StabilityDepositChange } from "envio";

import { decimalize, DECIMAL_ZERO, BIGINT_ZERO } from "../utils/bignumbers";
import { a } from "../utils/constants";

import { beginChange, initChange, finishChange, type ChangeCommon } from "./Change";
import { getUser } from "./User";
import { updateSystemStateByStabilityDepositChange } from "./SystemState";

async function getStabilityDeposit(
  context: handlerContext,
  _user: string,
): Promise<StabilityDeposit> {
  const id = a(_user);
  const stabilityDepositOrNull = await context.StabilityDeposit.get(id);

  if (stabilityDepositOrNull != null) {
    return stabilityDepositOrNull;
  } else {
    const owner = await getUser(context, _user);
    const newStabilityDeposit: StabilityDeposit = {
      id,
      owner_id: owner.id,
      depositedAmount: DECIMAL_ZERO,
      frontend_id: undefined,
    };
    context.User.set({ ...owner, stabilityDeposit_id: newStabilityDeposit.id });
    return newStabilityDeposit;
  }
}

async function createStabilityDepositChange(
  context: handlerContext,
  event: ChangeCommon,
): Promise<StabilityDepositChange> {
  const sequenceNumber = await beginChange(context);
  const base = await initChange(context, event, sequenceNumber);
  return {
    id: sequenceNumber.toString(),
    sequenceNumber,
    transaction_id: base.transaction_id,
    systemStateBefore_id: base.systemStateBefore_id,
    systemStateAfter_id: base.systemStateBefore_id, // set in finish
    stabilityDeposit_id: "",
    stabilityDepositOperation: "depositTokens",
    depositedAmountBefore: DECIMAL_ZERO,
    depositedAmountChange: DECIMAL_ZERO,
    depositedAmountAfter: DECIMAL_ZERO,
    collateralGain: undefined,
  };
}

async function finishStabilityDepositChange(
  context: handlerContext,
  change: StabilityDepositChange,
): Promise<void> {
  const after = await finishChange(context);
  context.StabilityDepositChange.set({ ...change, systemStateAfter_id: after });
}

/**
 * Mutates the stabilityDeposit and writes a StabilityDepositChange.
 * Returns the updated (but not yet persisted) deposit so the caller can persist.
 */
async function updateStabilityDepositByOperation(
  context: handlerContext,
  event: ChangeCommon,
  stabilityDeposit: StabilityDeposit,
  operation: string,
  newDepositedAmount: BigDecimal,
  collateralGain: BigDecimal | null = null,
): Promise<StabilityDeposit> {
  let change = await createStabilityDepositChange(context, event);

  change = {
    ...change,
    stabilityDeposit_id: stabilityDeposit.id,
    stabilityDepositOperation: operation as StabilityDepositChange["stabilityDepositOperation"],
    depositedAmountBefore: stabilityDeposit.depositedAmount,
  };

  const updatedDeposit: StabilityDeposit = {
    ...stabilityDeposit,
    depositedAmount: newDepositedAmount,
  };

  change = {
    ...change,
    depositedAmountAfter: updatedDeposit.depositedAmount,
    depositedAmountChange: updatedDeposit.depositedAmount.minus(change.depositedAmountBefore),
  };

  if (collateralGain != null) {
    change = { ...change, collateralGain };
  }

  await updateSystemStateByStabilityDepositChange(context, change);
  await finishStabilityDepositChange(context, change);

  return updatedDeposit;
}

export async function updateStabilityDeposit(
  context: handlerContext,
  event: ChangeCommon,
  _user: string,
  _amount: bigint,
): Promise<void> {
  let stabilityDeposit = await getStabilityDeposit(context, _user);
  const newDepositedAmount = decimalize(_amount);
  const owner = await getUser(context, _user);

  if (newDepositedAmount.eq(stabilityDeposit.depositedAmount)) {
    // Don't create a StabilityDepositChange when there's no change.
    // It means user only wanted to withdraw collateral gains.
    return;
  }

  if (owner.frontend_id != stabilityDeposit.frontend_id) {
    // FrontEndTagSet is emitted just before UserDepositChanged; it sets
    // owner.frontend, so we can use that here.
    stabilityDeposit = { ...stabilityDeposit, frontend_id: owner.frontend_id };
  }

  stabilityDeposit = await updateStabilityDepositByOperation(
    context,
    event,
    stabilityDeposit,
    newDepositedAmount.gt(stabilityDeposit.depositedAmount) ? "depositTokens" : "withdrawTokens",
    newDepositedAmount,
  );

  context.StabilityDeposit.set(stabilityDeposit);
}

export async function withdrawCollateralGainFromStabilityDeposit(
  context: handlerContext,
  event: ChangeCommon,
  _user: string,
  _ETH: bigint,
  _LUSDLoss: bigint,
): Promise<void> {
  if (_ETH === BIGINT_ZERO && _LUSDLoss === BIGINT_ZERO) {
    // Ignore "NOP" event
    return;
  }

  let stabilityDeposit = await getStabilityDeposit(context, _user);
  const depositLoss = decimalize(_LUSDLoss);
  const newDepositedAmount = stabilityDeposit.depositedAmount.minus(depositLoss);

  stabilityDeposit = await updateStabilityDepositByOperation(
    context,
    event,
    stabilityDeposit,
    "withdrawCollateralGain",
    newDepositedAmount,
    decimalize(_ETH),
  );

  context.StabilityDeposit.set(stabilityDeposit);
}
