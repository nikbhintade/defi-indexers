/**
 * Port of src/mappingHelpers/interaction.ts.
 *
 * Transaction gas fields come from envio field_selection (gas / gasPrice /
 * gasUsed) instead of `event.transaction` + `event.receipt`.
 */
import type {
  Account,
  AbsorbCollateralInteraction,
  AbsorbDebtInteraction,
  BuyCollateralInteraction,
  ClaimRewardsInteraction,
  CollateralToken,
  Market,
  Position,
  SupplyBaseInteraction,
  SupplyCollateralInteraction,
  Token,
  Transaction,
  TransferBaseInteraction,
  TransferCollateralInteraction,
  WithdrawBaseInteraction,
  WithdrawCollateralInteraction,
  WithdrawReservesInteraction,
} from "envio";
import type { Ctx, Mutable, TxEv } from "../common/types";
import { PRICE_FEED_FACTOR, ZERO_ADDRESS } from "../common/constants";
import { bigIntBytes, hexConcat } from "../common/graphBytes";
import { getChainlinkEthUsdPriceFeedAddress } from "../common/networkSpecific";
import { computeTokenValueUsd, low, toBD } from "../common/utils";
import { chainlinkLatestAnswer } from "../effects/contracts";
import { getOrCreateMarketConfiguration } from "./market";
import { getBaseTokenPriceUsd, getCollateralTokenPriceUsd, getOrCreateToken, getTokenPriceWithGenericOracleUsd } from "./token";

async function getOrCreateTransaction(ctx: Ctx, event: TxEv): Promise<Mutable<Transaction>> {
  const id = low(event.transaction.hash);
  const transaction = await ctx.Transaction.get(id);

  if (!transaction) {
    const gasPrice = event.transaction.gasPrice ?? 0n;
    const created: Mutable<Transaction> = {
      id,
      hash: id,
      blockNumber: BigInt(event.block.number),
      timestamp: BigInt(event.block.timestamp),

      from: low(event.transaction.from ?? ZERO_ADDRESS),
      to: event.transaction.to === undefined ? undefined : low(event.transaction.to),

      gasLimit: event.transaction.gas,
      gasPrice,

      supplyBaseInteractionCount: 0,
      withdrawBaseInteractionCount: 0,
      transferBaseInteractionCount: 0,
      absorbDebtInteractionCount: 0,
      supplyCollateralInteractionCount: 0,
      withdrawCollateralInteractionCount: 0,
      transferCollateralInteractionCount: 0,
      absorbCollateralInteractionCount: 0,
      buyCollateralInteractionCount: 0,
      withdrawReservesInteractionCount: 0,
      claimRewardsInteractionCount: 0,

      gasUsed: undefined,
      gasUsedUsd: undefined,
    };

    // Original: `if (event.receipt) { ... }` — envio always provides gasUsed
    // via field_selection, so this branch always runs (graph-node also always
    // had receipts here since the manifest sets `receipt: true`).
    const gasUsed = event.transaction.gasUsed;
    created.gasUsed = gasUsed;

    const tryLatestAnswer = await chainlinkLatestAnswer(
      ctx.effect,
      getChainlinkEthUsdPriceFeedAddress(),
      event.block.number,
    );
    if (tryLatestAnswer !== null) {
      const price = toBD(tryLatestAnswer).div(PRICE_FEED_FACTOR);
      created.gasUsedUsd = computeTokenValueUsd(gasUsed * gasPrice, 18, price);
    }

    ctx.Transaction.set({ ...created });
    return created;
  }

  return { ...transaction };
}

export async function createSupplyBaseInteraction(
  ctx: Ctx,
  market: Market,
  position: Position,
  supplier: string,
  amount: bigint,
  event: TxEv,
): Promise<SupplyBaseInteraction> {
  const transaction = await getOrCreateTransaction(ctx, event);
  const marketConfiguration = await getOrCreateMarketConfiguration(ctx, market, event);
  const baseToken = { ...(await ctx.BaseToken.getOrThrow(marketConfiguration.baseToken_id)) };
  const token = await getOrCreateToken(ctx, baseToken.token_id, event);
  const tokenPrice = await getBaseTokenPriceUsd(ctx, baseToken, event);
  const id = hexConcat(transaction.id, bigIntBytes(BigInt(event.logIndex)));

  const interaction: SupplyBaseInteraction = {
    id,
    transaction_id: transaction.id,
    market_id: market.id,
    position_id: position.id,
    supplier,
    asset_id: marketConfiguration.baseToken_id,
    amount,
    amountUsd: computeTokenValueUsd(amount, token.decimals ?? 0, tokenPrice),
  };

  ctx.SupplyBaseInteraction.set(interaction);

  // Update transaction count
  transaction.supplyBaseInteractionCount += 1;
  ctx.Transaction.set({ ...transaction });

  return interaction;
}

