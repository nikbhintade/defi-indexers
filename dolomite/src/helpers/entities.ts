/**
 * Entity getOrCreate helpers + the core par/wei/index balance accounting,
 * ported from the Dolomite subgraph's margin-helpers / user-helpers /
 * amm-helpers / isolation-mode-helpers / token-helpers.
 *
 * envio entities are plain immutable objects: read with context.X.get, write
 * with context.X.set({...}). There is no entity.save(); callers spread-update.
 */
import { BigDecimal } from "envio";
import type {
  EvmOnEventContext,
  AmmLiquidityPosition,
  BorrowPosition,
  BorrowPositionAmount,
  DolomiteMargin,
  InterestIndex,
  InterestIndexSnapshot,
  MarginAccount,
  MarginAccountTokenValue,
  MarginPosition,
  MarketRiskInfo,
  Token,
  TotalPar,
  Trade,
  User,
  UserParValue,
} from "envio";
import {
  a,
  DOLOMITE_MARGIN_ADDRESS,
  FIVE_BD,
  MarginPositionStatus,
  ONE_BI,
  USD_PRECISION,
  ZERO_BD,
  ZERO_BI,
  ZERO_BYTES,
} from "../constants.js";
import { absBD, convertTokenToDecimal, exponentToBigDecimal, roundHalfUp, truncate, type DolomiteValue } from "./math.js";
import { getTokenOraclePriceUSD } from "./pricing.js";

type Ctx = EvmOnEventContext;

// ---------------------------------------------------------------------------
// ID helpers
// ---------------------------------------------------------------------------
export function getIDForEvent(txHash: string, logIndex: number): string {
  return `${a(txHash)}-${logIndex.toString()}`;
}

export function marginAccountId(owner: string, accountNumber: bigint): string {
  return `${a(owner)}-${accountNumber.toString()}`;
}

export function tokenValueId(marginAccount: MarginAccount, token: Token): string {
  return `${a(marginAccount.user_id)}-${marginAccount.accountNumber.toString()}-${token.marketId.toString()}`;
}

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------
export async function createUserIfNecessary(context: Ctx, address: string): Promise<void> {
  const id = a(address);
  const user = await context.User.get(id);
  if (user === undefined) {
    context.User.set({
      id,
      effectiveUser_id: id,
      accountRiskOverrideSetter: undefined,
      totalBorrowVolumeOriginatedUSD: ZERO_BD,
      totalCollateralLiquidatedUSD: ZERO_BD,
      totalTradeVolumeUSD: ZERO_BD,
      totalZapVolumeUSD: ZERO_BD,
      totalBorrowPositionCount: ZERO_BI,
      totalLiquidationCount: ZERO_BI,
      totalMarginPositionCount: ZERO_BI,
      totalTradeCount: ZERO_BI,
      totalZapCount: ZERO_BI,
      isEffectiveUser: true,
      isolationModeVault_id: undefined,
    });
    const dolomiteMargin = await context.DolomiteMargin.getOrThrow(DOLOMITE_MARGIN_ADDRESS);
    context.DolomiteMargin.set({ ...dolomiteMargin, userCount: dolomiteMargin.userCount + ONE_BI });
  }
}

/** Resolves the effective user (owner) for an address, following the chain once. */
export async function getEffectiveUserForAddress(context: Ctx, address: string): Promise<User> {
  const user = await context.User.getOrThrow(a(address));
  return context.User.getOrThrow(user.effectiveUser_id);
}

// ---------------------------------------------------------------------------
// Transaction
// ---------------------------------------------------------------------------
export async function getOrCreateTransaction(
  context: Ctx,
  txHash: string,
  blockNumber: bigint,
  timestamp: bigint,
) {
  const id = a(txHash);
  let transaction = await context.Transaction.get(id);
  if (transaction === undefined) {
    transaction = {
      id,
      blockNumber,
      timestamp,
      intermittentAmmMints: [],
      intermittentAmmBurns: [],
      intermittentAmmTrades: [],
    };
    context.Transaction.set(transaction);
  }
  return transaction;
}

