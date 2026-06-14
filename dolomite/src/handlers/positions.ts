import { BigDecimal, indexer } from "envio";
import type { EvmOnEventContext, MarginPosition, Token, InterestIndex } from "envio";
type handlerContext = EvmOnEventContext;
import {
  BORROW_POSITION_PROXY_V1_ADDRESS,
  BORROW_POSITION_PROXY_V2_ADDRESS,
  DOLOMITE_AMM_ROUTER_PROXY_V1_ADDRESS,
  DOLOMITE_AMM_ROUTER_PROXY_V2_ADDRESS,
  DOLOMITE_MARGIN_ADDRESS,
  EVENT_EMITTER_PROXY_ADDRESS,
  EXPIRY_ADDRESS,
  MarginPositionStatus,
  ONE_BI,
  USD_PRECISION,
  ZERO_BD,
  ZERO_BI,
  a,
} from "../constants.js";
import { absBD, convertStructToDecimalAppliedValue, convertTokenToDecimal, truncate, type DolomiteValue } from "../helpers/math.js";
import {
  deleteTokenValueIfNecessary,
  getBorrowPositionAmountId,
  getBorrowPositionId,
  getEffectiveUserForAddress,
  getOrCreateDolomiteMarginForCall,
  getOrCreateMarginAccount,
  getOrCreateMarginPosition,
  getOrCreateTokenValue,
  getOrCreateTransaction,
  isStrategy,
  parseStrategy,
} from "../helpers/entities.js";
import { getTokenOraclePriceUSD } from "../helpers/pricing.js";

type Ctx = handlerContext;
type Struct = { deltaWei: DolomiteValue; newPar: DolomiteValue };

// ---------------------------------------------------------------------------
// Borrow position proxy
// ---------------------------------------------------------------------------
function isBorrowProxyKnown(addr: string): boolean {
  return (
    addr === BORROW_POSITION_PROXY_V1_ADDRESS ||
    addr === BORROW_POSITION_PROXY_V2_ADDRESS ||
    addr === EVENT_EMITTER_PROXY_ADDRESS
  );
}

indexer.onEvent({ contract: "BorrowPositionProxy", event: "BorrowPositionOpen" }, async ({ event, context }) => {
  if (!isBorrowProxyKnown(a(event.srcAddress))) return;
  if (event.params.accountIndex < 100n) return;

  const id = getBorrowPositionId(event.params.accountOwner, event.params.accountIndex);
  const existing = await context.BorrowPosition.get(id);
  if (existing !== undefined) return;

  const blockNumber = BigInt(event.block.number);
  const timestamp = BigInt(event.block.timestamp);
  const marginAccount = await getOrCreateMarginAccount(context, event.params.accountOwner, event.params.accountIndex, blockNumber, timestamp);
  context.MarginAccount.set(marginAccount);

  const user = await context.User.getOrThrow(a(event.params.accountOwner));
  context.User.set({ ...user, totalBorrowPositionCount: user.totalBorrowPositionCount + ONE_BI });
  if (user.effectiveUser_id !== user.id) {
    const eff = await context.User.getOrThrow(user.effectiveUser_id);
    context.User.set({ ...eff, totalBorrowPositionCount: eff.totalBorrowPositionCount + ONE_BI });
  }

  const effective = await getEffectiveUserForAddress(context, marginAccount.user_id);
  const tx = await getOrCreateTransaction(context, event.transaction.hash, blockNumber, timestamp);

  let strategy_id: string | undefined;
  if (isStrategy(marginAccount)) {
    const parsed = parseStrategy(marginAccount);
    context.StrategyPosition.set({
      id,
      effectiveUser_id: effective.id,
      marginAccount_id: marginAccount.id,
      strategyId: parsed.strategyId,
      positionId: parsed.positionId,
    });
    strategy_id = id;
  }

  context.BorrowPosition.set({
    id,
    effectiveUser_id: effective.id,
    marginAccount_id: marginAccount.id,
    openTimestamp: timestamp,
    openTransaction_id: tx.id,
    status: "OPEN",
    closeTimestamp: undefined,
    closeTransaction_id: undefined,
    amounts: [],
    allTokens: [],
    borrowTokens: [],
    supplyTokens: [],
    effectiveBorrowTokens: [],
    effectiveSupplyTokens: [],
    strategy_id,
  });

  const dm = await context.DolomiteMargin.getOrThrow(DOLOMITE_MARGIN_ADDRESS);
  context.DolomiteMargin.set({ ...dm, borrowPositionCount: dm.borrowPositionCount + ONE_BI });
});

