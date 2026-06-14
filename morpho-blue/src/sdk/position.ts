/**
 * Ported from src/sdk/position.ts (PositionManager). Functional/context-based.
 *
 * Position ids: `{account}-{market}-{side}` counter, with the open position id
 * `{counterId}-{nextCount}` (Messari convention). Account/Market/Protocol
 * counters are read fresh from context and re-set to stay consistent with the
 * subgraph's in-place mutation + save.
 */
import type { Context, Ev } from "../context";
import {
  BigDecimal,
  type Account,
  type EffectCaller,
  type Market,
  type Position,
  type PositionSnapshot,
  type _PositionCounter,
} from "envio";
import {
  INT_ZERO,
  PositionSide,
  SECONDS_PER_DAY,
  TransactionType,
} from "./constants";
import { toAssetsDown, toAssetsUp } from "../maths/shares";
import { getProtocol } from "../initializers/protocol";
import { getOrCreateToken, getPriceUSD } from "./token";
import { exponentToBigDecimal, toBD } from "./constants";
import { addDailyActivePosition } from "./snapshots";



function counterId(accountId: string, marketId: string, side: string): string {
  return accountId + "-" + marketId + "-" + side;
}

function positionId(counter: _PositionCounter): string {
  return counter.id + "-" + counter.nextCount.toString();
}

export async function getCurrentPosition(
  context: Context,
  accountId: string,
  marketId: string,
  side: string,
): Promise<Position | undefined> {
  const cId = counterId(accountId, marketId, side);
  const counter = await context._PositionCounter.get(cId);
  if (!counter) return undefined;
  return context.Position.get(positionId(counter));
}

async function getOrCreateCounter(
  context: Context,
  cId: string,
  event: Ev,
): Promise<_PositionCounter> {
  let counter = await context._PositionCounter.get(cId);
  if (!counter) {
    counter = { id: cId, nextCount: 0, lastTimestamp: event.block.timestamp };
    context._PositionCounter.set(counter);
  }
  return counter;
}

async function createPosition(
  context: Context,
  posId: string,
  accountId: string,
  market: Market,
  side: string,
  event: Ev,
  transactionType: string,
): Promise<{ position: Position; market: Market }> {
  const asset =
    transactionType === TransactionType.DEPOSIT_COLLATERAL ||
    transactionType === TransactionType.WITHDRAW_COLLATERAL
      ? market.inputToken_id
      : market.borrowedToken_id;

  const position: Position = {
    id: posId,
    account_id: accountId,
    market_id: market.id,
    asset_id: asset,
    hashOpened: event.transaction.hash.toLowerCase(),
    hashClosed: undefined,
    blockNumberOpened: event.block.number,
    timestampOpened: event.block.timestamp,
    blockNumberClosed: undefined,
    timestampClosed: undefined,
    side: side as Position["side"],
    type: undefined,
    isCollateral:
      transactionType === TransactionType.DEPOSIT
        ? false
        : transactionType === TransactionType.DEPOSIT_COLLATERAL
          ? true
          : undefined,
    balance: 0n,
    principal: undefined,
    depositCount: INT_ZERO,
    withdrawCount: INT_ZERO,
    borrowCount: INT_ZERO,
    repayCount: INT_ZERO,
    liquidationCount: INT_ZERO,
    transferredCount: INT_ZERO,
    receivedCount: INT_ZERO,
    shares:
      transactionType === TransactionType.DEPOSIT ? 0n : undefined,
    depositCollateralCount: INT_ZERO,
    withdrawCollateralCount: INT_ZERO,
  };
  context.Position.set(position);

  // update account position
  const account = await context.Account.get(accountId);
  if (account) {
    context.Account.set({
      ...account,
      positionCount: account.positionCount + 1,
      openPositionCount: account.openPositionCount + 1,
    });
  }

  // update market position
  let m = { ...market };
  m = {
    ...m,
    positionCount: m.positionCount + 1,
    openPositionCount: m.openPositionCount + 1,
  };
  if (transactionType === TransactionType.DEPOSIT) {
    m = { ...m, lendingPositionCount: m.lendingPositionCount + 1 };
  } else if (transactionType === TransactionType.DEPOSIT_COLLATERAL) {
    m = {
      ...m,
      lendingPositionCount: m.lendingPositionCount + 1,
      collateralPositionCount: m.collateralPositionCount + 1,
    };
  } else if (transactionType === TransactionType.BORROW) {
    m = { ...m, borrowingPositionCount: m.borrowingPositionCount + 1 };
  }
  context.Market.set(m);

  // update protocol position
  const protocol = await getProtocol(context);
  context.LendingProtocol.set({
    ...protocol,
    cumulativePositionCount: protocol.cumulativePositionCount + 1,
    openPositionCount: protocol.openPositionCount + 1,
  });

  return { position, market: m };
}

