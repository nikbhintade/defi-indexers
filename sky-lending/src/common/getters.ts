/**
 * Port of src/common/getters.ts. All store reads/writes go through the
 * HyperIndex `context`; AssemblyScript `X.load(id)` -> `await ctx.X.get(id)`,
 * `new X(id) ... .save()` -> `ctx.X.set({...})`.
 */
import type { Ctx, EventInfo, Mutable } from "./types";
import type {
  Token,
  Market,
  LendingProtocol,
  _Ilk,
  InterestRate,
  Liquidate,
  _Chi,
  Account,
  Position,
  _PositionCounter,
  _Urn,
  _Proxy,
  UsageMetricsHourlySnapshot,
  UsageMetricsDailySnapshot,
  MarketHourlySnapshot,
  MarketDailySnapshot,
  FinancialsDailySnapshot,
} from "envio";
import {
  BIGDECIMAL_ZERO,
  BIGDECIMAL_ONE,
  BIGINT_ZERO,
  BIGINT_ONE_RAY,
  INT_ZERO,
  PositionSide,
  ProtocolType,
  LendingType,
  Network,
  PROTOCOL_NAME,
  PROTOCOL_SLUG,
  VAT_ADDRESS,
  DAI_ADDRESS,
  ZERO_ADDRESS,
  SECONDS_PER_HOUR,
  SECONDS_PER_DAY,
  SCHEMA_VERSION,
  SUBGRAPH_VERSION,
  METHODOLOGY_VERSION,
} from "./constants";
import { bytes32ToString } from "../utils/bytes";

export async function getOrCreateToken(
  ctx: Ctx,
  tokenId: string,
  name = "unknown",
  symbol = "unknown",
  decimals = 18,
): Promise<Token> {
  let token = await ctx.Token.get(tokenId);
  if (token == null) {
    token = {
      id: tokenId,
      name,
      symbol,
      decimals,
      lastPriceUSD: undefined,
      lastPriceBlockNumber: undefined,
    };
    ctx.Token.set(token);
  }
  return token;
}

export async function getOrCreateLendingProtocol(ctx: Ctx): Promise<LendingProtocol> {
  let protocol = await ctx.LendingProtocol.get(VAT_ADDRESS);
  if (protocol == null) {
    protocol = {
      id: VAT_ADDRESS,
      name: PROTOCOL_NAME,
      slug: PROTOCOL_SLUG,
      schemaVersion: SCHEMA_VERSION,
      subgraphVersion: SUBGRAPH_VERSION,
      methodologyVersion: METHODOLOGY_VERSION,
      network: Network.MAINNET,
      type: ProtocolType.LENDING,
      lendingType: LendingType.CDP,
      riskType: undefined,
      mintedTokens: [DAI_ADDRESS],
      cumulativeUniqueUsers: 0,
      cumulativeUniqueTxSigners: 0,
      cumulativeUniqueDepositors: 0,
      cumulativeUniqueBorrowers: 0,
      cumulativeUniqueLiquidators: 0,
      cumulativeUniqueLiquidatees: 0,
      totalValueLockedUSD: BIGDECIMAL_ZERO,
      protocolControlledValueUSD: undefined,
      cumulativeSupplySideRevenueUSD: BIGDECIMAL_ZERO,
      cumulativeProtocolSideRevenueUSD: BIGDECIMAL_ZERO,
      _cumulativeProtocolSideStabilityFeeRevenue: BIGDECIMAL_ZERO,
      _cumulativeProtocolSideLiquidationRevenue: BIGDECIMAL_ZERO,
      _cumulativeProtocolSidePSMRevenue: BIGDECIMAL_ZERO,
      cumulativeTotalRevenueUSD: BIGDECIMAL_ZERO,
      totalDepositBalanceUSD: BIGDECIMAL_ZERO,
      cumulativeDepositUSD: BIGDECIMAL_ZERO,
      totalBorrowBalanceUSD: BIGDECIMAL_ZERO,
      cumulativeBorrowUSD: BIGDECIMAL_ZERO,
      cumulativeLiquidateUSD: BIGDECIMAL_ZERO,
      mintedTokenSupplies: undefined,
      totalPoolCount: 0,
      openPositionCount: 0,
      cumulativePositionCount: 0,
      marketIDList: [],
      _par: BIGINT_ONE_RAY,
    };
    ctx.LendingProtocol.set(protocol);
  }
  return protocol;
}

