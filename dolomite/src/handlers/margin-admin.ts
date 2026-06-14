import { BigDecimal, indexer } from "envio";
import {
  ADDRESS_ZERO,
  DOLOMITE_MARGIN_ADDRESS,
  EXPIRY_ADDRESS,
  INTEREST_PRECISION,
  ONE_BD,
  ONE_ETH_BD,
  ZERO_BD,
  ZERO_BI,
  _18_BI,
  a,
} from "../constants.js";
import { convertTokenToDecimal, truncate } from "../helpers/math.js";
import { getOrCreateDolomiteMarginForCall, createUserIfNecessary, getEffectiveUserForAddress } from "../helpers/entities.js";
import { updateInterestRate } from "../helpers/protocol-balance.js";
import { initializeToken } from "../helpers/token.js";
import { getNumMarkets, gExpiryRampTime, getMarketPrice, getMarginRatio, getLiquidationSpread, getEarningsRate, getMinBorrowedValue, getAccountMaxNumberOfMarketsWithBalances } from "../effects/contracts.js";

// ---------------------------------------------------------------------------
// Market added: create Token, InterestIndex, InterestRate, MarketRiskInfo,
// OraclePrice, TotalPar. Also lazily initialise DolomiteMargin risk params.
// ---------------------------------------------------------------------------
indexer.onEvent({ contract: "MarginAdmin", event: "LogAddMarket" }, async ({ event, context }) => {
  const blockNumber = BigInt(event.block.number);
  const block = Number(event.block.number);

  let dolomiteMargin = await getOrCreateDolomiteMarginForCall(context, event.transaction.hash, false);

  // Lazily populate risk params on first admin interaction (mirrors
  // getOrCreateDolomiteMarginForCall ProtocolType.Admin branch).
  if (dolomiteMargin.liquidationRatio.eq(ZERO_BD) && dolomiteMargin.numberOfMarkets === 0) {
    const ratio = await getMarginRatio(context.effect, DOLOMITE_MARGIN_ADDRESS, block);
    const spread = await getLiquidationSpread(context.effect, DOLOMITE_MARGIN_ADDRESS, block);
    const earnings = await getEarningsRate(context.effect, DOLOMITE_MARGIN_ADDRESS, block);
    const minBorrow = await getMinBorrowedValue(context.effect, DOLOMITE_MARGIN_ADDRESS, block);
    const maxMarkets = await getAccountMaxNumberOfMarketsWithBalances(context.effect, DOLOMITE_MARGIN_ADDRESS, block);
    const rampTime = await gExpiryRampTime(context.effect, EXPIRY_ADDRESS, block);
    dolomiteMargin = {
      ...dolomiteMargin,
      liquidationRatio: ratio === null ? ZERO_BD : new BigDecimal(ratio.value.toString()).div(ONE_ETH_BD).plus(ONE_BD),
      liquidationReward: spread === null ? ZERO_BD : new BigDecimal(spread.value.toString()).div(ONE_ETH_BD).plus(ONE_BD),
      earningsRate: earnings === null ? ZERO_BD : new BigDecimal(earnings.value.toString()).div(ONE_ETH_BD),
      minBorrowedValue:
        minBorrow === null ? ZERO_BD : new BigDecimal(minBorrow.value.toString()).div(ONE_ETH_BD).div(ONE_ETH_BD),
      accountMaxNumberOfMarketsWithBalances: maxMarkets === null ? ZERO_BI : maxMarkets,
      expiryRampTime: rampTime === null ? ZERO_BI : rampTime,
    };
  }

  const numMarkets = await getNumMarkets(context.effect, DOLOMITE_MARGIN_ADDRESS, block);
  dolomiteMargin = { ...dolomiteMargin, numberOfMarkets: numMarkets === null ? dolomiteMargin.numberOfMarkets : Number(numMarkets) };
  context.DolomiteMargin.set(dolomiteMargin);

  const tokenId = a(event.params.token);
  let token = await context.Token.get(tokenId);
  if (token === undefined) {
    token = await initializeToken(context, tokenId, event.params.marketId);
  }

  context.InterestIndex.set({
    id: token.id,
    token_id: token.id,
    borrowIndex: new BigDecimal("1.0"),
    supplyIndex: new BigDecimal("1.0"),
    lastUpdate: event.block.timestamp !== undefined ? BigInt(event.block.timestamp) : ZERO_BI,
  });

  context.InterestRate.set({
    id: token.id,
    token_id: token.id,
    borrowInterestRate: ZERO_BD,
    supplyInterestRate: ZERO_BD,
    interestSetter: ADDRESS_ZERO,
    optimalUtilizationRate: ZERO_BI,
    lowerOptimalRate: ZERO_BI,
    upperOptimalRate: ZERO_BI,
  });

  context.MarketRiskInfo.set({
    id: token.id,
    token_id: token.id,
    liquidationRewardPremium: ZERO_BD,
    marginPremium: ZERO_BD,
    isBorrowingDisabled: false,
    oracle: "0x",
    supplyMaxWei: ZERO_BD,
    borrowMaxWei: undefined,
    earningsRateOverride: undefined,
  });

  const priceCall = await getMarketPrice(context.effect, DOLOMITE_MARGIN_ADDRESS, event.params.marketId, block);
  context.OraclePrice.set({
    id: token.id,
    token_id: token.id,
    price: priceCall === null ? ZERO_BD : convertTokenToDecimal(priceCall.value, 36n - token.decimals),
    blockNumber,
    blockHash: a(event.block.hash ?? "0x"),
  });

  context.TotalPar.set({ id: token.id, token_id: token.id, borrowPar: ZERO_BD, supplyPar: ZERO_BD });
});