async function closePosition(
  context: Context,
  position: Position,
  market: Market,
  event: Ev,
): Promise<{ position: Position; market: Market }> {
  const closed: Position = {
    ...position,
    hashClosed: event.transaction.hash.toLowerCase(),
    blockNumberClosed: event.block.number,
    timestampClosed: event.block.timestamp,
  };
  context.Position.set(closed);

  const account = await context.Account.get(position.account_id);
  if (account) {
    context.Account.set({
      ...account,
      openPositionCount: account.openPositionCount - 1,
      closedPositionCount: account.closedPositionCount + 1,
    });
  }

  let m: Market = {
    ...market,
    openPositionCount: market.openPositionCount - 1,
    closedPositionCount: market.closedPositionCount + 1,
  };
  if (position.isCollateral) {
    m = { ...m, collateralPositionCount: m.collateralPositionCount - 1 };
  }
  context.Market.set(m);

  const protocol = await getProtocol(context);
  context.LendingProtocol.set({
    ...protocol,
    openPositionCount: protocol.openPositionCount - 1,
  });

  return { position: closed, market: m };
}

async function snapshotPosition(
  context: Context,
  position: Position,
  market: Market,
  accountId: string,
  event: Ev,
): Promise<void> {
  const token = await getOrCreateToken(context, position.asset_id);
  const mantissaFactorBD = exponentToBigDecimal(token.decimals);
  const snapshot: PositionSnapshot = {
    id:
      position.id +
      "-" +
      event.transaction.hash.toLowerCase() +
      "-" +
      event.logIndex.toString(),
    hash: event.transaction.hash.toLowerCase(),
    logIndex: event.logIndex,
    nonce: event.transaction.nonce,
    account_id: accountId,
    position_id: position.id,
    balance: position.balance,
    balanceUSD: toBD(position.balance)
      .div(mantissaFactorBD)
      .times(getPriceUSD(token)),
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
    principal: position.principal ?? undefined,
    index:
      market.borrowIndex !== undefined && position.side === PositionSide.BORROWER
        ? market.borrowIndex
        : market.supplyIndex !== undefined &&
            position.side === PositionSide.COLLATERAL
          ? market.supplyIndex
          : undefined,
  };
  context.PositionSnapshot.set(snapshot);
}

async function countDailyActivePosition(
  context: Context,
  counter: _PositionCounter,
  side: string,
  market: Market,
  event: Ev,
): Promise<void> {
  const lastDay = Number(counter.lastTimestamp) / SECONDS_PER_DAY;
  const currentDay = Number(event.block.timestamp) / SECONDS_PER_DAY;
  if (Math.trunc(lastDay) === Math.trunc(currentDay)) {
    return;
  }
  await addDailyActivePosition(context, market, event, side);
  context._PositionCounter.set({
    ...counter,
    lastTimestamp: event.block.timestamp,
  });
}

// ---- public position mutators (return the resulting Position) ----

