import { BigDecimal, indexer } from "envio";
import type { EvmOnEventContext, InterestIndex, MarginPosition, Token } from "envio";
type handlerContext = EvmOnEventContext;
import {
  DOLOMITE_MARGIN_ADDRESS,
  EXPIRY_ADDRESS,
  MarginPositionStatus,
  ONE_BI,
  TradeLiquidationType,
  USD_PRECISION,
  ZERO_BD,
  ZERO_BI,
  _18_BI,
  a,
} from "../constants.js";
import { absBD, convertStructToDecimalAppliedValue, convertTokenToDecimal, roundHalfUp, structAbs, truncate, type DolomiteValue } from "../helpers/math.js";
import {
  BalanceUpdate,
  MarginAccountWithValueParChange,
  canBeMarginPosition,
  getIDForEvent,
  getLiquidationSpreadForPair,
  getOrCreateDolomiteMarginForCall,
  getOrCreateInterestIndexSnapshotAndReturnId,
  getOrCreateMarginPosition,
  getOrCreateTransaction,
  getEffectiveUserForAddress,
  handleDolomiteMarginBalanceUpdateForAccount,
  parToWei,
  saveMostRecentTrade,
  updateBorrowPositionForBalanceUpdate,
} from "../helpers/entities.js";
import { changeProtocolBalance, changeProtocolBalanceApplied } from "../helpers/protocol-balance.js";
import { getTokenOraclePriceUSD } from "../helpers/pricing.js";

type Ctx = handlerContext;
type Struct = { deltaWei: DolomiteValue; newPar: DolomiteValue };

async function tokenForMarket(context: Ctx, marketId: bigint): Promise<Token> {
  const lookup = await context.TokenMarketIdReverseLookup.getOrThrow(marketId.toString());
  return context.Token.getOrThrow(lookup.token_id);
}

function ev(event: any) {
  return {
    hash: event.transaction.hash as string,
    logIndex: event.logIndex as number,
    blockNumber: BigInt(event.block.number),
    timestamp: BigInt(event.block.timestamp),
    blockHash: a(event.block.hash ?? "0x"),
  };
}

// ---- Index update ----
async function handleIndexUpdate(context: Ctx, marketId: bigint, borrow: bigint, supply: bigint, lastUpdate: bigint) {
  const token = await tokenForMarket(context, marketId);
  const existing = await context.InterestIndex.get(token.id);
  context.InterestIndex.set({
    id: token.id,
    token_id: token.id,
    borrowIndex: convertTokenToDecimal(borrow, _18_BI),
    supplyIndex: convertTokenToDecimal(supply, _18_BI),
    lastUpdate,
  });
  if (existing === undefined) {
    // keep token_id consistent
  }
}

indexer.onEvent({ contract: "MarginCore", event: "LogIndexUpdate" }, async ({ event, context }) => {
  // single-arg overload selected by signature; envio maps both to this name via
  // distinct signatures, the active one carries (borrow, supply, lastUpdate)
  const idx = (event.params as any).index;
  await handleIndexUpdate(context, event.params.market, idx.borrow, idx.supply, idx.lastUpdate);
});

indexer.onEvent({ contract: "MarginCore", event: "LogOraclePrice" }, async ({ event, context }) => {
  const e = ev(event);
  const token = await tokenForMarket(context, event.params.market);
  const oraclePrice = await context.OraclePrice.getOrThrow(token.id);
  context.OraclePrice.set({
    ...oraclePrice,
    price: convertTokenToDecimal(event.params.price.value, 36n - token.decimals),
    blockNumber: e.blockNumber,
    blockHash: e.blockHash,
  });
  const dolomiteMargin = await getOrCreateDolomiteMarginForCall(context, e.hash, false);
  const index = await context.InterestIndex.getOrThrow(token.id);
  await changeProtocolBalance(
    context,
    await context.Token.getOrThrow(token.id),
    { sign: false, value: ZERO_BI },
    index,
    true,
    dolomiteMargin,
    e.blockNumber,
    e.blockHash,
  );
});

indexer.onEvent({ contract: "MarginCore", event: "LogDeposit" }, async ({ event, context }) => {
  const e = ev(event);
  const token = await tokenForMarket(context, event.params.market);
  const update = event.params.update as Struct;

  const balanceUpdate = new BalanceUpdate(
    event.params.accountOwner,
    event.params.accountNumber,
    update.newPar,
    update.deltaWei,
    token,
  );
  const accountUpdateOne = await handleDolomiteMarginBalanceUpdateForAccount(
    context,
    balanceUpdate,
    e.hash,
    e.blockNumber,
    e.timestamp,
    e.blockHash,
  );

  await getOrCreateTransaction(context, e.hash, e.blockNumber, e.timestamp);
  let dolomiteMargin = await getOrCreateDolomiteMarginForCall(context, e.hash, true);

  const depositID = getIDForEvent(e.hash, e.logIndex);
  let deposit = await context.Deposit.get(depositID);
  const serialId = deposit === undefined ? dolomiteMargin.actionCount : deposit.serialId;

  const marketIndex = await context.InterestIndex.getOrThrow(token.id);
  const amountDeltaWei = convertStructToDecimalAppliedValue(update.deltaWei, token.decimals);
  const priceUSD = await getTokenOraclePriceUSD(context, token, e.blockNumber, e.blockHash);
  const amountUSDDeltaWei = truncate(amountDeltaWei.times(priceUSD), USD_PRECISION);

  const effectiveUser = await getEffectiveUserForAddress(context, event.params.accountOwner);
  context.Deposit.set({
    id: depositID,
    serialId,
    transaction_id: a(e.hash),
    logIndex: BigInt(e.logIndex),
    effectiveUser_id: effectiveUser.id,
    marginAccount_id: accountUpdateOne.marginAccount.id,
    token_id: token.id,
    interestIndex_id: await getOrCreateInterestIndexSnapshotAndReturnId(context, marketIndex),
    from: a(event.params.from),
    amountDeltaWei,
    amountDeltaPar: accountUpdateOne.deltaPar,
    amountUSDDeltaWei,
  });

  context.DolomiteMargin.set({
    ...dolomiteMargin,
    totalSupplyVolumeUSD: dolomiteMargin.totalSupplyVolumeUSD.plus(amountUSDDeltaWei),
  });
  dolomiteMargin = await context.DolomiteMargin.getOrThrow(DOLOMITE_MARGIN_ADDRESS);

  await changeProtocolBalance(
    context,
    await context.Token.getOrThrow(token.id),
    update.deltaWei,
    marketIndex,
    false,
    dolomiteMargin,
    e.blockNumber,
    e.blockHash,
  );
});

