/**
 * Port of src/mapping/lending-pool/v3.ts.
 */
import { indexer } from "envio";
import type { Reserve, UserReserve } from "envio";
import { USD_PRECISION, low } from "../common/constants";
import { divDecimal, calculateGrowth } from "../common/math";
import { getHistoryEntityId } from "../common/ids";
import type { Ctx, Ev } from "../common/types";
import {
  getOrInitReferrer,
  getOrInitReserve,
  getOrInitUser,
  getOrInitUserReserve,
  getPoolByContract,
  getPriceOracleAsset,
} from "../mappingHelpers/initializers";

async function assetPriceUSD(context: Ctx, reserve: Reserve) {
  const priceOracleAsset = await getPriceOracleAsset(context, reserve.price_id);
  return divDecimal(priceOracleAsset.priceInEth, USD_PRECISION);
}

indexer.onEvent({ contract: "Pool", event: "Supply" }, async ({ event, context }) => {
  const caller = event.params.user;
  const user = event.params.onBehalfOf;
  const { userReserve, reserve } = await getOrInitUserReserve(
    context,
    user,
    event.params.reserve,
    event.srcAddress,
  );

  let id = getHistoryEntityId(event);
  if (await context.Supply.get(id)) id = id + "0";

  context.Supply.set({
    id,
    txHash: event.transaction.hash.toLowerCase(),
    action: "Supply",
    pool_id: reserve.pool_id,
    user_id: userReserve.user_id,
    caller_id: (await getOrInitUser(context, caller)).id,
    userReserve_id: userReserve.id,
    reserve_id: reserve.id,
    amount: event.params.amount,
    timestamp: event.block.timestamp,
    assetPriceUSD: await assetPriceUSD(context, reserve),
    referrer_id: event.params.referralCode ? (await getOrInitReferrer(context, Number(event.params.referralCode))).id : undefined,
  });
});

indexer.onEvent({ contract: "Pool", event: "Withdraw" }, async ({ event, context }) => {
  const toUser = await getOrInitUser(context, event.params.to);
  const { userReserve, reserve } = await getOrInitUserReserve(
    context,
    event.params.user,
    event.params.reserve,
    event.srcAddress,
  );
  context.RedeemUnderlying.set({
    id: getHistoryEntityId(event),
    txHash: event.transaction.hash.toLowerCase(),
    action: "RedeemUnderlying",
    pool_id: reserve.pool_id,
    user_id: userReserve.user_id,
    to_id: toUser.id,
    userReserve_id: userReserve.id,
    reserve_id: reserve.id,
    amount: event.params.amount,
    timestamp: event.block.timestamp,
    assetPriceUSD: await assetPriceUSD(context, reserve),
  });
});

indexer.onEvent({ contract: "Pool", event: "Borrow" }, async ({ event, context }) => {
  const user = event.params.onBehalfOf;
  const caller = event.params.user;
  const { userReserve, reserve } = await getOrInitUserReserve(
    context,
    user,
    event.params.reserve,
    event.srcAddress,
  );
  context.Borrow.set({
    id: getHistoryEntityId(event),
    txHash: event.transaction.hash.toLowerCase(),
    action: "Borrow",
    pool_id: reserve.pool_id,
    user_id: userReserve.user_id,
    caller_id: (await getOrInitUser(context, caller)).id,
    userReserve_id: userReserve.id,
    reserve_id: reserve.id,
    amount: event.params.amount,
    stableTokenDebt: userReserve.principalStableDebt,
    variableTokenDebt: userReserve.scaledVariableDebt,
    borrowRate: event.params.borrowRate,
    borrowRateMode: Number(event.params.interestRateMode),
    timestamp: event.block.timestamp,
    referrer_id: event.params.referralCode ? (await getOrInitReferrer(context, Number(event.params.referralCode))).id : undefined,
    assetPriceUSD: await assetPriceUSD(context, reserve),
  });
});