export async function getOrCreateMarket(
  ctx: Ctx,
  marketID: string,
  name = "unknown",
  inputToken: string = ZERO_ADDRESS,
  blockNumber: bigint = BIGINT_ZERO,
  timeStamp: bigint = BIGINT_ZERO,
): Promise<Market> {
  let market = await ctx.Market.get(marketID);
  if (market == null) {
    const protocol = await getOrCreateLendingProtocol(ctx);
    market = {
      id: marketID,
      protocol_id: protocol.id,
      name,
      inputToken_id: inputToken,
      createdTimestamp: timeStamp,
      createdBlockNumber: blockNumber,
      totalValueLockedUSD: BIGDECIMAL_ZERO,
      inputTokenBalance: BIGINT_ZERO,
      inputTokenPriceUSD: BIGDECIMAL_ZERO,
      outputToken_id: undefined,
      outputTokenSupply: BIGINT_ZERO,
      outputTokenPriceUSD: BIGDECIMAL_ZERO,
      totalBorrowBalanceUSD: BIGDECIMAL_ZERO,
      cumulativeBorrowUSD: BIGDECIMAL_ZERO,
      totalDepositBalanceUSD: BIGDECIMAL_ZERO,
      cumulativeDepositUSD: BIGDECIMAL_ZERO,
      cumulativeLiquidateUSD: BIGDECIMAL_ZERO,
      cumulativeSupplySideRevenueUSD: BIGDECIMAL_ZERO,
      cumulativeProtocolSideRevenueUSD: BIGDECIMAL_ZERO,
      cumulativeTotalRevenueUSD: BIGDECIMAL_ZERO,
      isActive: true,
      canUseAsCollateral: true,
      canBorrowFrom: true,
      maximumLTV: BIGDECIMAL_ZERO,
      liquidationThreshold: BIGDECIMAL_ZERO,
      liquidationPenalty: BIGDECIMAL_ZERO,
      rates: [BIGDECIMAL_ZERO.toString()],
      _mat: BIGINT_ONE_RAY,
      positionCount: INT_ZERO,
      openPositionCount: INT_ZERO,
      closedPositionCount: INT_ZERO,
      borrowingPositionCount: INT_ZERO,
      lendingPositionCount: INT_ZERO,
      rewardTokens: undefined,
      exchangeRate: undefined,
      rewardTokenEmissionsAmount: undefined,
      rewardTokenEmissionsUSD: undefined,
    };
    ctx.Market.set(market);

    const marketIDList = [...protocol.marketIDList, marketID];
    ctx.LendingProtocol.set({ ...protocol, marketIDList });
  }
  return market;
}

export async function getOrCreateIlk(
  ctx: Ctx,
  ilk: string,
  marketID: string = ZERO_ADDRESS,
): Promise<_Ilk | undefined> {
  let _ilk = await ctx._Ilk.get(ilk.toLowerCase());
  if (_ilk == null && marketID !== ZERO_ADDRESS) {
    _ilk = { id: ilk.toLowerCase(), marketAddress: marketID };
    ctx._Ilk.set(_ilk);
  }
  return _ilk;
}

export async function getOrCreateInterestRate(
  ctx: Ctx,
  marketAddress: string,
  side: string,
  type: string,
): Promise<InterestRate> {
  const interestRateID = side + "-" + type + "-" + marketAddress;
  let interestRate = await ctx.InterestRate.get(interestRateID);
  if (interestRate) return interestRate;
  interestRate = {
    id: interestRateID,
    side: side as InterestRate["side"],
    type: type as InterestRate["type"],
    rate: BIGDECIMAL_ONE,
    duration: undefined,
    maturityBlock: undefined,
  };
  ctx.InterestRate.set(interestRate);
  return interestRate;
}

export async function getOrCreateLiquidate(
  ctx: Ctx,
  liquidateID: string,
  event: EventInfo,
  market: Market,
  liquidatee: string,
  liquidator: string,
  amount: bigint,
  amountUSD: import("envio").BigDecimal,
  profitUSD: import("envio").BigDecimal,
): Promise<Liquidate> {
  let liquidate = await ctx.Liquidate.get(liquidateID);
  if (liquidate == null) {
    liquidate = {
      id: liquidateID,
      hash: event.hash,
      logIndex: event.logIndex,
      nonce: event.nonce,
      liquidator_id: liquidator,
      liquidatee_id: liquidatee,
      blockNumber: event.blockNumber,
      timestamp: event.timestamp,
      market_id: market.id,
      asset_id: market.inputToken_id,
      amount,
      amountUSD,
      profitUSD,
      position_id: "",
    };
    ctx.Liquidate.set(liquidate);
  }
  return liquidate;
}