indexer.onEvent({ contract: "MarginCore", event: "LogWithdraw" }, async ({ event, context }) => {
  const e = ev(event);
  const token = await tokenForMarket(context, event.params.market);
  const update = event.params.update as Struct;

  const balanceUpdate = new BalanceUpdate(
    event.params.accountOwner,
    event.params.accountNumber,
    update.newPar,
    update.deltaWei,
    token,
  );
  const accountUpdateOne = await handleDolomiteMarginBalanceUpdateForAccount(
    context,
    balanceUpdate,
    e.hash,
    e.blockNumber,
    e.timestamp,
    e.blockHash,
  );

  await getOrCreateTransaction(context, e.hash, e.blockNumber, e.timestamp);
  const dolomiteMargin = await getOrCreateDolomiteMarginForCall(context, e.hash, true);

  const withdrawalID = getIDForEvent(e.hash, e.logIndex);
  const existing = await context.Withdrawal.get(withdrawalID);
  const serialId = existing === undefined ? dolomiteMargin.actionCount : existing.serialId;

  const marketIndex = await context.InterestIndex.getOrThrow(token.id);
  const amountDeltaWei = convertStructToDecimalAppliedValue(structAbs(update.deltaWei), token.decimals);
  const priceUSD = await getTokenOraclePriceUSD(context, token, e.blockNumber, e.blockHash);
  const effectiveUser = await getEffectiveUserForAddress(context, event.params.accountOwner);

  context.Withdrawal.set({
    id: withdrawalID,
    serialId,
    transaction_id: a(e.hash),
    logIndex: BigInt(e.logIndex),
    effectiveUser_id: effectiveUser.id,
    marginAccount_id: accountUpdateOne.marginAccount.id,
    token_id: token.id,
    interestIndex_id: await getOrCreateInterestIndexSnapshotAndReturnId(context, marketIndex),
    to: a(event.params.to),
    amountDeltaWei,
    amountDeltaPar: accountUpdateOne.deltaPar,
    amountUSDDeltaWei: truncate(amountDeltaWei.times(priceUSD), USD_PRECISION),
  });

  await changeProtocolBalance(
    context,
    await context.Token.getOrThrow(token.id),
    update.deltaWei,
    marketIndex,
    false,
    dolomiteMargin,
    e.blockNumber,
    e.blockHash,
  );
});

indexer.onEvent({ contract: "MarginCore", event: "LogTransfer" }, async ({ event, context }) => {
  const e = ev(event);
  const token = await tokenForMarket(context, event.params.market);
  const updateOne = event.params.updateOne as Struct;
  const updateTwo = event.params.updateTwo as Struct;

  const bu1 = new BalanceUpdate(event.params.accountOneOwner, event.params.accountOneNumber, updateOne.newPar, updateOne.deltaWei, token);
  const au1 = await handleDolomiteMarginBalanceUpdateForAccount(context, bu1, e.hash, e.blockNumber, e.timestamp, e.blockHash);
  const bu2 = new BalanceUpdate(event.params.accountTwoOwner, event.params.accountTwoNumber, updateTwo.newPar, updateTwo.deltaWei, token);
  const au2 = await handleDolomiteMarginBalanceUpdateForAccount(context, bu2, e.hash, e.blockNumber, e.timestamp, e.blockHash);

  await getOrCreateTransaction(context, e.hash, e.blockNumber, e.timestamp);
  const dolomiteMargin = await getOrCreateDolomiteMarginForCall(context, e.hash, true);

  const transferID = getIDForEvent(e.hash, e.logIndex);
  const existing = await context.Transfer.get(transferID);
  const serialId = existing === undefined ? dolomiteMargin.actionCount : existing.serialId;

  const oneSign = updateOne.deltaWei.sign;
  const fromMarginAccount = oneSign ? au2.marginAccount : au1.marginAccount;
  const fromDeltaPar = oneSign ? au2.deltaPar : au1.deltaPar;
  const toMarginAccount = oneSign ? au1.marginAccount : au2.marginAccount;
  const toDeltaPar = oneSign ? au1.deltaPar : au2.deltaPar;

  const fromEff = await getEffectiveUserForAddress(context, fromMarginAccount.user_id);
  const toEff = await getEffectiveUserForAddress(context, toMarginAccount.user_id);

  const marketIndex = await context.InterestIndex.getOrThrow(token.id);
  const priceUSD = await getTokenOraclePriceUSD(context, token, e.blockNumber, e.blockHash);
  const amountDeltaWei = convertStructToDecimalAppliedValue(structAbs(updateOne.deltaWei), token.decimals);

  context.Transfer.set({
    id: transferID,
    serialId,
    transaction_id: a(e.hash),
    logIndex: BigInt(e.logIndex),
    fromEffectiveUser_id: fromEff.id,
    fromMarginAccount_id: fromMarginAccount.id,
    toEffectiveUser_id: toEff.id,
    toMarginAccount_id: toMarginAccount.id,
    isSelfTransfer: fromMarginAccount.id === toMarginAccount.id,
    walletsConcatenated: `${au1.marginAccount.user_id}_${au2.marginAccount.user_id}`,
    effectiveWalletsConcatenated: `${fromEff.id}_${toEff.id}`,
    isTransferForMarginPosition: false,
    effectiveUsers: [fromEff.id, toEff.id],
    token_id: token.id,
    interestIndex_id: await getOrCreateInterestIndexSnapshotAndReturnId(context, marketIndex),
    amountDeltaWei,
    fromAmountDeltaPar: fromDeltaPar,
    toAmountDeltaPar: toDeltaPar,
    amountUSDDeltaWei: truncate(amountDeltaWei.times(priceUSD), USD_PRECISION),
  });

  const tokenEnt = await context.Token.getOrThrow(token.id);
  await changeProtocolBalance(context, tokenEnt, updateOne.deltaWei, marketIndex, true, dolomiteMargin, e.blockNumber, e.blockHash);
  await changeProtocolBalance(context, await context.Token.getOrThrow(token.id), updateTwo.deltaWei, marketIndex, true, await context.DolomiteMargin.getOrThrow(DOLOMITE_MARGIN_ADDRESS), e.blockNumber, e.blockHash);

  await updateMarginPositionForTransfer(context, au1.marginAccount, au2.marginAccount, bu1, bu2, transferID, e, token, priceUSD);
});