export async function createWithdrawBaseInteraction(
  ctx: Ctx,
  market: Market,
  position: Position,
  destination: string,
  amount: bigint,
  event: TxEv,
): Promise<WithdrawBaseInteraction> {
  const transaction = await getOrCreateTransaction(ctx, event);
  const marketConfiguration = await getOrCreateMarketConfiguration(ctx, market, event);
  const baseToken = { ...(await ctx.BaseToken.getOrThrow(marketConfiguration.baseToken_id)) };
  const token = await getOrCreateToken(ctx, baseToken.token_id, event);
  const tokenPrice = await getBaseTokenPriceUsd(ctx, baseToken, event);
  const id = hexConcat(transaction.id, bigIntBytes(BigInt(event.logIndex)));

  const interaction: WithdrawBaseInteraction = {
    id,
    transaction_id: transaction.id,
    market_id: market.id,
    position_id: position.id,
    destination,
    asset_id: marketConfiguration.baseToken_id,
    amount,
    amountUsd: computeTokenValueUsd(amount, token.decimals ?? 0, tokenPrice),
  };

  ctx.WithdrawBaseInteraction.set(interaction);

  // Update transaction count
  transaction.withdrawBaseInteractionCount += 1;
  ctx.Transaction.set({ ...transaction });

  return interaction;
}

export async function createTransferBaseInteraction(
  ctx: Ctx,
  market: Market,
  fromPosition: Position | null,
  toPosition: Position | null,
  amount: bigint,
  event: TxEv,
): Promise<TransferBaseInteraction> {
  const transaction = await getOrCreateTransaction(ctx, event);
  const marketConfiguration = await getOrCreateMarketConfiguration(ctx, market, event);
  const baseToken = { ...(await ctx.BaseToken.getOrThrow(marketConfiguration.baseToken_id)) };
  const token = await getOrCreateToken(ctx, baseToken.token_id, event);
  const tokenPrice = await getBaseTokenPriceUsd(ctx, baseToken, event);
  const id = hexConcat(transaction.id, bigIntBytes(BigInt(event.logIndex)));

  const interaction: TransferBaseInteraction = {
    id,
    transaction_id: transaction.id,
    market_id: market.id,
    fromPosition_id: fromPosition ? fromPosition.id : undefined,
    toPosition_id: toPosition ? toPosition.id : undefined,
    asset_id: marketConfiguration.baseToken_id,
    amount,
    amountUsd: computeTokenValueUsd(amount, token.decimals ?? 0, tokenPrice),
  };

  ctx.TransferBaseInteraction.set(interaction);

  // Update transaction count
  transaction.transferBaseInteractionCount += 1;
  ctx.Transaction.set({ ...transaction });

  return interaction;
}

export async function createAbsorbDebtInteraction(
  ctx: Ctx,
  market: Market,
  position: Position,
  absorber: string,
  amount: bigint,
  event: TxEv,
): Promise<AbsorbDebtInteraction> {
  const transaction = await getOrCreateTransaction(ctx, event);
  const marketConfiguration = await getOrCreateMarketConfiguration(ctx, market, event);
  const baseToken = { ...(await ctx.BaseToken.getOrThrow(marketConfiguration.baseToken_id)) };
  const token = await getOrCreateToken(ctx, baseToken.token_id, event);
  const tokenPrice = await getBaseTokenPriceUsd(ctx, baseToken, event);
  const id = hexConcat(transaction.id, bigIntBytes(BigInt(event.logIndex)));

  const interaction: AbsorbDebtInteraction = {
    id,
    transaction_id: transaction.id,
    market_id: market.id,
    position_id: position.id,
    absorber,
    asset_id: marketConfiguration.baseToken_id,
    amount,
    amountUsd: computeTokenValueUsd(amount, token.decimals ?? 0, tokenPrice),
  };

  ctx.AbsorbDebtInteraction.set(interaction);

  // Update transaction count
  transaction.absorbDebtInteractionCount += 1;
  ctx.Transaction.set({ ...transaction });

  return interaction;
}