export async function addCollateralPosition(
  context: Context,
  account: Account,
  market: Market,
  event: Ev,
  amountSupplied: bigint,
): Promise<Position> {
  const cId = counterId(account.id, market.id, PositionSide.COLLATERAL);
  const counter = await getOrCreateCounter(context, cId, event);
  const posId = positionId(counter);
  let position = await context.Position.get(posId);
  let m = market;
  if (!position) {
    const created = await createPosition(
      context,
      posId,
      account.id,
      market,
      PositionSide.COLLATERAL,
      event,
      TransactionType.DEPOSIT_COLLATERAL,
    );
    position = created.position;
    m = created.market;
  }
  position = {
    ...position,
    balance: position.balance + amountSupplied,
    principal: position.balance + amountSupplied,
    depositCollateralCount: position.depositCollateralCount + 1,
    depositCount: position.depositCount + 1,
  };
  context.Position.set(position);
  await snapshotPosition(context, position, m, account.id, event);
  await countDailyActivePosition(
    context,
    counter,
    PositionSide.COLLATERAL,
    m,
    event,
  );
  return position;
}

export async function addSupplyPosition(
  context: Context,
  account: Account,
  market: Market,
  event: Ev,
  sharesSupplied: bigint,
  assets: bigint,
): Promise<Position> {
  const cId = counterId(account.id, market.id, PositionSide.SUPPLIER);
  const counter = await getOrCreateCounter(context, cId, event);
  const posId = positionId(counter);
  let position = await context.Position.get(posId);
  let m = market;
  if (!position) {
    const created = await createPosition(
      context,
      posId,
      account.id,
      market,
      PositionSide.SUPPLIER,
      event,
      TransactionType.DEPOSIT,
    );
    position = created.position;
    m = created.market;
  }
  const newShares = (position.shares ?? 0n) + sharesSupplied;
  const totalSupply = toAssetsDown(
    newShares,
    m.totalSupplyShares,
    m.totalSupply,
  );
  position = {
    ...position,
    shares: newShares,
    balance: totalSupply,
    principal: (position.principal ?? 0n) + assets,
    depositCount: position.depositCount + 1,
  };
  context.Position.set(position);
  await snapshotPosition(context, position, m, account.id, event);
  await countDailyActivePosition(
    context,
    counter,
    PositionSide.SUPPLIER,
    m,
    event,
  );
  return position;
}

export async function addBorrowPosition(
  context: Context,
  account: Account,
  market: Market,
  event: Ev,
  sharesBorrowed: bigint,
): Promise<Position> {
  const cId = counterId(account.id, market.id, PositionSide.BORROWER);
  const counter = await getOrCreateCounter(context, cId, event);
  const posId = positionId(counter);
  let position = await context.Position.get(posId);
  let m = market;
  if (!position) {
    const created = await createPosition(
      context,
      posId,
      account.id,
      market,
      PositionSide.BORROWER,
      event,
      TransactionType.BORROW,
    );
    position = created.position;
    m = created.market;
  }
  const amountBorrowed = toAssetsUp(
    sharesBorrowed,
    m.totalBorrowShares,
    m.totalBorrow,
  );
  const newShares = (position.shares ?? 0n) + sharesBorrowed;
  const totalBorrow = toAssetsUp(newShares, m.totalBorrowShares, m.totalBorrow);
  position = {
    ...position,
    shares: newShares,
    balance: totalBorrow,
    principal: (position.principal ?? 0n) + amountBorrowed,
    borrowCount: position.borrowCount + 1,
  };
  context.Position.set(position);
  await snapshotPosition(context, position, m, account.id, event);
  await countDailyActivePosition(
    context,
    counter,
    PositionSide.BORROWER,
    m,
    event,
  );
  return position;
}

