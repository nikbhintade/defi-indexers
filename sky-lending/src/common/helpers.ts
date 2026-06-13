/**
 * Port of src/common/helpers.ts. Store mutations go through `context`; each
 * AssemblyScript entity field mutation + `.save()` becomes a mutable working
 * copy + `ctx.X.set(...)`.
 */
import { BigDecimal } from "envio";
import type { Market, Position } from "envio";
import type { Ctx, EventInfo, Mutable } from "./types";
import {
  BIGDECIMAL_ZERO,
  BIGINT_ZERO,
  BIGINT_NEG_ONE,
  BIGDECIMAL_NEG_ONE,
  BIGINT_NEG_HUNDRED,
  DAI_ADDRESS,
  ProtocolSideRevenueType,
  INT_ONE,
  PositionSide,
  SECONDS_PER_HOUR,
  SECONDS_PER_DAY,
} from "./constants";
import { createEventID } from "../utils/strings";
import { bigIntToBDUseDecimals } from "../utils/numbers";
import {
  getOrCreateLendingProtocol,
  getOrCreateMarket,
  getOrCreateAccount,
  getOrCreateToken,
  getOrCreatePosition,
  getMarketAddressFromIlk,
  getMarketFromIlk,
  getOpenPosition,
  getOwnerAddress,
  getOrCreateFinancials,
  getOrCreateMarketHourlySnapshot,
  getOrCreateMarketDailySnapshot,
  getOrCreateUsageMetricsHourlySnapshot,
  getOrCreateUsageMetricsDailySnapshot,
  getSnapshotRates,
} from "./getters";
import { daiTotalSupply } from "../effects/contracts";
import { VAT_ADDRESS } from "./constants";

export async function updateProtocol(
  ctx: Ctx,
  event: EventInfo,
  deltaCollateralUSD: BigDecimal = BIGDECIMAL_ZERO,
  deltaDebtUSD: BigDecimal = BIGDECIMAL_ZERO,
  liquidateUSD: BigDecimal = BIGDECIMAL_ZERO,
  newTotalRevenueUSD: BigDecimal = BIGDECIMAL_ZERO,
  newSupplySideRevenueUSD: BigDecimal = BIGDECIMAL_ZERO,
  protocolSideRevenueType = 0,
): Promise<void> {
  const protocol: Mutable<Awaited<ReturnType<typeof getOrCreateLendingProtocol>>> = {
    ...(await getOrCreateLendingProtocol(ctx)),
  };

  if (deltaCollateralUSD.gt(BIGDECIMAL_ZERO)) {
    protocol.cumulativeDepositUSD = protocol.cumulativeDepositUSD.plus(deltaCollateralUSD);
  }

  let totalBorrowBalanceUSD = BIGDECIMAL_ZERO;
  let totalDepositBalanceUSD = BIGDECIMAL_ZERO;
  for (let i = 0; i < protocol.marketIDList.length; i++) {
    const market = await ctx.Market.get(protocol.marketIDList[i]!);
    if (!market) continue;
    totalBorrowBalanceUSD = totalBorrowBalanceUSD.plus(market.totalBorrowBalanceUSD);
    totalDepositBalanceUSD = totalDepositBalanceUSD.plus(market.totalDepositBalanceUSD);
  }
  protocol.totalBorrowBalanceUSD = totalBorrowBalanceUSD;
  protocol.totalDepositBalanceUSD = totalDepositBalanceUSD;
  protocol.totalValueLockedUSD = protocol.totalDepositBalanceUSD;

  if (deltaDebtUSD.gt(BIGDECIMAL_ZERO)) {
    protocol.cumulativeBorrowUSD = protocol.cumulativeBorrowUSD.plus(deltaDebtUSD);
  }
  if (liquidateUSD.gt(BIGDECIMAL_ZERO)) {
    protocol.cumulativeLiquidateUSD = protocol.cumulativeLiquidateUSD.plus(liquidateUSD);
  }
  if (newTotalRevenueUSD.gt(BIGDECIMAL_ZERO)) {
    protocol.cumulativeTotalRevenueUSD = protocol.cumulativeTotalRevenueUSD.plus(newTotalRevenueUSD);
  }
  if (newSupplySideRevenueUSD.gt(BIGDECIMAL_ZERO)) {
    protocol.cumulativeSupplySideRevenueUSD =
      protocol.cumulativeSupplySideRevenueUSD.plus(newSupplySideRevenueUSD);
  }

  const newProtocolSideRevenueUSD = newTotalRevenueUSD.minus(newSupplySideRevenueUSD);
  if (newProtocolSideRevenueUSD.gt(BIGDECIMAL_ZERO)) {
    protocol.cumulativeProtocolSideRevenueUSD = protocol.cumulativeTotalRevenueUSD.minus(
      protocol.cumulativeSupplySideRevenueUSD,
    );
    switch (protocolSideRevenueType) {
      case ProtocolSideRevenueType.STABILITYFEE:
        protocol._cumulativeProtocolSideStabilityFeeRevenue =
          protocol._cumulativeProtocolSideStabilityFeeRevenue!.plus(newProtocolSideRevenueUSD);
        break;
      case ProtocolSideRevenueType.LIQUIDATION:
        protocol._cumulativeProtocolSideLiquidationRevenue =
          protocol._cumulativeProtocolSideLiquidationRevenue!.plus(newProtocolSideRevenueUSD);
        break;
      case ProtocolSideRevenueType.PSM:
        protocol._cumulativeProtocolSidePSMRevenue =
          protocol._cumulativeProtocolSidePSMRevenue!.plus(newProtocolSideRevenueUSD);
        break;
    }
  }

  // mintedTokenSupplies = [DAI.totalSupply()]
  const supply = await daiTotalSupply(event.effect, DAI_ADDRESS, Number(event.blockNumber));
  protocol.mintedTokens = [DAI_ADDRESS];
  protocol.mintedTokenSupplies = supply == null ? [BIGINT_ZERO] : [supply];

  ctx.LendingProtocol.set(protocol);
}

