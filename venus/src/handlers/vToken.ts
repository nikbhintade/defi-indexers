/**
 * Port of src/mappings/vToken.ts (VToken + VTokenUpdatedEvents templates).
 *
 * Two event generations share the same vToken address:
 *  - VToken template (orig-events / v1): Mint/MintBehalf/Redeem WITHOUT the
 *    trailing totalSupply param (handleMintV1 / handleMintBehalfV1 /
 *    handleRedeemV1) + Borrow/RepayBorrow/LiquidateBorrow/AccrueInterest/
 *    NewReserveFactor/Transfer/NewMarketInterestRateModel/ReservesAdded/
 *    ReservesReduced.
 *  - VTokenUpdatedEvents template (v2): Mint/MintBehalf/Redeem WITH totalSupply
 *    (handleMint / handleMintBehalf / handleRedeem).
 *
 * Entity-id deviation: the original builds Transaction ids with
 * `event.transactionLogIndex`; envio provides the block-level `event.logIndex`,
 * which graph-node's Ethereum/BSC adapter populates transactionLogIndex with
 * anyway (no per-tx log counter) — see MIGRATION.md.
 */
import { indexer } from "envio";
import { zeroBigInt32, nullAddress } from "../constants";
import {
  getOrCreateAccount,
  getOrCreateMarketPosition,
  updateMarketPositionSupply,
  updateMarketPositionBorrow,
  createMintEvent,
  createMintBehalfEvent,
  createRedeemEvent,
  createBorrowEvent,
  createRepayEvent,
  createLiquidationEvent,
  createTransferEvent,
} from "../services/helpers";
import {
  getOrCreateMarket,
  getOrCreateToken,
  getMarketOrThrow,
  updateMarketCashMantissa,
  updateMarketRates,
  getUnderlyingPrice,
} from "../services/markets";
import { getMarketId } from "../utilities/ids";

const low = (a: string) => a.toLowerCase();

// ============ VTokenUpdatedEvents (v2) ============

indexer.onEvent({ contract: "VTokenUpdatedEvents", event: "Mint" }, async ({ event, context }) => {
  const marketAddress = event.srcAddress;

  await updateMarketPositionSupply(
    context,
    event.params.minter,
    marketAddress,
    BigInt(event.block.number),
    event.params.totalSupply,
    event.block.number,
  );

  const market = await getOrCreateMarket(context, marketAddress, event.block.number);
  context.Market.set({
    ...market,
    totalSupplyVTokenMantissa: market.totalSupplyVTokenMantissa + event.params.mintTokens,
  });

  createMintEvent(context, {
    txHash: event.transaction.hash,
    logIndex: event.logIndex,
    amountMantissa: event.params.mintAmount,
    to: event.params.minter,
    from: marketAddress,
    blockNumber: event.block.number,
    blockTime: event.block.timestamp,
  });
});

indexer.onEvent(
  { contract: "VTokenUpdatedEvents", event: "MintBehalf" },
  async ({ event, context }) => {
    const marketAddress = event.srcAddress;

    await updateMarketPositionSupply(
      context,
      event.params.receiver,
      marketAddress,
      BigInt(event.block.number),
      event.params.totalSupply,
      event.block.number,
    );

    const market = await getOrCreateMarket(context, marketAddress, event.block.number);
    context.Market.set({
      ...market,
      totalSupplyVTokenMantissa: market.totalSupplyVTokenMantissa + event.params.mintTokens,
    });

    createMintBehalfEvent(context, {
      txHash: event.transaction.hash,
      logIndex: event.logIndex,
      amountMantissa: event.params.mintAmount,
      to: event.params.receiver,
      from: marketAddress,
      blockNumber: event.block.number,
      blockTime: event.block.timestamp,
    });
  },
);

