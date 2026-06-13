/**
 * Ported from src/helpers.ts + src/constants.ts (APR/checkAppVer parts) of the
 * Lido subgraph. Entity loaders take the envio handler `context`. Share/balance
 * math and APR formulas are reproduced bit-for-bit (graph-node BigInt is integer
 * division; BigDecimal is bignumber.js with high precision).
 */
import { BigDecimal, type EvmOnEventContext } from "envio";
import type {
  Totals,
  Shares,
  Stats,
  LidoTransfer,
  TotalReward,
  Holder,
  AppVersion,
} from "envio";

export type HandlerContext = EvmOnEventContext;

/** Mutable working copy of an entity (handlers build these, then .set()). */
export type Mutable<T> = { -readonly [K in keyof T]: T[K] };
export type MutableLidoTransfer = Mutable<LidoTransfer>;
export type MutableTotalReward = Mutable<TotalReward>;
import {
  CALCULATION_UNIT,
  E27_PRECISION_BASE,
  LIDO_APP_ID,
  ONE,
  ONE_HUNDRED_PERCENT,
  PROTOCOL_UPG_APP_VERS,
  PROTOCOL_UPG_BLOCKS,
  PROTOCOL_UPG_IDX_V1_SHARES,
  PROTOCOL_UPG_IDX_V2,
  PROTOCOL_UPG_IDX_V2_ADDED_CSM,
  PROTOCOL_UPG_IDX_V3,
  SECONDS_PER_YEAR,
  ZERO,
  ZERO_ADDRESS,
} from "./constants";

const TOTALS_ID = "";
const STATS_ID = "";

const bd = (x: bigint): BigDecimal => new BigDecimal(x.toString());

// ---- Totals ----
export async function loadTotals(context: HandlerContext): Promise<Totals> {
  const existing = await context.Totals.get(TOTALS_ID);
  if (existing) return existing;
  const totals: Totals = {
    id: TOTALS_ID,
    totalPooledEther: ZERO,
    totalShares: ZERO,
    maxPositivePooledEtherDrift: ZERO,
  };
  context.Totals.set(totals);
  return totals;
}

// ---- Stats ----
export async function loadStats(context: HandlerContext): Promise<Stats> {
  const existing = await context.Stats.get(STATS_ID);
  if (existing) return existing;
  const stats: Stats = {
    id: STATS_ID,
    uniqueHolders: ZERO,
    uniqueAnytimeHolders: ZERO,
    lastOracleCompletedId: ZERO,
  };
  context.Stats.set(stats);
  return stats;
}

// ---- Shares ----
export async function loadShares(
  context: HandlerContext,
  id: string
): Promise<Shares> {
  const existing = await context.Shares.get(id);
  if (existing) return existing;
  return { id, shares: ZERO };
}

// ---- TotalReward (id = transactionHash) ----
export function newTotalReward(
  txHash: string,
  block: bigint,
  blockTime: bigint,
  txIndex: bigint,
  logIndex: bigint
): MutableTotalReward {
  return {
    id: txHash,
    totalRewards: ZERO,
    totalRewardsWithFees: ZERO,
    mevFee: ZERO,
    feeBasis: ZERO,
    treasuryFeeBasisPoints: ZERO,
    insuranceFeeBasisPoints: ZERO,
    operatorsFeeBasisPoints: ZERO,
    totalFee: ZERO,
    insuranceFee: ZERO,
    operatorsFee: ZERO,
    treasuryFee: ZERO,
    dust: ZERO,
    shares2mint: ZERO,
    sharesToTreasury: ZERO,
    sharesToInsuranceFund: ZERO,
    sharesToOperators: ZERO,
    dustSharesToTreasury: ZERO,
    totalPooledEtherBefore: ZERO,
    totalPooledEtherAfter: ZERO,
    totalSharesBefore: ZERO,
    totalSharesAfter: ZERO,
    timeElapsed: ZERO,
    aprRaw: new BigDecimal(0),
    aprBeforeFees: new BigDecimal(0),
    apr: new BigDecimal(0),
    block,
    blockTime,
    transactionHash: txHash,
    transactionIndex: txIndex,
    logIndex,
  };
}

