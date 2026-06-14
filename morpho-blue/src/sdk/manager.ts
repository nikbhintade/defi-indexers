/**
 * Ported from src/sdk/manager.ts (DataManager). Creates Deposit/Withdraw/
 * Borrow/Repay/Liquidate/Flashloan event entities and updates market/protocol
 * aggregates + snapshots. `createDataManager` mirrors the constructor (loads
 * tokens + builds the snapshot set); each create* is a method that also bumps
 * transaction/usage data.
 *
 * Only the methods reachable from the active Morpho handlers are ported
 * (revenue/fee helpers in the source are dead code — see MIGRATION.md).
 */
import type { Context, Ev } from "../context";
import {
  BigDecimal,
  type Borrow,
  type Deposit,
  type EffectCaller,
  type Flashloan,
  type InterestRate,
  type Liquidate,
  type Market,
  type Position,
  type Repay,
  type Withdraw,
} from "envio";
import {
  BIGDECIMAL_WAD,
  BIGDECIMAL_ZERO,
  INT_ONE,
  Transaction,
  TransactionType,
  exponentToBigDecimal,
  toBD,
} from "./constants";
import { getProtocol } from "../initializers/protocol";
import { getMarket } from "../initializers/markets";
import { getAmountUSD, getOrCreateToken, updateTokenPrice } from "./token";
import { getOrCreateAccount } from "./account";
import {
  createSnapshots,
  updateSnapshotTransactionData,
  updateSnapshotUsageData,
  type SnapshotSet,
} from "./snapshots";
import { irmBorrowRateView } from "../effects/contracts";
import { concatI32, low } from "../utils/graphBytes";
import { cloneRates } from "../utils/rate";

/** cloneRates(market.rates, ts) with the source's null-guard (-> []). */
async function eventRates(
  context: Context,
  market: Market,
  timestamp: bigint,
): Promise<string[]> {
  if (!market.rates) return [];
  return cloneRates(context, market.rates, timestamp);
}

export type DataManager = {
  market: Market;
  snaps: SnapshotSet;
  event: Ev;
};

export async function createDataManager(
  context: Context,
  marketID: string,
  event: Ev,
): Promise<DataManager> {
  const market = await getMarket(context, marketID);
  const snaps = await createSnapshots(context, market, event);
  return { market, snaps, event };
}

function eventBase(event: Ev) {
  return {
    hash: event.transaction.hash.toLowerCase(),
    nonce: event.transaction.nonce,
    logIndex: event.logIndex,
    gasPrice: event.transaction.gasPrice,
    gasUsed: undefined,
    gasLimit: event.transaction.gas,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
  };
}

function txId(event: Ev, txEnum: number): string {
  return concatI32(
    concatI32(event.transaction.hash.toLowerCase(), event.logIndex),
    txEnum,
  );
}

