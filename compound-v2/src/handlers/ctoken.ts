/**
 * Port of src/mappings/ctoken.ts (CToken template handlers).
 *
 * Entity id deviation: the original used `event.transactionLogIndex` for
 * MintEvent / RedeemEvent / BorrowEvent / RepayEvent / LiquidationEvent /
 * TransferEvent ids. envio only provides the absolute (block-level)
 * `event.logIndex`, which is what graph-node's Ethereum adapter populates
 * transactionLogIndex with anyway — see MIGRATION.md.
 */
import { indexer } from "envio";
import {
  cTokenDecimals,
  cTokenDecimalsBD,
  exponentToBigDecimal,
  low,
  toBD,
  truncate,
} from "../utils";
import { createMarket, updateMarket } from "../services/markets";
import { createAccount, updateCommonCTokenStats } from "../services/helpers";

/* Account supplies assets into market and receives cTokens in exchange
 *
 * event.mintAmount is the underlying asset
 * event.mintTokens is the amount of cTokens minted
 * event.minter is the account
 *
 * Notes
 *    Transfer event will always get emitted with this
 *    Mints originate from the cToken address, not 0x000000, which is typical of ERC-20s
 *    No need to updateMarket(), handleAccrueInterest() ALWAYS runs before this
 *    No need to updateCommonCTokenStats, handleTransfer() will
 *    No need to update cTokenBalance, handleTransfer() will
 */
indexer.onEvent({ contract: "CToken", event: "Mint" }, async ({ event, context }) => {
  const market = await context.Market.getOrThrow(low(event.srcAddress));
  const mintID = low(event.transaction.hash).concat("-").concat(event.logIndex.toString());

  const cTokenAmount = truncate(toBD(event.params.mintTokens).div(cTokenDecimalsBD), cTokenDecimals);
  const underlyingAmount = truncate(
    toBD(event.params.mintAmount).div(exponentToBigDecimal(market.underlyingDecimals)),
    market.underlyingDecimals,
  );

  context.MintEvent.set({
    id: mintID,
    amount: cTokenAmount,
    to: low(event.params.minter),
    from: low(event.srcAddress),
    blockNumber: event.block.number,
    blockTime: event.block.timestamp,
    cTokenSymbol: market.symbol,
    underlyingAmount: underlyingAmount,
  });
});

/*  Account supplies cTokens into market and receives underlying asset in exchange
 *
 *  event.redeemAmount is the underlying asset
 *  event.redeemTokens is the cTokens
 *  event.redeemer is the account
 *
 *  Notes
 *    Transfer event will always get emitted with this
 *    No need to updateMarket(), handleAccrueInterest() ALWAYS runs before this
 *    No need to updateCommonCTokenStats, handleTransfer() will
 *    No need to update cTokenBalance, handleTransfer() will
 */
indexer.onEvent({ contract: "CToken", event: "Redeem" }, async ({ event, context }) => {
  const market = await context.Market.getOrThrow(low(event.srcAddress));
  const redeemID = low(event.transaction.hash).concat("-").concat(event.logIndex.toString());

  const cTokenAmount = truncate(toBD(event.params.redeemTokens).div(cTokenDecimalsBD), cTokenDecimals);
  const underlyingAmount = truncate(
    toBD(event.params.redeemAmount).div(exponentToBigDecimal(market.underlyingDecimals)),
    market.underlyingDecimals,
  );

  context.RedeemEvent.set({
    id: redeemID,
    amount: cTokenAmount,
    to: low(event.srcAddress),
    from: low(event.params.redeemer),
    blockNumber: event.block.number,
    blockTime: event.block.timestamp,
    cTokenSymbol: market.symbol,
    underlyingAmount: underlyingAmount,
  });
});

/* Borrow assets from the protocol. All values either ETH or ERC20
 *
 * event.params.totalBorrows = of the whole market (not used right now)
 * event.params.accountBorrows = total of the account
 * event.params.borrowAmount = that was added in this event
 * event.params.borrower = the account
 * Notes
 *    No need to updateMarket(), handleAccrueInterest() ALWAYS runs before this
 */
