/**
 * Port of src/operations/getOrCreate.ts (account + market position),
 * src/operations/get.ts (getComptroller), src/operations/update.ts (market
 * position supply/borrow), src/operations/updateXvs*State.ts, and
 * src/operations/create.ts (Transaction event creators).
 *
 * handleInitialization (block handler, filter: once) created the Comptroller
 * singleton on the first indexed block. envio has no once-block handler, so we
 * lazily create it with the same defaults (priceOracle = nullAddress,
 * closeFactorMantissa = 0, liquidationIncentive = 0). Once any real
 * NewPriceOracle / NewCloseFactor / NewLiquidationIncentive fires the values
 * converge — documented in MIGRATION.md.
 */
import type { Account, Comptroller, EvmOnEventContext, MarketPosition } from "envio";
import {
  NOT_AVAILABLE_BIG_INT,
  comptrollerAddress,
  nullAddress,
  oneBigInt,
  zeroBigInt32,
  BORROW,
  LIQUIDATE,
  MINT,
  MINT_BEHALF,
  REDEEM,
  REPAY,
  TRANSFER,
} from "../constants";
import { vTokenBorrowIndex } from "../effects/contracts";
import { getMarketId, getMarketPositionId, getTransactionId } from "../utilities/ids";

function intOrNA(value: bigint | null): bigint {
  return value === null ? NOT_AVAILABLE_BIG_INT : value;
}

/** Port of getComptroller + handleInitialization (lazy creation). */
export async function getOrCreateComptroller(context: EvmOnEventContext): Promise<Comptroller> {
  const existing = await context.Comptroller.get(comptrollerAddress);
  if (existing) {
    return existing;
  }
  const comptroller: Comptroller = {
    id: comptrollerAddress,
    address: comptrollerAddress,
    priceOracle: nullAddress,
    closeFactorMantissa: zeroBigInt32,
    liquidationIncentive: zeroBigInt32,
  };
  context.Comptroller.set(comptroller);
  return comptroller;
}

/** Port of getOrCreateAccount. */
export async function getOrCreateAccount(
  context: EvmOnEventContext,
  accountId: string,
): Promise<Account> {
  const id = accountId.toLowerCase();
  const existing = await context.Account.get(id);
  if (existing) {
    return existing;
  }
  const account: Account = {
    id,
    address: id,
    countLiquidated: 0,
    countLiquidator: 0,
    hasBorrowed: false,
  };
  context.Account.set(account);
  return account;
}

export type GetOrCreateMarketPositionReturn = {
  entity: MarketPosition;
  created: boolean;
};

/** Port of getOrCreateMarketPosition. `block` pins try_borrowIndex (state read). */
export async function getOrCreateMarketPosition(
  context: EvmOnEventContext,
  accountId: string,
  marketId: string,
  block: number,
): Promise<GetOrCreateMarketPositionReturn> {
  const id = getMarketPositionId(accountId, marketId);
  const existing = await context.MarketPosition.get(id);
  if (existing) {
    return { entity: existing, created: false };
  }
  await getOrCreateAccount(context, accountId);
  const borrowIndex = intOrNA(await vTokenBorrowIndex(context.effect, marketId, block));
  const marketPosition: MarketPosition = {
    id,
    market_id: getMarketId(marketId),
    account_id: accountId.toLowerCase(),
    vTokenBalanceMantissa: zeroBigInt32,
    totalUnderlyingRedeemedMantissa: zeroBigInt32,
    totalUnderlyingRepaidMantissa: zeroBigInt32,
    storedBorrowBalanceMantissa: zeroBigInt32,
    accrualBlockNumber: zeroBigInt32,
    borrowIndex,
    enteredMarket: false,
  };
  context.MarketPosition.set(marketPosition);
  return { entity: marketPosition, created: true };
}

/** Port of updateMarketPositionAccrualBlockNumber. */
export async function updateMarketPositionAccrualBlockNumber(
  context: EvmOnEventContext,
  accountAddress: string,
  marketAddress: string,
  blockNumber: bigint,
  block: number,
): Promise<MarketPosition> {
  await getOrCreateAccount(context, accountAddress);
  const result = await getOrCreateMarketPosition(context, accountAddress, marketAddress, block);
  const entity = { ...result.entity, accrualBlockNumber: blockNumber };
  context.MarketPosition.set(entity);
  return entity;
}