// ---- LidoTransfer skeleton ----
export function newLidoTransfer(
  id: string,
  from: string,
  to: string,
  value: bigint,
  block: bigint,
  blockTime: bigint,
  txHash: string,
  txIndex: bigint,
  logIndex: bigint
): MutableLidoTransfer {
  return {
    id,
    from,
    to,
    value,
    shares: ZERO,
    sharesBeforeDecrease: ZERO,
    sharesAfterDecrease: ZERO,
    sharesBeforeIncrease: ZERO,
    sharesAfterIncrease: ZERO,
    totalPooledEther: ZERO,
    totalShares: ZERO,
    balanceAfterDecrease: ZERO,
    balanceAfterIncrease: ZERO,
    block,
    blockTime,
    transactionHash: txHash,
    transactionIndex: txIndex,
    logIndex,
  };
}

// ---- transfer balances (mutates a working copy) ----
export function updateTransferBalances(
  entity: MutableLidoTransfer
): MutableLidoTransfer {
  if (entity.totalShares === ZERO) {
    return {
      ...entity,
      balanceAfterIncrease: entity.value,
      balanceAfterDecrease: ZERO,
    };
  }
  return {
    ...entity,
    balanceAfterIncrease:
      (entity.sharesAfterIncrease! * entity.totalPooledEther) /
      entity.totalShares,
    balanceAfterDecrease:
      (entity.sharesAfterDecrease! * entity.totalPooledEther) /
      entity.totalShares,
  };
}

// ---- transfer shares (mutates Shares entities via context) ----
export async function updateTransferShares(
  context: HandlerContext,
  entity: MutableLidoTransfer
): Promise<MutableLidoTransfer> {
  let out: MutableLidoTransfer = { ...entity };
  // Decreasing from address shares
  if (out.from !== ZERO_ADDRESS) {
    const sharesFrom = await loadShares(context, out.from);
    out.sharesBeforeDecrease = sharesFrom.shares;
    let newFromShares = sharesFrom.shares;
    if (out.from !== out.to && out.shares !== ZERO) {
      if (!(sharesFrom.shares >= out.shares)) {
        throw new Error("negative shares decrease on transfer");
      }
      newFromShares = sharesFrom.shares - out.shares;
      context.Shares.set({ ...sharesFrom, shares: newFromShares });
    }
    out.sharesAfterDecrease = newFromShares;
  }
  // Increasing to address shares
  if (out.to !== ZERO_ADDRESS) {
    const sharesTo = await loadShares(context, out.to);
    out.sharesBeforeIncrease = sharesTo.shares;
    let newToShares = sharesTo.shares;
    if (out.to !== out.from && out.shares !== ZERO) {
      newToShares = sharesTo.shares + out.shares;
      context.Shares.set({ ...sharesTo, shares: newToShares });
    }
    out.sharesAfterIncrease = newToShares;
  }
  return out;
}

// ---- holders/stats ----
export async function updateHolders(
  context: HandlerContext,
  entity: LidoTransfer
): Promise<void> {
  const stats = await loadStats(context);
  let uniqueHolders = stats.uniqueHolders;
  let uniqueAnytimeHolders = stats.uniqueAnytimeHolders;

  if (entity.to !== ZERO_ADDRESS && entity.balanceAfterIncrease !== ZERO) {
    let holder = await context.Holder.get(entity.to);
    let created = false;
    if (!holder) {
      holder = { id: entity.to, address: entity.to, hasBalance: false };
      created = true;
      uniqueAnytimeHolders = uniqueAnytimeHolders + ONE;
    }
    if (!holder.hasBalance) {
      holder = { ...holder, hasBalance: true };
      uniqueHolders = uniqueHolders + ONE;
    }
    context.Holder.set(holder);
    void created;
  }

  if (entity.from !== ZERO_ADDRESS) {
    const holder = await context.Holder.get(entity.from);
    if (holder) {
      if (holder.hasBalance && entity.balanceAfterDecrease === ZERO) {
        context.Holder.set({ ...holder, hasBalance: false });
        uniqueHolders = uniqueHolders - ONE;
      }
    }
  }
  context.Stats.set({ ...stats, uniqueHolders, uniqueAnytimeHolders });
}

