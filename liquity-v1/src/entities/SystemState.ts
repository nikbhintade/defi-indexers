/**
 * Ported from liquity/dev packages/subgraph/src/entities/SystemState.ts.
 *
 * SystemState is an append-on-mutate snapshot chain. `bumpSystemState` mutates
 * the entity's id to a fresh sequenceNumber and repoints Global.currentSystemState,
 * leaving the previous snapshot frozen under its old id (the subgraph relies on
 * graph-node treating an id change as "insert a new row"). We replicate this by
 * writing a NEW SystemState row under the new id and updating the pointer; the
 * old row already exists under its old id.
 */
import { BigDecimal } from "envio";
import type {
  EvmOnEventContext as handlerContext,
  SystemState,
  PriceChange,
  TroveChange,
  StabilityDepositChange,
  CollSurplusChange,
  LqtyStakeChange,
} from "envio";

import {
  decimalize,
  DECIMAL_ZERO,
  DECIMAL_ONE,
  DECIMAL_COLLATERAL_GAS_COMPENSATION_DIVISOR,
  DECIMAL_PRECISION,
  truncate,
} from "../utils/bignumbers";

import { calculateCollateralRatio } from "../utils/collateralRatio";

import {
  isBorrowerOperation,
  isRedemption,
  isLiquidation,
  isRecoveryModeLiquidation,
} from "../types/TroveOperation";

import { getGlobal, getSystemStateSequenceNumber } from "./Global";
import { beginChange, initChange, finishChange, type ChangeCommon } from "./Change";

export async function getCurrentSystemState(context: handlerContext): Promise<SystemState> {
  const currentSystemStateId = (await getGlobal(context)).currentSystemState_id;
  let currentSystemStateOrNull =
    currentSystemStateId != null ? await context.SystemState.get(currentSystemStateId) : undefined;

  if (currentSystemStateOrNull == null) {
    const sequenceNumber = await getSystemStateSequenceNumber(context);
    const newSystemState: SystemState = {
      id: sequenceNumber.toString(),
      sequenceNumber,
      price: undefined,
      totalCollateral: DECIMAL_ZERO,
      totalDebt: DECIMAL_ZERO,
      totalCollateralRatio: undefined,
      tokensInStabilityPool: DECIMAL_ZERO,
      collSurplusPoolBalance: DECIMAL_ZERO,
      totalLQTYTokensStaked: DECIMAL_ZERO,
    };
    context.SystemState.set(newSystemState);

    const global = await getGlobal(context);
    context.Global.set({ ...global, currentSystemState_id: newSystemState.id });

    currentSystemStateOrNull = newSystemState;
  }

  return currentSystemStateOrNull;
}

async function bumpSystemState(
  context: handlerContext,
  systemState: SystemState,
): Promise<void> {
  const sequenceNumber = await getSystemStateSequenceNumber(context);
  const bumped: SystemState = {
    ...systemState,
    id: sequenceNumber.toString(),
    sequenceNumber,
  };
  context.SystemState.set(bumped);

  const global = await getGlobal(context);
  context.Global.set({ ...global, currentSystemState_id: bumped.id });
}

export async function getCurrentPrice(context: handlerContext): Promise<BigDecimal> {
  const currentSystemState = await getCurrentSystemState(context);
  // The backend always starts with fetching the latest price, so
  // LastGoodPriceUpdated is the first event emitted; by the time we need the
  // price it has been initialized.
  return currentSystemState.price!;
}

async function createPriceChange(
  context: handlerContext,
  event: ChangeCommon,
): Promise<PriceChange> {
  const sequenceNumber = await beginChange(context);
  const base = await initChange(context, event, sequenceNumber);
  return {
    id: sequenceNumber.toString(),
    sequenceNumber,
    transaction_id: base.transaction_id,
    systemStateBefore_id: base.systemStateBefore_id,
    systemStateAfter_id: base.systemStateBefore_id, // placeholder; set by finishChange
    priceChange: DECIMAL_ZERO,
  };
}

async function finishPriceChange(
  context: handlerContext,
  priceChange: PriceChange,
): Promise<void> {
  const after = await finishChange(context);
  context.PriceChange.set({ ...priceChange, systemStateAfter_id: after });
}

/*
 * Update SystemState through a PriceChange if _lastGoodPrice is different from
 * the last recorded price.
 */