// ---------------------------------------------------------------------------
// Margin position router (open/close)
// ---------------------------------------------------------------------------
function isRouterKnown(addr: string): boolean {
  return (
    addr === DOLOMITE_AMM_ROUTER_PROXY_V1_ADDRESS ||
    addr === DOLOMITE_AMM_ROUTER_PROXY_V2_ADDRESS ||
    addr === EVENT_EMITTER_PROXY_ADDRESS
  );
}

class PositionChangeEvent {
  inputWei: BigDecimal;
  outputWei: BigDecimal;
  depositWei: BigDecimal;
  constructor(
    public inputToken: Token,
    public outputToken: Token,
    public depositToken: Token,
    inputWei: bigint,
    outputWei: bigint,
    depositWei: bigint,
    public isOpen: boolean,
    public timestamp: bigint,
    public hash: string,
  ) {
    this.inputWei = convertTokenToDecimal(inputWei, inputToken.decimals);
    this.outputWei = convertTokenToDecimal(outputWei, outputToken.decimals);
    this.depositWei = convertTokenToDecimal(depositWei, depositToken.decimals);
  }
}

async function updateMarginPositionForTrade(
  context: Ctx,
  marginPosition: MarginPosition,
  blockNumber: bigint,
  blockHash: string,
  pce: PositionChangeEvent,
  inputTokenNewPar: DolomiteValue,
  outputTokenNewPar: DolomiteValue,
  inputTokenIndex: InterestIndex,
  outputTokenIndex: InterestIndex,
): Promise<void> {
  let mp = { ...marginPosition };
  let isPositionBeingOpened = false;
  if (mp.owedToken_id === undefined || mp.owedToken_id === null || mp.heldToken_id === undefined || mp.heldToken_id === null) {
    isPositionBeingOpened = true;
    mp.owedToken_id = pce.inputToken.id;
    mp.heldToken_id = pce.outputToken.id;
  }

  if (!isPositionBeingOpened) {
    const tokens = [mp.heldToken_id, mp.owedToken_id];
    if (
      mp.status === MarginPositionStatus.Unknown ||
      !tokens.includes(pce.inputToken.id) ||
      !tokens.includes(pce.outputToken.id) ||
      !tokens.includes(pce.depositToken.id)
    ) {
      context.MarginPosition.set({ ...mp, status: MarginPositionStatus.Unknown });
      return;
    }
  }

  const heldToken = await context.Token.getOrThrow(mp.heldToken_id!);
  const owedToken = await context.Token.getOrThrow(mp.owedToken_id!);

  const heldTokenNewPar = mp.heldToken_id === pce.inputToken.id
    ? absBD(convertStructToDecimalAppliedValue(inputTokenNewPar, heldToken.decimals))
    : absBD(convertStructToDecimalAppliedValue(outputTokenNewPar, heldToken.decimals));
  const owedTokenNewPar = mp.owedToken_id === pce.inputToken.id
    ? absBD(convertStructToDecimalAppliedValue(inputTokenNewPar, owedToken.decimals))
    : absBD(convertStructToDecimalAppliedValue(outputTokenNewPar, owedToken.decimals));

  void inputTokenIndex;
  void outputTokenIndex;
  const heldTokenIndex = mp.heldToken_id === pce.inputToken.id ? inputTokenIndex : outputTokenIndex;
  const owedTokenIndex = mp.owedToken_id === pce.inputToken.id ? inputTokenIndex : outputTokenIndex;

  const inputAmountWei = !pce.isOpen ? pce.inputWei.negated() : pce.inputWei;
  const outputAmountWei = !pce.isOpen ? pce.outputWei.negated() : pce.outputWei;
  const heldAmountWei = mp.heldToken_id === pce.inputToken.id ? inputAmountWei : outputAmountWei;
  const owedAmountWei = mp.owedToken_id === pce.inputToken.id ? inputAmountWei : outputAmountWei;

  mp.owedAmountPar = owedTokenNewPar;
  mp.heldAmountPar = heldTokenNewPar;

  if (isPositionBeingOpened) {
    const owedPriceUSD = await getTokenOraclePriceUSD(context, owedToken, blockNumber, blockHash);
    const heldPriceUSD = await getTokenOraclePriceUSD(context, heldToken, blockNumber, blockHash);
    mp.initialOwedAmountPar = owedTokenNewPar;
    mp.initialOwedAmountWei = owedAmountWei;
    mp.initialOwedPrice = owedAmountWei.eq(ZERO_BD) ? ZERO_BD : truncate(absBD(heldAmountWei).div(absBD(owedAmountWei)), 18);
    mp.initialOwedPriceUSD = truncate(mp.initialOwedPrice.times(heldPriceUSD), 36);
    mp.initialOwedAmountUSD = truncate(owedAmountWei.times(mp.initialOwedPriceUSD), 36);

    mp.initialHeldAmountPar = heldTokenNewPar;
    mp.initialHeldAmountWei = heldAmountWei.plus(pce.depositWei);
    mp.initialHeldPrice = heldAmountWei.eq(ZERO_BD) ? ZERO_BD : truncate(absBD(owedAmountWei).div(absBD(heldAmountWei)), 18);
    mp.initialHeldPriceUSD = truncate(mp.initialHeldPrice.times(owedPriceUSD), USD_PRECISION);
    mp.initialHeldAmountUSD = truncate(mp.initialHeldAmountWei.times(mp.initialHeldPriceUSD), USD_PRECISION);

    mp.marginDeposit = pce.depositWei;
    mp.marginDepositUSD = truncate(pce.depositWei.times(mp.initialHeldPriceUSD), USD_PRECISION);
    mp.initialMarginDeposit = pce.depositWei;
    mp.initialMarginDepositUSD = truncate(pce.depositWei.times(mp.initialHeldPriceUSD), USD_PRECISION);
    mp.isInitialized = true;
  }

  if (mp.owedAmountPar.eq(ZERO_BD)) {
    mp.status = MarginPositionStatus.Closed;
    mp.closeTimestamp = pce.timestamp;
    mp.closeTransaction_id = a(pce.hash);
    const heldPriceUSD = await getTokenOraclePriceUSD(context, heldToken, blockNumber, blockHash);
    const owedPriceUSD = await getTokenOraclePriceUSD(context, owedToken, blockNumber, blockHash);
    mp.closeHeldPrice = heldAmountWei.eq(ZERO_BD) ? ZERO_BD : truncate(owedAmountWei.div(heldAmountWei), 18);
    mp.closeHeldPriceUSD = truncate(mp.closeHeldPrice.times(owedPriceUSD), USD_PRECISION);
    mp.closeHeldAmountWei = mp.initialHeldAmountPar.times(heldTokenIndex.supplyIndex);
    mp.closeHeldAmountUSD = truncate(mp.closeHeldAmountWei.times(heldPriceUSD), USD_PRECISION);
    mp.closeHeldAmountSeized = ZERO_BD;
    mp.closeHeldAmountSeizedUSD = ZERO_BD;
    mp.closeOwedPrice = owedAmountWei.eq(ZERO_BD) ? ZERO_BD : truncate(heldAmountWei.div(owedAmountWei), 18);
    mp.closeOwedPriceUSD = truncate(mp.closeOwedPrice.times(heldPriceUSD), 36);
    mp.closeOwedAmountWei = mp.initialOwedAmountPar.times(owedTokenIndex.borrowIndex);
    mp.closeOwedAmountUSD = truncate(mp.closeOwedAmountWei.times(owedPriceUSD), 36);
  }

  const marginAccount = await context.MarginAccount.getOrThrow(mp.marginAccount_id);
  const tokenValue = await getOrCreateTokenValue(context, marginAccount, owedToken);
  if (tokenValue.expirationTimestamp !== undefined && tokenValue.expirationTimestamp !== null) {
    mp.expirationTimestamp = tokenValue.expirationTimestamp;
  }

  context.MarginPosition.set(mp);
}