export async function updateMarket(
  ctx: Ctx,
  event: EventInfo,
  marketInput: Market,
  deltaCollateral: bigint = BIGINT_ZERO,
  deltaCollateralUSD: BigDecimal = BIGDECIMAL_ZERO,
  deltaDebtUSD: BigDecimal = BIGDECIMAL_ZERO,
  liquidateUSD: BigDecimal = BIGDECIMAL_ZERO,
  newTotalRevenueUSD: BigDecimal = BIGDECIMAL_ZERO,
  newSupplySideRevenueUSD: BigDecimal = BIGDECIMAL_ZERO,
): Promise<void> {
  // Re-read the latest market from the store: earlier helpers in the same
  // event (e.g. updatePosition) may have mutated counters on the persisted
  // copy. graph-node returned the same in-memory entity; HyperIndex hands us
  // immutable snapshots, so the caller's `marketInput` can be stale.
  const latest = await ctx.Market.get(marketInput.id);
  const market: Mutable<Market> = { ...(latest ?? marketInput) };
  const token = await getOrCreateToken(ctx, market.inputToken_id);

  if (deltaCollateral !== BIGINT_ZERO) {
    market.inputTokenBalance = market.inputTokenBalance + deltaCollateral;
    if (deltaCollateral > BIGINT_ZERO) {
      market.cumulativeDepositUSD = market.cumulativeDepositUSD.plus(deltaCollateralUSD);
    }
  }

  if (token.lastPriceUSD) {
    market.inputTokenPriceUSD = token.lastPriceUSD;
    market.totalDepositBalanceUSD = bigIntToBDUseDecimals(
      market.inputTokenBalance,
      token.decimals,
    ).times(market.inputTokenPriceUSD);
  } else if (!deltaCollateralUSD.eq(BIGDECIMAL_ZERO)) {
    market.totalDepositBalanceUSD = market.totalDepositBalanceUSD.plus(deltaCollateralUSD);
  }
  market.totalValueLockedUSD = market.totalDepositBalanceUSD;

  if (!deltaDebtUSD.eq(BIGDECIMAL_ZERO)) {
    market.totalBorrowBalanceUSD = market.totalBorrowBalanceUSD.plus(deltaDebtUSD);
    if (deltaDebtUSD.gt(BIGDECIMAL_ZERO)) {
      market.cumulativeBorrowUSD = market.cumulativeBorrowUSD.plus(deltaDebtUSD);
    }
  }

  if (liquidateUSD.gt(BIGDECIMAL_ZERO)) {
    market.cumulativeLiquidateUSD = market.cumulativeLiquidateUSD.plus(liquidateUSD);
  }
  if (newTotalRevenueUSD.gt(BIGDECIMAL_ZERO)) {
    market.cumulativeTotalRevenueUSD = market.cumulativeTotalRevenueUSD.plus(newTotalRevenueUSD);
  }
  if (newSupplySideRevenueUSD.gt(BIGDECIMAL_ZERO)) {
    market.cumulativeSupplySideRevenueUSD =
      market.cumulativeSupplySideRevenueUSD.plus(newSupplySideRevenueUSD);
  }
  if (newTotalRevenueUSD.gt(BIGDECIMAL_ZERO) || newSupplySideRevenueUSD.gt(BIGDECIMAL_ZERO)) {
    market.cumulativeProtocolSideRevenueUSD = market.cumulativeTotalRevenueUSD.minus(
      market.cumulativeSupplySideRevenueUSD,
    );
  }

  ctx.Market.set(market);

  await snapshotMarket(
    ctx,
    event,
    market,
    deltaCollateralUSD,
    deltaDebtUSD,
    liquidateUSD,
    newTotalRevenueUSD,
    newSupplySideRevenueUSD,
  );
}

