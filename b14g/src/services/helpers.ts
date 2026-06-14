/**
 * Port of src/mappings/helpers.ts entity constructors / mutators.
 *
 * graph-ts handlers create entities with `new X(id)` + field assignment +
 * `.save()`. In envio entities are immutable records written via
 * `context.X.set(...)`. Each constructor here builds the record, writes it, and
 * returns it so callers can keep mutating (re-`set`) it.
 */
import type { EvmOnEventContext, User, Stats, Vault, Transaction, UserActionCount, Lottery, LotteryRound, Order } from "envio";
import {
  ADDRESS_ZERO,
  B14G_ID,
  DUAL_CORE_VAULT,
  LOTTERY,
  MARKETPLACE_STRATEGY_ADDRESS,
  ZERO_BI,
} from "../constants";
import { concatBytes, low } from "../utils";

type Ctx = EvmOnEventContext;

/** Normalize envio's `number` block/timestamp fields to bigint entity fields. */
const toBI = (v: number | bigint): bigint => (typeof v === "bigint" ? v : BigInt(v));

export async function loadOrInitStats(context: Ctx): Promise<Stats> {
  let stats = await context.Stats.get(B14G_ID);
  if (!stats) {
    stats = {
      id: B14G_ID,
      totalStaker: 0,
      totalCoreStaked: ZERO_BI,
      totalDualCore: ZERO_BI,
      vaultMaxCap: ZERO_BI,
      totalEarned: ZERO_BI,
      marketplaceFee: undefined,
    };
    context.Stats.set(stats);
  }
  return stats;
}

export async function createUser(
  context: Ctx,
  id: string,
  timestamp: number | bigint,
): Promise<User> {
  const user: User = {
    id: low(id),
    dualCoreBalance: ZERO_BI,
    coreStakedInOrder: ZERO_BI,
    totalValidOrder: 0,
    totalYeildDeposited: ZERO_BI,
    createdAt: toBI(timestamp),
  };
  context.User.set(user);

  // createUser also bumps Stats.totalStaker (creating Stats if absent), but the
  // original `createUser` does NOT seed totalEarned-defaults the same way as the
  // marketplace path; it sets totalEarned/vaultMaxCap to 0 too.
  let stats = await context.Stats.get(B14G_ID);
  if (!stats) {
    stats = {
      id: B14G_ID,
      totalStaker: 0,
      totalCoreStaked: ZERO_BI,
      totalDualCore: ZERO_BI,
      totalEarned: ZERO_BI,
      vaultMaxCap: ZERO_BI,
      marketplaceFee: undefined,
    };
  }
  context.Stats.set({ ...stats, totalStaker: stats.totalStaker + 1 });
  return user;
}

export function createVault(context: Ctx, id: string): Vault {
  const vault: Vault = {
    id: low(id),
    totalStaked: ZERO_BI,
    total: 0,
    stake: 0,
    redeemInstantly: 0,
    unbond: 0,
    withdraw: 0,
    reInvest: 0,
    claim: 0,
    borrowCore: 0,
    repayCore: 0,
    migrate: undefined,
  };
  context.Vault.set(vault);
  return vault;
}

export function createTransaction(
  context: Ctx,
  id: string,
  blockNumber: number | bigint,
  timestamp: number | bigint,
  from: string,
  to: string,
  toType: Transaction["toType"],
  type: Transaction["type"],
  amount: bigint,
  txHash: string,
): Transaction {
  const transaction: Transaction = {
    id: low(id),
    blockNumber: toBI(blockNumber),
    timestamp: toBI(timestamp),
    from_id: low(from),
    to: low(to),
    toType,
    type,
    amount,
    txHash: low(txHash),
    rewardAmount: undefined,
    round: undefined,
    receiverAmount: undefined,
  };
  context.Transaction.set(transaction);
  return transaction;
}

export function createUserActionCount(
  context: Ctx,
  id: string,
  to: string,
): UserActionCount {
  const uac: UserActionCount = {
    id: concatBytes(id, to),
    user_id: low(id),
    to: low(to),
    total: 0,
    stake: 0,
    withdraw: 0,
    claim: 0,
    unbond: 0,
    withdrawDirect: 0,
    migrate: undefined,
  };
  context.UserActionCount.set(uac);
  return uac;
}

export function createLottery(context: Ctx): Lottery {
  const lottery: Lottery = {
    id: low(LOTTERY),
    currentRound: ZERO_BI,
    total: 0,
    stake: 0,
    withdraw: 0,
    claim: 0,
    totalParticipants: ZERO_BI,
    totalYields: ZERO_BI,
    totalReward: ZERO_BI,
    totalFee: ZERO_BI,
    requestRandomness: 0,
    fullfillRandomness: 0,
    endRound: 0,
    startRound: 0,
  };
  context.Lottery.set(lottery);
  return lottery;
}