indexer.onEvent({ contract: "Pool", event: "SwapBorrowRateMode" }, async ({ event, context }) => {
  const { userReserve, reserve } = await getOrInitUserReserve(
    context,
    event.params.user,
    event.params.reserve,
    event.srcAddress,
  );
  const from = Number(event.params.interestRateMode);
  context.SwapBorrowRate.set({
    id: getHistoryEntityId(event),
    txHash: event.transaction.hash.toLowerCase(),
    action: "SwapBorrowRate",
    pool_id: reserve.pool_id,
    borrowRateModeFrom: from,
    borrowRateModeTo: from === 1 ? 2 : 1,
    variableBorrowRate: reserve.variableBorrowRate,
    stableBorrowRate: reserve.stableBorrowRate,
    user_id: userReserve.user_id,
    userReserve_id: userReserve.id,
    reserve_id: reserve.id,
    timestamp: event.block.timestamp,
  });
});

indexer.onEvent({ contract: "Pool", event: "RebalanceStableBorrowRate" }, async ({ event, context }) => {
  const { userReserve, reserve } = await getOrInitUserReserve(
    context,
    event.params.user,
    event.params.reserve,
    event.srcAddress,
  );
  context.RebalanceStableBorrowRate.set({
    id: getHistoryEntityId(event),
    txHash: event.transaction.hash.toLowerCase(),
    action: "RebalanceStableBorrowRate",
    userReserve_id: userReserve.id,
    borrowRateFrom: userReserve.oldStableBorrowRate,
    borrowRateTo: userReserve.stableBorrowRate,
    pool_id: reserve.pool_id,
    reserve_id: reserve.id,
    user_id: low(event.params.user),
    timestamp: event.block.timestamp,
  });
});

indexer.onEvent({ contract: "Pool", event: "Repay" }, async ({ event, context }) => {
  const repayer = event.params.repayer;
  const { userReserve, reserve } = await getOrInitUserReserve(
    context,
    event.params.user,
    event.params.reserve,
    event.srcAddress,
  );
  context.Reserve.set({ ...reserve });
  context.Repay.set({
    id: getHistoryEntityId(event),
    txHash: event.transaction.hash.toLowerCase(),
    action: "Repay",
    pool_id: reserve.pool_id,
    user_id: userReserve.user_id,
    repayer_id: (await getOrInitUser(context, repayer)).id,
    userReserve_id: userReserve.id,
    reserve_id: reserve.id,
    amount: event.params.amount,
    timestamp: event.block.timestamp,
    useATokens: event.params.useATokens,
    assetPriceUSD: await assetPriceUSD(context, reserve),
  });
});

indexer.onEvent({ contract: "Pool", event: "LiquidationCall" }, async ({ event, context }) => {
  const user = await getOrInitUser(context, event.params.user);

  const collateral = await getOrInitUserReserve(
    context,
    event.params.user,
    event.params.collateralAsset,
    event.srcAddress,
  );
  const liquidatedCollateralAmount = event.params.liquidatedCollateralAmount;
  const collateralPoolReserve: Reserve = {
    ...collateral.reserve,
    lifetimeLiquidated: collateral.reserve.lifetimeLiquidated + liquidatedCollateralAmount,
  };
  context.Reserve.set(collateralPoolReserve);

  const principal = await getOrInitUserReserve(
    context,
    event.params.user,
    event.params.debtAsset,
    event.srcAddress,
  );
  context.Reserve.set({ ...principal.reserve });

  context.LiquidationCall.set({
    id: getHistoryEntityId(event),
    txHash: event.transaction.hash.toLowerCase(),
    action: "LiquidationCall",
    pool_id: collateralPoolReserve.pool_id,
    user_id: user.id,
    collateralReserve_id: collateralPoolReserve.id,
    collateralUserReserve_id: collateral.userReserve.id,
    collateralAmount: liquidatedCollateralAmount,
    principalReserve_id: principal.reserve.id,
    principalUserReserve_id: principal.userReserve.id,
    principalAmount: event.params.debtToCover,
    liquidator: low(event.params.liquidator),
    timestamp: event.block.timestamp,
    collateralAssetPriceUSD: await assetPriceUSD(context, collateralPoolReserve),
    borrowAssetPriceUSD: await assetPriceUSD(context, principal.reserve),
  });
});