indexer.onEvent({ contract: "DolomiteAmmRouter", event: "MarginPositionOpen" }, async ({ event, context }) => {
  if (!isRouterKnown(a(event.srcAddress))) return;
  const borrowPosition = await context.BorrowPosition.get(`${a(event.params.user)}-${event.params.accountIndex.toString()}`);
  if (borrowPosition !== undefined) return;

  const blockNumber = BigInt(event.block.number);
  const timestamp = BigInt(event.block.timestamp);
  const blockHash = a(event.block.hash ?? "0x");
  const marginAccount = await getOrCreateMarginAccount(context, event.params.user, event.params.accountIndex, blockNumber, timestamp);
  context.MarginAccount.set(marginAccount);

  const user = await context.User.getOrThrow(a(event.params.user));
  context.User.set({ ...user, totalMarginPositionCount: user.totalMarginPositionCount + ONE_BI });
  if (user.effectiveUser_id !== user.id) {
    const eff = await context.User.getOrThrow(user.effectiveUser_id);
    context.User.set({ ...eff, totalMarginPositionCount: eff.totalMarginPositionCount + ONE_BI });
  }

  const mp = await getOrCreateMarginPosition(context, event.transaction.hash, timestamp, marginAccount);
  const inputToken = await context.Token.getOrThrow(a(event.params.inputToken));
  const outputToken = await context.Token.getOrThrow(a(event.params.outputToken));
  const depositToken = await context.Token.getOrThrow(a(event.params.depositToken));
  const inputUpd = event.params.inputBalanceUpdate as Struct;
  const outputUpd = event.params.outputBalanceUpdate as Struct;
  const depositUpd = event.params.marginDepositUpdate as Struct;

  const pce = new PositionChangeEvent(
    inputToken, outputToken, depositToken,
    inputUpd.deltaWei.value, outputUpd.deltaWei.value, depositUpd.deltaWei.value,
    true, timestamp, event.transaction.hash,
  );
  const inputIndex = await context.InterestIndex.getOrThrow(inputToken.id);
  const outputIndex = await context.InterestIndex.getOrThrow(outputToken.id);
  await updateMarginPositionForTrade(context, mp, blockNumber, blockHash, pce, inputUpd.newPar, outputUpd.newPar, inputIndex, outputIndex);

  const dm = await context.DolomiteMargin.getOrThrow(DOLOMITE_MARGIN_ADDRESS);
  context.DolomiteMargin.set({ ...dm, marginPositionCount: dm.marginPositionCount + ONE_BI });
});