async function updateMarginPositionForTransfer(
  context: Ctx,
  marginAccount1: any,
  marginAccount2: any,
  balanceUpdate1: BalanceUpdate,
  balanceUpdate2: BalanceUpdate,
  transferId: string,
  e: ReturnType<typeof ev>,
  token: Token,
  priceUSD: BigDecimal,
): Promise<void> {
  if (marginAccount1.user_id !== marginAccount2.user_id) return;
  const oneIsPos = canBeMarginPosition(marginAccount1);
  const twoIsPos = canBeMarginPosition(marginAccount2);
  if (!((!oneIsPos && twoIsPos) || (!twoIsPos && oneIsPos))) return;

  const acct = oneIsPos ? marginAccount1 : marginAccount2;
  let mp = await getOrCreateMarginPosition(context, e.hash, e.timestamp, acct);
  if (!mp.isInitialized) return;

  const transfer = await context.Transfer.getOrThrow(transferId);
  context.Transfer.set({ ...transfer, isTransferForMarginPosition: true });

  if (mp.heldToken_id === token.id) {
    mp = {
      ...mp,
      heldAmountPar:
        balanceUpdate1.marginAccount === mp.marginAccount_id
          ? absBD(balanceUpdate1.valuePar)
          : absBD(balanceUpdate2.valuePar),
    };
    if (mp.status === MarginPositionStatus.Open && mp.marginAccount_id === transfer.toMarginAccount_id && !mp.heldAmountPar.eq(ZERO_BD)) {
      mp = {
        ...mp,
        initialHeldAmountPar: mp.heldAmountPar,
        initialHeldAmountWei: mp.initialHeldAmountWei.plus(transfer.amountDeltaWei),
        initialHeldAmountUSD: truncate(mp.initialHeldAmountUSD.plus(transfer.amountUSDDeltaWei), USD_PRECISION),
        marginDeposit: mp.marginDeposit.plus(transfer.amountDeltaWei),
      };
      mp = { ...mp, marginDepositUSD: truncate(mp.marginDeposit.times(priceUSD), USD_PRECISION) };
    } else if (mp.status === MarginPositionStatus.Open && mp.marginAccount_id === transfer.fromMarginAccount_id && !mp.heldAmountPar.eq(ZERO_BD)) {
      if (transfer.amountDeltaWei.gte(mp.marginDeposit)) {
        mp = { ...mp, marginDeposit: ZERO_BD };
      } else {
        mp = {
          ...mp,
          marginDeposit: mp.marginDeposit.minus(transfer.amountDeltaWei),
          initialHeldAmountPar: mp.heldAmountPar,
          initialHeldAmountWei: mp.initialHeldAmountWei.minus(transfer.amountDeltaWei),
          initialHeldAmountUSD: truncate(
            mp.initialHeldAmountUSD.minus(transfer.amountDeltaWei.times(mp.initialHeldPriceUSD)),
            USD_PRECISION,
          ),
        };
      }
      mp = { ...mp, marginDepositUSD: truncate(mp.marginDeposit.times(priceUSD), USD_PRECISION) };
    }
  } else if (token.id === mp.owedToken_id) {
    mp = {
      ...mp,
      owedAmountPar:
        balanceUpdate1.marginAccount === mp.marginAccount_id
          ? absBD(balanceUpdate1.valuePar)
          : absBD(balanceUpdate2.valuePar),
    };
  }
  context.MarginPosition.set(mp);
}

// ---- Buy / Sell / Trade ----
indexer.onEvent({ contract: "MarginCore", event: "LogBuy" }, async ({ event, context }) => {
  const e = ev(event);
  const inputToken = await tokenForMarket(context, event.params.takerMarket);
  const outputToken = await tokenForMarket(context, event.params.makerMarket);
  const takerUpdate = event.params.takerUpdate as Struct;
  const makerUpdate = event.params.makerUpdate as Struct;
  const takerInput = new BalanceUpdate(event.params.accountOwner, event.params.accountNumber, takerUpdate.newPar, takerUpdate.deltaWei, inputToken);
  const takerOutput = new BalanceUpdate(event.params.accountOwner, event.params.accountNumber, makerUpdate.newPar, makerUpdate.deltaWei, outputToken);
  await handleTradeInternal(context, e, a(event.params.exchangeWrapper), inputToken, outputToken, takerInput, takerOutput, null, null);
});

indexer.onEvent({ contract: "MarginCore", event: "LogSell" }, async ({ event, context }) => {
  const e = ev(event);
  const inputToken = await tokenForMarket(context, event.params.takerMarket);
  const outputToken = await tokenForMarket(context, event.params.makerMarket);
  const takerUpdate = event.params.takerUpdate as Struct;
  const makerUpdate = event.params.makerUpdate as Struct;
  const takerInput = new BalanceUpdate(event.params.accountOwner, event.params.accountNumber, takerUpdate.newPar, takerUpdate.deltaWei, inputToken);
  const takerOutput = new BalanceUpdate(event.params.accountOwner, event.params.accountNumber, makerUpdate.newPar, makerUpdate.deltaWei, outputToken);
  await handleTradeInternal(context, e, a(event.params.exchangeWrapper), inputToken, outputToken, takerInput, takerOutput, null, null);
});

indexer.onEvent({ contract: "MarginCore", event: "LogTrade" }, async ({ event, context }) => {
  const e = ev(event);
  const inputToken = await tokenForMarket(context, event.params.inputMarket);
  const outputToken = await tokenForMarket(context, event.params.outputMarket);
  const takerInputUpd = event.params.takerInputUpdate as Struct;
  const takerOutputUpd = event.params.takerOutputUpdate as Struct;
  const makerInputUpd = event.params.makerInputUpdate as Struct;
  const makerOutputUpd = event.params.makerOutputUpdate as Struct;

  const takerInput = new BalanceUpdate(event.params.takerAccountOwner, event.params.takerAccountNumber, takerInputUpd.newPar, takerInputUpd.deltaWei, inputToken);
  const takerOutput = new BalanceUpdate(event.params.takerAccountOwner, event.params.takerAccountNumber, takerOutputUpd.newPar, takerOutputUpd.deltaWei, outputToken);
  const makerInput = new BalanceUpdate(event.params.makerAccountOwner, event.params.makerAccountNumber, makerInputUpd.newPar, makerInputUpd.deltaWei, inputToken);
  const makerOutput = new BalanceUpdate(event.params.makerAccountOwner, event.params.makerAccountNumber, makerOutputUpd.newPar, makerOutputUpd.deltaWei, outputToken);

  await handleTradeInternal(context, e, a(event.params.autoTrader), inputToken, outputToken, takerInput, takerOutput, makerInput, makerOutput);
});

