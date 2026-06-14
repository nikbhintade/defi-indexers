/**
 * Port of src/mapping/tokenization/{tokenization,initialization}.ts.
 *
 * aToken/variable/stable debt token Mint/Burn/BalanceTransfer drive
 * reserve/userReserve accounting (ray math), reserve totals, and history
 * entities. The token's underlyingAssetAddress (seeded at ReserveInitialized)
 * is the join key back to the Reserve / UserReserve.
 */
import { indexer } from "envio";
import type { Reserve, UserReserve } from "envio";
import { TREASURY_ADDRESS_CHECKSUM, ZERO_BI, low } from "../common/constants";
import { calculateUtilizationRate, rayDiv, rayMul } from "../common/math";
import type { Ctx, Ev } from "../common/types";
import {
  getOrInitAToken,
  getOrInitReserve,
  getOrInitSToken,
  getOrInitUser,
  getOrInitUserReserve,
  getOrInitVToken,
  initReserveParamsHistoryItem,
} from "../mappingHelpers/initializers";

function saveUserReserveAHistory(
  context: Ctx,
  userReserve: UserReserve,
  event: Ev,
  index: bigint,
): void {
  context.ATokenBalanceHistoryItem.set({
    id: userReserve.id + event.transaction.hash.toLowerCase(),
    scaledATokenBalance: userReserve.scaledATokenBalance,
    currentATokenBalance: userReserve.currentATokenBalance,
    userReserve_id: userReserve.id,
    index,
    timestamp: event.block.timestamp,
  });
}

function saveUserReserveVHistory(
  context: Ctx,
  userReserve: UserReserve,
  event: Ev,
  index: bigint,
): void {
  context.VTokenBalanceHistoryItem.set({
    id: userReserve.id + event.transaction.hash.toLowerCase(),
    scaledVariableDebt: userReserve.scaledVariableDebt,
    currentVariableDebt: userReserve.currentVariableDebt,
    userReserve_id: userReserve.id,
    index,
    timestamp: event.block.timestamp,
  });
}

function saveUserReserveSHistory(
  context: Ctx,
  userReserve: UserReserve,
  event: Ev,
  rate: bigint,
): void {
  context.STokenBalanceHistoryItem.set({
    id: userReserve.id + event.transaction.hash.toLowerCase(),
    principalStableDebt: userReserve.principalStableDebt,
    currentStableDebt: userReserve.currentStableDebt,
    userReserve_id: userReserve.id,
    avgStableBorrowRate: rate,
    timestamp: event.block.timestamp,
  });
}

/** saveReserve: recompute utilizationRate, persist + append ReserveParamsHistoryItem (id = txHash ++ reserveId). */
function saveReserve(context: Ctx, reserve: Reserve, event: Ev): void {
  const utilizationRate = calculateUtilizationRate(
    reserve.totalLiquidity,
    reserve.availableLiquidity,
  );
  const updated: Reserve = { ...reserve, utilizationRate };
  context.Reserve.set(updated);

  const item = initReserveParamsHistoryItem(
    event.transaction.hash.toLowerCase() + updated.id,
    updated.id,
  );
  context.ReserveParamsHistoryItem.set({
    ...item,
    totalScaledVariableDebt: updated.totalScaledVariableDebt,
    totalCurrentVariableDebt: updated.totalCurrentVariableDebt,
    totalPrincipalStableDebt: updated.totalPrincipalStableDebt,
    lifetimePrincipalStableDebt: updated.lifetimePrincipalStableDebt,
    lifetimeScaledVariableDebt: updated.lifetimeScaledVariableDebt,
    lifetimeCurrentVariableDebt: updated.lifetimeCurrentVariableDebt,
    lifetimeLiquidity: updated.lifetimeLiquidity,
    lifetimeBorrows: updated.lifetimeBorrows,
    lifetimeRepayments: updated.lifetimeRepayments,
    lifetimeWithdrawals: updated.lifetimeWithdrawals,
    lifetimeLiquidated: updated.lifetimeLiquidated,
    lifetimeFlashLoanPremium: updated.lifetimeFlashLoanPremium,
    lifetimeFlashLoans: updated.lifetimeFlashLoans,
    lifetimeReserveFactorAccrued: updated.lifetimeReserveFactorAccrued,
    lifetimeDepositorsInterestEarned: updated.lifetimeDepositorsInterestEarned,
    availableLiquidity: updated.availableLiquidity,
    totalLiquidity: updated.totalLiquidity,
    totalLiquidityAsCollateral: updated.totalLiquidityAsCollateral,
    utilizationRate: updated.utilizationRate,
    variableBorrowRate: updated.variableBorrowRate,
    variableBorrowIndex: updated.variableBorrowIndex,
    stableBorrowRate: updated.stableBorrowRate,
    liquidityIndex: updated.liquidityIndex,
    liquidityRate: updated.liquidityRate,
    totalATokenSupply: updated.totalATokenSupply,
    averageStableBorrowRate: updated.averageStableRate,
    timestamp: event.block.timestamp,
  });
}