export async function createSupplyCollateralInteraction(
  ctx: Ctx,
  market: Market,
  position: Position,
  supplier: string,
  asset: CollateralToken,
  amount: bigint,
  event: TxEv,
): Promise<SupplyCollateralInteraction> {
  const transaction = await getOrCreateTransaction(ctx, event);
  const token = await getOrCreateToken(ctx, asset.token_id, event);
  const tokenPrice = await getCollateralTokenPriceUsd(ctx, { ...asset }, event);
  const id = hexConcat(transaction.id, bigIntBytes(BigInt(event.logIndex)));

  const interaction: SupplyCollateralInteraction = {
    id,
    transaction_id: transaction.id,
    market_id: market.id,
    position_id: position.id,
    supplier,
    asset_id: asset.id,
    amount,
    amountUsd: computeTokenValueUsd(amount, token.decimals ?? 0, tokenPrice),
  };

  ctx.SupplyCollateralInteraction.set(interaction);

  // Update transaction count
  transaction.supplyCollateralInteractionCount += 1;
  ctx.Transaction.set({ ...transaction });

  return interaction;
}

export async function createWithdrawCollateralInteraction(
  ctx: Ctx,
  market: Market,
  position: Position,
  destination: string,
  asset: CollateralToken,
  amount: bigint,
  event: TxEv,
): Promise<WithdrawCollateralInteraction> {
  const transaction = await getOrCreateTransaction(ctx, event);
  const token = await getOrCreateToken(ctx, asset.token_id, event);
  const tokenPrice = await getCollateralTokenPriceUsd(ctx, { ...asset }, event);
  const id = hexConcat(transaction.id, bigIntBytes(BigInt(event.logIndex)));

  const interaction: WithdrawCollateralInteraction = {
    id,
    transaction_id: transaction.id,
    market_id: market.id,
    position_id: position.id,
    destination,
    asset_id: asset.id,
    amount,
    amountUsd: computeTokenValueUsd(amount, token.decimals ?? 0, tokenPrice),
  };

  ctx.WithdrawCollateralInteraction.set(interaction);

  // Update transaction count
  transaction.withdrawCollateralInteractionCount += 1;
  ctx.Transaction.set({ ...transaction });

  return interaction;
}

export async function createTransferCollateralInteraction(
  ctx: Ctx,
  market: Market,
  fromPosition: Position,
  toPosition: Position,
  asset: CollateralToken,
  amount: bigint,
  event: TxEv,
): Promise<TransferCollateralInteraction> {
  const transaction = await getOrCreateTransaction(ctx, event);
  const token = await getOrCreateToken(ctx, asset.token_id, event);
  const tokenPrice = await getCollateralTokenPriceUsd(ctx, { ...asset }, event);
  const id = hexConcat(transaction.id, bigIntBytes(BigInt(event.logIndex)));

  const interaction: TransferCollateralInteraction = {
    id,
    transaction_id: transaction.id,
    market_id: market.id,
    fromPosition_id: fromPosition.id,
    toPosition_id: toPosition.id,
    asset_id: asset.id,
    amount,
    amountUsd: computeTokenValueUsd(amount, token.decimals ?? 0, tokenPrice),
  };

  ctx.TransferCollateralInteraction.set(interaction);

  // Update transaction count
  transaction.transferCollateralInteractionCount += 1;
  ctx.Transaction.set({ ...transaction });

  return interaction;
}

export async function createAbsorbCollateralInteraction(
  ctx: Ctx,
  market: Market,
  position: Position,
  absorber: string,
  asset: CollateralToken,
  amount: bigint,
  event: TxEv,
): Promise<AbsorbCollateralInteraction> {
  const transaction = await getOrCreateTransaction(ctx, event);
  const token = await getOrCreateToken(ctx, asset.token_id, event);
  const tokenPrice = await getCollateralTokenPriceUsd(ctx, { ...asset }, event);
  const id = hexConcat(transaction.id, bigIntBytes(BigInt(event.logIndex)));

  const interaction: AbsorbCollateralInteraction = {
    id,
    transaction_id: transaction.id,
    market_id: market.id,
    position_id: position.id,
    absorber,
    asset_id: asset.id,
    amount,
    amountUsd: computeTokenValueUsd(amount, token.decimals ?? 0, tokenPrice),
  };

  ctx.AbsorbCollateralInteraction.set(interaction);

  // Update transaction count
  transaction.absorbCollateralInteractionCount += 1;
  ctx.Transaction.set({ ...transaction });

  return interaction;
}