/**
 * Mirrors _handleTradeInternal. The POL (Polygon-zkEVM recycling) intermediate-
 * trade path is NOT reachable on Arbitrum (no `pol-` tokens), so it is omitted
 * here and documented in MIGRATION.md.
 */
async function handleTradeInternal(
  context: Ctx,
  e: ReturnType<typeof ev>,
  traderAddress: string,
  inputToken: Token,
  outputToken: Token,
  takerInputBalanceUpdate: BalanceUpdate,
  takerOutputBalanceUpdate: BalanceUpdate,
  makerInputBalanceUpdate: BalanceUpdate | null,
  makerOutputBalanceUpdate: BalanceUpdate | null,
): Promise<void> {
  await getOrCreateTransaction(context, e.hash, e.blockNumber, e.timestamp);
  let dolomiteMargin = await getOrCreateDolomiteMarginForCall(context, e.hash, true);

  const takerInputAccountUpdate = await handleDolomiteMarginBalanceUpdateForAccount(context, takerInputBalanceUpdate, e.hash, e.blockNumber, e.timestamp, e.blockHash);
  const takerOutputAccountUpdate = await handleDolomiteMarginBalanceUpdateForAccount(context, takerOutputBalanceUpdate, e.hash, e.blockNumber, e.timestamp, e.blockHash);

  let makerInputAccountUpdate: MarginAccountWithValueParChange | null = null;
  let makerOutputAccountUpdate: MarginAccountWithValueParChange | null = null;
  if (makerInputBalanceUpdate !== null && makerOutputBalanceUpdate !== null) {
    makerInputAccountUpdate = await handleDolomiteMarginBalanceUpdateForAccount(context, makerInputBalanceUpdate, e.hash, e.blockNumber, e.timestamp, e.blockHash);
    makerOutputAccountUpdate = await handleDolomiteMarginBalanceUpdateForAccount(context, makerOutputBalanceUpdate, e.hash, e.blockNumber, e.timestamp, e.blockHash);
  }

  const inputIndex = await context.InterestIndex.getOrThrow(inputToken.id);
  const outputIndex = await context.InterestIndex.getOrThrow(outputToken.id);

  const takerInputDeltaWei = takerInputBalanceUpdate.deltaWei;
  const takerOutputDeltaWei = takerOutputBalanceUpdate.deltaWei;
  const makerInputDeltaWei = makerInputBalanceUpdate ? makerInputBalanceUpdate.deltaWei : null;
  const makerOutputDeltaWei = makerOutputBalanceUpdate ? makerOutputBalanceUpdate.deltaWei : null;
  const isVirtualTransfer = makerInputAccountUpdate !== null;

  dolomiteMargin = await changeProtocolBalanceApplied(context, await context.Token.getOrThrow(inputToken.id), takerInputDeltaWei, inputIndex, isVirtualTransfer, dolomiteMargin, e.blockNumber, e.blockHash);
  dolomiteMargin = await changeProtocolBalanceApplied(context, await context.Token.getOrThrow(outputToken.id), takerOutputDeltaWei, outputIndex, isVirtualTransfer, dolomiteMargin, e.blockNumber, e.blockHash);
  if (makerInputDeltaWei && makerOutputDeltaWei) {
    dolomiteMargin = await changeProtocolBalanceApplied(context, await context.Token.getOrThrow(inputToken.id), makerInputDeltaWei, inputIndex, isVirtualTransfer, dolomiteMargin, e.blockNumber, e.blockHash);
    dolomiteMargin = await changeProtocolBalanceApplied(context, await context.Token.getOrThrow(outputToken.id), makerOutputDeltaWei, outputIndex, isVirtualTransfer, dolomiteMargin, e.blockNumber, e.blockHash);
  }

  const serialId = dolomiteMargin.actionCount;
  const tradeID = getIDForEvent(e.hash, e.logIndex);

  const takerEff = await getEffectiveUserForAddress(context, takerOutputAccountUpdate.marginAccount.user_id);
  const makerEff = makerOutputAccountUpdate ? await getEffectiveUserForAddress(context, makerOutputAccountUpdate.marginAccount.user_id) : null;

  const takerToken = takerInputDeltaWei.lt(ZERO_BD) ? inputToken : outputToken;
  const makerToken = takerInputDeltaWei.lt(ZERO_BD) ? outputToken : inputToken;
  const takerTokenDeltaWei = takerInputDeltaWei.lt(ZERO_BD) ? absBD(takerInputDeltaWei) : absBD(takerOutputDeltaWei);
  const makerTokenDeltaWei = takerInputDeltaWei.lt(ZERO_BD) ? absBD(takerOutputDeltaWei) : absBD(takerInputDeltaWei);

  const takerPrice = await getTokenOraclePriceUSD(context, takerToken, e.blockNumber, e.blockHash);
  const makerPrice = await getTokenOraclePriceUSD(context, makerToken, e.blockNumber, e.blockHash);
  const amountUSD = truncate(takerTokenDeltaWei.times(takerPrice), USD_PRECISION);
  const makerAmountUSD = truncate(makerTokenDeltaWei.times(makerPrice), USD_PRECISION);

  const takerInputTokenDeltaPar = takerInputAccountUpdate.deltaPar.lt(ZERO_BD) ? takerInputAccountUpdate.deltaPar : takerOutputAccountUpdate.deltaPar;
  const takerOutputTokenDeltaPar = takerOutputAccountUpdate.deltaPar.gt(ZERO_BD) ? takerOutputAccountUpdate.deltaPar : takerInputAccountUpdate.deltaPar;

  let makerInputTokenDeltaPar: BigDecimal | undefined;
  let makerOutputTokenDeltaPar: BigDecimal | undefined;
  if (makerInputAccountUpdate !== null && makerInputAccountUpdate.deltaPar.gt(ZERO_BD)) {
    makerInputTokenDeltaPar = makerInputAccountUpdate.deltaPar;
  } else if (makerOutputAccountUpdate !== null && makerOutputAccountUpdate.deltaPar.gt(ZERO_BD)) {
    makerInputTokenDeltaPar = makerOutputAccountUpdate.deltaPar;
  } else if (makerInputAccountUpdate !== null && makerOutputAccountUpdate !== null) {
    makerInputTokenDeltaPar = ZERO_BD;
  }
  if (makerOutputAccountUpdate !== null && makerOutputAccountUpdate.deltaPar.lt(ZERO_BD)) {
    makerOutputTokenDeltaPar = makerOutputAccountUpdate.deltaPar;
  } else if (makerInputAccountUpdate !== null && makerInputAccountUpdate.deltaPar.lt(ZERO_BD)) {
    makerOutputTokenDeltaPar = makerInputAccountUpdate.deltaPar;
  } else if (makerInputAccountUpdate !== null && makerOutputAccountUpdate !== null) {
    makerOutputTokenDeltaPar = ZERO_BD;
  }

  const walletsConcatenated = makerOutputAccountUpdate
    ? `${takerOutputAccountUpdate.marginAccount.user_id}_${makerOutputAccountUpdate.marginAccount.user_id}`
    : takerOutputAccountUpdate.marginAccount.user_id;
  const effectiveWalletsConcatenated = makerEff ? `${takerEff.id}_${makerEff.id}` : takerEff.id;
  const effectiveUsers = makerEff ? [takerEff.id, makerEff.id] : [takerEff.id];

  const trade = {
    id: tradeID,
    serialId,
    traderAddress,
    transaction_id: a(e.hash),
    timestamp: e.timestamp,
    logIndex: BigInt(e.logIndex),
    takerEffectiveUser_id: takerEff.id,
    takerMarginAccount_id: takerOutputAccountUpdate.marginAccount.id,
    makerEffectiveUser_id: makerEff ? makerEff.id : undefined,
    makerMarginAccount_id: makerOutputAccountUpdate ? makerOutputAccountUpdate.marginAccount.id : undefined,
    walletsConcatenated,
    effectiveWalletsConcatenated,
    effectiveUsers,
    takerToken_id: inputToken.id,
    makerToken_id: outputToken.id,
    takerInterestIndex_id: await getOrCreateInterestIndexSnapshotAndReturnId(context, inputIndex),
    makerInterestIndex_id: await getOrCreateInterestIndexSnapshotAndReturnId(context, outputIndex),
    takerTokenDeltaWei,
    makerTokenDeltaWei,
    takerInputTokenDeltaPar,
    takerOutputTokenDeltaPar,
    makerInputTokenDeltaPar,
    makerOutputTokenDeltaPar,
    amountUSD,
    takerAmountUSD: amountUSD,
    makerAmountUSD,
    liquidationType: traderAddress === EXPIRY_ADDRESS ? TradeLiquidationType.EXPIRATION : undefined,
  };
  context.Trade.set(trade);

  // volume
  const makerTokenEnt = await context.Token.getOrThrow(makerToken.id);
  const takerTokenEnt = await context.Token.getOrThrow(takerToken.id);
  context.DolomiteMargin.set({
    ...dolomiteMargin,
    totalTradeVolumeUSD: dolomiteMargin.totalTradeVolumeUSD.plus(amountUSD),
    tradeCount: dolomiteMargin.tradeCount + ONE_BI,
  });
  context.Token.set({ ...makerTokenEnt, tradeVolume: makerTokenEnt.tradeVolume.plus(makerTokenDeltaWei), tradeVolumeUSD: makerTokenEnt.tradeVolumeUSD.plus(makerAmountUSD) });
  if (takerToken.id !== makerToken.id) {
    const takerFresh = await context.Token.getOrThrow(takerToken.id);
    context.Token.set({ ...takerFresh, tradeVolume: takerFresh.tradeVolume.plus(takerTokenDeltaWei), tradeVolumeUSD: takerFresh.tradeVolumeUSD.plus(amountUSD) });
  }

  await saveMostRecentTrade(context, trade as any);

  // user counts
  if (makerOutputAccountUpdate !== null) {
    const makerUser = await context.User.getOrThrow(makerOutputAccountUpdate.marginAccount.user_id);
    context.User.set({ ...makerUser, totalTradeVolumeUSD: makerUser.totalTradeVolumeUSD.plus(makerAmountUSD), totalTradeCount: makerUser.totalTradeCount + ONE_BI });
    if (makerUser.effectiveUser_id !== makerUser.id) {
      const eff = await context.User.getOrThrow(makerUser.effectiveUser_id);
      context.User.set({ ...eff, totalTradeVolumeUSD: eff.totalTradeVolumeUSD.plus(makerAmountUSD), totalTradeCount: eff.totalTradeCount + ONE_BI });
    }
  }
  const takerUser = await context.User.getOrThrow(takerOutputAccountUpdate.marginAccount.user_id);
  context.User.set({ ...takerUser, totalTradeVolumeUSD: takerUser.totalTradeVolumeUSD.plus(amountUSD), totalTradeCount: takerUser.totalTradeCount + ONE_BI });
  if (takerUser.effectiveUser_id !== takerUser.id) {
    const eff = await context.User.getOrThrow(takerUser.effectiveUser_id);
    context.User.set({ ...eff, totalTradeVolumeUSD: eff.totalTradeVolumeUSD.plus(amountUSD), totalTradeCount: eff.totalTradeCount + ONE_BI });
  }

  // expiration -> liquidate margin position
  if (traderAddress === EXPIRY_ADDRESS && makerOutputAccountUpdate !== null && makerInputDeltaWei !== null && makerOutputDeltaWei !== null) {
    const mp = await getOrCreateMarginPosition(context, e.hash, e.timestamp, makerOutputAccountUpdate.marginAccount);
    const heldToken = mp.heldToken_id === outputToken.id ? outputToken : inputToken;
    const owedToken = mp.owedToken_id === outputToken.id ? outputToken : inputToken;
    const heldPrice = await getTokenOraclePriceUSD(context, heldToken, e.blockNumber, e.blockHash);
    const owedPrice = await getTokenOraclePriceUSD(context, owedToken, e.blockNumber, e.blockHash);
    const expirationTimestamp = mp.expirationTimestamp;
    if (expirationTimestamp !== undefined && expirationTimestamp !== null) {
      let liquidationSpread = await getLiquidationSpreadForPair(context, heldToken, owedToken, dolomiteMargin);
      const expiryAge = e.timestamp - expirationTimestamp;
      const expiryRampTime = dolomiteMargin.expiryRampTime;
      if (expiryAge < expiryRampTime) {
        liquidationSpread = truncate(liquidationSpread.times(new BigDecimal(expiryAge.toString())).div(new BigDecimal(expiryRampTime.toString())), 18);
      }
      const owedPriceAdj = truncate(owedPrice.times(liquidationSpread), 36);
      const makerOutNewParStruct = (makerOutputBalanceUpdate as BalanceUpdate);
      const heldNewPar = mp.heldToken_id === outputToken.id ? makerOutNewParStruct.valuePar : (makerInputBalanceUpdate as BalanceUpdate).valuePar;
      const owedNewPar = mp.owedToken_id === outputToken.id ? makerOutNewParStruct.valuePar : (makerInputBalanceUpdate as BalanceUpdate).valuePar;
      const borrowedTokenAmountDeltaWei = mp.owedToken_id === outputToken.id ? makerOutputDeltaWei : makerInputDeltaWei;
      await handleLiquidateMarginPosition(
        context,
        mp,
        e,
        heldPrice,
        owedPriceAdj,
        heldToken,
        owedToken,
        mp.heldToken_id === outputToken.id ? outputIndex : inputIndex,
        mp.owedToken_id === outputToken.id ? outputIndex : inputIndex,
        heldNewPar,
        owedNewPar,
        absBD(borrowedTokenAmountDeltaWei),
        MarginPositionStatus.Expired,
      );
    }
  }
}

