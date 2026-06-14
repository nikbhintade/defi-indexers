/**
 * Ported from liquity/dev packages/subgraph/src/entities/User.ts.
 * Also hosts the CollSurplusChange logic (CollSurplusPool mapping).
 * User id = address (lowercase hex).
 */
import type { EvmOnEventContext as handlerContext, User, CollSurplusChange } from "envio";

import { decimalize, DECIMAL_ZERO } from "../utils/bignumbers";
import { a } from "../utils/constants";

import { beginChange, initChange, finishChange, type ChangeCommon } from "./Change";
import { updateSystemStateByCollSurplusChange } from "./SystemState";

export async function getUser(context: handlerContext, _user: string): Promise<User> {
  const id = a(_user);
  const userOrNull = await context.User.get(id);

  if (userOrNull != null) {
    return userOrNull;
  } else {
    const newUser: User = {
      id,
      trove_id: undefined,
      stabilityDeposit_id: undefined,
      stake_id: undefined,
      frontend_id: undefined,
      collSurplus: DECIMAL_ZERO,
    };
    context.User.set(newUser);
    return newUser;
  }
}

async function createCollSurplusChange(
  context: handlerContext,
  event: ChangeCommon,
): Promise<{ change: CollSurplusChange }> {
  const sequenceNumber = await beginChange(context);
  const base = await initChange(context, event, sequenceNumber);
  const change: CollSurplusChange = {
    id: sequenceNumber.toString(),
    sequenceNumber,
    transaction_id: base.transaction_id,
    systemStateBefore_id: base.systemStateBefore_id,
    systemStateAfter_id: base.systemStateBefore_id, // set in finish
    user_id: "",
    collSurplusBefore: DECIMAL_ZERO,
    collSurplusChange: DECIMAL_ZERO,
    collSurplusAfter: DECIMAL_ZERO,
  };
  return { change };
}

async function finishCollSurplusChange(
  context: handlerContext,
  change: CollSurplusChange,
): Promise<void> {
  const after = await finishChange(context);
  context.CollSurplusChange.set({ ...change, systemStateAfter_id: after });
}

export async function updateUserClaimColl(
  context: handlerContext,
  event: ChangeCommon,
  _borrower: string,
  _collSurplus: bigint,
): Promise<void> {
  const user = await getUser(context, _borrower);
  const newCollSurplus = decimalize(_collSurplus);
  if (newCollSurplus.eq(user.collSurplus)) {
    return;
  }

  let { change } = await createCollSurplusChange(context, event);

  change = {
    ...change,
    user_id: user.id,
    collSurplusBefore: user.collSurplus,
    collSurplusAfter: newCollSurplus,
    collSurplusChange: newCollSurplus.minus(user.collSurplus),
  };

  await updateSystemStateByCollSurplusChange(context, change);
  await finishCollSurplusChange(context, change);

  context.User.set({ ...user, collSurplus: newCollSurplus });
}