indexer.onEvent({ contract: "DolomiteAmmRouter", event: "MarginPositionClose" }, async ({ event, context }) => {
  if (!isRouterKnown(a(event.srcAddress))) return;
  const borrowPosition = await context.BorrowPosition.get(`${a(event.params.user)}-${event.params.accountIndex.toString()}`);
  if (borrowPosition !== undefined) return;

  const blockNumber = BigInt(event.block.number);
  const timestamp = BigInt(event.block.timestamp);
  const blockHash = a(event.block.hash ?? "0x");
  const marginAccount = await getOrCreateMarginAccount(context, event.params.user, event.params.accountIndex, blockNumber, timestamp);
  context.MarginAccount.set(marginAccount);

  const mp = await getOrCreateMarginPosition(context, event.transaction.hash, timestamp, marginAccount);
  const inputToken = await context.Token.getOrThrow(a(event.params.inputToken));
  const outputToken = await context.Token.getOrThrow(a(event.params.outputToken));
  const withdrawalToken = await context.Token.getOrThrow(a(event.params.withdrawalToken));
  const inputUpd = event.params.inputBalanceUpdate as Struct;
  const outputUpd = event.params.outputBalanceUpdate as Struct;
  const withdrawUpd = event.params.marginWithdrawalUpdate as Struct;

  const pce = new PositionChangeEvent(
    inputToken, outputToken, withdrawalToken,
    inputUpd.deltaWei.value, outputUpd.deltaWei.value, withdrawUpd.deltaWei.value,
    false, timestamp, event.transaction.hash,
  );
  const inputIndex = await context.InterestIndex.getOrThrow(inputToken.id);
  const outputIndex = await context.InterestIndex.getOrThrow(outputToken.id);
  await updateMarginPositionForTrade(context, mp, blockNumber, blockHash, pce, inputUpd.newPar, outputUpd.newPar, inputIndex, outputIndex);
});