export async function getOrCreateChi(ctx: Ctx, chiID: string): Promise<_Chi> {
  let _chi = await ctx._Chi.get(chiID);
  if (_chi == null) {
    _chi = { id: chiID, chi: BIGINT_ONE_RAY, rho: BIGINT_ZERO };
    ctx._Chi.set(_chi);
  }
  return _chi;
}

export async function getOrCreateAccount(ctx: Ctx, accountID: string): Promise<Account> {
  let account = await ctx.Account.get(accountID);
  if (account == null) {
    account = {
      id: accountID,
      depositCount: INT_ZERO,
      withdrawCount: INT_ZERO,
      borrowCount: INT_ZERO,
      repayCount: INT_ZERO,
      liquidateCount: INT_ZERO,
      liquidationCount: INT_ZERO,
      positionCount: INT_ZERO,
      openPositionCount: INT_ZERO,
      closedPositionCount: INT_ZERO,
      _positionIDList: [],
    };
    ctx.Account.set(account);
  }
  return account;
}

export async function getOrCreatePositionCounter(
  ctx: Ctx,
  urn: string,
  ilk: string,
  side: string,
): Promise<_PositionCounter> {
  const marketID = (await getMarketAddressFromIlk(ctx, ilk))!;
  const ID = `${urn}-${marketID}-${side}`;
  let counterEntity = await ctx._PositionCounter.get(ID);
  if (!counterEntity) {
    counterEntity = { id: ID, nextCount: INT_ZERO };
    ctx._PositionCounter.set(counterEntity);
  }
  return counterEntity;
}

export async function getNextPositionCounter(
  ctx: Ctx,
  urn: string,
  ilk: string,
  side: string,
): Promise<number> {
  const counterEntity = await getOrCreatePositionCounter(ctx, urn, ilk, side);
  return counterEntity.nextCount;
}

export async function getOrCreatePosition(
  ctx: Ctx,
  event: EventInfo,
  address: string,
  ilk: string,
  side: string,
  newPosition = false,
): Promise<Position> {
  const urnOwnerAddr = await getOwnerAddressFromUrn(ctx, address);
  const _is_urn = urnOwnerAddr != null;
  const proxyOwnerAddr = await getOwnerAddressFromProxy(ctx, address);
  const urnProxyOwnerAddr = urnOwnerAddr
    ? await getOwnerAddressFromProxy(ctx, urnOwnerAddr)
    : null;
  const _is_proxy = !(proxyOwnerAddr == null && urnProxyOwnerAddr == null);
  const accountAddress = await getOwnerAddress(ctx, address);
  const marketID = (await getMarketAddressFromIlk(ctx, ilk))!;
  const positionPrefix = `${address}-${marketID}-${side}`;
  const counterEntity = await getOrCreatePositionCounter(ctx, address, ilk, side);
  let counter = counterEntity.nextCount;
  let positionID = `${positionPrefix}-${counter}`;
  let position = await ctx.Position.get(positionID);

  if (newPosition && position != null) {
    counter += 1;
    positionID = `${positionPrefix}-${counter}`;
    position = await ctx.Position.get(positionID);
    ctx._PositionCounter.set({ ...counterEntity, nextCount: counter });
  }

  if (position == null) {
    position = {
      id: positionID,
      market_id: marketID,
      account_id: accountAddress,
      _is_urn,
      _is_proxy,
      hashOpened: event.hash,
      blockNumberOpened: event.blockNumber,
      timestampOpened: event.timestamp,
      side: side as Position["side"],
      balance: BIGINT_ZERO,
      depositCount: INT_ZERO,
      withdrawCount: INT_ZERO,
      borrowCount: INT_ZERO,
      repayCount: INT_ZERO,
      liquidationCount: INT_ZERO,
      isCollateral: side === PositionSide.LENDER ? true : undefined,
      hashClosed: undefined,
      blockNumberClosed: undefined,
      timestampClosed: undefined,
    };
    ctx.Position.set(position);
  }
  return position;
}

// find the open position for the matching urn/ilk/side combination
export async function getOpenPosition(
  ctx: Ctx,
  urn: string,
  ilk: string,
  side: string,
): Promise<Position | null> {
  const marketID = (await getMarketAddressFromIlk(ctx, ilk))!;
  const nextCounter = await getNextPositionCounter(ctx, urn, ilk, side);
  for (let counter = nextCounter; counter >= 0; counter--) {
    const positionID = `${urn}-${marketID}-${side}-${counter}`;
    const position = await ctx.Position.get(positionID);
    if (position && position.hashClosed == null) {
      return position;
    }
  }
  return null;
}