indexer.onEvent({ contract: "VTokenUpdatedEvents", event: "Redeem" }, async ({ event, context }) => {
  const marketAddress = event.srcAddress;

  await updateMarketPositionSupply(
    context,
    event.params.redeemer,
    marketAddress,
    BigInt(event.block.number),
    event.params.totalSupply,
    event.block.number,
  );

  const result = await getOrCreateMarketPosition(
    context,
    event.params.redeemer,
    getMarketId(marketAddress),
    event.block.number,
  );
  context.MarketPosition.set({
    ...result.entity,
    totalUnderlyingRedeemedMantissa:
      result.entity.totalUnderlyingRedeemedMantissa + event.params.redeemAmount,
  });

  const market = await getOrCreateMarket(context, marketAddress, event.block.number);
  context.Market.set({
    ...market,
    totalSupplyVTokenMantissa: market.totalSupplyVTokenMantissa - event.params.redeemTokens,
  });

  createRedeemEvent(context, {
    txHash: event.transaction.hash,
    logIndex: event.logIndex,
    amountMantissa: event.params.redeemAmount,
    to: event.params.redeemer,
    from: marketAddress,
    blockNumber: event.block.number,
    blockTime: event.block.timestamp,
  });
});

// ============ VToken (v1) ============

indexer.onEvent({ contract: "VToken", event: "Mint" }, async ({ event, context }) => {
  const marketAddress = event.srcAddress;
  const result = await getOrCreateMarketPosition(
    context,
    event.params.minter,
    getMarketId(marketAddress),
    event.block.number,
  );
  // Creation updates balance
  await updateMarketPositionSupply(
    context,
    event.params.minter,
    marketAddress,
    BigInt(event.block.number),
    result.entity.vTokenBalanceMantissa + event.params.mintTokens,
    event.block.number,
  );

  const market = await getOrCreateMarket(context, marketAddress, event.block.number);

  context.Market.set({
    ...market,
    totalSupplyVTokenMantissa: market.totalSupplyVTokenMantissa + event.params.mintTokens,
  });

  createMintEvent(context, {
    txHash: event.transaction.hash,
    logIndex: event.logIndex,
    amountMantissa: event.params.mintAmount,
    to: event.params.minter,
    from: marketAddress,
    blockNumber: event.block.number,
    blockTime: event.block.timestamp,
  });
});

indexer.onEvent({ contract: "VToken", event: "MintBehalf" }, async ({ event, context }) => {
  const marketAddress = event.srcAddress;

  const result = await getOrCreateMarketPosition(
    context,
    event.params.receiver,
    getMarketId(marketAddress),
    event.block.number,
  );
  // Creation updates balance
  await updateMarketPositionSupply(
    context,
    event.params.receiver,
    marketAddress,
    BigInt(event.block.number),
    result.entity.vTokenBalanceMantissa + event.params.mintTokens,
    event.block.number,
  );

  const market = await getOrCreateMarket(context, marketAddress, event.block.number);
  context.Market.set({
    ...market,
    totalSupplyVTokenMantissa: market.totalSupplyVTokenMantissa + event.params.mintTokens,
  });

  createMintBehalfEvent(context, {
    txHash: event.transaction.hash,
    logIndex: event.logIndex,
    amountMantissa: event.params.mintAmount,
    to: event.params.receiver,
    from: marketAddress,
    blockNumber: event.block.number,
    blockTime: event.block.timestamp,
  });
});

indexer.onEvent({ contract: "VToken", event: "Redeem" }, async ({ event, context }) => {
  const marketAddress = event.srcAddress;
  const market = await getOrCreateMarket(context, marketAddress, event.block.number);

  context.Market.set({
    ...market,
    totalSupplyVTokenMantissa: market.totalSupplyVTokenMantissa - event.params.redeemTokens,
  });

  createRedeemEvent(context, {
    txHash: event.transaction.hash,
    logIndex: event.logIndex,
    amountMantissa: event.params.redeemAmount,
    to: event.params.redeemer,
    from: marketAddress,
    blockNumber: event.block.number,
    blockTime: event.block.timestamp,
  });

  const result = await getOrCreateMarketPosition(
    context,
    event.params.redeemer,
    getMarketId(marketAddress),
    event.block.number,
  );

  await updateMarketPositionSupply(
    context,
    event.params.redeemer,
    marketAddress,
    BigInt(event.block.number),
    result.entity.vTokenBalanceMantissa - event.params.redeemTokens,
    event.block.number,
  );
});