// ---------------------------------------------------------------------------
// Expiry
// ---------------------------------------------------------------------------
indexer.onEvent({ contract: "MarginExpiry", event: "ExpirySet" }, async ({ event, context }) => {
  const blockNumber = BigInt(event.block.number);
  const timestamp = BigInt(event.block.timestamp);
  const lookup = await context.TokenMarketIdReverseLookup.getOrThrow(event.params.marketId.toString());
  const token = await context.Token.getOrThrow(lookup.token_id);
  const time = event.params.time;

  let marginAccount = await getOrCreateMarginAccount(context, event.params.owner, event.params.number, blockNumber, timestamp);
  let expirationTokens = marginAccount.expirationTokens;
  if (time === ZERO_BI) {
    const idx = expirationTokens.indexOf(token.id);
    if (idx !== -1) expirationTokens = expirationTokens.slice(0, idx).concat(expirationTokens.slice(idx + 1));
    marginAccount = { ...marginAccount, expirationTokens, hasExpiration: expirationTokens.length > 0 };
  } else {
    if (expirationTokens.indexOf(token.id) === -1) expirationTokens = expirationTokens.concat([token.id]);
    marginAccount = { ...marginAccount, expirationTokens, hasExpiration: true };
  }
  context.MarginAccount.set(marginAccount);

  const mp = await getOrCreateMarginPosition(context, event.transaction.hash, timestamp, marginAccount);
  if (!mp.marginDeposit.eq(ZERO_BD) && mp.status === MarginPositionStatus.Open) {
    if (time === ZERO_BI) {
      const exp = mp.expirationTimestamp;
      if (exp === undefined || exp === null || exp >= timestamp) {
        context.MarginPosition.set({ ...mp, expirationTimestamp: undefined });
      }
    } else {
      context.MarginPosition.set({ ...mp, expirationTimestamp: time });
    }
  }

  let tokenValue = await getOrCreateTokenValue(context, marginAccount, token);
  tokenValue = {
    ...tokenValue,
    expirationTimestamp: time > ZERO_BI ? time : undefined,
    expiryAddress: time > ZERO_BI ? a(event.srcAddress) : undefined,
  };
  if (!deleteTokenValueIfNecessary(context, tokenValue)) {
    context.MarginAccountTokenValue.set(tokenValue);
  }

  const bpaId = getBorrowPositionAmountId(marginAccount.user_id, marginAccount.accountNumber, token);
  const bpa = await context.BorrowPositionAmount.get(bpaId);
  if (bpa !== undefined) {
    if (time === ZERO_BI) {
      const exp = mp.expirationTimestamp;
      if (exp === undefined || exp === null || exp >= timestamp) {
        context.BorrowPositionAmount.set({ ...bpa, expirationTimestamp: undefined });
      }
    } else {
      context.BorrowPositionAmount.set({ ...bpa, expirationTimestamp: time });
    }
  }
});

indexer.onEvent({ contract: "MarginExpiry", event: "LogExpiryRampTimeSet" }, async ({ event, context }) => {
  const dm = await getOrCreateDolomiteMarginForCall(context, event.transaction.hash, false);
  context.DolomiteMargin.set({ ...dm, expiryRampTime: event.params.expiryRampTime });
});

void EXPIRY_ADDRESS;