// ---------------------------------------------------------------------------
// DolomiteMargin
// ---------------------------------------------------------------------------
export async function getOrCreateDolomiteMarginForCall(
  context: Ctx,
  txHash: string,
  isAction: boolean,
): Promise<DolomiteMargin> {
  let dolomiteMargin = await context.DolomiteMargin.get(DOLOMITE_MARGIN_ADDRESS);
  if (dolomiteMargin === undefined) {
    dolomiteMargin = {
      id: DOLOMITE_MARGIN_ADDRESS,
      numberOfMarkets: 0,
      liquidationRatio: ZERO_BD,
      liquidationReward: ZERO_BD,
      earningsRate: ZERO_BD,
      minBorrowedValue: ZERO_BD,
      accountMaxNumberOfMarketsWithBalances: ZERO_BI,
      expiryRampTime: ZERO_BI,
      oracleSentinel: undefined,
      callbackGasLimit: undefined,
      defaultAccountRiskOverrideSetter: undefined,
      supplyLiquidityUSD: ZERO_BD,
      borrowLiquidityUSD: ZERO_BD,
      lastTransactionHash: ZERO_BYTES,
      totalBorrowVolumeUSD: ZERO_BD,
      totalLiquidationVolumeUSD: ZERO_BD,
      totalSupplyVolumeUSD: ZERO_BD,
      totalTradeVolumeUSD: ZERO_BD,
      totalVaporizationVolumeUSD: ZERO_BD,
      totalZapVolumeUSD: ZERO_BD,
      userCount: ZERO_BI,
      marginPositionCount: ZERO_BI,
      borrowPositionCount: ZERO_BI,
      actionCount: ZERO_BI,
      liquidationCount: ZERO_BI,
      tradeCount: ZERO_BI,
      transactionCount: ZERO_BI,
      vaporizationCount: ZERO_BI,
      zapCount: ZERO_BI,
      vestingPositionTransferCount: ZERO_BI,
    };
  }

  let next = { ...dolomiteMargin };
  if (next.lastTransactionHash !== a(txHash)) {
    next.lastTransactionHash = a(txHash);
    next.transactionCount = next.transactionCount + ONE_BI;
  }
  if (isAction) {
    next.actionCount = next.actionCount + ONE_BI;
  }
  context.DolomiteMargin.set(next);
  return next;
}

// ---------------------------------------------------------------------------
// Token value / margin account
// ---------------------------------------------------------------------------
export async function getOrCreateMarginAccount(
  context: Ctx,
  owner: string,
  accountNumber: bigint,
  blockNumber: bigint,
  timestamp: bigint,
): Promise<MarginAccount> {
  const id = marginAccountId(owner, accountNumber);
  let marginAccount = await context.MarginAccount.get(id);
  if (marginAccount === undefined) {
    await createUserIfNecessary(context, owner);
    const effective = await getEffectiveUserForAddress(context, owner);
    marginAccount = {
      id,
      user_id: a(owner),
      effectiveUser_id: effective.id,
      accountNumber,
      lastUpdatedTimestamp: timestamp,
      lastUpdatedBlockNumber: blockNumber,
      borrowTokens: [],
      supplyTokens: [],
      expirationTokens: [],
      hasBorrowValue: false,
      hasSupplyValue: false,
      hasExpiration: false,
    };
  } else {
    marginAccount = { ...marginAccount, lastUpdatedBlockNumber: blockNumber, lastUpdatedTimestamp: timestamp };
  }
  return marginAccount;
}

