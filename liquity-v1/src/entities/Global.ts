/**
 * Ported from liquity/dev packages/subgraph/src/entities/Global.ts.
 *
 * The subgraph keeps a single Global entity (id "only") holding every
 * sequential counter (systemStateCount, transactionCount, changeCount,
 * liquidationCount, redemptionCount) plus aggregate trove/stake stats and the
 * internal temp pointers (currentSystemState/currentLiquidation/
 * currentRedemption/tmpDepositUpdate).
 *
 * The mappings do a synchronous read-modify-write of Global many times within a
 * single handler. envio's entity cache makes `await context.Global.get(...)`
 * after a `context.Global.set(...)` return the just-written value, so the
 * pattern is replicated faithfully — but EVERY mutation must be awaited in
 * order to stay deterministic.
 */
import { BigDecimal } from "envio";
import type { EvmOnEventContext as handlerContext } from "envio";

import { BIGINT_ZERO, DECIMAL_ZERO, decimalize } from "../utils/bignumbers";

// NB: the subgraph entity is literally named `Global`, which collides with
// envio's exported `interface Global {}` (the indexer global-config registry).
// We therefore derive the entity's row type from the context accessor instead
// of `import type { Global } from "envio"` (which would resolve to the config
// interface and lose all entity fields).
export type Global = NonNullable<Awaited<ReturnType<handlerContext["Global"]["get"]>>>;

export const onlyGlobalId = "only";

export async function getGlobal(context: handlerContext): Promise<Global> {
  const globalOrNull = await context.Global.get(onlyGlobalId);

  if (globalOrNull != null) {
    return globalOrNull;
  } else {
    const newGlobal: Global = {
      id: onlyGlobalId,
      systemStateCount: 0,
      transactionCount: 0,
      changeCount: 0,
      liquidationCount: 0,
      redemptionCount: 0,
      numberOfOpenTroves: 0,
      numberOfLiquidatedTroves: 0,
      numberOfRedeemedTroves: 0,
      numberOfTrovesClosedByOwner: 0,
      totalNumberOfTroves: 0,
      rawTotalRedistributedCollateral: BIGINT_ZERO,
      rawTotalRedistributedDebt: BIGINT_ZERO,
      totalNumberOfLQTYStakes: 0,
      numberOfActiveLQTYStakes: 0,
      totalBorrowingFeesPaid: DECIMAL_ZERO,
      totalRedemptionFeesPaid: DECIMAL_ZERO,
      currentSystemState_id: undefined,
      currentLiquidation_id: undefined,
      currentRedemption_id: undefined,
      tmpDepositUpdate: undefined,
    };
    // NB: the subgraph does NOT save() here; it returns the unsaved entity and
    // the caller saves later. We must NOT persist yet, otherwise an early
    // partial Global could leak. Callers that mutate will set() themselves.
    return newGlobal;
  }
}

type IntCounterKey =
  | "systemStateCount"
  | "transactionCount"
  | "changeCount"
  | "liquidationCount"
  | "redemptionCount";

async function increaseCounter(context: handlerContext, key: IntCounterKey): Promise<number> {
  const global = await getGlobal(context);
  const count = global[key];
  context.Global.set({ ...global, [key]: count + 1 });
  return count;
}

export const getSystemStateSequenceNumber = (context: handlerContext) =>
  increaseCounter(context, "systemStateCount");

export const getTransactionSequenceNumber = (context: handlerContext) =>
  increaseCounter(context, "transactionCount");

export const getChangeSequenceNumber = (context: handlerContext) =>
  increaseCounter(context, "changeCount");

export async function getLastChangeSequenceNumber(context: handlerContext): Promise<number> {
  const global = await getGlobal(context);
  return global.changeCount - 1;
}

export const getLiquidationSequenceNumber = (context: handlerContext) =>
  increaseCounter(context, "liquidationCount");

export const getRedemptionSequenceNumber = (context: handlerContext) =>
  increaseCounter(context, "redemptionCount");