export async function getMarketAddressFromIlk(ctx: Ctx, ilk: string): Promise<string | null> {
  const _ilk = await getOrCreateIlk(ctx, ilk);
  if (_ilk) return _ilk.marketAddress.toLowerCase();
  return null;
}

export async function getMarketFromIlk(ctx: Ctx, ilk: string): Promise<Market | null> {
  const marketAddress = await getMarketAddressFromIlk(ctx, ilk);
  if (marketAddress) {
    return await getOrCreateMarket(ctx, marketAddress);
  }
  return null;
}

export async function getOwnerAddressFromUrn(ctx: Ctx, urn: string): Promise<string | null> {
  const _urn = await ctx._Urn.get(urn);
  return _urn ? _urn.ownerAddress : null;
}

export async function getOwnerAddressFromProxy(ctx: Ctx, proxy: string): Promise<string | null> {
  const _proxy = await ctx._Proxy.get(proxy);
  return _proxy ? _proxy.ownerAddress : null;
}

// get owner address from possible urn or proxy address
export async function getOwnerAddress(ctx: Ctx, address: string): Promise<string> {
  const urnOwner = await getOwnerAddressFromUrn(ctx, address);
  let owner = urnOwner ? urnOwner : address;
  const proxyOwner = await getOwnerAddressFromProxy(ctx, owner);
  owner = proxyOwner ? proxyOwner : owner;
  return owner;
}

// create snapshot-copy InterestRate entities so snapshot rates don't point to live rate
export async function getSnapshotRates(
  ctx: Ctx,
  rates: readonly string[],
  timeSuffix: string,
): Promise<string[]> {
  const snapshotRates: string[] = [];
  for (let i = 0; i < rates.length; i++) {
    const rate = await ctx.InterestRate.get(rates[i]!);
    if (!rate) continue;
    const snapshotRateId = rates[i]!.concat("-").concat(timeSuffix);
    ctx.InterestRate.set({
      id: snapshotRateId,
      side: rate.side,
      type: rate.type,
      rate: rate.rate,
      duration: undefined,
      maturityBlock: undefined,
    });
    snapshotRates.push(snapshotRateId);
  }
  return snapshotRates;
}

// ----- metrics snapshot getters -----

export async function getOrCreateUsageMetricsHourlySnapshot(
  ctx: Ctx,
  event: EventInfo,
): Promise<Mutable<UsageMetricsHourlySnapshot>> {
  const id = (event.timestamp / BigInt(SECONDS_PER_HOUR)).toString();
  let snap = await ctx.UsageMetricsHourlySnapshot.get(id);
  const protocol = await getOrCreateLendingProtocol(ctx);
  if (snap == null) {
    snap = {
      id,
      protocol_id: protocol.id,
      hourlyActiveUsers: 0,
      cumulativeUniqueUsers: protocol.cumulativeUniqueUsers,
      cumulativeUniqueTxSigners: protocol.cumulativeUniqueTxSigners,
      hourlyTransactionCount: 0,
      hourlyDepositCount: 0,
      hourlyBorrowCount: 0,
      hourlyWithdrawCount: 0,
      hourlyRepayCount: 0,
      hourlyLiquidateCount: 0,
      blockNumber: BIGINT_ZERO,
      timestamp: BIGINT_ZERO,
    };
    ctx.UsageMetricsHourlySnapshot.set(snap);
  }
  return { ...snap };
}

export async function getOrCreateUsageMetricsDailySnapshot(
  ctx: Ctx,
  event: EventInfo,
): Promise<Mutable<UsageMetricsDailySnapshot>> {
  const id = (event.timestamp / BigInt(SECONDS_PER_DAY)).toString();
  let snap = await ctx.UsageMetricsDailySnapshot.get(id);
  const protocol = await getOrCreateLendingProtocol(ctx);
  if (snap == null) {
    snap = {
      id,
      protocol_id: protocol.id,
      dailyActiveUsers: 0,
      dailyActiveTxSigners: 0,
      dailyActiveDepositors: 0,
      dailyActiveBorrowers: 0,
      dailyActiveLiquidators: 0,
      dailyActiveLiquidatees: 0,
      cumulativeUniqueUsers: protocol.cumulativeUniqueUsers,
      cumulativeUniqueTxSigners: protocol.cumulativeUniqueTxSigners,
      cumulativeUniqueDepositors: protocol.cumulativeUniqueDepositors,
      cumulativeUniqueBorrowers: protocol.cumulativeUniqueBorrowers,
      cumulativeUniqueLiquidators: protocol.cumulativeUniqueLiquidators,
      cumulativeUniqueLiquidatees: protocol.cumulativeUniqueLiquidatees,
      totalPoolCount: protocol.totalPoolCount,
      dailyTransactionCount: 0,
      dailyDepositCount: 0,
      dailyBorrowCount: 0,
      dailyWithdrawCount: 0,
      dailyRepayCount: 0,
      dailyLiquidateCount: 0,
      blockNumber: BIGINT_ZERO,
      timestamp: BIGINT_ZERO,
    };
    ctx.UsageMetricsDailySnapshot.set(snap);
  }
  return { ...snap };
}