export async function getOrCreateTokenValue(
  context: Ctx,
  marginAccount: MarginAccount,
  token: Token,
): Promise<MarginAccountTokenValue> {
  const id = tokenValueId(marginAccount, token);
  let tokenValue = await context.MarginAccountTokenValue.get(id);
  if (tokenValue === undefined) {
    tokenValue = {
      id,
      marginAccount_id: marginAccount.id,
      effectiveUser_id: marginAccount.effectiveUser_id,
      token_id: token.id,
      valuePar: ZERO_BD,
      expirationTimestamp: undefined,
      expiryAddress: undefined,
    };
  }
  return tokenValue;
}

export function deleteTokenValueIfNecessary(context: Ctx, tokenValue: MarginAccountTokenValue): boolean {
  if (
    tokenValue.valuePar.eq(ZERO_BD) &&
    tokenValue.expirationTimestamp === undefined &&
    tokenValue.expiryAddress === undefined
  ) {
    context.MarginAccountTokenValue.deleteUnsafe(tokenValue.id);
    return true;
  }
  return false;
}

export async function getOrCreateEffectiveUserTokenValue(
  context: Ctx,
  effectiveUser: string,
  token: Token,
): Promise<UserParValue> {
  const id = `${a(effectiveUser)}-${token.id}`;
  let tokenValue = await context.UserParValue.get(id);
  if (tokenValue === undefined) {
    tokenValue = {
      id,
      user_id: a(effectiveUser),
      token_id: token.id,
      totalSupplyPar: ZERO_BD,
      totalBorrowPar: ZERO_BD,
    };
    context.UserParValue.set(tokenValue);
  }
  return tokenValue;
}