indexer.onEvent({ contract: "MarginAdmin", event: "LogRemoveMarket" }, async ({ event, context }) => {
  let dolomiteMargin = await getOrCreateDolomiteMarginForCall(context, event.transaction.hash, false);
  context.DolomiteMargin.set({ ...dolomiteMargin, numberOfMarkets: dolomiteMargin.numberOfMarkets + 1 });

  const lookup = await context.TokenMarketIdReverseLookup.get(event.params.marketId.toString());
  if (lookup !== undefined) {
    const id = lookup.token_id;
    context.TokenMarketIdReverseLookup.deleteUnsafe(event.params.marketId.toString());
    context.InterestIndex.deleteUnsafe(id);
    context.InterestRate.deleteUnsafe(id);
    context.MarketRiskInfo.deleteUnsafe(id);
    context.OraclePrice.deleteUnsafe(id);
    context.TotalPar.deleteUnsafe(id);
  }
});

async function tokenForMarket(context: any, marketId: bigint) {
  const lookup = await context.TokenMarketIdReverseLookup.getOrThrow(marketId.toString());
  return context.Token.getOrThrow(lookup.token_id);
}

indexer.onEvent({ contract: "MarginAdmin", event: "LogSetIsClosing" }, async ({ event, context }) => {
  const token = await tokenForMarket(context, event.params.marketId);
  const info = await context.MarketRiskInfo.getOrThrow(token.id);
  context.MarketRiskInfo.set({ ...info, isBorrowingDisabled: event.params.isClosing });
});

indexer.onEvent({ contract: "MarginAdmin", event: "LogSetPriceOracle" }, async ({ event, context }) => {
  const token = await tokenForMarket(context, event.params.marketId);
  const info = await context.MarketRiskInfo.getOrThrow(token.id);
  context.MarketRiskInfo.set({ ...info, oracle: a(event.params.priceOracle) });
});

indexer.onEvent({ contract: "MarginAdmin", event: "LogSetInterestSetter" }, async ({ event, context }) => {
  const token = await tokenForMarket(context, event.params.marketId);
  const interestRate = await context.InterestRate.getOrThrow(token.id);
  // NOTE: optimal/lower/upper rate fetch was via interest-setter eth_calls per
  // setter type. Deferred (see MIGRATION.md); store interestSetter address and
  // leave the optimal rates at their prior values so build/test stay offline.
  context.InterestRate.set({ ...interestRate, interestSetter: a(event.params.interestSetter) });
  const totalPar = await context.TotalPar.getOrThrow(token.id);
  const index = await context.InterestIndex.getOrThrow(token.id);
  const dolomiteMargin = await context.DolomiteMargin.getOrThrow(DOLOMITE_MARGIN_ADDRESS);
  await updateInterestRate(context, token, totalPar, index, dolomiteMargin);
});

indexer.onEvent({ contract: "MarginAdmin", event: "LogSetMarginPremium" }, async ({ event, context }) => {
  const token = await tokenForMarket(context, event.params.marketId);
  const info = await context.MarketRiskInfo.getOrThrow(token.id);
  context.MarketRiskInfo.set({
    ...info,
    marginPremium: new BigDecimal(event.params.marginPremium.value.toString()).div(ONE_ETH_BD),
  });
});