// ---- aToken Burn / Mint (shared internals) ----

async function tokenBurn(
  context: Ctx,
  event: Ev,
  from: string,
  value: bigint,
  index: bigint,
): Promise<void> {
  const aToken = await getOrInitAToken(context, event.srcAddress);
  const { userReserve, reserve } = await getOrInitUserReserve(
    context,
    from,
    aToken.underlyingAssetAddress,
    event.srcAddress,
  );

  const calculatedAmount = rayDiv(value, index);
  const scaledATokenBalance = userReserve.scaledATokenBalance - calculatedAmount;
  const ur: UserReserve = {
    ...userReserve,
    scaledATokenBalance,
    currentATokenBalance: rayMul(scaledATokenBalance, index),
    variableBorrowIndex: reserve.variableBorrowIndex,
    liquidityRate: reserve.liquidityRate,
    lastUpdateTimestamp: event.block.timestamp,
  };

  let pr: Reserve = {
    ...reserve,
    totalDeposits: reserve.totalDeposits - value,
    availableLiquidity: reserve.availableLiquidity - value,
    totalATokenSupply: reserve.totalATokenSupply - value,
    totalLiquidity: reserve.totalLiquidity - value,
    lifetimeWithdrawals: reserve.lifetimeWithdrawals + value,
  };
  if (ur.usageAsCollateralEnabledOnUser) {
    pr = { ...pr, totalLiquidityAsCollateral: pr.totalLiquidityAsCollateral - value };
  }
  saveReserve(context, pr, event);

  context.UserReserve.set(ur);
  saveUserReserveAHistory(context, ur, event, index);
}

async function tokenMint(
  context: Ctx,
  event: Ev,
  from: string,
  value: bigint,
  index: bigint,
): Promise<void> {
  const aToken = await getOrInitAToken(context, event.srcAddress);
  const reserve = await getOrInitReserve(context, aToken.underlyingAssetAddress, event.srcAddress);
  let pr: Reserve = { ...reserve, totalATokenSupply: reserve.totalATokenSupply + value };

  // QUIRK: source compares lowercased `from` against a checksummed literal that
  // never matches, so the treasury branch is dead and we always take the user
  // branch. See common/constants.ts.
  if (low(from) !== TREASURY_ADDRESS_CHECKSUM) {
    const { userReserve } = await getOrInitUserReserve(
      context,
      from,
      aToken.underlyingAssetAddress,
      event.srcAddress,
    );
    const calculatedAmount = rayDiv(value, index);
    const scaledATokenBalance = userReserve.scaledATokenBalance + calculatedAmount;
    const ur: UserReserve = {
      ...userReserve,
      scaledATokenBalance,
      currentATokenBalance: rayMul(scaledATokenBalance, index),
      liquidityRate: pr.liquidityRate,
      variableBorrowIndex: pr.variableBorrowIndex,
      lastUpdateTimestamp: event.block.timestamp,
    };
    context.UserReserve.set(ur);

    pr = {
      ...pr,
      totalDeposits: pr.totalDeposits + value,
      availableLiquidity: pr.availableLiquidity + value,
      totalLiquidity: pr.totalLiquidity + value,
      lifetimeLiquidity: pr.lifetimeLiquidity + value,
    };
    if (ur.usageAsCollateralEnabledOnUser) {
      pr = { ...pr, totalLiquidityAsCollateral: pr.totalLiquidityAsCollateral + value };
    }
    saveReserve(context, pr, event);
    saveUserReserveAHistory(context, ur, event, index);
  } else {
    pr = { ...pr, lifetimeReserveFactorAccrued: pr.lifetimeReserveFactorAccrued + value };
    saveReserve(context, pr, event);
  }
}

indexer.onEvent({ contract: "AToken", event: "Burn" }, async ({ event, context }) => {
  await tokenBurn(context, event, event.params.from, event.params.value, event.params.index);
});

indexer.onEvent({ contract: "AToken", event: "Mint" }, async ({ event, context }) => {
  await tokenMint(context, event, event.params.from, event.params.value, event.params.index);
});