export async function snapshotMarket(
  ctx: Ctx,
  event: EventInfo,
  market: Market,
  deltaCollateralUSD: BigDecimal = BIGDECIMAL_ZERO,
  deltaDebtUSD: BigDecimal = BIGDECIMAL_ZERO,
  liquidateUSD: BigDecimal = BIGDECIMAL_ZERO,
  newTotalRevenueUSD: BigDecimal = BIGDECIMAL_ZERO,
  newSupplySideRevenueUSD: BigDecimal = BIGDECIMAL_ZERO,
): Promise<void> {
  const marketID = market.id;
  const hourly = await getOrCreateMarketHourlySnapshot(ctx, event, marketID);
  const daily = await getOrCreateMarketDailySnapshot(ctx, event, marketID);

  const hours = (event.timestamp / BigInt(SECONDS_PER_HOUR)).toString();
  const hourlySnapshotRates = await getSnapshotRates(ctx, market.rates, hours);
  const days = (event.timestamp / BigInt(SECONDS_PER_DAY)).toString();
  const dailySnapshotRates = await getSnapshotRates(ctx, market.rates, days);

  hourly.totalValueLockedUSD = market.totalValueLockedUSD;
  hourly.totalBorrowBalanceUSD = market.totalBorrowBalanceUSD;
  hourly.cumulativeSupplySideRevenueUSD = market.cumulativeSupplySideRevenueUSD;
  hourly.cumulativeProtocolSideRevenueUSD = market.cumulativeProtocolSideRevenueUSD;
  hourly.cumulativeTotalRevenueUSD = market.cumulativeTotalRevenueUSD;
  hourly.totalDepositBalanceUSD = market.totalDepositBalanceUSD;
  hourly.cumulativeDepositUSD = market.cumulativeDepositUSD;
  hourly.cumulativeBorrowUSD = market.cumulativeBorrowUSD;
  hourly.cumulativeLiquidateUSD = market.cumulativeLiquidateUSD;
  hourly.inputTokenBalance = market.inputTokenBalance;
  hourly.inputTokenPriceUSD = market.inputTokenPriceUSD;
  hourly.rates = hourlySnapshotRates;
  hourly.blockNumber = event.blockNumber;
  hourly.timestamp = event.timestamp;

  daily.totalValueLockedUSD = market.totalValueLockedUSD;
  daily.totalBorrowBalanceUSD = market.totalBorrowBalanceUSD;
  daily.cumulativeSupplySideRevenueUSD = market.cumulativeSupplySideRevenueUSD;
  daily.cumulativeProtocolSideRevenueUSD = market.cumulativeProtocolSideRevenueUSD;
  daily.cumulativeTotalRevenueUSD = market.cumulativeTotalRevenueUSD;
  daily.totalDepositBalanceUSD = market.totalDepositBalanceUSD;
  daily.cumulativeDepositUSD = market.cumulativeDepositUSD;
  daily.cumulativeBorrowUSD = market.cumulativeBorrowUSD;
  daily.cumulativeLiquidateUSD = market.cumulativeLiquidateUSD;
  daily.inputTokenBalance = market.inputTokenBalance;
  daily.inputTokenPriceUSD = market.inputTokenPriceUSD;
  daily.rates = dailySnapshotRates;
  daily.blockNumber = event.blockNumber;
  daily.timestamp = event.timestamp;

  if (deltaCollateralUSD.gt(BIGDECIMAL_ZERO)) {
    hourly.hourlyDepositUSD = hourly.hourlyDepositUSD.plus(deltaCollateralUSD);
    daily.dailyDepositUSD = daily.dailyDepositUSD.plus(deltaCollateralUSD);
  } else if (deltaCollateralUSD.lt(BIGDECIMAL_ZERO)) {
    hourly.hourlyWithdrawUSD = hourly.hourlyWithdrawUSD.minus(deltaCollateralUSD);
    daily.dailyWithdrawUSD = daily.dailyWithdrawUSD.minus(deltaCollateralUSD);
  }
  if (deltaDebtUSD.gt(BIGDECIMAL_ZERO)) {
    hourly.hourlyBorrowUSD = hourly.hourlyBorrowUSD.plus(deltaDebtUSD);
    daily.dailyBorrowUSD = daily.dailyBorrowUSD.plus(deltaDebtUSD);
  } else if (deltaDebtUSD.lt(BIGDECIMAL_ZERO)) {
    hourly.hourlyRepayUSD = hourly.hourlyRepayUSD.minus(deltaDebtUSD);
    daily.dailyRepayUSD = daily.dailyRepayUSD.minus(deltaDebtUSD);
  }
  if (liquidateUSD.gt(BIGDECIMAL_ZERO)) {
    hourly.hourlyLiquidateUSD = hourly.hourlyLiquidateUSD.plus(liquidateUSD);
    daily.dailyLiquidateUSD = daily.dailyLiquidateUSD.plus(liquidateUSD);
  }
  if (newTotalRevenueUSD.gt(BIGDECIMAL_ZERO)) {
    hourly.hourlyTotalRevenueUSD = hourly.hourlyTotalRevenueUSD.plus(newTotalRevenueUSD);
    daily.dailyTotalRevenueUSD = daily.dailyTotalRevenueUSD.plus(newTotalRevenueUSD);
  }
  if (newSupplySideRevenueUSD.gt(BIGDECIMAL_ZERO)) {
    hourly.hourlySupplySideRevenueUSD =
      hourly.hourlySupplySideRevenueUSD.plus(newSupplySideRevenueUSD);
    daily.dailySupplySideRevenueUSD = daily.dailySupplySideRevenueUSD.plus(newSupplySideRevenueUSD);
  }
  if (newTotalRevenueUSD.gt(BIGDECIMAL_ZERO) || newSupplySideRevenueUSD.gt(BIGDECIMAL_ZERO)) {
    hourly.hourlyProtocolSideRevenueUSD = hourly.hourlyTotalRevenueUSD.minus(
      hourly.hourlySupplySideRevenueUSD,
    );
    daily.dailyProtocolSideRevenueUSD = daily.dailyTotalRevenueUSD.minus(
      daily.dailySupplySideRevenueUSD,
    );
  }
  ctx.MarketHourlySnapshot.set(hourly);
  ctx.MarketDailySnapshot.set(daily);
}