indexer.onEvent({ contract: "MarginCore", event: "LogLiquidate" }, async ({ event, context }) => {
  const e = ev(event);
  const heldToken = await tokenForMarket(context, event.params.heldMarket);
  const owedToken = await tokenForMarket(context, event.params.owedMarket);

  const liquidHeld = event.params.liquidHeldUpdate as Struct;
  const liquidOwed = event.params.liquidOwedUpdate as Struct;
  const solidHeld = event.params.solidHeldUpdate as Struct;
  const solidOwed = event.params.solidOwedUpdate as Struct;

  const bu1 = new BalanceUpdate(event.params.liquidAccountOwner, event.params.liquidAccountNumber, liquidHeld.newPar, liquidHeld.deltaWei, heldToken);
  const liquidHeldAU = await handleDolomiteMarginBalanceUpdateForAccount(context, bu1, e.hash, e.blockNumber, e.timestamp, e.blockHash);
  const bu2 = new BalanceUpdate(event.params.liquidAccountOwner, event.params.liquidAccountNumber, liquidOwed.newPar, liquidOwed.deltaWei, owedToken);
  const liquidOwedAU = await handleDolomiteMarginBalanceUpdateForAccount(context, bu2, e.hash, e.blockNumber, e.timestamp, e.blockHash);
  const bu3 = new BalanceUpdate(event.params.solidAccountOwner, event.params.solidAccountNumber, solidHeld.newPar, solidHeld.deltaWei, heldToken);
  const solidHeldAU = await handleDolomiteMarginBalanceUpdateForAccount(context, bu3, e.hash, e.blockNumber, e.timestamp, e.blockHash);
  const bu4 = new BalanceUpdate(event.params.solidAccountOwner, event.params.solidAccountNumber, solidOwed.newPar, solidOwed.deltaWei, owedToken);
  const solidOwedAU = await handleDolomiteMarginBalanceUpdateForAccount(context, bu4, e.hash, e.blockNumber, e.timestamp, e.blockHash);

  await getOrCreateTransaction(context, e.hash, e.blockNumber, e.timestamp);
  let dolomiteMargin = await getOrCreateDolomiteMarginForCall(context, e.hash, true);

  const liquidationID = getIDForEvent(e.hash, e.logIndex);
  const existing = await context.Liquidation.get(liquidationID);
  const serialId = existing === undefined ? dolomiteMargin.actionCount : existing.serialId;

  const heldIndex = await context.InterestIndex.getOrThrow(heldToken.id);
  const owedIndex = await context.InterestIndex.getOrThrow(owedToken.id);

  const liquidEff = await getEffectiveUserForAddress(context, liquidOwedAU.marginAccount.user_id);
  const solidEff = await getEffectiveUserForAddress(context, solidOwedAU.marginAccount.user_id);

  const heldTokenAmountDeltaWei = convertStructToDecimalAppliedValue(structAbs(solidHeld.deltaWei), heldToken.decimals);
  const borrowedTokenAmountDeltaWei = convertStructToDecimalAppliedValue(structAbs(solidOwed.deltaWei), owedToken.decimals);

  const heldPriceUSD = await getTokenOraclePriceUSD(context, heldToken, e.blockNumber, e.blockHash);
  const owedPriceUSD = await getTokenOraclePriceUSD(context, owedToken, e.blockNumber, e.blockHash);
  const liquidationSpread = await getLiquidationSpreadForPair(context, heldToken, owedToken, dolomiteMargin);
  const owedPriceAdj = truncate(owedPriceUSD.times(liquidationSpread), 36);

  const heldTokenLiquidationRewardWei = roundHalfUp(borrowedTokenAmountDeltaWei.times(owedPriceAdj).div(heldPriceUSD), heldToken.decimals);
  const borrowedTokenAmountUSD = truncate(borrowedTokenAmountDeltaWei.times(owedPriceUSD), USD_PRECISION);
  const heldTokenAmountUSD = truncate(heldTokenAmountDeltaWei.times(heldPriceUSD), USD_PRECISION);
  const heldTokenLiquidationRewardUSD = truncate(heldTokenLiquidationRewardWei.times(heldPriceUSD), USD_PRECISION);

  context.Liquidation.set({
    id: liquidationID,
    serialId,
    transaction_id: a(e.hash),
    logIndex: BigInt(e.logIndex),
    liquidEffectiveUser_id: liquidEff.id,
    liquidMarginAccount_id: liquidOwedAU.marginAccount.id,
    solidEffectiveUser_id: solidEff.id,
    solidMarginAccount_id: solidOwedAU.marginAccount.id,
    effectiveUsers: [liquidEff.id, solidEff.id],
    heldToken_id: heldToken.id,
    borrowedToken_id: owedToken.id,
    heldInterestIndex_id: await getOrCreateInterestIndexSnapshotAndReturnId(context, heldIndex),
    borrowedInterestIndex_id: await getOrCreateInterestIndexSnapshotAndReturnId(context, owedIndex),
    heldTokenAmountDeltaWei,
    borrowedTokenAmountDeltaWei,
    heldTokenLiquidationRewardWei,
    borrowedTokenAmountUSD,
    heldTokenAmountUSD,
    heldTokenLiquidationRewardUSD,
    liquidBorrowedTokenAmountDeltaPar: liquidOwedAU.deltaPar,
    liquidHeldTokenAmountDeltaPar: liquidHeldAU.deltaPar,
    solidBorrowedTokenAmountDeltaPar: solidOwedAU.deltaPar,
    solidHeldTokenAmountDeltaPar: solidHeldAU.deltaPar,
  });

  context.DolomiteMargin.set({
    ...dolomiteMargin,
    liquidationCount: dolomiteMargin.liquidationCount + ONE_BI,
    totalLiquidationVolumeUSD: dolomiteMargin.totalLiquidationVolumeUSD.plus(borrowedTokenAmountUSD),
  });
  dolomiteMargin = await context.DolomiteMargin.getOrThrow(DOLOMITE_MARGIN_ADDRESS);

  dolomiteMargin = await changeProtocolBalance(context, await context.Token.getOrThrow(heldToken.id), solidHeld.deltaWei, heldIndex, true, dolomiteMargin, e.blockNumber, e.blockHash);
  dolomiteMargin = await changeProtocolBalance(context, await context.Token.getOrThrow(owedToken.id), solidOwed.deltaWei, owedIndex, true, dolomiteMargin, e.blockNumber, e.blockHash);
  dolomiteMargin = await changeProtocolBalance(context, await context.Token.getOrThrow(heldToken.id), liquidHeld.deltaWei, heldIndex, true, dolomiteMargin, e.blockNumber, e.blockHash);
  dolomiteMargin = await changeProtocolBalance(context, await context.Token.getOrThrow(owedToken.id), liquidOwed.deltaWei, owedIndex, true, dolomiteMargin, e.blockNumber, e.blockHash);

  if (canBeMarginPosition(liquidOwedAU.marginAccount)) {
    const mp = await getOrCreateMarginPosition(context, e.hash, e.timestamp, liquidOwedAU.marginAccount);
    await handleLiquidateMarginPosition(
      context, mp, e, heldPriceUSD, owedPriceAdj, heldToken, owedToken, heldIndex, owedIndex,
      convertStructToDecimalAppliedValue(liquidHeld.newPar, heldToken.decimals),
      convertStructToDecimalAppliedValue(liquidOwed.newPar, owedToken.decimals),
      borrowedTokenAmountDeltaWei,
      MarginPositionStatus.Liquidated,
    );
  }

  const liquidUser = await context.User.getOrThrow(liquidOwedAU.marginAccount.user_id);
  context.User.set({ ...liquidUser, totalCollateralLiquidatedUSD: liquidUser.totalCollateralLiquidatedUSD.plus(heldTokenAmountUSD), totalLiquidationCount: liquidUser.totalLiquidationCount + ONE_BI });
  if (liquidUser.effectiveUser_id !== liquidUser.id) {
    const eff = await context.User.getOrThrow(liquidUser.effectiveUser_id);
    context.User.set({ ...eff, totalCollateralLiquidatedUSD: eff.totalCollateralLiquidatedUSD.plus(heldTokenAmountUSD), totalLiquidationCount: eff.totalLiquidationCount + ONE_BI });
  }
});