indexer.onEvent({ contract: "AToken", event: "BalanceTransfer" }, async ({ event, context }) => {
  await tokenBurn(context, event, event.params.from, event.params.value, event.params.index);
  await tokenMint(context, event, event.params.to, event.params.value, event.params.index);

  const aToken = await getOrInitAToken(context, event.srcAddress);
  const fromUR = await getOrInitUserReserve(
    context,
    event.params.from,
    aToken.underlyingAssetAddress,
    event.srcAddress,
  );
  const toUR = await getOrInitUserReserve(
    context,
    event.params.to,
    aToken.underlyingAssetAddress,
    event.srcAddress,
  );
  const reserve = await getOrInitReserve(context, aToken.underlyingAssetAddress, event.srcAddress);

  if (
    fromUR.userReserve.usageAsCollateralEnabledOnUser &&
    !toUR.userReserve.usageAsCollateralEnabledOnUser
  ) {
    saveReserve(
      context,
      {
        ...reserve,
        totalLiquidityAsCollateral: reserve.totalLiquidityAsCollateral - event.params.value,
      },
      event,
    );
  } else if (
    !fromUR.userReserve.usageAsCollateralEnabledOnUser &&
    toUR.userReserve.usageAsCollateralEnabledOnUser
  ) {
    saveReserve(
      context,
      {
        ...reserve,
        totalLiquidityAsCollateral: reserve.totalLiquidityAsCollateral + event.params.value,
      },
      event,
    );
  }
});

// ---- BurnAndMintByGovernance: re-emits a synthetic BalanceTransfer ----
indexer.onEvent(
  { contract: "AToken", event: "BurnAndMintByGovernance" },
  async ({ event, context }) => {
    const aToken = await context.AToken.get(low(event.srcAddress));
    if (!aToken) return;
    const reserve = await getOrInitReserve(
      context,
      aToken.underlyingAssetAddress,
      event.srcAddress,
    );
    // synthetic BalanceTransfer(from=oldWallet, to=newWallet, value=amount, index=liquidityIndex)
    const from = event.params.oldWallet;
    const to = event.params.newWallet;
    const value = event.params.amount;
    const index = reserve.liquidityIndex;

    await tokenBurn(context, event, from, value, index);
    await tokenMint(context, event, to, value, index);

    const fromUR = await getOrInitUserReserve(
      context,
      from,
      aToken.underlyingAssetAddress,
      event.srcAddress,
    );
    const toUR = await getOrInitUserReserve(
      context,
      to,
      aToken.underlyingAssetAddress,
      event.srcAddress,
    );
    const r2 = await getOrInitReserve(context, aToken.underlyingAssetAddress, event.srcAddress);
    if (
      fromUR.userReserve.usageAsCollateralEnabledOnUser &&
      !toUR.userReserve.usageAsCollateralEnabledOnUser
    ) {
      saveReserve(
        context,
        { ...r2, totalLiquidityAsCollateral: r2.totalLiquidityAsCollateral - value },
        event,
      );
    } else if (
      !fromUR.userReserve.usageAsCollateralEnabledOnUser &&
      toUR.userReserve.usageAsCollateralEnabledOnUser
    ) {
      saveReserve(
        context,
        { ...r2, totalLiquidityAsCollateral: r2.totalLiquidityAsCollateral + value },
        event,
      );
    }
  },
);

// ---- Variable debt token ----
indexer.onEvent({ contract: "VariableDebtToken", event: "Burn" }, async ({ event, context }) => {
  const vToken = await getOrInitVToken(context, event.srcAddress);
  const from = event.params.user;
  const value = event.params.amount;
  const index = event.params.index;
  const { userReserve, reserve } = await getOrInitUserReserve(
    context,
    from,
    vToken.underlyingAssetAddress,
    event.srcAddress,
  );

  const calculatedAmount = rayDiv(value, index);
  const scaledVariableDebt = userReserve.scaledVariableDebt - calculatedAmount;
  const currentVariableDebt = rayMul(scaledVariableDebt, index);
  let ur: UserReserve = {
    ...userReserve,
    scaledVariableDebt,
    currentVariableDebt,
    currentTotalDebt: userReserve.currentStableDebt + currentVariableDebt,
  };

  const totalScaledVariableDebt = reserve.totalScaledVariableDebt - calculatedAmount;
  const pr: Reserve = {
    ...reserve,
    totalScaledVariableDebt,
    totalCurrentVariableDebt: rayMul(totalScaledVariableDebt, index),
    availableLiquidity: reserve.availableLiquidity + value,
    lifetimeRepayments: reserve.lifetimeRepayments + value,
  };

  ur = {
    ...ur,
    liquidityRate: pr.liquidityRate,
    variableBorrowIndex: pr.variableBorrowIndex,
    lastUpdateTimestamp: event.block.timestamp,
  };
  context.UserReserve.set(ur);
  saveReserve(context, pr, event);

  const user = await getOrInitUser(context, from);
  if (ur.scaledVariableDebt === ZERO_BI && ur.principalStableDebt === ZERO_BI) {
    context.User.set({ ...user, borrowedReservesCount: user.borrowedReservesCount - 1 });
  }
  saveUserReserveVHistory(context, ur, event, index);
});