export async function updateFinancialsSnapshot(
  ctx: Ctx,
  event: EventInfo,
  deltaCollateralUSD: BigDecimal = BIGDECIMAL_ZERO,
  deltaDebtUSD: BigDecimal = BIGDECIMAL_ZERO,
  liquidateUSD: BigDecimal = BIGDECIMAL_ZERO,
  newTotalRevenueUSD: BigDecimal = BIGDECIMAL_ZERO,
  newSupplySideRevenueUSD: BigDecimal = BIGDECIMAL_ZERO,
  protocolSideRevenueType = 0,
): Promise<void> {
  const protocol = await getOrCreateLendingProtocol(ctx);
  const fin = await getOrCreateFinancials(ctx, event);

  fin.totalValueLockedUSD = protocol.totalValueLockedUSD;
  fin.totalBorrowBalanceUSD = protocol.totalBorrowBalanceUSD;
  fin.totalDepositBalanceUSD = protocol.totalDepositBalanceUSD;
  fin.mintedTokenSupplies = protocol.mintedTokenSupplies;
  fin.cumulativeSupplySideRevenueUSD = protocol.cumulativeSupplySideRevenueUSD;
  fin.cumulativeProtocolSideRevenueUSD = protocol.cumulativeProtocolSideRevenueUSD;
  fin._cumulativeProtocolSideStabilityFeeRevenue = protocol._cumulativeProtocolSideStabilityFeeRevenue;
  fin._cumulativeProtocolSideLiquidationRevenue = protocol._cumulativeProtocolSideLiquidationRevenue;
  fin._cumulativeProtocolSidePSMRevenue = protocol._cumulativeProtocolSidePSMRevenue;
  fin.cumulativeTotalRevenueUSD = protocol.cumulativeTotalRevenueUSD;
  fin.cumulativeBorrowUSD = protocol.cumulativeBorrowUSD;
  fin.cumulativeDepositUSD = protocol.cumulativeDepositUSD;
  fin.cumulativeLiquidateUSD = protocol.cumulativeLiquidateUSD;

  if (deltaCollateralUSD.gt(BIGDECIMAL_ZERO)) {
    fin.dailyDepositUSD = fin.dailyDepositUSD.plus(deltaCollateralUSD);
  } else if (deltaCollateralUSD.lt(BIGDECIMAL_ZERO)) {
    fin.dailyWithdrawUSD = fin.dailyWithdrawUSD.minus(deltaCollateralUSD);
  }
  if (deltaDebtUSD.gt(BIGDECIMAL_ZERO)) {
    fin.dailyBorrowUSD = fin.dailyBorrowUSD.plus(deltaDebtUSD);
  } else if (deltaDebtUSD.lt(BIGDECIMAL_ZERO)) {
    fin.dailyRepayUSD = fin.dailyRepayUSD.minus(deltaDebtUSD);
  }
  if (liquidateUSD.gt(BIGDECIMAL_ZERO)) {
    fin.dailyLiquidateUSD = fin.dailyLiquidateUSD.plus(liquidateUSD);
  }
  if (newTotalRevenueUSD.gt(BIGDECIMAL_ZERO)) {
    fin.dailyTotalRevenueUSD = fin.dailyTotalRevenueUSD.plus(newTotalRevenueUSD);
  }
  if (newSupplySideRevenueUSD.gt(BIGDECIMAL_ZERO)) {
    fin.dailySupplySideRevenueUSD = fin.dailySupplySideRevenueUSD.plus(newSupplySideRevenueUSD);
  }
  const newProtocolSideRevenueUSD = newTotalRevenueUSD.minus(newSupplySideRevenueUSD);
  if (newProtocolSideRevenueUSD.gt(BIGDECIMAL_ZERO)) {
    fin.dailyProtocolSideRevenueUSD = fin.dailyTotalRevenueUSD.minus(fin.dailySupplySideRevenueUSD);
    switch (protocolSideRevenueType) {
      case ProtocolSideRevenueType.STABILITYFEE:
        fin._dailyProtocolSideStabilityFeeRevenue =
          fin._dailyProtocolSideStabilityFeeRevenue!.plus(newProtocolSideRevenueUSD);
        break;
      case ProtocolSideRevenueType.LIQUIDATION:
        fin._dailyProtocolSideLiquidationRevenue =
          fin._dailyProtocolSideLiquidationRevenue!.plus(newProtocolSideRevenueUSD);
        break;
      case ProtocolSideRevenueType.PSM:
        fin._dailyProtocolSidePSMRevenue =
          fin._dailyProtocolSidePSMRevenue!.plus(newProtocolSideRevenueUSD);
        break;
    }
  }
  fin.blockNumber = event.blockNumber;
  fin.timestamp = event.timestamp;
  ctx.FinancialsDailySnapshot.set(fin);
}

export async function snapshotPosition(ctx: Ctx, event: EventInfo, position: Position): Promise<void> {
  const txHash = event.hash;
  const snapshotID = `${position.id}-${txHash}-${event.logIndex.toString()}`;
  const existing = await ctx.PositionSnapshot.get(snapshotID);
  if (existing == null) {
    ctx.PositionSnapshot.set({
      id: snapshotID,
      hash: txHash,
      logIndex: event.logIndex,
      nonce: event.nonce,
      position_id: position.id,
      balance: position.balance,
      blockNumber: event.blockNumber,
      timestamp: event.timestamp,
    });
  }
}