indexer.onEvent({ contract: "MarginCore", event: "LogVaporize" }, async ({ event, context }) => {
  const e = ev(event);
  const heldToken = await tokenForMarket(context, event.params.heldMarket);
  const owedToken = await tokenForMarket(context, event.params.owedMarket);

  const vaporOwed = event.params.vaporOwedUpdate as Struct;
  const solidHeld = event.params.solidHeldUpdate as Struct;
  const solidOwed = event.params.solidOwedUpdate as Struct;

  const bu1 = new BalanceUpdate(event.params.vaporAccountOwner, event.params.vaporAccountNumber, vaporOwed.newPar, vaporOwed.deltaWei, owedToken);
  const vaporOwedAU = await handleDolomiteMarginBalanceUpdateForAccount(context, bu1, e.hash, e.blockNumber, e.timestamp, e.blockHash);
  const bu2 = new BalanceUpdate(event.params.solidAccountOwner, event.params.solidAccountNumber, solidHeld.newPar, solidHeld.deltaWei, heldToken);
  const solidHeldAU = await handleDolomiteMarginBalanceUpdateForAccount(context, bu2, e.hash, e.blockNumber, e.timestamp, e.blockHash);
  const bu3 = new BalanceUpdate(event.params.solidAccountOwner, event.params.solidAccountNumber, solidOwed.newPar, solidOwed.deltaWei, owedToken);
  const solidOwedAU = await handleDolomiteMarginBalanceUpdateForAccount(context, bu3, e.hash, e.blockNumber, e.timestamp, e.blockHash);

  await getOrCreateTransaction(context, e.hash, e.blockNumber, e.timestamp);
  let dolomiteMargin = await getOrCreateDolomiteMarginForCall(context, e.hash, true);

  const vaporizationID = getIDForEvent(e.hash, e.logIndex);
  const existing = await context.Vaporization.get(vaporizationID);
  const serialId = existing === undefined ? dolomiteMargin.actionCount : existing.serialId;

  const heldIndex = await context.InterestIndex.getOrThrow(heldToken.id);
  const owedIndex = await context.InterestIndex.getOrThrow(owedToken.id);
  const vaporEff = await getEffectiveUserForAddress(context, vaporOwedAU.marginAccount.user_id);
  const solidEff = await getEffectiveUserForAddress(context, solidOwedAU.marginAccount.user_id);

  const borrowedTokenAmountDeltaWei = convertStructToDecimalAppliedValue(structAbs(solidOwed.deltaWei), owedToken.decimals);
  const heldTokenAmountDeltaWei = convertStructToDecimalAppliedValue(structAbs(solidHeld.deltaWei), heldToken.decimals);
  const owedPriceUSD = await getTokenOraclePriceUSD(context, owedToken, e.blockNumber, e.blockHash);
  const vaporOwedDeltaWeiBD = convertStructToDecimalAppliedValue(vaporOwed.deltaWei, owedToken.decimals);
  const amountUSDVaporized = truncate(vaporOwedDeltaWeiBD.times(owedPriceUSD), USD_PRECISION);

  context.Vaporization.set({
    id: vaporizationID,
    serialId,
    transaction_id: a(e.hash),
    logIndex: BigInt(e.logIndex),
    vaporEffectiveUser_id: vaporEff.id,
    vaporMarginAccount_id: vaporOwedAU.marginAccount.id,
    solidEffectiveUser_id: solidEff.id,
    solidMarginAccount_id: solidOwedAU.marginAccount.id,
    effectiveUsers: [vaporEff.id, solidEff.id],
    heldToken_id: heldToken.id,
    borrowedToken_id: owedToken.id,
    heldInterestIndex_id: await getOrCreateInterestIndexSnapshotAndReturnId(context, heldIndex),
    borrowedInterestIndex_id: await getOrCreateInterestIndexSnapshotAndReturnId(context, owedIndex),
    borrowedTokenAmountDeltaWei,
    heldTokenAmountDeltaWei,
    vaporBorrowedTokenAmountDeltaPar: vaporOwedAU.deltaPar,
    solidHeldTokenAmountDeltaPar: solidHeldAU.deltaPar,
    solidBorrowedTokenAmountDeltaPar: solidOwedAU.deltaPar,
    amountUSDVaporized,
  });

  context.DolomiteMargin.set({
    ...dolomiteMargin,
    vaporizationCount: dolomiteMargin.vaporizationCount + ONE_BI,
    totalVaporizationVolumeUSD: dolomiteMargin.totalVaporizationVolumeUSD.plus(amountUSDVaporized),
  });
  dolomiteMargin = await context.DolomiteMargin.getOrThrow(DOLOMITE_MARGIN_ADDRESS);

  dolomiteMargin = await changeProtocolBalance(context, await context.Token.getOrThrow(heldToken.id), solidHeld.deltaWei, heldIndex, true, dolomiteMargin, e.blockNumber, e.blockHash);
  dolomiteMargin = await changeProtocolBalance(context, await context.Token.getOrThrow(owedToken.id), solidOwed.deltaWei, owedIndex, true, dolomiteMargin, e.blockNumber, e.blockHash);
  dolomiteMargin = await changeProtocolBalance(context, await context.Token.getOrThrow(owedToken.id), vaporOwed.deltaWei, owedIndex, true, dolomiteMargin, e.blockNumber, e.blockHash);

  if (canBeMarginPosition(vaporOwedAU.marginAccount)) {
    const mp = await getOrCreateMarginPosition(context, e.hash, e.timestamp, vaporOwedAU.marginAccount);
    if (mp.status === MarginPositionStatus.Liquidated) {
      context.MarginPosition.set({ ...mp, owedAmountPar: convertStructToDecimalAppliedValue(vaporOwed.newPar, owedToken.decimals) });
    }
  }
});

