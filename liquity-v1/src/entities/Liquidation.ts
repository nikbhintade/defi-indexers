/**
 * Ported from liquity/dev packages/subgraph/src/entities/Liquidation.ts.
 * A Liquidation is opened lazily (the first TroveUpdated of a liquidation tx)
 * and finished by the TroveManager Liquidation event. Global.currentLiquidation
 * is the temp pointer linking the two.
 */
import type { EvmOnEventContext as handlerContext, Liquidation } from "envio";

import { decimalize, DECIMAL_ZERO } from "../utils/bignumbers";

import { getGlobal, getLiquidationSequenceNumber } from "./Global";
import { getTransaction } from "./Transaction";
import type { ChangeCommon } from "./Change";
import { getUser } from "./User";

type LiquidationEvent = ChangeCommon & { transaction: { from: string | undefined } };

export async function getCurrentLiquidation(
  context: handlerContext,
  event: LiquidationEvent,
): Promise<Liquidation> {
  const currentLiquidationId = (await getGlobal(context)).currentLiquidation_id;
  let currentLiquidationOrNull =
    currentLiquidationId != null ? await context.Liquidation.get(currentLiquidationId) : undefined;

  if (currentLiquidationOrNull == null) {
    const sequenceNumber = await getLiquidationSequenceNumber(context);
    const newLiquidation: Liquidation = {
      id: sequenceNumber.toString(),
      sequenceNumber,
      transaction_id: (await getTransaction(context, event)).id,
      liquidator_id: (await getUser(context, event.transaction.from!)).id,
      liquidatedCollateral: DECIMAL_ZERO,
      liquidatedDebt: DECIMAL_ZERO,
      collGasCompensation: DECIMAL_ZERO,
      tokenGasCompensation: DECIMAL_ZERO,
    };
    context.Liquidation.set(newLiquidation);

    const global = await getGlobal(context);
    context.Global.set({ ...global, currentLiquidation_id: newLiquidation.id });

    currentLiquidationOrNull = newLiquidation;
  }

  return currentLiquidationOrNull;
}

export async function finishCurrentLiquidation(
  context: handlerContext,
  event: LiquidationEvent,
  _liquidatedColl: bigint,
  _liquidatedDebt: bigint,
  _collGasCompensation: bigint,
  _LUSDGasCompensation: bigint,
): Promise<void> {
  const currentLiquidation = await getCurrentLiquidation(context, event);
  context.Liquidation.set({
    ...currentLiquidation,
    liquidatedCollateral: decimalize(_liquidatedColl),
    liquidatedDebt: decimalize(_liquidatedDebt),
    collGasCompensation: decimalize(_collGasCompensation),
    tokenGasCompensation: decimalize(_LUSDGasCompensation),
  });

  const global = await getGlobal(context);
  context.Global.set({ ...global, currentLiquidation_id: undefined });
}