indexer.onEvent({ contract: "Pool", event: "FlashLoan" }, async ({ event, context }) => {
  const initiator = await getOrInitUser(context, event.params.initiator);
  const reserve = await getOrInitReserve(context, event.params.asset, event.srcAddress);
  const poolId = await getPoolByContract(context, event.srcAddress);
  const pool = await context.Pool.get(poolId);

  const premium = event.params.premium;
  // flashloanPremiumToProtocol deprecated in v3.4; defaults to 10000
  const flashloanPremiumToProtocol = pool?.flashloanPremiumToProtocol ?? 10000n;
  const premiumToProtocol = (premium * flashloanPremiumToProtocol + 5000n) / 10000n;
  const premiumToLP = premium - premiumToProtocol;

  const updated: Reserve = {
    ...reserve,
    availableLiquidity: reserve.availableLiquidity + premium,
    lifetimeFlashLoans: reserve.lifetimeFlashLoans + event.params.amount,
    lifetimeFlashLoanPremium: reserve.lifetimeFlashLoanPremium + premium,
    lifetimeFlashLoanLPPremium: reserve.lifetimeFlashLoanLPPremium + premiumToLP,
    lifetimeFlashLoanProtocolPremium: reserve.lifetimeFlashLoanProtocolPremium + premiumToProtocol,
    totalATokenSupply: reserve.totalATokenSupply + premium,
  };
  context.Reserve.set(updated);

  context.FlashLoan.set({
    id: getHistoryEntityId(event),
    pool_id: updated.pool_id,
    reserve_id: updated.id,
    target: low(event.params.target),
    initiator_id: initiator.id,
    totalFee: premium,
    lpFee: premiumToLP,
    protocolFee: premiumToProtocol,
    amount: event.params.amount,
    timestamp: event.block.timestamp,
    assetPriceUSD: await assetPriceUSD(context, updated),
  });
});

type CollateralEvent = Ev & { params: { reserve: string; user: string } };

async function usageAsCollateral(
  context: Ctx,
  event: CollateralEvent,
  toState: boolean,
): Promise<void> {
  const { userReserve, reserve } = await getOrInitUserReserve(
    context,
    event.params.user,
    event.params.reserve,
    event.srcAddress,
  );
  const timestamp = event.block.timestamp;
  context.UsageAsCollateral.set({
    id: getHistoryEntityId(event),
    txHash: event.transaction.hash.toLowerCase(),
    action: "UsageAsCollateral",
    pool_id: reserve.pool_id,
    fromState: userReserve.usageAsCollateralEnabledOnUser,
    toState,
    user_id: userReserve.user_id,
    userReserve_id: userReserve.id,
    reserve_id: reserve.id,
    timestamp,
  });
  const updated: UserReserve = {
    ...userReserve,
    lastUpdateTimestamp: timestamp,
    usageAsCollateralEnabledOnUser: toState,
  };
  context.UserReserve.set(updated);
}

indexer.onEvent(
  { contract: "Pool", event: "ReserveUsedAsCollateralEnabled" },
  async ({ event, context }) => usageAsCollateral(context, event, true),
);
indexer.onEvent(
  { contract: "Pool", event: "ReserveUsedAsCollateralDisabled" },
  async ({ event, context }) => usageAsCollateral(context, event, false),
);

indexer.onEvent({ contract: "Pool", event: "ReserveDataUpdated" }, async ({ event, context }) => {
  const reserve = await getOrInitReserve(context, event.params.reserve, event.srcAddress);
  let r: Reserve = {
    ...reserve,
    stableBorrowRate: event.params.stableBorrowRate,
    variableBorrowRate: event.params.variableBorrowRate,
    variableBorrowIndex: event.params.variableBorrowIndex,
  };
  const timestamp = BigInt(event.block.timestamp);
  const prevTimestamp = BigInt(reserve.lastUpdateTimestamp);
  if (timestamp > prevTimestamp) {
    const growth = calculateGrowth(r.totalATokenSupply, r.liquidityRate, prevTimestamp, timestamp);
    r = {
      ...r,
      totalATokenSupply: r.totalATokenSupply + growth,
      lifetimeSuppliersInterestEarned: r.lifetimeSuppliersInterestEarned + growth,
    };
  }
  r = {
    ...r,
    liquidityRate: event.params.liquidityRate,
    liquidityIndex: event.params.liquidityIndex,
    lastUpdateTimestamp: event.block.timestamp,
  };
  context.Reserve.set(r);
});

