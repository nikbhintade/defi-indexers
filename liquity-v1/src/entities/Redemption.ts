/**
 * Ported from liquity/dev packages/subgraph/src/entities/Redemption.ts.
 */
import type { EvmOnEventContext as handlerContext, Redemption } from "envio";

import { decimalize, DECIMAL_ZERO } from "../utils/bignumbers";

import { getGlobal, getRedemptionSequenceNumber } from "./Global";
import { getTransaction } from "./Transaction";
import type { ChangeCommon } from "./Change";
import { getUser } from "./User";

type RedemptionEvent = ChangeCommon & { transaction: { from: string | undefined } };

export async function getCurrentRedemption(
  context: handlerContext,
  event: RedemptionEvent,
): Promise<Redemption> {
  const currentRedemptionId = (await getGlobal(context)).currentRedemption_id;
  let currentRedemptionOrNull =
    currentRedemptionId != null ? await context.Redemption.get(currentRedemptionId) : undefined;

  if (currentRedemptionOrNull == null) {
    const sequenceNumber = await getRedemptionSequenceNumber(context);
    const newRedemption: Redemption = {
      id: sequenceNumber.toString(),
      sequenceNumber,
      transaction_id: (await getTransaction(context, event)).id,
      redeemer_id: (await getUser(context, event.transaction.from!)).id,
      tokensAttemptedToRedeem: DECIMAL_ZERO,
      tokensActuallyRedeemed: DECIMAL_ZERO,
      collateralRedeemed: DECIMAL_ZERO,
      partial: false,
      fee: DECIMAL_ZERO,
    };
    context.Redemption.set(newRedemption);

    const global = await getGlobal(context);
    context.Global.set({ ...global, currentRedemption_id: newRedemption.id });

    currentRedemptionOrNull = newRedemption;
  }

  return currentRedemptionOrNull;
}

export async function finishCurrentRedemption(
  context: handlerContext,
  event: RedemptionEvent,
  _attemptedLUSDAmount: bigint,
  _actualLUSDAmount: bigint,
  _ETHSent: bigint,
  _ETHFee: bigint,
): Promise<void> {
  const fee = decimalize(_ETHFee);

  const currentRedemption = await getCurrentRedemption(context, event);
  context.Redemption.set({
    ...currentRedemption,
    tokensAttemptedToRedeem: decimalize(_attemptedLUSDAmount),
    tokensActuallyRedeemed: decimalize(_actualLUSDAmount),
    collateralRedeemed: decimalize(_ETHSent),
    partial: _actualLUSDAmount < _attemptedLUSDAmount,
    fee,
  });

  const global = await getGlobal(context);
  context.Global.set({
    ...global,
    currentRedemption_id: undefined,
    totalRedemptionFeesPaid: global.totalRedemptionFeesPaid.plus(fee),
  });
}