/** Port of updateMarketPositionSupply. */
export async function updateMarketPositionSupply(
  context: EvmOnEventContext,
  accountAddress: string,
  marketAddress: string,
  blockNumber: bigint,
  accountSupplyBalanceMantissa: bigint,
  block: number,
): Promise<MarketPosition> {
  const market = await context.Market.getOrThrow(getMarketId(marketAddress));
  const marketPosition = await updateMarketPositionAccrualBlockNumber(
    context,
    accountAddress,
    marketAddress,
    blockNumber,
    block,
  );
  const previousBalance = marketPosition.vTokenBalanceMantissa;
  const updated = { ...marketPosition, vTokenBalanceMantissa: accountSupplyBalanceMantissa };
  context.MarketPosition.set(updated);

  if (previousBalance === zeroBigInt32 && accountSupplyBalanceMantissa !== zeroBigInt32) {
    context.Market.set({ ...market, supplierCount: market.supplierCount + oneBigInt });
  } else if (accountSupplyBalanceMantissa === zeroBigInt32 && previousBalance !== zeroBigInt32) {
    context.Market.set({ ...market, supplierCount: market.supplierCount - oneBigInt });
  }
  return updated;
}

/** Port of updateMarketPositionBorrow. */
export async function updateMarketPositionBorrow(
  context: EvmOnEventContext,
  accountAddress: string,
  marketAddress: string,
  blockNumber: bigint,
  accountBorrows: bigint,
  block: number,
): Promise<MarketPosition> {
  const market = await context.Market.getOrThrow(getMarketId(marketAddress));
  const marketPosition = await updateMarketPositionAccrualBlockNumber(
    context,
    accountAddress,
    marketAddress,
    blockNumber,
    block,
  );
  const previousBorrow = marketPosition.storedBorrowBalanceMantissa;
  const borrowIndex = intOrNA(await vTokenBorrowIndex(context.effect, marketAddress, block));
  const updated = {
    ...marketPosition,
    storedBorrowBalanceMantissa: accountBorrows,
    borrowIndex,
  };
  context.MarketPosition.set(updated);

  if (previousBorrow === zeroBigInt32 && accountBorrows !== zeroBigInt32) {
    context.Market.set({ ...market, borrowerCount: market.borrowerCount + oneBigInt });
  } else if (accountBorrows === zeroBigInt32 && previousBorrow !== zeroBigInt32) {
    context.Market.set({ ...market, borrowerCount: market.borrowerCount - oneBigInt });
  }
  return updated;
}

// ---- Transaction event creators (operations/create.ts) ----

type TxEventInput = {
  txHash: string;
  logIndex: number;
  amountMantissa: bigint;
  to: string;
  from: string;
  blockNumber: number;
  blockTime: number;
};

function createTransaction(
  context: EvmOnEventContext,
  type:
    | typeof MINT
    | typeof MINT_BEHALF
    | typeof REDEEM
    | typeof BORROW
    | typeof REPAY
    | typeof LIQUIDATE
    | typeof TRANSFER,
  input: TxEventInput,
): void {
  context.Transaction.set({
    id: getTransactionId(input.txHash, input.logIndex),
    type,
    amountMantissa: input.amountMantissa,
    to: input.to.toLowerCase(),
    from: input.from.toLowerCase(),
    blockNumber: input.blockNumber,
    blockTime: input.blockTime,
  });
}

export const createMintEvent = (context: EvmOnEventContext, input: TxEventInput) =>
  createTransaction(context, MINT, input);
export const createMintBehalfEvent = (context: EvmOnEventContext, input: TxEventInput) =>
  createTransaction(context, MINT_BEHALF, input);
export const createRedeemEvent = (context: EvmOnEventContext, input: TxEventInput) =>
  createTransaction(context, REDEEM, input);
export const createBorrowEvent = (context: EvmOnEventContext, input: TxEventInput) =>
  createTransaction(context, BORROW, input);
export const createRepayEvent = (context: EvmOnEventContext, input: TxEventInput) =>
  createTransaction(context, REPAY, input);
export const createLiquidationEvent = (context: EvmOnEventContext, input: TxEventInput) =>
  createTransaction(context, LIQUIDATE, input);
export const createTransferEvent = (context: EvmOnEventContext, input: TxEventInput) =>
  createTransaction(context, TRANSFER, input);