// updatePosition based on deposit/withdraw/borrow/repay. Call AFTER createTransactions.
export async function updatePosition(
  ctx: Ctx,
  event: EventInfo,
  urn: string,
  ilk: string,
  deltaCollateral: bigint = BIGINT_ZERO,
  deltaDebt: bigint = BIGINT_ZERO,
): Promise<void> {
  const marketID = (await getMarketAddressFromIlk(ctx, ilk))!;
  const accountAddress = await getOwnerAddress(ctx, urn);
  const eventID = createEventID(event.hash, event.logIndex);

  const protocol: Mutable<Awaited<ReturnType<typeof getOrCreateLendingProtocol>>> = {
    ...(await getOrCreateLendingProtocol(ctx)),
  };
  const market: Mutable<Market> = { ...(await getOrCreateMarket(ctx, marketID)) };
  const account: Mutable<Awaited<ReturnType<typeof getOrCreateAccount>>> = {
    ...(await getOrCreateAccount(ctx, accountAddress)),
  };

  if (deltaCollateral !== BIGINT_ZERO) {
    let lenderPosition = await getOpenPosition(ctx, urn, ilk, PositionSide.LENDER);
    if (lenderPosition == null) {
      lenderPosition = await getOrCreatePosition(ctx, event, urn, ilk, PositionSide.LENDER, true);
      protocol.openPositionCount += INT_ONE;
      protocol.cumulativePositionCount += INT_ONE;
      market.positionCount += INT_ONE;
      market.openPositionCount += INT_ONE;
      market.lendingPositionCount += INT_ONE;
      account.positionCount += INT_ONE;
      account.openPositionCount += INT_ONE;
    }
    const lp: Mutable<Position> = { ...lenderPosition };
    lp.balance = lp.balance + deltaCollateral;
    if (lp.balance < BIGINT_ZERO && lp.balance >= BIGINT_NEG_HUNDRED) {
      lp.balance = BIGINT_ZERO; // small negative due to rounding
    }
    if (deltaCollateral > BIGINT_ZERO) {
      lp.depositCount += INT_ONE;
      const deposit = await ctx.Deposit.get(eventID);
      if (deposit) ctx.Deposit.set({ ...deposit, position_id: lp.id });
    } else if (deltaCollateral < BIGINT_ZERO) {
      lp.withdrawCount += INT_ONE;
      if (lp.balance === BIGINT_ZERO) {
        lp.blockNumberClosed = event.blockNumber;
        lp.timestampClosed = event.timestamp;
        lp.hashClosed = event.hash;
        protocol.openPositionCount -= INT_ONE;
        market.openPositionCount -= INT_ONE;
        market.closedPositionCount += INT_ONE;
        account.openPositionCount -= INT_ONE;
        account.closedPositionCount += INT_ONE;
      }
      const withdraw = await ctx.Withdraw.get(eventID);
      if (withdraw) ctx.Withdraw.set({ ...withdraw, position_id: lp.id });
    }
    ctx.Position.set(lp);
    await snapshotPosition(ctx, event, lp);
  }

  if (deltaDebt !== BIGINT_ZERO) {
    let borrowerPosition = await getOpenPosition(ctx, urn, ilk, PositionSide.BORROWER);
    if (borrowerPosition == null) {
      borrowerPosition = await getOrCreatePosition(ctx, event, urn, ilk, PositionSide.BORROWER, true);
      protocol.openPositionCount += INT_ONE;
      protocol.cumulativePositionCount += INT_ONE;
      market.positionCount += INT_ONE;
      market.openPositionCount += INT_ONE;
      market.borrowingPositionCount += INT_ONE;
      account.positionCount += INT_ONE;
      account.openPositionCount += INT_ONE;
    }
    const bp: Mutable<Position> = { ...borrowerPosition };
    bp.balance = bp.balance + deltaDebt;
    if (bp.balance < BIGINT_ZERO && bp.balance >= BIGINT_NEG_HUNDRED) {
      bp.balance = BIGINT_ZERO;
    }
    if (deltaDebt > BIGINT_ZERO) {
      bp.borrowCount += INT_ONE;
      const borrow = await ctx.Borrow.get(eventID);
      if (borrow) ctx.Borrow.set({ ...borrow, position_id: bp.id });
    } else if (deltaDebt < BIGINT_ZERO) {
      bp.repayCount += INT_ONE;
      if (bp.balance === BIGINT_ZERO) {
        bp.blockNumberClosed = event.blockNumber;
        bp.timestampClosed = event.timestamp;
        bp.hashClosed = event.hash;
        protocol.openPositionCount -= INT_ONE;
        market.openPositionCount -= INT_ONE;
        market.closedPositionCount += INT_ONE;
        account.openPositionCount -= INT_ONE;
        account.closedPositionCount += INT_ONE;
      }
      const repay = await ctx.Repay.get(eventID);
      if (repay) ctx.Repay.set({ ...repay, position_id: bp.id });
    }
    ctx.Position.set(bp);
    await snapshotPosition(ctx, event, bp);
  }

  ctx.LendingProtocol.set(protocol);
  ctx.Market.set(market);
  ctx.Account.set(account);
}

export async function transferPosition(
  ctx: Ctx,
  event: EventInfo,
  ilk: string,
  srcUrn: string,
  dstUrn: string,
  side: string,
  srcAccountAddress: string | null = null,
  dstAccountAddress: string | null = null,
  transferAmount: bigint | null = null,
): Promise<void> {
  if (srcUrn === dstUrn && srcAccountAddress === dstAccountAddress) return;

  const protocol: Mutable<Awaited<ReturnType<typeof getOrCreateLendingProtocol>>> = {
    ...(await getOrCreateLendingProtocol(ctx)),
  };
  const market: Mutable<Market> = { ...(await getMarketFromIlk(ctx, ilk))! };
  const usageHourly = await getOrCreateUsageMetricsHourlySnapshot(ctx, event);
  const usageDaily = await getOrCreateUsageMetricsDailySnapshot(ctx, event);

  if (srcAccountAddress == null) {
    srcAccountAddress = (await getOwnerAddress(ctx, srcUrn)).toLowerCase();
  }
  const srcAccount: Mutable<Awaited<ReturnType<typeof getOrCreateAccount>>> = {
    ...(await getOrCreateAccount(ctx, srcAccountAddress!)),
  };

  const srcPositionRaw = await getOpenPosition(ctx, srcUrn, ilk, side);
  if (srcPositionRaw == null) return;
  const srcPosition: Mutable<Position> = { ...srcPositionRaw };

  if (transferAmount == null || transferAmount > srcPosition.balance) {
    transferAmount = srcPosition.balance;
  }

  srcPosition.balance = srcPosition.balance - transferAmount;
  if (srcPosition.balance === BIGINT_ZERO) {
    srcPosition.blockNumberClosed = event.blockNumber;
    srcPosition.timestampClosed = event.timestamp;
    srcPosition.hashClosed = event.hash;
    protocol.openPositionCount -= INT_ONE;
    market.openPositionCount -= INT_ONE;
    market.closedPositionCount += INT_ONE;
    srcAccount.openPositionCount -= INT_ONE;
    srcAccount.closedPositionCount += INT_ONE;
  }
  ctx.Position.set(srcPosition);
  await snapshotPosition(ctx, event, srcPosition);

  if (dstAccountAddress == null) {
    dstAccountAddress = (await getOwnerAddress(ctx, dstUrn)).toLowerCase();
  }
  let dstAccountRaw = await ctx.Account.get(dstAccountAddress!);
  let dstAccount: Mutable<Awaited<ReturnType<typeof getOrCreateAccount>>>;
  if (dstAccountRaw == null) {
    dstAccount = { ...(await getOrCreateAccount(ctx, dstAccountAddress!)) };
    protocol.cumulativeUniqueUsers += 1;
    usageDaily.cumulativeUniqueUsers += 1;
    usageHourly.cumulativeUniqueUsers += 1;
  } else {
    dstAccount = { ...dstAccountRaw };
  }

  let dstPositionRaw = await getOpenPosition(ctx, dstUrn, ilk, side);
  if (!dstPositionRaw) {
    dstPositionRaw = await getOrCreatePosition(ctx, event, dstUrn, ilk, side, true);
  }
  const dstPosition: Mutable<Position> = { ...dstPositionRaw };
  dstPosition.balance = dstPosition.balance + transferAmount;
  ctx.Position.set(dstPosition);
  await snapshotPosition(ctx, event, dstPosition);

  protocol.openPositionCount += INT_ONE;
  protocol.cumulativePositionCount += INT_ONE;
  market.openPositionCount += INT_ONE;
  market.positionCount += INT_ONE;
  if (side === PositionSide.BORROWER) {
    market.borrowingPositionCount += INT_ONE;
  } else if (side === PositionSide.LENDER) {
    market.lendingPositionCount += INT_ONE;
  }
  dstAccount.openPositionCount += INT_ONE;
  dstAccount.positionCount += INT_ONE;

  ctx.LendingProtocol.set(protocol);
  ctx.Market.set(market);
  ctx.UsageMetricsDailySnapshot.set(usageDaily);
  ctx.UsageMetricsHourlySnapshot.set(usageHourly);
  ctx.Account.set(srcAccount);
  ctx.Account.set(dstAccount);
}