indexer.onEvent({ contract: "CToken", event: "Borrow" }, async ({ event, context }) => {
  const market = await context.Market.getOrThrow(low(event.srcAddress));
  const accountID = low(event.params.borrower);
  let account = await context.Account.get(accountID);
  if (account == undefined) {
    account = createAccount(context, accountID);
  }
  context.Account.set({ ...account, hasBorrowed: true });

  // Update cTokenStats common for all events, and return the stats to update unique
  // values for each event
  const cTokenStats = await updateCommonCTokenStats(
    context,
    market.id,
    market.symbol,
    accountID,
    low(event.transaction.hash),
    BigInt(event.block.timestamp),
    BigInt(event.block.number),
    BigInt(event.logIndex),
  );

  const borrowAmountBD = toBD(event.params.borrowAmount).div(
    exponentToBigDecimal(market.underlyingDecimals),
  );

  context.AccountCToken.set({
    ...cTokenStats,
    storedBorrowBalance: truncate(
      toBD(event.params.accountBorrows).div(exponentToBigDecimal(market.underlyingDecimals)),
      market.underlyingDecimals,
    ),
    accountBorrowIndex: market.borrowIndex,
    totalUnderlyingBorrowed: cTokenStats.totalUnderlyingBorrowed.plus(borrowAmountBD),
  });

  const borrowID = low(event.transaction.hash).concat("-").concat(event.logIndex.toString());

  const borrowAmount = truncate(
    toBD(event.params.borrowAmount).div(exponentToBigDecimal(market.underlyingDecimals)),
    market.underlyingDecimals,
  );

  const accountBorrows = truncate(
    toBD(event.params.accountBorrows).div(exponentToBigDecimal(market.underlyingDecimals)),
    market.underlyingDecimals,
  );

  context.BorrowEvent.set({
    id: borrowID,
    amount: borrowAmount,
    accountBorrows: accountBorrows,
    borrower: low(event.params.borrower),
    blockNumber: event.block.number,
    blockTime: event.block.timestamp,
    underlyingSymbol: market.underlyingSymbol,
  });
});

/* Repay some amount borrowed. Anyone can repay anyones balance
 *
 * event.params.totalBorrows = of the whole market (not used right now)
 * event.params.accountBorrows = total of the account (not used right now)
 * event.params.repayAmount = that was added in this event
 * event.params.borrower = the borrower
 * event.params.payer = the payer
 *
 * Notes
 *    No need to updateMarket(), handleAccrueInterest() ALWAYS runs before this
 *    Once a account totally repays a borrow, it still has its account interest index set to the
 *    markets value. We keep this, even though you might think it would reset to 0 upon full
 *    repay.
 */
indexer.onEvent({ contract: "CToken", event: "RepayBorrow" }, async ({ event, context }) => {
  const market = await context.Market.getOrThrow(low(event.srcAddress));
  const accountID = low(event.params.borrower);
  const account = await context.Account.get(accountID);
  if (account == undefined) {
    createAccount(context, accountID);
  }

  // Update cTokenStats common for all events, and return the stats to update unique
  // values for each event
  const cTokenStats = await updateCommonCTokenStats(
    context,
    market.id,
    market.symbol,
    accountID,
    low(event.transaction.hash),
    BigInt(event.block.timestamp),
    BigInt(event.block.number),
    BigInt(event.logIndex),
  );

  const repayAmountBD = toBD(event.params.repayAmount).div(
    exponentToBigDecimal(market.underlyingDecimals),
  );

  context.AccountCToken.set({
    ...cTokenStats,
    storedBorrowBalance: truncate(
      toBD(event.params.accountBorrows).div(exponentToBigDecimal(market.underlyingDecimals)),
      market.underlyingDecimals,
    ),
    accountBorrowIndex: market.borrowIndex,
    totalUnderlyingRepaid: cTokenStats.totalUnderlyingRepaid.plus(repayAmountBD),
  });

  const repayID = low(event.transaction.hash).concat("-").concat(event.logIndex.toString());

  const repayAmount = truncate(
    toBD(event.params.repayAmount).div(exponentToBigDecimal(market.underlyingDecimals)),
    market.underlyingDecimals,
  );

  const accountBorrows = truncate(
    toBD(event.params.accountBorrows).div(exponentToBigDecimal(market.underlyingDecimals)),
    market.underlyingDecimals,
  );

  context.RepayEvent.set({
    id: repayID,
    amount: repayAmount,
    accountBorrows: accountBorrows,
    borrower: low(event.params.borrower),
    blockNumber: event.block.number,
    blockTime: event.block.timestamp,
    underlyingSymbol: market.underlyingSymbol,
    payer: low(event.params.payer),
  });
});