indexer.onEvent({ contract: "MarginCore", event: "LogCall" }, async ({ event, context }) => {
  await getOrCreateDolomiteMarginForCall(context, event.transaction.hash, true);
});

async function handleLiquidateMarginPosition(
  context: Ctx,
  marginPosition: MarginPosition,
  e: ReturnType<typeof ev>,
  heldPrice: BigDecimal,
  owedPriceAdj: BigDecimal,
  heldToken: Token,
  owedToken: Token,
  heldIndex: InterestIndex,
  owedIndex: InterestIndex,
  heldNewPar: BigDecimal,
  owedNewPar: BigDecimal,
  borrowedTokenAmountDeltaWei: BigDecimal,
  status: string,
): Promise<void> {
  if (
    !(
      marginPosition.isInitialized &&
      (marginPosition.status === MarginPositionStatus.Open ||
        marginPosition.status === MarginPositionStatus.Liquidated ||
        marginPosition.status === MarginPositionStatus.Expired)
    )
  ) {
    return;
  }

  let mp = { ...marginPosition, status };
  if (mp.closeTimestamp === undefined || mp.closeTimestamp === null) {
    mp.closeTimestamp = e.timestamp;
    mp.closeTransaction_id = a(e.hash);
  }

  const heldTokenLiquidationRewardWei = roundHalfUp(borrowedTokenAmountDeltaWei.times(owedPriceAdj).div(heldPrice), heldToken.decimals);
  const heldTokenLiquidationRewardUSD = truncate(heldTokenLiquidationRewardWei.times(heldPrice), USD_PRECISION);

  mp.heldAmountPar = heldNewPar;
  mp.owedAmountPar = owedNewPar;

  if ((mp.closeHeldAmountUSD === undefined || mp.closeHeldAmountUSD === null) && (mp.closeOwedAmountUSD === undefined || mp.closeOwedAmountUSD === null)) {
    const heldPriceUSD = await getTokenOraclePriceUSD(context, heldToken, e.blockNumber, e.blockHash);
    const owedPriceUSD = await getTokenOraclePriceUSD(context, owedToken, e.blockNumber, e.blockHash);
    const closeHeldAmountWei = parToWei(mp.initialHeldAmountPar, heldIndex, heldToken.decimals);
    const closeOwedAmountWei = parToWei(mp.initialOwedAmountPar.negated(), owedIndex, owedToken.decimals).negated();

    mp.closeHeldPrice = truncate(heldPriceUSD.div(owedPriceUSD), USD_PRECISION);
    mp.closeHeldPriceUSD = truncate(heldPriceUSD, USD_PRECISION);
    mp.closeHeldAmountWei = closeHeldAmountWei;
    mp.closeHeldAmountUSD = truncate(closeHeldAmountWei.times(heldPriceUSD), USD_PRECISION);

    if (mp.closeHeldAmountSeized !== undefined && mp.closeHeldAmountSeized !== null && mp.closeHeldAmountSeizedUSD !== undefined && mp.closeHeldAmountSeizedUSD !== null) {
      mp.closeHeldAmountSeized = mp.closeHeldAmountSeized.plus(heldTokenLiquidationRewardWei);
      mp.closeHeldAmountSeizedUSD = mp.closeHeldAmountSeizedUSD.plus(heldTokenLiquidationRewardUSD);
    } else {
      mp.closeHeldAmountSeized = heldTokenLiquidationRewardWei;
      mp.closeHeldAmountSeizedUSD = heldTokenLiquidationRewardUSD;
    }

    mp.closeOwedPrice = truncate(owedPriceUSD.div(heldPriceUSD), USD_PRECISION);
    mp.closeOwedPriceUSD = truncate(owedPriceUSD, USD_PRECISION);
    mp.closeOwedAmountWei = closeOwedAmountWei;
    mp.closeOwedAmountUSD = truncate(closeOwedAmountWei.times(owedPriceUSD), USD_PRECISION);
  }

  context.MarginPosition.set(mp);
}

export { updateBorrowPositionForBalanceUpdate };