export async function liquidatePosition(
  ctx: Ctx,
  event: EventInfo,
  urn: string,
  ilk: string,
  collateral: bigint,
  debt: bigint,
): Promise<string[]> {
  const protocol: Mutable<Awaited<ReturnType<typeof getOrCreateLendingProtocol>>> = {
    ...(await getOrCreateLendingProtocol(ctx)),
  };
  const market: Mutable<Market> = { ...(await getMarketFromIlk(ctx, ilk))! };
  const accountAddress = await getOwnerAddress(ctx, urn);
  const account: Mutable<Awaited<ReturnType<typeof getOrCreateAccount>>> = {
    ...(await getOrCreateAccount(ctx, accountAddress)),
  };

  const borrowerPosition: Mutable<Position> = {
    ...(await getOpenPosition(ctx, urn, ilk, PositionSide.BORROWER))!,
  };
  const lenderPosition: Mutable<Position> = {
    ...(await getOpenPosition(ctx, urn, ilk, PositionSide.LENDER))!,
  };

  if (debt > borrowerPosition.balance) {
    debt = borrowerPosition.balance;
  }
  borrowerPosition.balance = borrowerPosition.balance - debt;
  borrowerPosition.liquidationCount += INT_ONE;
  if (borrowerPosition.balance === BIGINT_ZERO) {
    borrowerPosition.blockNumberClosed = event.blockNumber;
    borrowerPosition.timestampClosed = event.timestamp;
    borrowerPosition.hashClosed = event.hash;
    await snapshotPosition(ctx, event, borrowerPosition);
    protocol.openPositionCount -= INT_ONE;
    market.openPositionCount -= INT_ONE;
    market.closedPositionCount += INT_ONE;
    market.borrowingPositionCount -= INT_ONE;
    account.openPositionCount -= INT_ONE;
    account.closedPositionCount += INT_ONE;
  }
  ctx.Position.set(borrowerPosition);
  await snapshotPosition(ctx, event, borrowerPosition);

  lenderPosition.balance = lenderPosition.balance - collateral;
  lenderPosition.liquidationCount += INT_ONE;
  if (lenderPosition.balance === BIGINT_ZERO) {
    lenderPosition.blockNumberClosed = event.blockNumber;
    lenderPosition.timestampClosed = event.timestamp;
    lenderPosition.hashClosed = event.hash;
    protocol.openPositionCount -= INT_ONE;
    market.openPositionCount -= INT_ONE;
    market.closedPositionCount += INT_ONE;
    market.lendingPositionCount -= INT_ONE;
    account.openPositionCount -= INT_ONE;
    account.closedPositionCount += INT_ONE;
  }
  ctx.Position.set(lenderPosition);
  await snapshotPosition(ctx, event, lenderPosition);

  ctx.LendingProtocol.set(protocol);
  ctx.Market.set(market);
  ctx.Account.set(account);

  return [lenderPosition.id, borrowerPosition.id];
}