export async function updateTotalRedistributed(
  context: handlerContext,
  L_ETH: bigint,
  L_LUSDDebt: bigint,
): Promise<void> {
  const global = await getGlobal(context);
  context.Global.set({
    ...global,
    rawTotalRedistributedCollateral: L_ETH,
    rawTotalRedistributedDebt: L_LUSDDebt,
  });
}

export async function increaseNumberOfOpenTroves(context: handlerContext): Promise<void> {
  const global = await getGlobal(context);
  context.Global.set({
    ...global,
    numberOfOpenTroves: global.numberOfOpenTroves + 1,
    totalNumberOfTroves: global.totalNumberOfTroves + 1,
  });
}

export async function increaseNumberOfLiquidatedTroves(context: handlerContext): Promise<void> {
  const global = await getGlobal(context);
  context.Global.set({
    ...global,
    numberOfLiquidatedTroves: global.numberOfLiquidatedTroves + 1,
    numberOfOpenTroves: global.numberOfOpenTroves - 1,
  });
}

export async function decreaseNumberOfLiquidatedTroves(context: handlerContext): Promise<void> {
  const global = await getGlobal(context);
  context.Global.set({
    ...global,
    numberOfLiquidatedTroves: global.numberOfLiquidatedTroves - 1,
    numberOfOpenTroves: global.numberOfOpenTroves + 1,
  });
}

export async function increaseNumberOfRedeemedTroves(context: handlerContext): Promise<void> {
  const global = await getGlobal(context);
  context.Global.set({
    ...global,
    numberOfRedeemedTroves: global.numberOfRedeemedTroves + 1,
    numberOfOpenTroves: global.numberOfOpenTroves - 1,
  });
}

export async function decreaseNumberOfRedeemedTroves(context: handlerContext): Promise<void> {
  const global = await getGlobal(context);
  context.Global.set({
    ...global,
    numberOfRedeemedTroves: global.numberOfRedeemedTroves - 1,
    numberOfOpenTroves: global.numberOfOpenTroves + 1,
  });
}

export async function increaseNumberOfTrovesClosedByOwner(context: handlerContext): Promise<void> {
  const global = await getGlobal(context);
  context.Global.set({
    ...global,
    numberOfTrovesClosedByOwner: global.numberOfTrovesClosedByOwner + 1,
    numberOfOpenTroves: global.numberOfOpenTroves - 1,
  });
}

export async function decreaseNumberOfTrovesClosedByOwner(context: handlerContext): Promise<void> {
  const global = await getGlobal(context);
  context.Global.set({
    ...global,
    numberOfTrovesClosedByOwner: global.numberOfTrovesClosedByOwner - 1,
    numberOfOpenTroves: global.numberOfOpenTroves + 1,
  });
}

export async function increaseTotalNumberOfLQTYStakes(context: handlerContext): Promise<void> {
  const global = await getGlobal(context);
  context.Global.set({
    ...global,
    totalNumberOfLQTYStakes: global.totalNumberOfLQTYStakes + 1,
    numberOfActiveLQTYStakes: global.numberOfActiveLQTYStakes + 1,
  });
}

export async function increaseNumberOfActiveLQTYStakes(context: handlerContext): Promise<void> {
  const global = await getGlobal(context);
  context.Global.set({ ...global, numberOfActiveLQTYStakes: global.numberOfActiveLQTYStakes + 1 });
}

export async function decreaseNumberOfActiveLQTYStakes(context: handlerContext): Promise<void> {
  const global = await getGlobal(context);
  context.Global.set({ ...global, numberOfActiveLQTYStakes: global.numberOfActiveLQTYStakes - 1 });
}

export async function increaseTotalBorrowingFeesPaid(
  context: handlerContext,
  _LUSDFee: bigint,
): Promise<void> {
  const global = await getGlobal(context);
  context.Global.set({
    ...global,
    totalBorrowingFeesPaid: global.totalBorrowingFeesPaid.plus(decimalize(_LUSDFee)),
  });
}

export { BigDecimal };