indexer.onEvent({ contract: "VToken", event: "Borrow" }, async ({ event, context }) => {
  const marketAddress = event.srcAddress;
  const market = await getOrCreateMarket(context, marketAddress, event.block.number);
  context.Market.set({ ...market, totalBorrowsMantissa: event.params.totalBorrows });

  const account = await getOrCreateAccount(context, event.params.borrower);
  context.Account.set({ ...account, hasBorrowed: true });

  await updateMarketPositionBorrow(
    context,
    event.params.borrower,
    marketAddress,
    BigInt(event.block.number),
    event.params.accountBorrows,
    event.block.number,
  );

  createBorrowEvent(context, {
    txHash: event.transaction.hash,
    logIndex: event.logIndex,
    amountMantissa: event.params.borrowAmount,
    to: event.params.borrower,
    from: marketAddress,
    blockNumber: event.block.number,
    blockTime: event.block.timestamp,
  });
});

indexer.onEvent({ contract: "VToken", event: "RepayBorrow" }, async ({ event, context }) => {
  const marketAddress = event.srcAddress;
  const market = await getOrCreateMarket(context, marketAddress, event.block.number);
  context.Market.set({ ...market, totalBorrowsMantissa: event.params.totalBorrows });

  const marketPosition = await updateMarketPositionBorrow(
    context,
    event.params.borrower,
    marketAddress,
    BigInt(event.block.number),
    event.params.accountBorrows,
    event.block.number,
  );

  context.MarketPosition.set({
    ...marketPosition,
    totalUnderlyingRepaidMantissa:
      marketPosition.totalUnderlyingRepaidMantissa + event.params.repayAmount,
  });

  createRepayEvent(context, {
    txHash: event.transaction.hash,
    logIndex: event.logIndex,
    amountMantissa: event.params.repayAmount,
    to: event.params.borrower,
    from: marketAddress,
    blockNumber: event.block.number,
    blockTime: event.block.timestamp,
  });
});

indexer.onEvent({ contract: "VToken", event: "LiquidateBorrow" }, async ({ event, context }) => {
  const liquidator = await getOrCreateAccount(context, event.params.liquidator);
  context.Account.set({ ...liquidator, countLiquidator: liquidator.countLiquidator + 1 });

  const borrower = await getOrCreateAccount(context, event.params.borrower);
  context.Account.set({ ...borrower, countLiquidated: borrower.countLiquidated + 1 });

  createLiquidationEvent(context, {
    txHash: event.transaction.hash,
    logIndex: event.logIndex,
    amountMantissa: event.params.repayAmount,
    to: event.params.borrower,
    from: event.srcAddress,
    blockNumber: event.block.number,
    blockTime: event.block.timestamp,
  });
});

indexer.onEvent({ contract: "VToken", event: "Transfer" }, async ({ event, context }) => {
  const accountFromAddress = low(event.params.from);
  const accountToAddress = low(event.params.to);
  const marketAddress = low(event.srcAddress);

  // FROM branch: not minting (from != vToken, from != null), not to-vToken.
  if (
    accountFromAddress !== nullAddress &&
    accountFromAddress !== marketAddress &&
    accountToAddress !== marketAddress
  ) {
    await getOrCreateAccount(context, accountFromAddress);
    const marketPosition = await getOrCreateMarketPosition(
      context,
      accountFromAddress,
      getMarketId(marketAddress),
      event.block.number,
    );
    await updateMarketPositionSupply(
      context,
      accountFromAddress,
      marketAddress,
      BigInt(event.block.number),
      marketPosition.entity.vTokenBalanceMantissa - event.params.amount,
      event.block.number,
    );
  }

  // TO branch: amount > 0, to/from not null, from != vToken, to != vToken.
  if (
    event.params.amount > zeroBigInt32 &&
    accountToAddress !== nullAddress &&
    accountFromAddress !== nullAddress &&
    accountFromAddress !== marketAddress &&
    accountToAddress !== marketAddress
  ) {
    await getOrCreateAccount(context, accountToAddress);
    const marketPosition = await getOrCreateMarketPosition(
      context,
      accountToAddress,
      getMarketId(marketAddress),
      event.block.number,
    );
    await updateMarketPositionSupply(
      context,
      accountToAddress,
      marketAddress,
      BigInt(event.block.number),
      marketPosition.entity.vTokenBalanceMantissa + event.params.amount,
      event.block.number,
    );
  }

  createTransferEvent(context, {
    txHash: event.transaction.hash,
    logIndex: event.logIndex,
    amountMantissa: event.params.amount,
    to: event.params.to,
    from: event.params.from,
    blockNumber: event.block.number,
    blockTime: event.block.timestamp,
  });
});