export function deleteUserParValueIfNecessary(context: Ctx, upv: UserParValue): boolean {
  if (upv.totalSupplyPar.eq(ZERO_BD) && upv.totalBorrowPar.eq(ZERO_BD)) {
    context.UserParValue.deleteUnsafe(upv.id);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// InterestIndexSnapshot
// ---------------------------------------------------------------------------
export async function getOrCreateInterestIndexSnapshotAndReturnId(
  context: Ctx,
  index: InterestIndex,
): Promise<string> {
  const snapshotId = `${index.token_id}-${index.lastUpdate.toString()}`;
  const existing = await context.InterestIndexSnapshot.get(snapshotId);
  if (existing === undefined) {
    const snapshot: InterestIndexSnapshot = {
      id: snapshotId,
      token_id: index.token_id,
      borrowIndex: index.borrowIndex,
      supplyIndex: index.supplyIndex,
      updateTimestamp: index.lastUpdate,
    };
    context.InterestIndexSnapshot.set(snapshot);
  }
  return snapshotId;
}

// ---------------------------------------------------------------------------
// par <-> wei
// ---------------------------------------------------------------------------
export function parToWei(par: BigDecimal, index: InterestIndex, decimals: bigint): BigDecimal {
  if (par.eq(ZERO_BD)) {
    return ZERO_BD;
  } else if (par.gt(ZERO_BD)) {
    return roundHalfUp(par.times(index.supplyIndex), decimals);
  }
  return roundHalfUp(par.times(index.borrowIndex), decimals);
}

export function canBeMarginPosition(marginAccount: MarginAccount): boolean {
  return marginAccount.accountNumber >= 100n;
}

// ---------------------------------------------------------------------------
// MarginPosition
// ---------------------------------------------------------------------------
export async function getOrCreateMarginPosition(
  context: Ctx,
  txHash: string,
  timestamp: bigint,
  account: MarginAccount,
): Promise<MarginPosition> {
  let mp = await context.MarginPosition.get(account.id);
  if (mp === undefined) {
    const effective = await getEffectiveUserForAddress(context, account.user_id);
    await getOrCreateTransaction(context, txHash, ZERO_BI, timestamp);
    mp = {
      id: account.id,
      effectiveUser_id: effective.id,
      marginAccount_id: account.id,
      isInitialized: false,
      status: MarginPositionStatus.Open,
      openTimestamp: timestamp,
      openTransaction_id: a(txHash),
      heldToken_id: undefined,
      marginDeposit: ZERO_BD,
      marginDepositUSD: ZERO_BD,
      initialMarginDeposit: ZERO_BD,
      initialMarginDepositUSD: ZERO_BD,
      initialHeldAmountPar: ZERO_BD,
      initialHeldAmountWei: ZERO_BD,
      initialHeldAmountUSD: ZERO_BD,
      initialHeldPrice: ZERO_BD,
      initialHeldPriceUSD: ZERO_BD,
      closeHeldPrice: undefined,
      closeHeldPriceUSD: undefined,
      closeHeldAmountWei: undefined,
      closeHeldAmountUSD: undefined,
      closeHeldAmountSeized: undefined,
      closeHeldAmountSeizedUSD: undefined,
      heldAmountPar: ZERO_BD,
      owedToken_id: undefined,
      initialOwedAmountPar: ZERO_BD,
      initialOwedAmountWei: ZERO_BD,
      initialOwedAmountUSD: ZERO_BD,
      initialOwedPrice: ZERO_BD,
      initialOwedPriceUSD: ZERO_BD,
      closeOwedPrice: undefined,
      closeOwedPriceUSD: undefined,
      closeOwedAmountWei: undefined,
      closeOwedAmountUSD: undefined,
      owedAmountPar: ZERO_BD,
      closeTimestamp: undefined,
      closeTransaction_id: undefined,
      expirationTimestamp: undefined,
    };
  }
  return mp;
}

// ---------------------------------------------------------------------------
// BalanceUpdate model (the (sign,value) deltaWei/newPar struct → BigDecimal)
// ---------------------------------------------------------------------------
export class BalanceUpdate {
  accountOwner: string;
  accountNumber: bigint;
  token: Token;
  valuePar: BigDecimal;
  deltaWei: BigDecimal;

  constructor(
    accountOwner: string,
    accountNumber: bigint,
    newPar: DolomiteValue,
    deltaWei: DolomiteValue,
    token: Token,
  ) {
    this.accountOwner = a(accountOwner);
    this.accountNumber = accountNumber;
    this.token = token;
    this.valuePar = convertTokenToDecimal(newPar.sign ? newPar.value : -newPar.value, token.decimals);
    this.deltaWei = convertTokenToDecimal(deltaWei.sign ? deltaWei.value : -deltaWei.value, token.decimals);
  }

  get marginAccount(): string {
    return marginAccountId(this.accountOwner, this.accountNumber);
  }
}

export class MarginAccountWithValueParChange {
  marginAccount: MarginAccount;
  deltaPar: BigDecimal;
  constructor(marginAccount: MarginAccount, deltaPar: BigDecimal) {
    this.marginAccount = marginAccount;
    this.deltaPar = deltaPar;
  }
}

function handleTotalParChange(totalPar: TotalPar, oldPar: BigDecimal, newPar: BigDecimal): TotalPar {
  let supplyPar = totalPar.supplyPar;
  let borrowPar = totalPar.borrowPar;
  // roll-back oldPar
  if (oldPar.gte(ZERO_BD)) {
    supplyPar = supplyPar.minus(oldPar);
  } else {
    borrowPar = borrowPar.minus(absBD(oldPar));
  }
  // roll-forward newPar
  if (newPar.gte(ZERO_BD)) {
    supplyPar = supplyPar.plus(newPar);
  } else {
    borrowPar = borrowPar.plus(absBD(newPar));
  }
  return { ...totalPar, supplyPar, borrowPar };
}

/**
 * The heart of the par accounting: applies a balance update for an account,
 * recomputes borrow/supply token lists, the effective-user par values, and
 * tracks originated borrow volume. Returns the updated MarginAccount (NOT yet
 * persisted by the caller in some paths) + the deltaPar. Mirrors
 * handleDolomiteMarginBalanceUpdateForAccount.
 */
export async function handleDolomiteMarginBalanceUpdateForAccount(
  context: Ctx,
  balanceUpdate: BalanceUpdate,
  txHash: string,
  blockNumber: bigint,
  timestamp: bigint,
  blockHash: string,
): Promise<MarginAccountWithValueParChange> {
  let marginAccount = await getOrCreateMarginAccount(
    context,
    balanceUpdate.accountOwner,
    balanceUpdate.accountNumber,
    blockNumber,
    timestamp,
  );
  let tokenValue = await getOrCreateTokenValue(context, marginAccount, balanceUpdate.token);
  const token = await context.Token.getOrThrow(tokenValue.token_id);
  let effectiveUserTokenValue = await getOrCreateEffectiveUserTokenValue(
    context,
    marginAccount.effectiveUser_id,
    token,
  );

  let totalPar = await context.TotalPar.getOrThrow(token.id);
  totalPar = handleTotalParChange(totalPar, tokenValue.valuePar, balanceUpdate.valuePar);
  context.TotalPar.set(totalPar);

  let borrowTokens = marginAccount.borrowTokens;
  let supplyTokens = marginAccount.supplyTokens;

  if (tokenValue.valuePar.lt(ZERO_BD) && balanceUpdate.valuePar.gte(ZERO_BD)) {
    const idx = borrowTokens.indexOf(balanceUpdate.token.id);
    if (idx !== -1) {
      borrowTokens = borrowTokens.slice(0, idx).concat(borrowTokens.slice(idx + 1));
    }
  } else if (tokenValue.valuePar.gte(ZERO_BD) && balanceUpdate.valuePar.lt(ZERO_BD)) {
    borrowTokens = borrowTokens.concat([balanceUpdate.token.id]);
  }

  if (tokenValue.valuePar.lte(ZERO_BD) && balanceUpdate.valuePar.gt(ZERO_BD)) {
    supplyTokens = supplyTokens.concat([balanceUpdate.token.id]);
  } else if (tokenValue.valuePar.gt(ZERO_BD) && balanceUpdate.valuePar.lte(ZERO_BD)) {
    const idx = supplyTokens.indexOf(balanceUpdate.token.id);
    if (idx !== -1) {
      supplyTokens = supplyTokens.slice(0, idx).concat(supplyTokens.slice(idx + 1));
    }
  }

  marginAccount = {
    ...marginAccount,
    borrowTokens,
    supplyTokens,
    hasBorrowValue: borrowTokens.length > 0,
    hasSupplyValue: supplyTokens.length > 0,
  };

  // originated borrow volume
  if (balanceUpdate.valuePar.lt(ZERO_BD) && balanceUpdate.valuePar.lt(tokenValue.valuePar)) {
    let amountParBorrowed = absBD(balanceUpdate.valuePar).minus(tokenValue.valuePar);
    if (amountParBorrowed.gt(absBD(balanceUpdate.valuePar))) {
      amountParBorrowed = absBD(balanceUpdate.valuePar);
    }
    const interestIndex = await context.InterestIndex.getOrThrow(token.id);
    const priceUSD = await getTokenOraclePriceUSD(context, token, blockNumber, blockHash);
    const amountBorrowedUSD = truncate(
      parToWei(amountParBorrowed, interestIndex, token.decimals).times(priceUSD),
      USD_PRECISION,
    );
    const user = await context.User.getOrThrow(marginAccount.user_id);
    context.User.set({
      ...user,
      totalBorrowVolumeOriginatedUSD: user.totalBorrowVolumeOriginatedUSD.plus(amountBorrowedUSD),
    });
    if (user.effectiveUser_id !== user.id) {
      const eff = await context.User.getOrThrow(user.effectiveUser_id);
      context.User.set({
        ...eff,
        totalBorrowVolumeOriginatedUSD: eff.totalBorrowVolumeOriginatedUSD.plus(amountBorrowedUSD),
      });
    }
  }

  const deltaPar = balanceUpdate.valuePar.minus(tokenValue.valuePar);
  let totalSupplyPar = effectiveUserTokenValue.totalSupplyPar;
  let totalBorrowPar = effectiveUserTokenValue.totalBorrowPar;
  if (tokenValue.valuePar.gt(ZERO_BD)) {
    if (deltaPar.lt(ZERO_BD) && absBD(deltaPar).gt(tokenValue.valuePar)) {
      totalSupplyPar = totalSupplyPar.minus(tokenValue.valuePar);
      const borrowDelta = absBD(deltaPar).minus(tokenValue.valuePar);
      totalBorrowPar = totalBorrowPar.plus(borrowDelta);
    } else {
      totalSupplyPar = totalSupplyPar.plus(deltaPar);
    }
  } else if (tokenValue.valuePar.lt(ZERO_BD)) {
    if (deltaPar.gt(ZERO_BD) && deltaPar.gt(absBD(tokenValue.valuePar))) {
      totalBorrowPar = totalBorrowPar.minus(absBD(tokenValue.valuePar));
      const supplyDelta = deltaPar.minus(absBD(tokenValue.valuePar));
      totalSupplyPar = totalSupplyPar.plus(supplyDelta);
    } else {
      totalBorrowPar = totalBorrowPar.minus(deltaPar);
    }
  } else {
    if (deltaPar.gt(ZERO_BD)) {
      totalSupplyPar = totalSupplyPar.plus(deltaPar);
    } else if (deltaPar.lt(ZERO_BD)) {
      totalBorrowPar = totalBorrowPar.minus(deltaPar);
    }
  }
  effectiveUserTokenValue = { ...effectiveUserTokenValue, totalSupplyPar, totalBorrowPar };

  tokenValue = { ...tokenValue, valuePar: balanceUpdate.valuePar };

  context.MarginAccount.set(marginAccount);
  if (!deleteUserParValueIfNecessary(context, effectiveUserTokenValue)) {
    context.UserParValue.set(effectiveUserTokenValue);
  }
  if (!deleteTokenValueIfNecessary(context, tokenValue)) {
    context.MarginAccountTokenValue.set(tokenValue);
  }

  await updateBorrowPositionForBalanceUpdate(context, marginAccount, balanceUpdate, txHash, blockNumber, timestamp);

  return new MarginAccountWithValueParChange(marginAccount, deltaPar);
}

export async function saveMostRecentTrade(context: Ctx, trade: Trade): Promise<void> {
  context.MostRecentTrade.set({ id: trade.takerToken_id, trade_id: trade.id });
  context.MostRecentTrade.set({ id: trade.makerToken_id, trade_id: trade.id });
}

export async function getLiquidationSpreadForPair(
  context: Ctx,
  heldToken: Token,
  owedToken: Token,
  dolomiteMargin: DolomiteMargin,
): Promise<BigDecimal> {
  const heldRiskInfo = (await context.MarketRiskInfo.getOrThrow(heldToken.id)) as MarketRiskInfo;
  const owedRiskInfo = (await context.MarketRiskInfo.getOrThrow(owedToken.id)) as MarketRiskInfo;
  const ONE = new BigDecimal("1");
  let liquidationSpread = dolomiteMargin.liquidationReward.minus(ONE);
  liquidationSpread = liquidationSpread.times(ONE.plus(heldRiskInfo.liquidationRewardPremium));
  liquidationSpread = liquidationSpread.times(ONE.plus(owedRiskInfo.liquidationRewardPremium));
  return liquidationSpread;
}

// ---------------------------------------------------------------------------
// BorrowPosition tracking (subgraph borrow-position-helpers)
// ---------------------------------------------------------------------------
export function getBorrowPositionId(owner: string, accountIndex: bigint): string {
  return marginAccountId(owner, accountIndex);
}

export function getBorrowPositionAmountId(owner: string, accountIndex: bigint, token: Token): string {
  return `${getBorrowPositionId(owner, accountIndex)}-${token.id}`;
}

async function getOrCreateBorrowPositionAmount(
  context: Ctx,
  marginAccount: MarginAccount,
  token: Token,
): Promise<BorrowPositionAmount> {
  const id = getBorrowPositionAmountId(marginAccount.user_id, marginAccount.accountNumber, token);
  let bpa = await context.BorrowPositionAmount.get(id);
  if (bpa === undefined) {
    bpa = { id, token_id: token.id, amountWei: ZERO_BD, amountPar: ZERO_BD, expirationTimestamp: undefined };
  }
  return bpa;
}

async function updateBorrowAndSupplyTokens(
  context: Ctx,
  borrowPosition: BorrowPosition,
  marginAccount: MarginAccount,
  balanceUpdate: BalanceUpdate,
): Promise<BorrowPosition> {
  const tokenValue = await getOrCreateTokenValue(context, marginAccount, balanceUpdate.token);
  let bpa = await getOrCreateBorrowPositionAmount(context, marginAccount, balanceUpdate.token);

  let amounts = borrowPosition.amounts;
  let allTokens = borrowPosition.allTokens;
  let supplyTokens = borrowPosition.supplyTokens;
  let borrowTokens = borrowPosition.borrowTokens;
  let effectiveSupplyTokens = borrowPosition.effectiveSupplyTokens;
  let effectiveBorrowTokens = borrowPosition.effectiveBorrowTokens;
  let updated = false;

  const removeOnce = (arr: readonly string[], v: string): readonly string[] => {
    const idx = arr.indexOf(v);
    if (idx !== -1) {
      updated = true;
      return arr.slice(0, idx).concat(arr.slice(idx + 1));
    }
    return arr;
  };

  if (!bpa.amountPar.eq(ZERO_BD) && balanceUpdate.valuePar.eq(ZERO_BD)) {
    amounts = removeOnce(amounts, bpa.id);
    allTokens = removeOnce(allTokens, bpa.token_id);
    if (bpa.amountPar.gt(ZERO_BD)) {
      supplyTokens = removeOnce(supplyTokens, bpa.token_id);
    } else {
      borrowTokens = removeOnce(borrowTokens, bpa.token_id);
    }
  } else if (bpa.amountPar.eq(ZERO_BD) && !balanceUpdate.valuePar.eq(ZERO_BD)) {
    amounts = amounts.concat([bpa.id]);
    allTokens = allTokens.concat([bpa.token_id]);
    if (balanceUpdate.valuePar.gt(ZERO_BD)) {
      supplyTokens = supplyTokens.concat([bpa.token_id]);
      if (effectiveSupplyTokens.indexOf(bpa.token_id) === -1) {
        effectiveSupplyTokens = effectiveSupplyTokens.concat([bpa.token_id]);
      }
    } else {
      borrowTokens = borrowTokens.concat([bpa.token_id]);
      if (effectiveBorrowTokens.indexOf(bpa.token_id) === -1) {
        effectiveBorrowTokens = effectiveBorrowTokens.concat([bpa.token_id]);
      }
    }
    updated = true;
  }

  bpa = { ...bpa, amountPar: tokenValue.valuePar, amountWei: bpa.amountWei.plus(balanceUpdate.deltaWei) };
  context.BorrowPositionAmount.set(bpa);

  const next = {
    ...borrowPosition,
    amounts,
    allTokens,
    supplyTokens,
    borrowTokens,
    effectiveSupplyTokens,
    effectiveBorrowTokens,
  };
  if (updated) {
    context.BorrowPosition.set(next);
  }
  return next;
}

export async function updateBorrowPositionForBalanceUpdate(
  context: Ctx,
  marginAccount: MarginAccount,
  balanceUpdate: BalanceUpdate,
  txHash: string,
  blockNumber: bigint,
  timestamp: bigint,
): Promise<void> {
  const id = getBorrowPositionId(marginAccount.user_id, marginAccount.accountNumber);
  let position = await context.BorrowPosition.get(id);
  if (position === undefined) {
    return;
  }
  const wasEmpty = position.amounts.length === 0;
  position = await updateBorrowAndSupplyTokens(context, position, marginAccount, balanceUpdate);
  const isEmpty = position.amounts.length === 0;
  if (isEmpty && position.status !== "CLOSED") {
    const tx = await getOrCreateTransaction(context, txHash, blockNumber, timestamp);
    context.BorrowPosition.set({
      ...position,
      status: "CLOSED",
      closeTimestamp: timestamp,
      closeTransaction_id: tx.id,
    });
  } else if (wasEmpty && !isEmpty) {
    context.BorrowPosition.set({
      ...position,
      status: "OPEN",
      closeTimestamp: undefined,
      closeTransaction_id: undefined,
    });
  }
}

export function isStrategy(marginAccount: MarginAccount): boolean {
  return (
    marginAccount.accountNumber >= 1_000_000_000n && marginAccount.accountNumber <= 10_000_000_000n
  );
}

export function parseStrategy(marginAccount: MarginAccount): { strategyId: bigint; positionId: bigint } {
  const fullPositionId = marginAccount.accountNumber;
  const positionId = fullPositionId % 1_000_000n;
  const remaining = (fullPositionId - positionId) / 1_000_000n;
  const strategyId = remaining - 1_000n;
  return { strategyId, positionId };
}

// ---------------------------------------------------------------------------
// AMM liquidity positions
// ---------------------------------------------------------------------------
export async function createLiquidityPosition(
  context: Ctx,
  exchange: string,
  userAddress: string,
): Promise<AmmLiquidityPosition> {
  const positionID = `${a(exchange)}-${a(userAddress)}`;
  let position = await context.AmmLiquidityPosition.get(positionID);
  if (position === undefined) {
    const pair = await context.AmmPair.getOrThrow(a(exchange));
    context.AmmPair.set({ ...pair, liquidityProviderCount: pair.liquidityProviderCount + ONE_BI });
    const user = await context.User.getOrThrow(a(userAddress));
    position = {
      id: positionID,
      liquidityTokenBalance: ZERO_BD,
      pair_id: a(exchange),
      user_id: a(userAddress),
      effectiveUser_id: user.effectiveUser_id,
    };
    context.AmmLiquidityPosition.set(position);
  }
  return position;
}

export async function createLiquiditySnapshot(
  context: Ctx,
  position: AmmLiquidityPosition,
  blockNumber: bigint,
  timestamp: bigint,
): Promise<void> {
  const ts = Number(timestamp);
  const bundle = await context.Bundle.getOrThrow("1");
  const pair = await context.AmmPair.getOrThrow(position.pair_id);
  const token0 = await context.Token.getOrThrow(pair.token0_id);
  const token1 = await context.Token.getOrThrow(pair.token1_id);
  const token0MarketIndex = await context.InterestIndex.getOrThrow(token0.id);
  const token1MarketIndex = await context.InterestIndex.getOrThrow(token1.id);

  const id = `${position.id}${ts.toString()}`;
  context.AmmLiquidityPositionSnapshot.set({
    id,
    liquidityPosition_id: position.id,
    timestamp: ts,
    block: Number(blockNumber),
    user_id: position.user_id,
    effectiveUser_id: position.effectiveUser_id,
    pair_id: position.pair_id,
    token0PriceUSD: (token0.derivedETH ?? ZERO_BD).times(bundle.ethPrice),
    token1PriceUSD: (token1.derivedETH ?? ZERO_BD).times(bundle.ethPrice),
    reserve0: pair.reserve0,
    reserve1: pair.reserve1,
    reserveUSD: pair.reserveUSD,
    liquidityTokenTotalSupply: pair.totalSupply,
    liquidityTokenBalance: position.liquidityTokenBalance,
    token0InterestIndex_id: await getOrCreateInterestIndexSnapshotAndReturnId(context, token0MarketIndex),
    token1InterestIndex_id: await getOrCreateInterestIndexSnapshotAndReturnId(context, token1MarketIndex),
  });
}

export { FIVE_BD, exponentToBigDecimal };