async function updateTransactionData(
  context: Context,
  dm: DataManager,
  transactionType: string,
  amount: bigint,
  amountUSD: BigDecimal,
): Promise<void> {
  const protocol = await getProtocol(context);
  let m = await getMarket(context, dm.market.id);
  let p = { ...protocol };
  if (
    transactionType === TransactionType.DEPOSIT ||
    transactionType === TransactionType.DEPOSIT_COLLATERAL
  ) {
    p.depositCount += INT_ONE;
    p.cumulativeDepositUSD = p.cumulativeDepositUSD.plus(amountUSD);
    m = { ...m, cumulativeDepositUSD: m.cumulativeDepositUSD.plus(amountUSD), depositCount: m.depositCount + INT_ONE };
  } else if (
    transactionType === TransactionType.WITHDRAW ||
    transactionType === TransactionType.WITHDRAW_COLLATERAL
  ) {
    p.withdrawCount += INT_ONE;
    m = { ...m, withdrawCount: m.withdrawCount + INT_ONE };
  } else if (transactionType === TransactionType.BORROW) {
    p.borrowCount += INT_ONE;
    p.cumulativeBorrowUSD = p.cumulativeBorrowUSD.plus(amountUSD);
    m = { ...m, cumulativeBorrowUSD: m.cumulativeBorrowUSD.plus(amountUSD), borrowCount: m.borrowCount + INT_ONE };
  } else if (transactionType === TransactionType.REPAY) {
    p.repayCount += INT_ONE;
    m = { ...m, repayCount: m.repayCount + INT_ONE };
  } else if (transactionType === TransactionType.LIQUIDATE) {
    p.liquidationCount += INT_ONE;
    p.cumulativeLiquidateUSD = p.cumulativeLiquidateUSD.plus(amountUSD);
    m = { ...m, cumulativeLiquidateUSD: m.cumulativeLiquidateUSD.plus(amountUSD), liquidationCount: m.liquidationCount + INT_ONE };
  } else if (transactionType === TransactionType.FLASHLOAN) {
    p.flashloanCount += INT_ONE;
    m = { ...m, cumulativeFlashloanUSD: m.cumulativeFlashloanUSD.plus(amountUSD), flashloanCount: m.flashloanCount + INT_ONE };
  } else {
    return;
  }
  p.transactionCount += INT_ONE;
  m = { ...m, transactionCount: m.transactionCount + INT_ONE };
  context.LendingProtocol.set(p);
  context.Market.set(m);
  dm.market = m;

  updateSnapshotTransactionData(context, dm.snaps, transactionType, amount, amountUSD);
}

async function updateUsageData(
  context: Context,
  dm: DataManager,
  transactionType: string,
  account: string,
): Promise<void> {
  // Source bumps market/protocol cumulativeUnique* via activityCounter; here
  // we delegate the snapshot side (which holds the _ActiveAccount markers) and
  // mirror the market/protocol cumulative bumps.
  await updateSnapshotUsageData(context, dm.snaps, dm.market, transactionType, account);
}

export async function updateMarketAndProtocolData(
  context: Context,
  dm: DataManager,
): Promise<void> {
  let market = await getMarket(context, dm.market.id);
  const inputToken = await getOrCreateToken(context, market.inputToken_id);
  const borrowedToken = await getOrCreateToken(context, market.borrowedToken_id);

  const inUpd = await updateTokenPrice(context, inputToken, Number(dm.event.block.number));
  const boUpd = await updateTokenPrice(context, borrowedToken, Number(dm.event.block.number));
  const inputTokenPriceUSD = inUpd.priceUSD;
  const borrowableTokenPriceUSD = boUpd.priceUSD;

  const totalCollateralUSD = toBD(market.totalCollateral)
    .div(exponentToBigDecimal(inUpd.token.decimals))
    .times(inputTokenPriceUSD);
  const totalSupplyUSD = toBD(market.totalSupply)
    .div(exponentToBigDecimal(boUpd.token.decimals))
    .times(borrowableTokenPriceUSD);
  const totalBorrowUSD = toBD(market.totalBorrow)
    .div(exponentToBigDecimal(boUpd.token.decimals))
    .times(borrowableTokenPriceUSD);

  const tvl = totalCollateralUSD.plus(totalSupplyUSD);
  market = {
    ...market,
    inputTokenPriceUSD,
    totalBorrowBalanceUSD: totalBorrowUSD,
    totalValueLockedUSD: tvl,
    totalDepositBalanceUSD: tvl,
  };
  context.Market.set(market);

  await updateInterestRates(context, market, Number(dm.event.block.number));
  // reload after interest-rate update may have re-set the market.rates
  market = await getMarket(context, market.id);
  dm.market = market;

  // PROTOCOL aggregation across all markets
  let protocol = await getProtocol(context);
  const marketList = (await context._MarketList.get(protocol.id))?.markets ?? [];
  let totalValueLockedUSD = BIGDECIMAL_ZERO;
  let totalBorrowBalanceUSD = BIGDECIMAL_ZERO;
  for (const mid of marketList) {
    const mkt = await context.Market.get(mid);
    if (!mkt) continue;
    totalValueLockedUSD = totalValueLockedUSD.plus(mkt.totalValueLockedUSD);
    totalBorrowBalanceUSD = totalBorrowBalanceUSD.plus(mkt.totalBorrowBalanceUSD);
  }
  context.LendingProtocol.set({
    ...protocol,
    totalValueLockedUSD,
    totalDepositBalanceUSD: totalValueLockedUSD,
    totalBorrowBalanceUSD,
  });
}