indexer.onEvent({ contract: "VariableDebtToken", event: "Mint" }, async ({ event, context }) => {
  const vToken = await getOrInitVToken(context, event.srcAddress);
  const reserve = await getOrInitReserve(context, vToken.underlyingAssetAddress, event.srcAddress);

  let from = event.params.from;
  if (low(from) !== low(event.params.onBehalfOf)) from = event.params.onBehalfOf;

  const value = event.params.value;
  const index = event.params.index;

  const { userReserve } = await getOrInitUserReserve(
    context,
    from,
    vToken.underlyingAssetAddress,
    event.srcAddress,
  );

  // source increments borrowedReservesCount on the *event.params.from* user
  const user = await getOrInitUser(context, event.params.from);
  if (userReserve.scaledVariableDebt === ZERO_BI && userReserve.principalStableDebt === ZERO_BI) {
    context.User.set({ ...user, borrowedReservesCount: user.borrowedReservesCount + 1 });
  }

  const calculatedAmount = rayDiv(value, index);
  const scaledVariableDebt = userReserve.scaledVariableDebt + calculatedAmount;
  const currentVariableDebt = rayMul(scaledVariableDebt, index);
  const ur: UserReserve = {
    ...userReserve,
    scaledVariableDebt,
    currentVariableDebt,
    currentTotalDebt: userReserve.currentStableDebt + currentVariableDebt,
    liquidityRate: reserve.liquidityRate,
    variableBorrowIndex: reserve.variableBorrowIndex,
    lastUpdateTimestamp: event.block.timestamp,
  };
  context.UserReserve.set(ur);

  const totalScaledVariableDebt = reserve.totalScaledVariableDebt + calculatedAmount;
  const lifetimeScaledVariableDebt = reserve.lifetimeScaledVariableDebt + calculatedAmount;
  const pr: Reserve = {
    ...reserve,
    totalScaledVariableDebt,
    totalCurrentVariableDebt: rayMul(totalScaledVariableDebt, index),
    lifetimeScaledVariableDebt,
    lifetimeCurrentVariableDebt: rayMul(lifetimeScaledVariableDebt, index),
    availableLiquidity: reserve.availableLiquidity - value,
    lifetimeBorrows: reserve.lifetimeBorrows + value,
  };
  saveReserve(context, pr, event);
  saveUserReserveVHistory(context, ur, event, index);
});

// ---- Stable debt token ----
indexer.onEvent({ contract: "StableDebtToken", event: "Mint" }, async ({ event, context }) => {
  const borrowedAmount = event.params.amount;
  const sToken = await getOrInitSToken(context, event.srcAddress);
  let from = event.params.user;
  if (low(from) !== low(event.params.onBehalfOf)) from = event.params.onBehalfOf;

  const { userReserve } = await getOrInitUserReserve(
    context,
    from,
    sToken.underlyingAssetAddress,
    event.srcAddress,
  );
  const reserve = await getOrInitReserve(context, sToken.underlyingAssetAddress, event.srcAddress);

  const user = await getOrInitUser(context, from);
  if (userReserve.scaledVariableDebt === ZERO_BI && userReserve.principalStableDebt === ZERO_BI) {
    context.User.set({ ...user, borrowedReservesCount: user.borrowedReservesCount + 1 });
  }

  const calculatedAmount = event.params.amount + event.params.balanceIncrease;
  const pr: Reserve = {
    ...reserve,
    totalPrincipalStableDebt: event.params.newTotalSupply,
    lifetimePrincipalStableDebt: reserve.lifetimePrincipalStableDebt + calculatedAmount,
    averageStableRate: event.params.avgStableRate,
    lifetimeBorrows: reserve.lifetimeBorrows + borrowedAmount,
    availableLiquidity: reserve.availableLiquidity - borrowedAmount,
    totalLiquidity: reserve.totalLiquidity + event.params.balanceIncrease,
    stableDebtLastUpdateTimestamp: event.block.timestamp,
  };
  saveReserve(context, pr, event);

  const principalStableDebt = userReserve.principalStableDebt + calculatedAmount;
  const ur: UserReserve = {
    ...userReserve,
    principalStableDebt,
    currentStableDebt: principalStableDebt,
    currentTotalDebt: principalStableDebt + userReserve.currentVariableDebt,
    oldStableBorrowRate: userReserve.stableBorrowRate,
    stableBorrowRate: event.params.newRate,
    liquidityRate: pr.liquidityRate,
    variableBorrowIndex: pr.variableBorrowIndex,
    stableBorrowLastUpdateTimestamp: event.block.timestamp,
    lastUpdateTimestamp: event.block.timestamp,
  };
  context.UserReserve.set(ur);
  saveUserReserveSHistory(context, ur, event, event.params.avgStableRate);
});