indexer.onEvent({ contract: "Pool", event: "MintUnbacked" }, async ({ event, context }) => {
  const caller = event.params.user;
  const user = event.params.onBehalfOf;
  const { userReserve, reserve } = await getOrInitUserReserve(
    context,
    user,
    event.params.reserve,
    event.srcAddress,
  );
  context.MintUnbacked.set({
    id: getHistoryEntityId(event),
    pool_id: reserve.pool_id,
    user_id: userReserve.user_id,
    userReserve_id: userReserve.id,
    caller_id: (await getOrInitUser(context, caller)).id,
    reserve_id: reserve.id,
    amount: event.params.amount,
    timestamp: event.block.timestamp,
    referral: Number(event.params.referralCode),
  });
});

indexer.onEvent({ contract: "Pool", event: "BackUnbacked" }, async ({ event, context }) => {
  const backer = event.params.backer;
  const { userReserve, reserve } = await getOrInitUserReserve(
    context,
    backer,
    event.params.reserve,
    event.srcAddress,
  );
  const poolId = await getPoolByContract(context, event.srcAddress);
  const pool = await context.Pool.get(poolId);

  const premium = event.params.fee;
  const premiumToProtocol = (premium * (pool?.bridgeProtocolFee ?? 0n) + 5000n) / 10000n;
  const premiumToLP = premium - premiumToProtocol;
  context.Reserve.set({
    ...reserve,
    lifetimePortalLPFee: reserve.lifetimePortalLPFee + premiumToLP,
    lifetimePortalProtocolFee: reserve.lifetimePortalProtocolFee + premiumToProtocol,
  });

  context.BackUnbacked.set({
    id: getHistoryEntityId(event),
    pool_id: reserve.pool_id,
    backer_id: userReserve.user_id,
    userReserve_id: userReserve.id,
    reserve_id: reserve.id,
    amount: event.params.amount,
    timestamp: event.block.timestamp,
    fee: event.params.fee,
    lpFee: premiumToLP,
    protocolFee: premiumToProtocol,
  });
});

indexer.onEvent({ contract: "Pool", event: "UserEModeSet" }, async ({ event, context }) => {
  const user = await getOrInitUser(context, event.params.user);
  context.User.set({ ...user, eModeCategoryId_id: event.params.categoryId.toString() });
  context.UserEModeSet.set({
    id: getHistoryEntityId(event),
    action: "UserEModeSet",
    txHash: event.transaction.hash.toLowerCase(),
    user_id: user.id,
    categoryId: Number(event.params.categoryId),
    timestamp: event.block.timestamp,
  });
});

indexer.onEvent({ contract: "Pool", event: "MintedToTreasury" }, async ({ event, context }) => {
  const reserve = await getOrInitReserve(context, event.params.reserve, event.srcAddress);
  context.MintedToTreasury.set({
    id: getHistoryEntityId(event),
    pool_id: reserve.pool_id,
    reserve_id: reserve.id,
    amount: event.params.amountMinted,
    timestamp: event.block.timestamp,
  });
});

indexer.onEvent(
  { contract: "Pool", event: "IsolationModeTotalDebtUpdated" },
  async ({ event, context }) => {
    const reserve = await getOrInitReserve(context, event.params.asset, event.srcAddress);
    context.IsolationModeTotalDebtUpdated.set({
      id: getHistoryEntityId(event),
      pool_id: reserve.pool_id,
      reserve_id: reserve.id,
      isolatedDebt: event.params.totalDebt,
      timestamp: event.block.timestamp,
    });
  },
);