async function updateInterestRates(
  context: Context,
  market: Market,
  block: number,
): Promise<void> {
  const irmAddress = low(market.irm);
  if (irmAddress === "0x0000000000000000000000000000000000000000") return;
  if (market.totalBorrow === 0n) return;

  // Oracle address is the trailing 20 bytes of the oracle id (marketId+oracle).
  const borrowRateTry = await irmBorrowRateView(
    context.effect,
    irmAddress,
    {
      loanToken: market.borrowedToken_id,
      collateralToken: market.inputToken_id,
      oracle: oracleAddressFromId(market.id, market.oracle_id),
      irm: irmAddress,
      lltv: market.lltv,
    },
    {
      totalSupplyAssets: market.totalSupply,
      totalSupplyShares: market.totalSupplyShares,
      totalBorrowAssets: market.totalBorrow,
      totalBorrowShares: market.totalBorrowShares,
      lastUpdate: market.lastUpdate,
      fee: market.fee,
    },
    block, // state-dependent, pinned to event block
  );
  if (borrowRateTry === null) return;

  const secondsPerYear = new BigDecimal("31536000");
  const borrowRate = toBD(borrowRateTry).div(BIGDECIMAL_WAD).times(secondsPerYear);
  const utilization = toBD((market.totalBorrow * BIGDECIMAL_WAD_BIGINT) / market.totalSupply).div(BIGDECIMAL_WAD);
  const feesPercent = new BigDecimal("1").minus(toBD(market.fee).div(BIGDECIMAL_WAD));
  const supplyRate = borrowRate.times(utilization).times(feesPercent);

  const supplyRateId = market.id + "-supply";
  const borrowRateId = market.id + "-borrow";
  const supplyRateSnap = await context.InterestRate.get(supplyRateId);
  if (!supplyRateSnap) return;
  context.InterestRate.set({ ...supplyRateSnap, rate: supplyRate });
  const borrowRateSnap = await context.InterestRate.get(borrowRateId);
  if (!borrowRateSnap) return;
  context.InterestRate.set({ ...borrowRateSnap, rate: borrowRate });

  context.Market.set({ ...market, rates: [supplyRateId, borrowRateId] });
}

const BIGDECIMAL_WAD_BIGINT = 10n ** 18n;

// oracle id is hexConcat(marketId, oracleAddress); the address is the trailing
// 20 bytes (40 hex chars) of the oracle id.
function oracleAddressFromId(_marketId: string, oracleId: string): string {
  const clean = oracleId.startsWith("0x") ? oracleId.slice(2) : oracleId;
  return "0x" + clean.slice(clean.length - 40);
}

// ---------------- create* event entities ----------------

export async function createDeposit(
  context: Context,
  dm: DataManager,
  position: Position,
  amount: bigint,
  shares: bigint,
): Promise<Deposit> {
  const token = await getOrCreateToken(context, dm.market.inputToken_id);
  const amountUSD = getAmountUSD(token, amount);
  const deposit: Deposit = {
    id: txId(dm.event, Transaction.DEPOSIT),
    ...eventBase(dm.event),
    account_id: position.account_id,
    accountActor_id: undefined,
    market_id: dm.market.id,
    position_id: position.id,
    asset_id: position.asset_id,
    amount,
    amountUSD,
    isCollateral: false,
    shares,
    rates: await eventRates(context, dm.market, dm.event.block.timestamp),
  };
  context.Deposit.set(deposit);
  await updateTransactionData(context, dm, TransactionType.DEPOSIT, amount, amountUSD);
  await updateUsageData(context, dm, TransactionType.DEPOSIT, position.account_id);
  return deposit;
}