/*
 * Liquidate an account who has fell below the collateral factor.
 *
 * event.params.borrower - the borrower who is getting liquidated of their cTokens
 * event.params.cTokenCollateral - the market ADDRESS of the ctoken being liquidated
 * event.params.liquidator - the liquidator
 * event.params.repayAmount - the amount of underlying to be repaid
 * event.params.seizeTokens - cTokens seized (transfer event should handle this)
 *
 * Notes
 *    No need to updateMarket(), handleAccrueInterest() ALWAYS runs before this.
 *    When calling this function, event RepayBorrow, and event Transfer will be called every
 *    time. This means we can ignore repayAmount. Seize tokens only changes state
 *    of the cTokens, which is covered by transfer. Therefore we only
 *    add liquidation counts in this handler.
 */
indexer.onEvent({ contract: "CToken", event: "LiquidateBorrow" }, async ({ event, context }) => {
  const liquidatorID = low(event.params.liquidator);
  let liquidator = await context.Account.get(liquidatorID);
  if (liquidator == undefined) {
    liquidator = createAccount(context, liquidatorID);
  }
  context.Account.set({ ...liquidator, countLiquidator: liquidator.countLiquidator + 1 });

  const borrowerID = low(event.params.borrower);
  let borrower = await context.Account.get(borrowerID);
  if (borrower == undefined) {
    borrower = createAccount(context, borrowerID);
  }
  context.Account.set({ ...borrower, countLiquidated: borrower.countLiquidated + 1 });

  // For a liquidation, the liquidator pays down the borrow of the underlying
  // asset. They seize one of potentially many types of cToken collateral of
  // the underwater borrower. So we must get that address from the event, and
  // the repay token is the event.address
  const marketRepayToken = await context.Market.getOrThrow(low(event.srcAddress));
  const marketCTokenLiquidated = await context.Market.getOrThrow(low(event.params.cTokenCollateral));
  const mintID = low(event.transaction.hash).concat("-").concat(event.logIndex.toString());

  const cTokenAmount = truncate(toBD(event.params.seizeTokens).div(cTokenDecimalsBD), cTokenDecimals);
  const underlyingRepayAmount = truncate(
    toBD(event.params.repayAmount).div(exponentToBigDecimal(marketRepayToken.underlyingDecimals)),
    marketRepayToken.underlyingDecimals,
  );

  context.LiquidationEvent.set({
    id: mintID,
    amount: cTokenAmount,
    to: low(event.params.liquidator),
    from: low(event.params.borrower),
    blockNumber: event.block.number,
    blockTime: event.block.timestamp,
    underlyingSymbol: marketRepayToken.underlyingSymbol,
    underlyingRepayAmount: underlyingRepayAmount,
    cTokenSymbol: marketCTokenLiquidated.symbol,
  });
});

/* Transferring of cTokens
 *
 * event.params.from = sender of cTokens
 * event.params.to = receiver of cTokens
 * event.params.amount = amount sent
 *
 * Notes
 *    Possible ways to emit Transfer:
 *      seize() - i.e. a Liquidation Transfer (does not emit anything else)
 *      redeemFresh() - i.e. redeeming your cTokens for underlying asset
 *      mintFresh() - i.e. you are lending underlying assets to create ctokens
 *      transfer() - i.e. a basic transfer
 *    This function handles all 4 cases. Transfer is emitted alongside the mint, redeem, and seize
 *    events. So for those events, we do not update cToken balances.
 */