export async function updateUsageMetrics(
  ctx: Ctx,
  event: EventInfo,
  users: string[] = [],
  deltaCollateralUSD: BigDecimal = BIGDECIMAL_ZERO,
  deltaDebtUSD: BigDecimal = BIGDECIMAL_ZERO,
  liquidateUSD: BigDecimal = BIGDECIMAL_ZERO,
  liquidator: string | null = null,
  liquidatee: string | null = null,
): Promise<void> {
  const protocol: Mutable<Awaited<ReturnType<typeof getOrCreateLendingProtocol>>> = {
    ...(await getOrCreateLendingProtocol(ctx)),
  };
  const usageHourly = await getOrCreateUsageMetricsHourlySnapshot(ctx, event);
  const usageDaily = await getOrCreateUsageMetricsDailySnapshot(ctx, event);

  const hours = (event.timestamp / BigInt(SECONDS_PER_HOUR)).toString();
  const days = (event.timestamp / BigInt(SECONDS_PER_DAY)).toString();

  for (let i = 0; i < users.length; i++) {
    const accountID = users[i]!;
    let account = await ctx.Account.get(accountID);
    if (account == null) {
      account = await getOrCreateAccount(ctx, accountID);
      protocol.cumulativeUniqueUsers += 1;
      usageHourly.cumulativeUniqueUsers += 1;
      usageDaily.cumulativeUniqueUsers += 1;
    }
    const hourlyActiveID = "hourly-".concat(accountID).concat("-").concat(hours);
    if ((await ctx.ActiveAccount.get(hourlyActiveID)) == null) {
      ctx.ActiveAccount.set({ id: hourlyActiveID });
      usageHourly.hourlyActiveUsers += 1;
    }
    const dailyActiveID = "daily-".concat(accountID).concat("-").concat(days);
    if ((await ctx.ActiveAccount.get(dailyActiveID)) == null) {
      ctx.ActiveAccount.set({ id: dailyActiveID });
      usageDaily.dailyActiveUsers += 1;
    }
  }

  const txSignerID = event.from;
  if ((await ctx._TxSigner.get(txSignerID)) == null) {
    ctx._TxSigner.set({ id: txSignerID });
    protocol.cumulativeUniqueTxSigners += 1;
    usageHourly.cumulativeUniqueTxSigners += 1;
    usageDaily.cumulativeUniqueTxSigners += 1;
  }
  const dailyTxSignerID = txSignerID.concat("-").concat(days);
  if ((await ctx._TxSigner.get(dailyTxSignerID)) == null) {
    ctx._TxSigner.set({ id: dailyTxSignerID });
    usageDaily.dailyActiveTxSigners += 1;
  }

  if (deltaCollateralUSD.gt(BIGDECIMAL_ZERO)) {
    usageHourly.hourlyDepositCount += 1;
    usageDaily.dailyDepositCount += 1;
    const depositAccount: Mutable<Awaited<ReturnType<typeof getOrCreateAccount>>> = {
      ...(await getOrCreateAccount(ctx, users[1]!)),
    };
    if (depositAccount.depositCount === 0) {
      protocol.cumulativeUniqueDepositors += 1;
      usageDaily.cumulativeUniqueDepositors += 1;
    }
    depositAccount.depositCount += INT_ONE;
    ctx.Account.set(depositAccount);
    const dailyDepositorID = "daily-depositor-".concat(users[1]!).concat("-").concat(days);
    if ((await ctx.ActiveAccount.get(dailyDepositorID)) == null) {
      ctx.ActiveAccount.set({ id: dailyDepositorID });
      usageDaily.dailyActiveDepositors += 1;
    }
  } else if (deltaCollateralUSD.lt(BIGDECIMAL_ZERO)) {
    usageHourly.hourlyWithdrawCount += 1;
    usageDaily.dailyWithdrawCount += 1;
    const withdrawAccount: Mutable<Awaited<ReturnType<typeof getOrCreateAccount>>> = {
      ...(await getOrCreateAccount(ctx, users[1]!)),
    };
    withdrawAccount.withdrawCount += INT_ONE;
    ctx.Account.set(withdrawAccount);
  }

  if (deltaDebtUSD.gt(BIGDECIMAL_ZERO)) {
    usageHourly.hourlyBorrowCount += 1;
    usageDaily.dailyBorrowCount += 1;
    const borrowAccount: Mutable<Awaited<ReturnType<typeof getOrCreateAccount>>> = {
      ...(await getOrCreateAccount(ctx, users[2]!)),
    };
    if (borrowAccount.borrowCount === 0) {
      protocol.cumulativeUniqueBorrowers += 1;
      usageDaily.cumulativeUniqueBorrowers += 1;
    }
    borrowAccount.borrowCount += INT_ONE;
    ctx.Account.set(borrowAccount);
    const dailyBorrowerID = "daily-borrow-".concat(users[2]!).concat("-").concat(days);
    if ((await ctx.ActiveAccount.get(dailyBorrowerID)) == null) {
      ctx.ActiveAccount.set({ id: dailyBorrowerID });
      usageDaily.dailyActiveBorrowers += 1;
    }
  } else if (deltaDebtUSD.lt(BIGDECIMAL_ZERO)) {
    usageHourly.hourlyRepayCount += 1;
    usageDaily.dailyRepayCount += 1;
    const repayAccount: Mutable<Awaited<ReturnType<typeof getOrCreateAccount>>> = {
      ...(await getOrCreateAccount(ctx, users[1]!)),
    };
    repayAccount.repayCount += INT_ONE;
    ctx.Account.set(repayAccount);
  }

  if (liquidateUSD.gt(BIGDECIMAL_ZERO)) {
    usageHourly.hourlyLiquidateCount += 1;
    usageDaily.dailyLiquidateCount += 1;
    if (liquidator) {
      let liquidatorAccountRaw = await ctx.Account.get(liquidator);
      let liquidatorAccount: Mutable<Awaited<ReturnType<typeof getOrCreateAccount>>>;
      if (liquidatorAccountRaw == null || liquidatorAccountRaw.liquidateCount === 0) {
        if (liquidatorAccountRaw == null) {
          protocol.cumulativeUniqueUsers += 1;
          usageDaily.cumulativeUniqueUsers += 1;
          usageHourly.cumulativeUniqueUsers += 1;
        }
        liquidatorAccount = { ...(await getOrCreateAccount(ctx, liquidator)) };
        protocol.cumulativeUniqueLiquidators += 1;
        usageDaily.cumulativeUniqueLiquidators += 1;
      } else {
        liquidatorAccount = { ...liquidatorAccountRaw };
      }
      liquidatorAccount.liquidateCount += INT_ONE;
      ctx.Account.set(liquidatorAccount);
      const dailyLiquidatorID = "daily-liquidate".concat(liquidator).concat("-").concat(days);
      if ((await ctx.ActiveAccount.get(dailyLiquidatorID)) == null) {
        ctx.ActiveAccount.set({ id: dailyLiquidatorID });
        usageDaily.dailyActiveLiquidators += 1;
      }
    }
    if (liquidatee) {
      let liquidateeAccountRaw = await ctx.Account.get(liquidatee);
      let liquidateeAccount: Mutable<Awaited<ReturnType<typeof getOrCreateAccount>>>;
      if (liquidateeAccountRaw == null || liquidateeAccountRaw.liquidationCount === 0) {
        liquidateeAccount = { ...(await getOrCreateAccount(ctx, liquidatee)) };
        protocol.cumulativeUniqueLiquidatees += 1;
        usageDaily.cumulativeUniqueLiquidatees += 1;
      } else {
        liquidateeAccount = { ...liquidateeAccountRaw };
      }
      liquidateeAccount.liquidationCount += INT_ONE;
      ctx.Account.set(liquidateeAccount);
      const dailyLiquidateeID = "daily-liquidatee-".concat(liquidatee).concat("-").concat(days);
      if ((await ctx.ActiveAccount.get(dailyLiquidateeID)) == null) {
        ctx.ActiveAccount.set({ id: dailyLiquidateeID });
        usageDaily.dailyActiveLiquidatees += 1;
      }
    }
  }

  usageHourly.hourlyTransactionCount += 1;
  usageDaily.dailyTransactionCount += 1;
  usageHourly.blockNumber = event.blockNumber;
  usageDaily.blockNumber = event.blockNumber;
  usageHourly.timestamp = event.timestamp;
  usageDaily.timestamp = event.timestamp;

  ctx.LendingProtocol.set(protocol);
  ctx.UsageMetricsHourlySnapshot.set(usageHourly);
  ctx.UsageMetricsDailySnapshot.set(usageDaily);
}