indexer.onEvent({ contract: "StableDebtToken", event: "Burn" }, async ({ event, context }) => {
  const sToken = await getOrInitSToken(context, event.srcAddress);
  const { userReserve, reserve } = await getOrInitUserReserve(
    context,
    event.params.user,
    sToken.underlyingAssetAddress,
    event.srcAddress,
  );
  const balanceIncrease = event.params.balanceIncrease;
  const amount = event.params.amount;

  const pr: Reserve = {
    ...reserve,
    totalPrincipalStableDebt: event.params.newTotalSupply,
    lifetimeRepayments: reserve.lifetimeRepayments + amount,
    averageStableRate: event.params.avgStableRate,
    stableDebtLastUpdateTimestamp: event.block.timestamp,
    availableLiquidity: reserve.availableLiquidity + amount + balanceIncrease,
    totalLiquidity: reserve.totalLiquidity + balanceIncrease,
    totalATokenSupply: reserve.totalATokenSupply + balanceIncrease,
  };
  saveReserve(context, pr, event);

  const principalStableDebt = userReserve.principalStableDebt - amount;
  const ur: UserReserve = {
    ...userReserve,
    principalStableDebt,
    currentStableDebt: principalStableDebt,
    currentTotalDebt: principalStableDebt + userReserve.currentVariableDebt,
    liquidityRate: pr.liquidityRate,
    variableBorrowIndex: pr.variableBorrowIndex,
    stableBorrowLastUpdateTimestamp: event.block.timestamp,
    lastUpdateTimestamp: event.block.timestamp,
  };
  context.UserReserve.set(ur);

  const user = await getOrInitUser(context, event.params.user);
  if (ur.scaledVariableDebt === ZERO_BI && ur.principalStableDebt === ZERO_BI) {
    context.User.set({ ...user, borrowedReservesCount: user.borrowedReservesCount - 1 });
  }
  saveUserReserveSHistory(context, ur, event, event.params.avgStableRate);
});

// ---- borrow-allowance delegation ----
indexer.onEvent(
  { contract: "StableDebtToken", event: "BorrowAllowanceDelegated" },
  async ({ event, context }) => {
    const { userReserve } = await getOrInitUserReserve(
      context,
      event.params.fromUser,
      event.params.asset,
      event.srcAddress,
    );
    const id =
      "stable" +
      low(event.params.fromUser) +
      low(event.params.toUser) +
      low(event.params.asset);
    const existing = await context.StableTokenDelegatedAllowance.get(id);
    context.StableTokenDelegatedAllowance.set({
      id,
      fromUser_id: existing?.fromUser_id ?? low(event.params.fromUser),
      toUser_id: existing?.toUser_id ?? low(event.params.toUser),
      userReserve_id: existing?.userReserve_id ?? userReserve.id,
      amountAllowed: event.params.amount,
    });
  },
);

indexer.onEvent(
  { contract: "VariableDebtToken", event: "BorrowAllowanceDelegated" },
  async ({ event, context }) => {
    const { userReserve } = await getOrInitUserReserve(
      context,
      event.params.fromUser,
      event.params.asset,
      event.srcAddress,
    );
    const id =
      "variable" +
      low(event.params.fromUser) +
      low(event.params.toUser) +
      low(event.params.asset);
    const existing = await context.VariableTokenDelegatedAllowance.get(id);
    context.VariableTokenDelegatedAllowance.set({
      id,
      fromUser_id: existing?.fromUser_id ?? low(event.params.fromUser),
      toUser_id: existing?.toUser_id ?? low(event.params.toUser),
      userReserve_id: existing?.userReserve_id ?? userReserve.id,
      amountAllowed: event.params.amount,
    });
  },
);