export function createLotteryRound(
  context: Ctx,
  startTime: number | bigint,
  round: bigint,
): LotteryRound {
  const lotteryRound: LotteryRound = {
    id: round.toString(),
    lottery_id: low(LOTTERY),
    startTime: toBI(startTime),
    endTime: ZERO_BI,
    round,
    winners: [],
    rewardAmount: ZERO_BI,
    feeAmount: ZERO_BI,
    totalParticipants: ZERO_BI,
    totalYields: ZERO_BI,
    timestamp: ZERO_BI,
    endRoundTx: ADDRESS_ZERO,
    randomnessId: ADDRESS_ZERO,
  };
  context.LotteryRound.set(lotteryRound);
  return lotteryRound;
}

/**
 * Port of helpers.handleVaultAction. Returns Stats.totalCoreStaked (or 0 if
 * Stats missing — original returns ZERO_BI when stats is null).
 */
export async function handleVaultAction(
  context: Ctx,
  coreAmount: bigint,
  dualCoreAmount: bigint,
  isStake: boolean,
  isNormalRedeem: boolean,
): Promise<bigint> {
  let stats = await context.Stats.get(B14G_ID);
  let vault = await context.Vault.get(low(DUAL_CORE_VAULT));
  if (!stats) {
    return ZERO_BI;
  }
  if (!vault) {
    vault = createVault(context, DUAL_CORE_VAULT);
  }
  let totalCoreStaked = stats.totalCoreStaked;
  let totalDualCore = stats.totalDualCore;
  let v = { ...vault };
  if (isStake) {
    totalCoreStaked = totalCoreStaked + coreAmount;
    totalDualCore = totalDualCore + dualCoreAmount;
    v.stake += 1;
  } else {
    totalCoreStaked = totalCoreStaked - coreAmount;
    totalDualCore = totalDualCore - dualCoreAmount;
    if (isNormalRedeem) {
      v.unbond += 1;
    } else {
      v.redeemInstantly += 1;
    }
  }
  v.total += 1;
  context.Vault.set(v);
  context.Stats.set({ ...stats, totalCoreStaked, totalDualCore });
  return totalCoreStaked;
}

/**
 * Port of helpers.handleOrderAction. `type` is an ORDER_ACTION numeric kind.
 * Returns Stats.totalCoreStaked (0 when stats/order missing).
 */
export async function handleOrderAction(
  context: Ctx,
  coreAmount: bigint,
  orderId: string,
  user: string,
  type: number, // ORDER_ACTION
): Promise<bigint> {
  const stats = await context.Stats.get(B14G_ID);
  const order = await context.Order.get(low(orderId));
  if (!stats || !order) {
    return ZERO_BI;
  }

  // ORDER_ACTION: STAKE=0 WITHDRAW=1 CLAIM_BTC=2 CLAIM_CORE=3
  if (type === 2 || type === 3) {
    let o = { ...order, total: order.total + 1 };
    if (type === 2) {
      o.claimBtc += 1;
    } else {
      o.claimCore += 1;
    }
    context.Order.set(o);
    return stats.totalCoreStaked;
  } else {
    let totalCoreStaked = stats.totalCoreStaked;
    let o = { ...order };
    if (type === 0) {
      if (low(user) !== low(MARKETPLACE_STRATEGY_ADDRESS)) {
        totalCoreStaked = totalCoreStaked + coreAmount;
      }
      o.stake += 1;
      o.realtimeStakeAmount = o.realtimeStakeAmount + coreAmount;
      // graph-ts BigInt.div by zero reverts the handler; JS bigint throws too.
      // Guard to avoid crashing when btcAmount is still 0 (order not yet BTC-staked).
      o.realtimeTier = o.btcAmount === 0n ? 0n : o.realtimeStakeAmount / o.btcAmount;
    } else {
      if (low(user) !== low(MARKETPLACE_STRATEGY_ADDRESS)) {
        totalCoreStaked = totalCoreStaked - coreAmount;
      }
      o.withdraw += 1;
      o.realtimeStakeAmount = o.realtimeStakeAmount - coreAmount;
      o.realtimeTier = o.btcAmount === 0n ? 0n : o.realtimeStakeAmount / o.btcAmount;
    }
    o.total += 1;
    context.Order.set(o);
    context.Stats.set({ ...stats, totalCoreStaked });
    return totalCoreStaked;
  }
}