export async function createTransactions(
  ctx: Ctx,
  event: EventInfo,
  market: Market,
  lender: string | null,
  borrower: string | null,
  deltaCollateral: bigint = BIGINT_ZERO,
  deltaCollateralUSD: BigDecimal = BIGDECIMAL_ZERO,
  deltaDebt: bigint = BIGINT_ZERO,
  deltaDebtUSD: BigDecimal = BIGDECIMAL_ZERO,
): Promise<void> {
  const transactionID = createEventID(event.hash, event.logIndex);

  if (deltaCollateral > BIGINT_ZERO) {
    ctx.Deposit.set({
      id: transactionID,
      hash: event.hash,
      logIndex: event.logIndex,
      nonce: event.nonce,
      account_id: lender!,
      blockNumber: event.blockNumber,
      timestamp: event.timestamp,
      market_id: market.id,
      asset_id: market.inputToken_id,
      amount: deltaCollateral,
      amountUSD: deltaCollateralUSD,
      position_id: "",
    });
  } else if (deltaCollateral < BIGINT_ZERO) {
    ctx.Withdraw.set({
      id: transactionID,
      hash: event.hash,
      logIndex: event.logIndex,
      nonce: event.nonce,
      account_id: lender!,
      blockNumber: event.blockNumber,
      timestamp: event.timestamp,
      market_id: market.id,
      asset_id: market.inputToken_id,
      amount: deltaCollateral * BIGINT_NEG_ONE,
      amountUSD: deltaCollateralUSD.times(BIGDECIMAL_NEG_ONE),
      position_id: "",
    });
  }

  if (deltaDebt > BIGINT_ZERO) {
    ctx.Borrow.set({
      id: transactionID,
      hash: event.hash,
      logIndex: event.logIndex,
      nonce: event.nonce,
      account_id: borrower!,
      blockNumber: event.blockNumber,
      timestamp: event.timestamp,
      market_id: market.id,
      asset_id: market.inputToken_id,
      amount: deltaDebt,
      amountUSD: deltaDebtUSD,
      position_id: "",
    });
  } else if (deltaDebt < BIGINT_ZERO) {
    ctx.Repay.set({
      id: transactionID,
      hash: event.hash,
      logIndex: event.logIndex,
      nonce: event.nonce,
      account_id: borrower!,
      blockNumber: event.blockNumber,
      timestamp: event.timestamp,
      market_id: market.id,
      asset_id: market.inputToken_id,
      amount: deltaDebt * BIGINT_NEG_ONE,
      amountUSD: deltaDebtUSD.times(BIGDECIMAL_NEG_ONE),
      position_id: "",
    });
  }
}

export async function updatePriceForMarket(ctx: Ctx, marketID: string, event: EventInfo): Promise<void> {
  const marketRaw = await getOrCreateMarket(ctx, marketID);
  const token = await ctx.Token.get(marketRaw.inputToken_id);
  const market: Mutable<Market> = { ...marketRaw };
  market.inputTokenPriceUSD = token!.lastPriceUSD!;
  market.totalDepositBalanceUSD = bigIntToBDUseDecimals(
    market.inputTokenBalance,
    token!.decimals,
  ).times(market.inputTokenPriceUSD);
  market.totalValueLockedUSD = market.totalDepositBalanceUSD;
  ctx.Market.set(market);

  const protocol: Mutable<Awaited<ReturnType<typeof getOrCreateLendingProtocol>>> = {
    ...(await getOrCreateLendingProtocol(ctx)),
  };
  let protocolTotalDepositBalanceUSD = BIGDECIMAL_ZERO;
  for (let i = 0; i < protocol.marketIDList.length; i++) {
    const m = await getOrCreateMarket(ctx, protocol.marketIDList[i]!);
    protocolTotalDepositBalanceUSD = protocolTotalDepositBalanceUSD.plus(m.totalDepositBalanceUSD);
  }
  protocol.totalDepositBalanceUSD = protocolTotalDepositBalanceUSD;
  protocol.totalValueLockedUSD = protocol.totalDepositBalanceUSD;
  ctx.LendingProtocol.set(protocol);

  await updateFinancialsSnapshot(ctx, event);
}

export async function updateRevenue(
  ctx: Ctx,
  event: EventInfo,
  marketID: string,
  newTotalRevenueUSD: BigDecimal = BIGDECIMAL_ZERO,
  newSupplySideRevenueUSD: BigDecimal = BIGDECIMAL_ZERO,
  protocolSideRevenueType = 0,
): Promise<void> {
  const market = await getOrCreateMarket(ctx, marketID);
  if (market) {
    await updateMarket(
      ctx,
      event,
      market,
      BIGINT_ZERO,
      BIGDECIMAL_ZERO,
      BIGDECIMAL_ZERO,
      BIGDECIMAL_ZERO,
      newTotalRevenueUSD,
      newSupplySideRevenueUSD,
    );
  }
  await updateProtocol(
    ctx,
    event,
    BIGDECIMAL_ZERO,
    BIGDECIMAL_ZERO,
    BIGDECIMAL_ZERO,
    newTotalRevenueUSD,
    newSupplySideRevenueUSD,
    protocolSideRevenueType,
  );
  await updateFinancialsSnapshot(
    ctx,
    event,
    BIGDECIMAL_ZERO,
    BIGDECIMAL_ZERO,
    BIGDECIMAL_ZERO,
    newTotalRevenueUSD,
    newSupplySideRevenueUSD,
    protocolSideRevenueType,
  );
}

// silence unused import if VAT_ADDRESS not referenced
void VAT_ADDRESS;