export async function createDepositCollateral(
  context: Context,
  dm: DataManager,
  position: Position,
  amount: bigint,
): Promise<Deposit> {
  const token = await getOrCreateToken(context, dm.market.inputToken_id);
  const amountUSD = getAmountUSD(token, amount);
  const deposit: Deposit = {
    id: txId(dm.event, Transaction.DEPOSIT),
    ...eventBase(dm.event),
    account_id: position.account_id,
    accountActor_id: undefined,
    market_id: dm.market.id,
    position_id: position.id,
    asset_id: position.asset_id,
    amount,
    amountUSD,
    isCollateral: true,
    shares: undefined,
    rates: await eventRates(context, dm.market, dm.event.block.timestamp),
  };
  context.Deposit.set(deposit);
  await updateTransactionData(context, dm, TransactionType.DEPOSIT_COLLATERAL, amount, amountUSD);
  await updateUsageData(context, dm, TransactionType.DEPOSIT_COLLATERAL, position.account_id);
  return deposit;
}

export async function createWithdraw(
  context: Context,
  dm: DataManager,
  position: Position,
  amount: bigint,
  shares: bigint,
): Promise<Withdraw> {
  const token = await getOrCreateToken(context, dm.market.borrowedToken_id);
  const amountUSD = getAmountUSD(token, amount);
  const withdraw: Withdraw = {
    id: txId(dm.event, Transaction.WITHDRAW),
    ...eventBase(dm.event),
    account_id: position.account_id,
    accountActor_id: undefined,
    market_id: dm.market.id,
    position_id: position.id,
    asset_id: dm.market.borrowedToken_id,
    amount,
    amountUSD,
    isCollateral: false,
    shares,
    rates: await eventRates(context, dm.market, dm.event.block.timestamp),
  };
  context.Withdraw.set(withdraw);
  await updateTransactionData(context, dm, TransactionType.WITHDRAW, amount, amountUSD);
  await updateUsageData(context, dm, TransactionType.WITHDRAW, position.account_id);
  return withdraw;
}

export async function createWithdrawCollateral(
  context: Context,
  dm: DataManager,
  position: Position,
  amount: bigint,
): Promise<Withdraw> {
  const token = await getOrCreateToken(context, dm.market.inputToken_id);
  const amountUSD = getAmountUSD(token, amount);
  const withdraw: Withdraw = {
    id: txId(dm.event, Transaction.WITHDRAW),
    ...eventBase(dm.event),
    account_id: position.account_id,
    accountActor_id: undefined,
    market_id: dm.market.id,
    position_id: position.id,
    asset_id: position.asset_id,
    amount,
    amountUSD,
    isCollateral: true,
    shares: undefined,
    rates: await eventRates(context, dm.market, dm.event.block.timestamp),
  };
  context.Withdraw.set(withdraw);
  await updateTransactionData(context, dm, TransactionType.WITHDRAW_COLLATERAL, amount, amountUSD);
  await updateUsageData(context, dm, TransactionType.WITHDRAW_COLLATERAL, position.account_id);
  return withdraw;
}

export async function createBorrow(
  context: Context,
  dm: DataManager,
  position: Position,
  amount: bigint,
  shares: bigint,
): Promise<Borrow> {
  const token = await getOrCreateToken(context, dm.market.borrowedToken_id);
  const amountUSD = getAmountUSD(token, amount);
  const borrow: Borrow = {
    id: txId(dm.event, Transaction.BORROW),
    ...eventBase(dm.event),
    account_id: position.account_id,
    accountActor_id: undefined,
    market_id: dm.market.id,
    position_id: position.id,
    asset_id: dm.market.borrowedToken_id,
    amount,
    amountUSD,
    shares,
    rates: await eventRates(context, dm.market, dm.event.block.timestamp),
  };
  context.Borrow.set(borrow);
  await updateTransactionData(context, dm, TransactionType.BORROW, amount, amountUSD);
  await updateUsageData(context, dm, TransactionType.BORROW, position.account_id);
  return borrow;
}