indexer.onEvent({ contract: "VToken", event: "AccrueInterest" }, async ({ event, context }) => {
  const marketAddress = event.srcAddress;
  let market = await getOrCreateMarket(context, marketAddress, event.block.number);

  market = {
    ...market,
    accrualBlockNumber: BigInt(event.block.number),
    borrowIndex: event.params.borrowIndex,
    totalBorrowsMantissa: event.params.totalBorrows,
  };
  market = await updateMarketCashMantissa(context, market, event.block.number);

  const underlyingToken = await getOrCreateToken(context, market.underlyingToken_id);
  market = {
    ...market,
    lastUnderlyingPriceCents: await getUnderlyingPrice(
      context,
      marketAddress,
      underlyingToken.decimals,
      event.block.number,
    ),
    lastUnderlyingPriceBlockNumber: BigInt(event.block.number),
  };

  market = await updateMarketRates(context, market, event.block.number);
  // market.reservesMantissa = vTokenContract.totalReserves() (non-try)
  market = {
    ...market,
    reservesMantissa: await readTotalReserves(context, marketAddress, event.block.number),
  };
  context.Market.set(market);
});

indexer.onEvent({ contract: "VToken", event: "NewReserveFactor" }, async ({ event, context }) => {
  const market = await getOrCreateMarket(context, event.srcAddress, event.block.number);
  context.Market.set({ ...market, reserveFactorMantissa: event.params.newReserveFactorMantissa });
});

indexer.onEvent(
  { contract: "VToken", event: "NewMarketInterestRateModel" },
  async ({ event, context }) => {
    const market = await getOrCreateMarket(context, event.srcAddress, event.block.number);
    context.Market.set({
      ...market,
      interestRateModelAddress: low(event.params.newInterestRateModel),
    });
  },
);

indexer.onEvent({ contract: "VToken", event: "ReservesAdded" }, async ({ event, context }) => {
  const marketAddress = event.srcAddress;
  let market = await getOrCreateMarket(context, marketAddress, event.block.number);
  market = { ...market, reservesMantissa: event.params.newTotalReserves };
  market = await updateMarketRates(context, market, event.block.number);
  context.Market.set(market);
});

indexer.onEvent({ contract: "VToken", event: "ReservesReduced" }, async ({ event, context }) => {
  const marketAddress = event.srcAddress;
  let market = await getOrCreateMarket(context, marketAddress, event.block.number);
  market = { ...market, reservesMantissa: event.params.newTotalReserves };
  market = await updateMarketRates(context, market, event.block.number);
  context.Market.set(market);
});

// Non-try totalReserves read (AccrueInterest); revert aborts graph-node -> 0n.
import { vTokenTotalReserves } from "../effects/contracts";
import type { EvmOnEventContext } from "envio";

async function readTotalReserves(
  context: EvmOnEventContext,
  vToken: string,
  block: number,
): Promise<bigint> {
  const v = await vTokenTotalReserves(context.effect, vToken, block);
  if (v === null) {
    context.log.error(`***CALL FAILED*** : VToken.totalReserves() reverted`);
    return 0n;
  }
  return v;
}