export async function reduceCollateralPosition(
  context: Context,
  account: Account,
  market: Market,
  event: Ev,
  amountWithdrawn: bigint,
): Promise<Position> {
  const cId = counterId(account.id, market.id, PositionSide.COLLATERAL);
  const counter = await context._PositionCounter.get(cId);
  if (!counter) throw new Error(`[subtractPosition] counter ${cId} not found`);
  const posId = positionId(counter);
  let position = await context.Position.get(posId);
  if (!position) throw new Error(`[subtractPosition] position ${posId} not found`);

  position = {
    ...position,
    balance: position.balance - amountWithdrawn,
    principal: position.balance - amountWithdrawn,
    withdrawCount: position.withdrawCount + 1,
    withdrawCollateralCount: position.withdrawCollateralCount + 1,
  };
  context.Position.set(position);
  let m = market;
  if (position.balance === 0n) {
    const closed = await closePosition(context, position, m, event);
    position = closed.position;
    m = closed.market;
  }
  await snapshotPosition(context, position, m, account.id, event);
  await countDailyActivePosition(
    context,
    counter,
    PositionSide.COLLATERAL,
    m,
    event,
  );
  return position;
}

export async function reduceBorrowPosition(
  context: Context,
  account: Account,
  market: Market,
  event: Ev,
  sharesRepaid: bigint,
): Promise<Position> {
  const cId = counterId(account.id, market.id, PositionSide.BORROWER);
  const counter = await context._PositionCounter.get(cId);
  if (!counter) throw new Error(`[subtractPosition] counter ${cId} not found`);
  const posId = positionId(counter);
  let position = await context.Position.get(posId);
  if (!position) throw new Error(`[subtractPosition] position ${posId} not found`);

  const amountRepaid = toAssetsDown(
    sharesRepaid,
    market.totalBorrowShares,
    market.totalBorrow,
  );
  const newShares = (position.shares ?? 0n) - sharesRepaid;
  const totalBorrow = toAssetsUp(
    newShares,
    market.totalBorrowShares,
    market.totalBorrow,
  );
  position = {
    ...position,
    shares: newShares,
    balance: totalBorrow,
    principal: (position.principal ?? 0n) - amountRepaid,
    repayCount: position.repayCount + 1,
  };
  context.Position.set(position);
  let m = market;
  if (newShares === 0n) {
    const closed = await closePosition(context, position, m, event);
    position = closed.position;
    m = closed.market;
  }
  await snapshotPosition(context, position, m, account.id, event);
  await countDailyActivePosition(
    context,
    counter,
    PositionSide.BORROWER,
    m,
    event,
  );
  return position;
}

export async function reduceSupplyPosition(
  context: Context,
  account: Account,
  market: Market,
  event: Ev,
  sharesWithdrawn: bigint,
  assets: bigint,
): Promise<Position> {
  const cId = counterId(account.id, market.id, PositionSide.SUPPLIER);
  const counter = await context._PositionCounter.get(cId);
  if (!counter) throw new Error(`[subtractPosition] counter ${cId} not found`);
  const posId = positionId(counter);
  let position = await context.Position.get(posId);
  if (!position) throw new Error(`[subtractPosition] position ${posId} not found`);

  const newShares = (position.shares ?? 0n) - sharesWithdrawn;
  const totalSupply = toAssetsDown(
    newShares,
    market.totalSupplyShares,
    market.totalSupply,
  );
  position = {
    ...position,
    shares: newShares,
    balance: totalSupply,
    principal: (position.principal ?? 0n) - assets,
    withdrawCount: position.withdrawCount + 1,
  };
  context.Position.set(position);
  let m = market;
  if (newShares === 0n) {
    const closed = await closePosition(context, position, m, event);
    position = closed.position;
    m = closed.market;
  }
  await snapshotPosition(context, position, m, account.id, event);
  await countDailyActivePosition(
    context,
    counter,
    PositionSide.SUPPLIER,
    m,
    event,
  );
  return position;
}

void BigDecimal;