indexer.onEvent({ contract: "CToken", event: "Transfer" }, async ({ event, context }) => {
  // We only updateMarket() if accrual block number is not up to date. This will only happen
  // with normal transfers, since mint, redeem, and seize transfers will already run updateMarket()
  const marketID = low(event.srcAddress);
  let market = await context.Market.getOrThrow(marketID);
  if (market.accrualBlockNumber != event.block.number) {
    market = await updateMarket(context, marketID, event.block.number, event.block.timestamp);
  }

  const amountUnderlying = market.exchangeRate.times(toBD(event.params.amount).div(cTokenDecimalsBD));
  const amountUnderlyingTruncated = truncate(amountUnderlying, market.underlyingDecimals);

  // Checking if the tx is FROM the cToken contract (i.e. this will not run when minting)
  // If so, it is a mint, and we don't need to run these calculations
  const accountFromID = low(event.params.from);
  if (accountFromID != marketID) {
    const accountFrom = await context.Account.get(accountFromID);
    if (accountFrom == undefined) {
      createAccount(context, accountFromID);
    }

    // Update cTokenStats common for all events, and return the stats to update unique
    // values for each event
    const cTokenStatsFrom = await updateCommonCTokenStats(
      context,
      market.id,
      market.symbol,
      accountFromID,
      low(event.transaction.hash),
      BigInt(event.block.timestamp),
      BigInt(event.block.number),
      BigInt(event.logIndex),
    );

    context.AccountCToken.set({
      ...cTokenStatsFrom,
      cTokenBalance: cTokenStatsFrom.cTokenBalance.minus(
        truncate(toBD(event.params.amount).div(cTokenDecimalsBD), cTokenDecimals),
      ),
      totalUnderlyingRedeemed: cTokenStatsFrom.totalUnderlyingRedeemed.plus(amountUnderlyingTruncated),
    });
  }

  // Checking if the tx is TO the cToken contract (i.e. this will not run when redeeming)
  // If so, we ignore it. this leaves an edge case, where someone who accidentally sends
  // cTokens to a cToken contract, where it will not get recorded. Right now it would
  // be messy to include, so we are leaving it out for now TODO fix this in future
  const accountToID = low(event.params.to);
  if (accountToID != marketID) {
    const accountTo = await context.Account.get(accountToID);
    if (accountTo == undefined) {
      createAccount(context, accountToID);
    }

    // Update cTokenStats common for all events, and return the stats to update unique
    // values for each event
    const cTokenStatsTo = await updateCommonCTokenStats(
      context,
      market.id,
      market.symbol,
      accountToID,
      low(event.transaction.hash),
      BigInt(event.block.timestamp),
      BigInt(event.block.number),
      BigInt(event.logIndex),
    );

    context.AccountCToken.set({
      ...cTokenStatsTo,
      cTokenBalance: cTokenStatsTo.cTokenBalance.plus(
        truncate(toBD(event.params.amount).div(cTokenDecimalsBD), cTokenDecimals),
      ),
      totalUnderlyingSupplied: cTokenStatsTo.totalUnderlyingSupplied.plus(amountUnderlyingTruncated),
    });
  }

  const transferID = low(event.transaction.hash).concat("-").concat(event.logIndex.toString());

  context.TransferEvent.set({
    id: transferID,
    amount: toBD(event.params.amount).div(cTokenDecimalsBD),
    to: low(event.params.to),
    from: low(event.params.from),
    blockNumber: event.block.number,
    blockTime: event.block.timestamp,
    cTokenSymbol: market.symbol,
  });
});

indexer.onEvent({ contract: "CToken", event: "AccrueInterest" }, async ({ event, context }) => {
  await updateMarket(context, low(event.srcAddress), event.block.number, event.block.timestamp);
});

indexer.onEvent({ contract: "CToken", event: "NewReserveFactor" }, async ({ event, context }) => {
  const marketID = low(event.srcAddress);
  const market = await context.Market.getOrThrow(marketID);
  context.Market.set({ ...market, reserveFactor: event.params.newReserveFactorMantissa });
});

indexer.onEvent(
  { contract: "CToken", event: "NewMarketInterestRateModel" },
  async ({ event, context }) => {
    const marketID = low(event.srcAddress);
    let market = await context.Market.get(marketID);
    if (market == undefined) {
      market = await createMarket(context, marketID, event.block.number);
    }
    context.Market.set({
      ...market,
      interestRateModelAddress: low(event.params.newInterestRateModel),
    });
  },
);