export async function createBuyCollateralInteraction(
  ctx: Ctx,
  market: Market,
  buyer: string,
  asset: CollateralToken,
  collateralAmount: bigint,
  baseAmount: bigint,
  event: TxEv,
): Promise<void> {
  const transaction = await getOrCreateTransaction(ctx, event);
  const marketConfiguration = await getOrCreateMarketConfiguration(ctx, market, event);
  const baseToken = { ...(await ctx.BaseToken.getOrThrow(marketConfiguration.baseToken_id)) };
  const baseTokenPrice = await getBaseTokenPriceUsd(ctx, baseToken, event);
  const collateralPrice = await getCollateralTokenPriceUsd(ctx, { ...asset }, event);

  const baseTokenToken = await getOrCreateToken(ctx, baseToken.token_id, event);
  const collateralTokenToken = await getOrCreateToken(ctx, asset.token_id, event);
  const id = hexConcat(transaction.id, bigIntBytes(BigInt(event.logIndex)));

  const interaction: BuyCollateralInteraction = {
    id,
    transaction_id: transaction.id,
    market_id: market.id,
    buyer,
    asset_id: asset.id,
    collateralAmount,
    baseAmount,
    collateralAmountUsd: computeTokenValueUsd(collateralAmount, collateralTokenToken.decimals ?? 0, collateralPrice),
    baseAmountUsd: computeTokenValueUsd(baseAmount, baseTokenToken.decimals ?? 0, baseTokenPrice),
  };

  ctx.BuyCollateralInteraction.set(interaction);

  // Update transaction count
  transaction.buyCollateralInteractionCount += 1;
  ctx.Transaction.set({ ...transaction });
}

export async function createWithdrawReservesInteraction(
  ctx: Ctx,
  market: Market,
  destination: string,
  amount: bigint,
  event: TxEv,
): Promise<void> {
  const transaction = await getOrCreateTransaction(ctx, event);
  const marketConfiguration = await getOrCreateMarketConfiguration(ctx, market, event);
  const baseToken = { ...(await ctx.BaseToken.getOrThrow(marketConfiguration.baseToken_id)) };
  const token = await getOrCreateToken(ctx, baseToken.token_id, event);
  const tokenPrice = await getBaseTokenPriceUsd(ctx, baseToken, event);
  const id = hexConcat(transaction.id, bigIntBytes(BigInt(event.logIndex)));

  const interaction: WithdrawReservesInteraction = {
    id,
    transaction_id: transaction.id,
    market_id: market.id,
    destination,
    amount,
    amountUsd: computeTokenValueUsd(amount, token.decimals ?? 0, tokenPrice),
  };

  ctx.WithdrawReservesInteraction.set(interaction);

  // Update transaction count
  transaction.withdrawReservesInteractionCount += 1;
  ctx.Transaction.set({ ...transaction });
}

export async function createClaimRewardsInteraction(
  ctx: Ctx,
  account: Account,
  position: Position | null,
  destination: string,
  token: Token,
  amount: bigint,
  event: TxEv,
): Promise<ClaimRewardsInteraction> {
  const transaction = await getOrCreateTransaction(ctx, event);
  const tokenPrice = await getTokenPriceWithGenericOracleUsd(ctx, { ...token }, event);
  const id = hexConcat(transaction.id, bigIntBytes(BigInt(event.logIndex)));

  const interaction: ClaimRewardsInteraction = {
    id,
    transaction_id: transaction.id,
    account_id: account.id,
    position_id: position === null ? undefined : position.id,
    destination,
    token_id: token.id,
    amount,
    amountUsd: computeTokenValueUsd(amount, token.decimals ?? 0, tokenPrice),
  };

  ctx.ClaimRewardsInteraction.set(interaction);

  // Update transaction count
  transaction.claimRewardsInteractionCount += 1;
  ctx.Transaction.set({ ...transaction });

  return interaction;
}