export async function updatePrice(
  context: handlerContext,
  event: ChangeCommon,
  _lastGoodPrice: bigint,
): Promise<void> {
  const systemState = await getCurrentSystemState(context);
  const oldPriceOrNull = systemState.price;
  const newPrice = decimalize(_lastGoodPrice);

  if (oldPriceOrNull == null) {
    // On first price event, just initialize price without creating a change.
    context.SystemState.set({ ...systemState, price: newPrice });
    return;
  }

  const oldPrice = oldPriceOrNull;

  if (!newPrice.eq(oldPrice)) {
    let priceChange = await createPriceChange(context, event);

    const updated = { ...systemState, price: newPrice };
    await bumpSystemState(context, updated);

    priceChange = { ...priceChange, priceChange: newPrice.minus(oldPrice) };
    await finishPriceChange(context, priceChange);
  }
}

function tryToOffsetWithTokensFromStabilityPool(
  systemState: SystemState,
  collateralToLiquidate: BigDecimal,
  debtToLiquidate: BigDecimal,
): SystemState {
  if (debtToLiquidate.lte(systemState.tokensInStabilityPool)) {
    // Completely offset
    return {
      ...systemState,
      totalCollateral: systemState.totalCollateral.minus(collateralToLiquidate),
      totalDebt: systemState.totalDebt.minus(debtToLiquidate),
      tokensInStabilityPool: systemState.tokensInStabilityPool.minus(debtToLiquidate),
    };
  } else if (systemState.tokensInStabilityPool.gt(DECIMAL_ZERO)) {
    // Partially offset, emptying the pool
    return {
      ...systemState,
      totalCollateral: systemState.totalCollateral.minus(
        truncate(
          collateralToLiquidate
            .times(systemState.tokensInStabilityPool)
            .div(debtToLiquidate),
          DECIMAL_PRECISION,
        ),
      ),
      totalDebt: systemState.totalDebt.minus(systemState.tokensInStabilityPool),
      tokensInStabilityPool: DECIMAL_ZERO,
    };
  } else {
    // Empty pool
    return systemState;
  }
}

export async function updateSystemStateByTroveChange(
  context: handlerContext,
  troveChange: TroveChange,
): Promise<void> {
  let systemState = await getCurrentSystemState(context);
  const operation = troveChange.troveOperation;

  if (isBorrowerOperation(operation) || isRedemption(operation)) {
    systemState = {
      ...systemState,
      totalCollateral: systemState.totalCollateral.plus(troveChange.collateralChange),
      totalDebt: systemState.totalDebt.plus(troveChange.debtChange),
    };
  } else if (isLiquidation(operation)) {
    const collateral = troveChange.collateralBefore;
    const debt = troveChange.debtBefore;
    const collateralGasCompensation = truncate(
      collateral.div(DECIMAL_COLLATERAL_GAS_COMPENSATION_DIVISOR),
      DECIMAL_PRECISION,
    );

    systemState = {
      ...systemState,
      totalCollateral: systemState.totalCollateral.minus(collateralGasCompensation),
    };

    if (
      !isRecoveryModeLiquidation(operation) ||
      (troveChange.collateralRatioBefore != null &&
        troveChange.collateralRatioBefore.gt(DECIMAL_ONE))
    ) {
      systemState = tryToOffsetWithTokensFromStabilityPool(
        systemState,
        collateral.minus(collateralGasCompensation),
        debt,
      );
    }
  }

  systemState = {
    ...systemState,
    totalCollateralRatio:
      calculateCollateralRatio(
        systemState.totalCollateral,
        systemState.totalDebt,
        systemState.price!, // A trove change is guaranteed to be preceded by a price update
      ) ?? undefined,
  };

  await bumpSystemState(context, systemState);
}

export async function updateSystemStateByStabilityDepositChange(
  context: handlerContext,
  stabilityDepositChange: StabilityDepositChange,
): Promise<void> {
  let systemState = await getCurrentSystemState(context);
  const operation = stabilityDepositChange.stabilityDepositOperation;

  if (operation === "depositTokens" || operation === "withdrawTokens") {
    systemState = {
      ...systemState,
      tokensInStabilityPool: systemState.tokensInStabilityPool.plus(
        stabilityDepositChange.depositedAmountChange,
      ),
    };
  }

  await bumpSystemState(context, systemState);
}

export async function updateSystemStateByCollSurplusChange(
  context: handlerContext,
  collSurplusChange: CollSurplusChange,
): Promise<void> {
  const systemState = await getCurrentSystemState(context);
  await bumpSystemState(context, {
    ...systemState,
    collSurplusPoolBalance: systemState.collSurplusPoolBalance.plus(
      collSurplusChange.collSurplusChange,
    ),
  });
}

export async function updateSystemStateByLqtyStakeChange(
  context: handlerContext,
  stakeChange: LqtyStakeChange,
): Promise<void> {
  const systemState = await getCurrentSystemState(context);
  await bumpSystemState(context, {
    ...systemState,
    totalLQTYTokensStaked: systemState.totalLQTYTokensStaked.plus(stakeChange.stakedAmountChange),
  });
}