export async function createRepay(
  context: Context,
  dm: DataManager,
  position: Position,
  amount: bigint,
  shares: bigint,
): Promise<Repay> {
  const token = await getOrCreateToken(context, dm.market.borrowedToken_id);
  const amountUSD = getAmountUSD(token, amount);
  const repay: Repay = {
    id: txId(dm.event, Transaction.REPAY),
    ...eventBase(dm.event),
    account_id: position.account_id,
    accountActor_id: undefined,
    market_id: dm.market.id,
    position_id: position.id,
    asset_id: position.asset_id,
    amount,
    amountUSD,
    shares,
    rates: await eventRates(context, dm.market, dm.event.block.timestamp),
  };
  context.Repay.set(repay);
  await updateTransactionData(context, dm, TransactionType.REPAY, amount, amountUSD);
  await updateUsageData(context, dm, TransactionType.REPAY, position.account_id);
  return repay;
}

export async function createLiquidate(
  context: Context,
  dm: DataManager,
  liquidatorId: string,
  borrowPosition: Position,
  collateralPosition: Position,
  repaid: bigint,
  seized: bigint,
): Promise<Liquidate> {
  const token = await getOrCreateToken(context, dm.market.borrowedToken_id);
  const collateralToken = await getOrCreateToken(context, dm.market.inputToken_id);

  const seizedUSD = getAmountUSD(token, repaid);
  const repaidUSD = getAmountUSD(collateralToken, repaid);
  const liquidate: Liquidate = {
    id: txId(dm.event, Transaction.DEPOSIT), // source uses Transaction.DEPOSIT here (bug preserved)
    ...eventBase(dm.event),
    liquidator_id: liquidatorId,
    liquidatee_id: borrowPosition.account_id,
    market_id: dm.market.id,
    positions: [borrowPosition.id, collateralPosition.id],
    asset_id: token.id,
    amount: seized,
    collateralAsset_id: collateralToken.id,
    repaid,
    repaidUSD,
    amountUSD: seizedUSD,
    profitUSD: seizedUSD.minus(repaidUSD),
  };
  context.Liquidate.set(liquidate);
  await updateTransactionData(context, dm, TransactionType.LIQUIDATE, seized, seizedUSD);
  await updateUsageData(context, dm, TransactionType.LIQUIDATE, borrowPosition.account_id);
  return liquidate;
}

export async function createFlashloan(
  context: Context,
  dm: DataManager,
  asset: string,
  account: string,
  amount: bigint,
): Promise<Flashloan> {
  const flashloaner = await getOrCreateAccount(context, account);
  context.Account.set({
    ...flashloaner,
    flashloanCount: flashloaner.flashloanCount + INT_ONE,
  });

  const token = await getOrCreateToken(context, low(asset));
  const amountUSD = getAmountUSD(token, amount);
  const flashloan: Flashloan = {
    id: txId(dm.event, Transaction.FLASHLOAN),
    ...eventBase(dm.event),
    account_id: low(account),
    accountActor_id: undefined,
    market_id: dm.market.id,
    asset_id: low(asset),
    amount,
    amountUSD,
    feeAmount: undefined,
    feeAmountUSD: undefined,
  };
  context.Flashloan.set(flashloan);
  await updateTransactionData(context, dm, TransactionType.FLASHLOAN, amount, amountUSD);
  await updateUsageData(context, dm, TransactionType.FLASHLOAN, low(account));
  return flashloan;
}