indexer.onEvent({ contract: "MarginAdmin", event: "LogSetSpreadPremium" }, async ({ event, context }) => {
  const token = await tokenForMarket(context, event.params.marketId);
  const info = await context.MarketRiskInfo.getOrThrow(token.id);
  context.MarketRiskInfo.set({
    ...info,
    liquidationRewardPremium: new BigDecimal(event.params.spreadPremium.value.toString()).div(ONE_ETH_BD),
  });
});

indexer.onEvent({ contract: "MarginAdmin", event: "LogSetLiquidationSpreadPremium" }, async ({ event, context }) => {
  const token = await tokenForMarket(context, event.params.marketId);
  const info = await context.MarketRiskInfo.getOrThrow(token.id);
  context.MarketRiskInfo.set({
    ...info,
    liquidationRewardPremium: new BigDecimal(event.params.liquidationSpreadPremium.value.toString()).div(ONE_ETH_BD),
  });
});

indexer.onEvent({ contract: "MarginAdmin", event: "LogSetMaxWei" }, async ({ event, context }) => {
  const token = await tokenForMarket(context, event.params.marketId);
  const info = await context.MarketRiskInfo.getOrThrow(token.id);
  const value = event.params.maxWei.value;
  context.MarketRiskInfo.set({
    ...info,
    supplyMaxWei: value === ZERO_BI ? undefined : convertTokenToDecimal(value, token.decimals),
  });
});

indexer.onEvent({ contract: "MarginAdmin", event: "LogSetMaxSupplyWei" }, async ({ event, context }) => {
  const token = await tokenForMarket(context, event.params.marketId);
  const info = await context.MarketRiskInfo.getOrThrow(token.id);
  const value = event.params.maxSupplyWei.value;
  context.MarketRiskInfo.set({
    ...info,
    supplyMaxWei: value === ZERO_BI ? undefined : convertTokenToDecimal(value, token.decimals),
  });
});

indexer.onEvent({ contract: "MarginAdmin", event: "LogSetMaxBorrowWei" }, async ({ event, context }) => {
  const token = await tokenForMarket(context, event.params.marketId);
  const info = await context.MarketRiskInfo.getOrThrow(token.id);
  const value = event.params.maxBorrowWei.value;
  context.MarketRiskInfo.set({
    ...info,
    borrowMaxWei: value === ZERO_BI ? undefined : convertTokenToDecimal(value, token.decimals),
  });
});

indexer.onEvent({ contract: "MarginAdmin", event: "LogSetEarningsRateOverride" }, async ({ event, context }) => {
  const token = await tokenForMarket(context, event.params.marketId);
  const info = await context.MarketRiskInfo.getOrThrow(token.id);
  const value = event.params.earningsRateOverride.value;
  context.MarketRiskInfo.set({
    ...info,
    earningsRateOverride: value === ZERO_BI ? undefined : convertTokenToDecimal(value, _18_BI),
  });
});

indexer.onEvent({ contract: "MarginAdmin", event: "LogSetMarginRatio" }, async ({ event, context }) => {
  const dm = await getOrCreateDolomiteMarginForCall(context, event.transaction.hash, false);
  context.DolomiteMargin.set({
    ...dm,
    liquidationRatio: new BigDecimal(event.params.marginRatio.value.toString()).div(ONE_ETH_BD).plus(ONE_BD),
  });
});

indexer.onEvent({ contract: "MarginAdmin", event: "LogSetLiquidationSpread" }, async ({ event, context }) => {
  const dm = await getOrCreateDolomiteMarginForCall(context, event.transaction.hash, false);
  context.DolomiteMargin.set({
    ...dm,
    liquidationReward: new BigDecimal(event.params.liquidationSpread.value.toString()).div(ONE_ETH_BD).plus(ONE_BD),
  });
});