export async function getOrCreateMarketHourlySnapshot(
  ctx: Ctx,
  event: EventInfo,
  marketAddress: string,
): Promise<Mutable<MarketHourlySnapshot>> {
  const hours = (event.timestamp / BigInt(SECONDS_PER_HOUR)).toString();
  const snapshotID = marketAddress.concat("-").concat(hours);
  let snap = await ctx.MarketHourlySnapshot.get(snapshotID);
  const market = await getOrCreateMarket(ctx, marketAddress);
  if (snap == null) {
    const protocol = await getOrCreateLendingProtocol(ctx);
    snap = {
      id: snapshotID,
      protocol_id: protocol.id,
      market_id: marketAddress,
      inputTokenBalance: market.inputTokenBalance,
      inputTokenPriceUSD: market.inputTokenPriceUSD,
      outputTokenSupply: market.outputTokenSupply,
      outputTokenPriceUSD: market.outputTokenPriceUSD,
      totalValueLockedUSD: market.totalValueLockedUSD,
      totalDepositBalanceUSD: market.totalDepositBalanceUSD,
      totalBorrowBalanceUSD: market.totalBorrowBalanceUSD,
      cumulativeDepositUSD: market.cumulativeDepositUSD,
      cumulativeBorrowUSD: market.cumulativeBorrowUSD,
      cumulativeLiquidateUSD: market.cumulativeLiquidateUSD,
      rates: market.rates,
      blockNumber: event.blockNumber,
      timestamp: event.timestamp,
      hourlyDepositUSD: BIGDECIMAL_ZERO,
      hourlyBorrowUSD: BIGDECIMAL_ZERO,
      hourlyLiquidateUSD: BIGDECIMAL_ZERO,
      hourlyWithdrawUSD: BIGDECIMAL_ZERO,
      hourlyRepayUSD: BIGDECIMAL_ZERO,
      cumulativeSupplySideRevenueUSD: market.cumulativeSupplySideRevenueUSD,
      cumulativeProtocolSideRevenueUSD: market.cumulativeProtocolSideRevenueUSD,
      cumulativeTotalRevenueUSD: market.cumulativeTotalRevenueUSD,
      hourlySupplySideRevenueUSD: BIGDECIMAL_ZERO,
      hourlyProtocolSideRevenueUSD: BIGDECIMAL_ZERO,
      hourlyTotalRevenueUSD: BIGDECIMAL_ZERO,
      exchangeRate: undefined,
      rewardTokenEmissionsAmount: undefined,
      rewardTokenEmissionsUSD: undefined,
    };
    ctx.MarketHourlySnapshot.set(snap);
  }
  return { ...snap };
}