// ---- APR v1 ----
export function calcAPR_v1(
  entity: MutableTotalReward,
  preTotalPooledEther: bigint,
  postTotalPooledEther: bigint,
  timeElapsed: bigint,
  feeBasis: bigint
): MutableTotalReward {
  const aprRaw = bd(postTotalPooledEther)
    .div(bd(preTotalPooledEther))
    .minus(new BigDecimal(1))
    .times(new BigDecimal(100))
    .times(new BigDecimal(365));

  const aprBeforeFees =
    timeElapsed === ZERO
      ? aprRaw
      : bd((postTotalPooledEther - preTotalPooledEther) * SECONDS_PER_YEAR)
          .div(bd(preTotalPooledEther * timeElapsed))
          .times(new BigDecimal(100));

  const apr = aprBeforeFees.minus(
    aprBeforeFees
      .times(bd(CALCULATION_UNIT))
      .div(bd(feeBasis))
      .div(new BigDecimal(100))
  );

  return { ...entity, aprRaw, aprBeforeFees, apr };
}

// ---- APR v2 ----
export function calcAPR_v2(
  entity: MutableTotalReward,
  preTotalEther: bigint,
  postTotalEther: bigint,
  preTotalShares: bigint,
  postTotalShares: bigint,
  timeElapsed: bigint
): MutableTotalReward {
  const preShareRate = bd(preTotalEther)
    .times(E27_PRECISION_BASE)
    .div(bd(preTotalShares));
  const postShareRate = bd(postTotalEther)
    .times(E27_PRECISION_BASE)
    .div(bd(postTotalShares));
  const secondsInYear = bd(SECONDS_PER_YEAR);

  const apr = secondsInYear
    .times(postShareRate.minus(preShareRate))
    .times(ONE_HUNDRED_PERCENT)
    .div(preShareRate)
    .div(bd(timeElapsed));

  return { ...entity, apr, aprRaw: apr, aprBeforeFees: apr };
}

// ---- App-version gating (checkAppVer) ----
export async function checkAppVer(
  context: HandlerContext,
  block: bigint,
  appId: string | null,
  minUpgId: number
): Promise<boolean> {
  // fast path via block numbers
  if (block !== ZERO) {
    if (
      minUpgId < PROTOCOL_UPG_BLOCKS.length &&
      PROTOCOL_UPG_BLOCKS[minUpgId] !== block
    ) {
      return PROTOCOL_UPG_BLOCKS[minUpgId]! < block;
    }
  }
  if (!appId) return true;
  const appVer: AppVersion | undefined = await context.AppVersion.get(appId);
  if (!appVer) return true;
  const upgVers = PROTOCOL_UPG_APP_VERS.get(appId);
  if (!upgVers || upgVers.length === 0 || minUpgId >= upgVers.length)
    return true;
  return upgVers[minUpgId]! <= appVer.major;
}

export const isLidoV2 = (context: HandlerContext, block: bigint) =>
  checkAppVer(context, block, LIDO_APP_ID, PROTOCOL_UPG_IDX_V2);
export const isLidoTransferShares = (context: HandlerContext, block: bigint) =>
  checkAppVer(context, block, LIDO_APP_ID, PROTOCOL_UPG_IDX_V1_SHARES);
export const isLidoAddedCSM = (context: HandlerContext, block: bigint) =>
  checkAppVer(context, block, LIDO_APP_ID, PROTOCOL_UPG_IDX_V2_ADDED_CSM);
export const isLidoV3 = (context: HandlerContext, block: bigint) =>
  checkAppVer(context, block, LIDO_APP_ID, PROTOCOL_UPG_IDX_V3);