indexer.onEvent({ contract: "MarginAdmin", event: "LogSetEarningsRate" }, async ({ event, context }) => {
  let dm = await getOrCreateDolomiteMarginForCall(context, event.transaction.hash, false);
  let adj = ONE_BD;
  if (dm.earningsRate.gt(ZERO_BD)) adj = dm.earningsRate;
  const earningsRate = new BigDecimal(event.params.earningsRate.value.toString()).div(ONE_ETH_BD);
  dm = { ...dm, earningsRate };
  context.DolomiteMargin.set(dm);

  for (let i = 0; i < dm.numberOfMarkets; i++) {
    const map = await context.TokenMarketIdReverseLookup.get(i.toString());
    if (map !== undefined) {
      const ir = await context.InterestRate.getOrThrow(map.token_id);
      const supplyInterestRate = truncate(
        truncate(ir.supplyInterestRate.div(adj), INTEREST_PRECISION).times(earningsRate),
        INTEREST_PRECISION,
      );
      context.InterestRate.set({ ...ir, supplyInterestRate });
    }
  }
});

indexer.onEvent({ contract: "MarginAdmin", event: "LogSetMinBorrowedValue" }, async ({ event, context }) => {
  const dm = await getOrCreateDolomiteMarginForCall(context, event.transaction.hash, false);
  context.DolomiteMargin.set({
    ...dm,
    minBorrowedValue: new BigDecimal(event.params.minBorrowedValue.value.toString()).div(ONE_ETH_BD).div(ONE_ETH_BD),
  });
});

indexer.onEvent(
  { contract: "MarginAdmin", event: "LogSetAccountMaxNumberOfMarketsWithBalances" },
  async ({ event, context }) => {
    const dm = await getOrCreateDolomiteMarginForCall(context, event.transaction.hash, false);
    context.DolomiteMargin.set({
      ...dm,
      accountMaxNumberOfMarketsWithBalances: event.params.accountMaxNumberOfMarketsWithBalances,
    });
  },
);

indexer.onEvent({ contract: "MarginAdmin", event: "LogSetOracleSentinel" }, async ({ event, context }) => {
  const dm = await getOrCreateDolomiteMarginForCall(context, event.transaction.hash, false);
  context.DolomiteMargin.set({ ...dm, oracleSentinel: a(event.params.oracleSentinel) });
});

indexer.onEvent({ contract: "MarginAdmin", event: "LogSetCallbackGasLimit" }, async ({ event, context }) => {
  const dm = await getOrCreateDolomiteMarginForCall(context, event.transaction.hash, false);
  context.DolomiteMargin.set({ ...dm, callbackGasLimit: event.params.callbackGasLimit });
});

indexer.onEvent(
  { contract: "MarginAdmin", event: "LogSetDefaultAccountRiskOverrideSetter" },
  async ({ event, context }) => {
    const dm = await getOrCreateDolomiteMarginForCall(context, event.transaction.hash, false);
    const setter = a(event.params.defaultAccountRiskOverrideSetter);
    context.DolomiteMargin.set({ ...dm, defaultAccountRiskOverrideSetter: setter === ADDRESS_ZERO ? undefined : setter });
  },
);

indexer.onEvent({ contract: "MarginAdmin", event: "LogSetAccountRiskOverrideSetter" }, async ({ event, context }) => {
  await createUserIfNecessary(context, event.params.accountOwner);
  const user = await getEffectiveUserForAddress(context, event.params.accountOwner);
  const setter = a(event.params.accountRiskOverrideSetter);
  context.User.set({ ...user, accountRiskOverrideSetter: setter === ADDRESS_ZERO ? undefined : setter });
});

indexer.onEvent({ contract: "MarginAdmin", event: "LogSetGlobalOperator" }, async ({ event, context }) => {
  const op = a(event.params.operator);
  if (!event.params.approved) {
    context.GlobalOperator.deleteUnsafe(op);
  } else {
    const existing = await context.GlobalOperator.get(op);
    if (existing === undefined) context.GlobalOperator.set({ id: op });
  }
});

indexer.onEvent({ contract: "MarginAdmin", event: "LogSetAutoTraderIsSpecial" }, async ({ event, context }) => {
  const trader = a(event.params.autoTrader);
  if (!event.params.isSpecial) {
    context.SpecialAutoTrader.deleteUnsafe(trader);
  } else {
    const existing = await context.SpecialAutoTrader.get(trader);
    if (existing === undefined) context.SpecialAutoTrader.set({ id: trader });
    if (trader === EXPIRY_ADDRESS) {
      const dm = await getOrCreateDolomiteMarginForCall(context, event.transaction.hash, false);
      const ramp = await gExpiryRampTime(context.effect, EXPIRY_ADDRESS, Number(event.block.number));
      if (ramp !== null) context.DolomiteMargin.set({ ...dm, expiryRampTime: ramp });
    }
  }
});
