/**
 * Ported from liquity/dev packages/subgraph/src/entities/LqtyStake.ts.
 * LqtyStake id = staker address (lowercase hex).
 */
import { BigDecimal } from "envio";
import type { EvmOnEventContext as handlerContext, LqtyStake, LqtyStakeChange } from "envio";

import { decimalize, DECIMAL_ZERO, BIGINT_ZERO } from "../utils/bignumbers";
import { a } from "../utils/constants";

import {
  decreaseNumberOfActiveLQTYStakes,
  increaseNumberOfActiveLQTYStakes,
  increaseTotalNumberOfLQTYStakes,
} from "./Global";

import { getUser } from "./User";
import { beginChange, initChange, finishChange, type ChangeCommon } from "./Change";
import { updateSystemStateByLqtyStakeChange } from "./SystemState";

async function startLQTYStakeChange(
  context: handlerContext,
  event: ChangeCommon,
): Promise<LqtyStakeChange> {
  const sequenceNumber = await beginChange(context);
  const base = await initChange(context, event, sequenceNumber);
  return {
    id: sequenceNumber.toString(),
    sequenceNumber,
    transaction_id: base.transaction_id,
    systemStateBefore_id: base.systemStateBefore_id,
    systemStateAfter_id: base.systemStateBefore_id, // set in finish
    stake_id: "",
    stakeOperation: "stakeCreated",
    stakedAmountBefore: DECIMAL_ZERO,
    stakedAmountChange: DECIMAL_ZERO,
    stakedAmountAfter: DECIMAL_ZERO,
    issuanceGain: DECIMAL_ZERO,
    redemptionGain: DECIMAL_ZERO,
  };
}

async function finishLQTYStakeChange(
  context: handlerContext,
  stakeChange: LqtyStakeChange,
): Promise<void> {
  const after = await finishChange(context);
  context.LqtyStakeChange.set({ ...stakeChange, systemStateAfter_id: after });
}

async function getUserStake(
  context: handlerContext,
  address: string,
): Promise<LqtyStake | undefined> {
  const user = await getUser(context, address);
  if (user.stake_id == null) {
    return undefined;
  }
  return context.LqtyStake.get(user.stake_id);
}

async function createStake(context: handlerContext, address: string): Promise<LqtyStake> {
  const user = await getUser(context, address);
  const stake: LqtyStake = {
    id: a(address),
    owner_id: user.id,
    amount: DECIMAL_ZERO,
  };
  context.User.set({ ...user, stake_id: stake.id });
  return stake;
}

function getOperationType(stake: LqtyStake, nextStakeAmount: BigDecimal): string {
  const isCreating = stake.amount.eq(DECIMAL_ZERO) && nextStakeAmount.gt(DECIMAL_ZERO);
  if (isCreating) {
    return "stakeCreated";
  }

  const isIncreasing = nextStakeAmount.gt(stake.amount);
  if (isIncreasing) {
    return "stakeIncreased";
  }

  const isRemoving = nextStakeAmount.eq(DECIMAL_ZERO);
  if (isRemoving) {
    return "stakeRemoved";
  }

  return "stakeDecreased";
}

export async function updateStake(
  context: handlerContext,
  event: ChangeCommon,
  address: string,
  newStake: bigint,
): Promise<void> {
  let stake = await getUserStake(context, address);
  const isUserFirstStake = stake == null;

  if (stake == null) {
    stake = await createStake(context, address);
  }

  const nextStakeAmount = decimalize(newStake);

  let stakeChange = await startLQTYStakeChange(context, event);
  const stakeOperation = getOperationType(stake, nextStakeAmount);
  stakeChange = {
    ...stakeChange,
    stake_id: stake.id,
    stakeOperation: stakeOperation as LqtyStakeChange["stakeOperation"],
    stakedAmountBefore: stake.amount,
    stakedAmountChange: nextStakeAmount.minus(stake.amount),
    stakedAmountAfter: nextStakeAmount,
  };

  stake = { ...stake, amount: nextStakeAmount };

  if (stakeChange.stakeOperation === "stakeCreated") {
    if (isUserFirstStake) {
      await increaseTotalNumberOfLQTYStakes(context);
    } else {
      await increaseNumberOfActiveLQTYStakes(context);
    }
  } else if (stakeChange.stakeOperation === "stakeRemoved") {
    await decreaseNumberOfActiveLQTYStakes(context);
  }

  await updateSystemStateByLqtyStakeChange(context, stakeChange);
  await finishLQTYStakeChange(context, stakeChange);

  context.LqtyStake.set(stake);
}

export async function withdrawStakeGains(
  context: handlerContext,
  event: ChangeCommon,
  address: string,
  LUSDGain: bigint,
  ETHGain: bigint,
): Promise<void> {
  if (LUSDGain === BIGINT_ZERO && ETHGain === BIGINT_ZERO) {
    return;
  }

  let stake = (await getUserStake(context, address)) ?? (await createStake(context, address));
  let stakeChange = await startLQTYStakeChange(context, event);
  stakeChange = {
    ...stakeChange,
    stake_id: stake.id,
    stakeOperation: "gainsWithdrawn",
    issuanceGain: decimalize(LUSDGain),
    redemptionGain: decimalize(ETHGain),
    stakedAmountBefore: stake.amount,
    stakedAmountChange: DECIMAL_ZERO,
    stakedAmountAfter: stake.amount,
  };

  await updateSystemStateByLqtyStakeChange(context, stakeChange);
  await finishLQTYStakeChange(context, stakeChange);

  context.LqtyStake.set(stake);
}

export { BigDecimal };