export async function getOrCreateMarketDailySnapshot(
  ctx: Ctx,
  event: EventInfo,
  marketAddress: string,
): Promise<Mutable<MarketDailySnapshot>> {
  const days = (event.timestamp / BigInt(SECONDS_PER_DAY)).toString();
  const snapshotID = marketAddress.concat("-").concat(days);
  let snap = await ctx.MarketDailySnapshot.get(snapshotID);
  const market = await getOrCreateMarket(ctx, marketAddress);
  if (snap == null) {
    const protocol = await getOrCreateLendingProtocol(ctx);
    snap = {
      id: snapshotID,
      protocol_id: protocol.id,
      market_id: marketAddress,
      inputTokenBalance: market.inputTokenBalance,
      inputTokenPriceUSD: market.inputTokenPriceUSD,
      outputTokenSupply: market.outputTokenSupply,
      outputTokenPriceUSD: market.outputTokenPriceUSD,
      totalValueLockedUSD: market.totalValueLockedUSD,
      totalDepositBalanceUSD: market.totalDepositBalanceUSD,
      totalBorrowBalanceUSD: market.totalBorrowBalanceUSD,
      cumulativeDepositUSD: market.cumulativeDepositUSD,
      cumulativeBorrowUSD: market.cumulativeBorrowUSD,
      cumulativeLiquidateUSD: market.cumulativeLiquidateUSD,
      rates: market.rates,
      blockNumber: event.blockNumber,
      timestamp: event.timestamp,
      dailyDepositUSD: BIGDECIMAL_ZERO,
      dailyBorrowUSD: BIGDECIMAL_ZERO,
      dailyLiquidateUSD: BIGDECIMAL_ZERO,
      dailyWithdrawUSD: BIGDECIMAL_ZERO,
      dailyRepayUSD: BIGDECIMAL_ZERO,
      cumulativeSupplySideRevenueUSD: market.cumulativeSupplySideRevenueUSD,
      cumulativeProtocolSideRevenueUSD: market.cumulativeProtocolSideRevenueUSD,
      cumulativeTotalRevenueUSD: market.cumulativeTotalRevenueUSD,
      dailySupplySideRevenueUSD: BIGDECIMAL_ZERO,
      dailyProtocolSideRevenueUSD: BIGDECIMAL_ZERO,
      dailyTotalRevenueUSD: BIGDECIMAL_ZERO,
      exchangeRate: undefined,
      rewardTokenEmissionsAmount: undefined,
      rewardTokenEmissionsUSD: undefined,
    };
    ctx.MarketDailySnapshot.set(snap);
  }
  return { ...snap };
}

export async function getOrCreateFinancials(
  ctx: Ctx,
  event: EventInfo,
): Promise<Mutable<FinancialsDailySnapshot>> {
  const id = (event.timestamp / BigInt(SECONDS_PER_DAY)).toString();
  let fin = await ctx.FinancialsDailySnapshot.get(id);
  const protocol = await getOrCreateLendingProtocol(ctx);
  if (fin == null) {
    fin = {
      id,
      protocol_id: protocol.id,
      totalValueLockedUSD: protocol.totalValueLockedUSD,
      totalBorrowBalanceUSD: protocol.totalBorrowBalanceUSD,
      totalDepositBalanceUSD: protocol.totalDepositBalanceUSD,
      mintedTokenSupplies: protocol.mintedTokenSupplies,
      cumulativeSupplySideRevenueUSD: protocol.cumulativeSupplySideRevenueUSD,
      cumulativeProtocolSideRevenueUSD: protocol.cumulativeProtocolSideRevenueUSD,
      _cumulativeProtocolSideStabilityFeeRevenue: protocol._cumulativeProtocolSideStabilityFeeRevenue,
      _cumulativeProtocolSideLiquidationRevenue: protocol._cumulativeProtocolSideLiquidationRevenue,
      _cumulativeProtocolSidePSMRevenue: protocol._cumulativeProtocolSidePSMRevenue,
      cumulativeTotalRevenueUSD: protocol.cumulativeTotalRevenueUSD,
      cumulativeBorrowUSD: protocol.cumulativeBorrowUSD,
      cumulativeDepositUSD: protocol.cumulativeDepositUSD,
      cumulativeLiquidateUSD: protocol.cumulativeLiquidateUSD,
      dailySupplySideRevenueUSD: BIGDECIMAL_ZERO,
      dailyProtocolSideRevenueUSD: BIGDECIMAL_ZERO,
      _dailyProtocolSideStabilityFeeRevenue: BIGDECIMAL_ZERO,
      _dailyProtocolSideLiquidationRevenue: BIGDECIMAL_ZERO,
      _dailyProtocolSidePSMRevenue: BIGDECIMAL_ZERO,
      dailyTotalRevenueUSD: BIGDECIMAL_ZERO,
      dailyBorrowUSD: BIGDECIMAL_ZERO,
      dailyWithdrawUSD: BIGDECIMAL_ZERO,
      dailyDepositUSD: BIGDECIMAL_ZERO,
      dailyRepayUSD: BIGDECIMAL_ZERO,
      dailyLiquidateUSD: BIGDECIMAL_ZERO,
      protocolControlledValueUSD: undefined,
      blockNumber: event.blockNumber,
      timestamp: event.timestamp,
    };
    ctx.FinancialsDailySnapshot.set(fin);
  }
  return { ...fin };
}

// re-export to mirror bytes32 ilk -> ascii name where needed
export { bytes32ToString };
