/**
 * Port of src/mapping/tokenization/tokenization-v3.ts + initialization-v3.ts.
 *
 * aToken/variable/stable debt token Mint/Burn/BalanceTransfer drive
 * reserve/userReserve accounting, rates/indexes, and history entities.
 */
import { indexer, BigDecimal } from "envio";
import type { Reserve, UserReserve } from "envio";
import { ZERO_BI, TREASURY_ADDRESSES, low } from "../common/constants";
import { rayDiv, rayMul } from "../common/math";
import { getHistoryEntityId } from "../common/ids";
import type { Ctx, Ev } from "../common/types";
import {
  calculateUtilizationRate,
  getOrInitReserve,
  getOrInitSubToken,
  getOrInitUser,
  getOrInitUserReserve,
  getPoolByContract,
  getPriceOracleAsset,
} from "../mappingHelpers/initializers";
import { tryReserveDataAccruedToTreasury } from "../effects/contracts";

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
    id: getHistoryEntityId(event),
    principalStableDebt: userReserve.principalStableDebt,
    currentStableDebt: userReserve.currentStableDebt,
    userReserve_id: userReserve.id,
    avgStableBorrowRate: rate,
    timestamp: event.block.timestamp,
  });
}

/** saveReserve: compute utilization, persist, append ReserveParamsHistoryItem. */
async function saveReserve(context: Ctx, reserve: Reserve, event: Ev): Promise<void> {
  const utilizationRate = calculateUtilizationRate(reserve);
  const updated: Reserve = { ...reserve, utilizationRate };
  context.Reserve.set(updated);

  const priceOracleAsset = await getPriceOracleAsset(context, updated.price_id);
  context.ReserveParamsHistoryItem.set({
    id: getHistoryEntityId(event),
    reserve_id: updated.id,
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
    lifetimeFlashLoanLPPremium: updated.lifetimeFlashLoanLPPremium,
    lifetimeFlashLoanProtocolPremium: updated.lifetimeFlashLoanProtocolPremium,
    lifetimeFlashLoans: updated.lifetimeFlashLoans,
    lifetimeReserveFactorAccrued: updated.lifetimeReserveFactorAccrued,
    lifetimeSuppliersInterestEarned: updated.lifetimeSuppliersInterestEarned,
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
    accruedToTreasury: updated.accruedToTreasury,
    priceInEth: priceOracleAsset.priceInEth,
    // subgraph quirk: priceInUsd = priceInEth.toBigDecimal() (no scaling)
    priceInUsd: new BigDecimal(priceOracleAsset.priceInEth.toString()),
    timestamp: event.block.timestamp,
    lifetimePortalLPFee: updated.lifetimePortalLPFee,
    lifetimePortalProtocolFee: updated.lifetimePortalProtocolFee,
  });
}

// ============ aToken ============

async function tokenBurn(
  context: Ctx,
  event: Ev,
  from: string,
  value: bigint,
  balanceIncrease: bigint,
  index: bigint,
): Promise<void> {
  const aToken = await getOrInitSubToken(context, event.srcAddress);
  const init = await getOrInitUserReserve(
    context,
    from,
    aToken.underlyingAssetAddress,
    event.srcAddress,
  );
  let userReserve = init.userReserve;
  let poolReserve = init.reserve;

  const userBalanceChange = value + balanceIncrease;
  const calculatedAmount = rayDiv(userBalanceChange, index);

  const scaled = userReserve.scaledATokenBalance - calculatedAmount;
  userReserve = {
    ...userReserve,
    scaledATokenBalance: scaled,
    currentATokenBalance: rayMul(scaled, index),
    variableBorrowIndex: poolReserve.variableBorrowIndex,
    liquidityRate: poolReserve.liquidityRate,
  };

  poolReserve = {
    ...poolReserve,
    totalSupplies: poolReserve.totalSupplies - userBalanceChange,
    availableLiquidity: poolReserve.availableLiquidity - userBalanceChange,
    totalATokenSupply: poolReserve.totalATokenSupply - userBalanceChange,
    totalLiquidity: poolReserve.totalLiquidity - userBalanceChange,
    lifetimeWithdrawals: poolReserve.lifetimeWithdrawals + userBalanceChange,
  };
  if (userReserve.usageAsCollateralEnabledOnUser) {
    poolReserve = {
      ...poolReserve,
      totalLiquidityAsCollateral: poolReserve.totalLiquidityAsCollateral - userBalanceChange,
    };
  }
  await saveReserve(context, poolReserve, event);

  userReserve = { ...userReserve, lastUpdateTimestamp: event.block.timestamp };
  context.UserReserve.set(userReserve);
  saveUserReserveAHistory(context, userReserve, event, index);
}

async function tokenMint(
  context: Ctx,
  event: Ev,
  onBehalf: string,
  value: bigint,
  balanceIncrease: bigint,
  index: bigint,
): Promise<void> {
  const aToken = await getOrInitSubToken(context, event.srcAddress);
  let poolReserve = await getOrInitReserve(context, aToken.underlyingAssetAddress, event.srcAddress);

  const userBalanceChange = value - balanceIncrease;
  poolReserve = {
    ...poolReserve,
    totalATokenSupply: poolReserve.totalATokenSupply + userBalanceChange,
  };

  const poolId = await getPoolByContract(context, event.srcAddress);
  const pool = await context.Pool.get(poolId);
  if (pool && pool.pool) {
    const accrued = await tryReserveDataAccruedToTreasury(
      context.effect,
      pool.pool,
      aToken.underlyingAssetAddress,
      event.block.number,
    );
    if (accrued !== null) {
      poolReserve = { ...poolReserve, accruedToTreasury: accrued };
    } else {
      context.log.error(
        `error reading reserveData. Pool: ${pool.pool}, Underlying: ${aToken.underlyingAssetAddress}`,
      );
    }
  }

  if (!TREASURY_ADDRESSES.includes(low(onBehalf))) {
    const initur = await getOrInitUserReserve(
      context,
      onBehalf,
      aToken.underlyingAssetAddress,
      event.srcAddress,
    );
    let userReserve = initur.userReserve;
    const calculatedAmount = rayDiv(userBalanceChange, index);
    const scaled = userReserve.scaledATokenBalance + calculatedAmount;
    userReserve = {
      ...userReserve,
      scaledATokenBalance: scaled,
      currentATokenBalance: rayMul(scaled, index),
      liquidityRate: poolReserve.liquidityRate,
      variableBorrowIndex: poolReserve.variableBorrowIndex,
      lastUpdateTimestamp: event.block.timestamp,
    };
    context.UserReserve.set(userReserve);

    poolReserve = {
      ...poolReserve,
      totalSupplies: poolReserve.totalSupplies + userBalanceChange,
      availableLiquidity: poolReserve.availableLiquidity + userBalanceChange,
      totalLiquidity: poolReserve.totalLiquidity + userBalanceChange,
      lifetimeLiquidity: poolReserve.lifetimeLiquidity + userBalanceChange,
    };
    if (userReserve.usageAsCollateralEnabledOnUser) {
      poolReserve = {
        ...poolReserve,
        totalLiquidityAsCollateral: poolReserve.totalLiquidityAsCollateral + userBalanceChange,
      };
    }
    await saveReserve(context, poolReserve, event);
    saveUserReserveAHistory(context, userReserve, event, index);
  } else {
    poolReserve = {
      ...poolReserve,
      lifetimeReserveFactorAccrued: poolReserve.lifetimeReserveFactorAccrued + userBalanceChange,
    };
    await saveReserve(context, poolReserve, event);
  }
}

indexer.onEvent({ contract: "AToken", event: "Burn" }, async ({ event, context }) => {
  await tokenBurn(
    context,
    event,
    event.params.from,
    event.params.value,
    event.params.balanceIncrease,
    event.params.index,
  );
});

indexer.onEvent({ contract: "AToken", event: "Mint" }, async ({ event, context }) => {
  await tokenMint(
    context,
    event,
    event.params.onBehalfOf,
    event.params.value,
    event.params.balanceIncrease,
    event.params.index,
  );
});

indexer.onEvent({ contract: "AToken", event: "BalanceTransfer" }, async ({ event, context }) => {
  // On Ethereum mainnet the v3.0.1 update predates the start block, so
  // BalanceTransfer.value is always already scaled by index (rayMul).
  const balanceTransferValue = rayMul(event.params.value, event.params.index);

  await tokenBurn(context, event, event.params.from, balanceTransferValue, ZERO_BI, event.params.index);
  await tokenMint(context, event, event.params.to, balanceTransferValue, ZERO_BI, event.params.index);

  const aToken = await getOrInitSubToken(context, event.srcAddress);
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
  let reserve = await getOrInitReserve(context, aToken.underlyingAssetAddress, event.srcAddress);
  if (
    fromUR.userReserve.usageAsCollateralEnabledOnUser &&
    !toUR.userReserve.usageAsCollateralEnabledOnUser
  ) {
    reserve = {
      ...reserve,
      totalLiquidityAsCollateral: reserve.totalLiquidityAsCollateral - event.params.value,
    };
    await saveReserve(context, reserve, event);
  } else if (
    !fromUR.userReserve.usageAsCollateralEnabledOnUser &&
    toUR.userReserve.usageAsCollateralEnabledOnUser
  ) {
    reserve = {
      ...reserve,
      totalLiquidityAsCollateral: reserve.totalLiquidityAsCollateral + event.params.value,
    };
    await saveReserve(context, reserve, event);
  }
});

// ============ variable debt token ============

indexer.onEvent({ contract: "VariableDebtToken", event: "Burn" }, async ({ event, context }) => {
  const vToken = await getOrInitSubToken(context, event.srcAddress);
  const value = event.params.value;
  const balanceIncrease = event.params.balanceIncrease;
  const userBalanceChange = value + balanceIncrease;
  const index = event.params.index;
  const init = await getOrInitUserReserve(
    context,
    event.params.from,
    vToken.underlyingAssetAddress,
    event.srcAddress,
  );
  let userReserve = init.userReserve;
  let poolReserve = init.reserve;

  const calculatedAmount = rayDiv(userBalanceChange, index);
  const scaledVariableDebt = userReserve.scaledVariableDebt - calculatedAmount;
  const currentVariableDebt = rayMul(scaledVariableDebt, index);
  userReserve = {
    ...userReserve,
    scaledVariableDebt,
    currentVariableDebt,
    currentTotalDebt: userReserve.currentStableDebt + currentVariableDebt,
  };

  const totalScaledVariableDebt = poolReserve.totalScaledVariableDebt - calculatedAmount;
  poolReserve = {
    ...poolReserve,
    totalScaledVariableDebt,
    totalCurrentVariableDebt: rayMul(totalScaledVariableDebt, index),
    availableLiquidity: poolReserve.availableLiquidity + userBalanceChange,
    lifetimeRepayments: poolReserve.lifetimeRepayments + userBalanceChange,
  };

  userReserve = {
    ...userReserve,
    liquidityRate: poolReserve.liquidityRate,
    variableBorrowIndex: poolReserve.variableBorrowIndex,
    lastUpdateTimestamp: event.block.timestamp,
  };
  context.UserReserve.set(userReserve);
  await saveReserve(context, poolReserve, event);

  const user = await getOrInitUser(context, event.params.from);
  if (userReserve.scaledVariableDebt === ZERO_BI && userReserve.principalStableDebt === ZERO_BI) {
    context.User.set({ ...user, borrowedReservesCount: user.borrowedReservesCount - 1 });
  }
  saveUserReserveVHistory(context, userReserve, event, index);
});

indexer.onEvent({ contract: "VariableDebtToken", event: "Mint" }, async ({ event, context }) => {
  const vToken = await getOrInitSubToken(context, event.srcAddress);
  const from = event.params.onBehalfOf;
  const value = event.params.value;
  const balanceIncrease = event.params.balanceIncrease;
  const userBalanceChange = value - balanceIncrease;
  const index = event.params.index;
  const init = await getOrInitUserReserve(context, from, vToken.underlyingAssetAddress, event.srcAddress);
  let userReserve = init.userReserve;
  let poolReserve = init.reserve;

  let user = await getOrInitUser(context, from);
  if (userReserve.scaledVariableDebt === ZERO_BI && userReserve.principalStableDebt === ZERO_BI) {
    user = { ...user, borrowedReservesCount: user.borrowedReservesCount + 1 };
    context.User.set(user);
  }

  const calculatedAmount = rayDiv(userBalanceChange, index);
  const scaledVariableDebt = userReserve.scaledVariableDebt + calculatedAmount;
  const currentVariableDebt = rayMul(scaledVariableDebt, index);
  userReserve = {
    ...userReserve,
    scaledVariableDebt,
    currentVariableDebt,
    currentTotalDebt: userReserve.currentStableDebt + currentVariableDebt,
    liquidityRate: poolReserve.liquidityRate,
    variableBorrowIndex: poolReserve.variableBorrowIndex,
    lastUpdateTimestamp: event.block.timestamp,
  };
  context.UserReserve.set(userReserve);

  const totalScaledVariableDebt = poolReserve.totalScaledVariableDebt + calculatedAmount;
  const lifetimeScaledVariableDebt = poolReserve.lifetimeScaledVariableDebt + calculatedAmount;
  poolReserve = {
    ...poolReserve,
    totalScaledVariableDebt,
    totalCurrentVariableDebt: rayMul(totalScaledVariableDebt, index),
    lifetimeScaledVariableDebt,
    lifetimeCurrentVariableDebt: rayMul(lifetimeScaledVariableDebt, index),
    availableLiquidity: poolReserve.availableLiquidity - userBalanceChange,
    lifetimeBorrows: poolReserve.lifetimeBorrows + userBalanceChange,
  };
  await saveReserve(context, poolReserve, event);
  saveUserReserveVHistory(context, userReserve, event, index);
});

// ============ stable debt token ============

indexer.onEvent({ contract: "StableDebtToken", event: "Mint" }, async ({ event, context }) => {
  const balanceChangeIncludingInterest = event.params.amount;
  const borrowedAmount = event.params.amount - event.params.balanceIncrease;
  const sToken = await getOrInitSubToken(context, event.srcAddress);
  let from = event.params.user;
  if (low(from) !== low(event.params.onBehalfOf)) from = event.params.onBehalfOf;

  const init = await getOrInitUserReserve(context, from, sToken.underlyingAssetAddress, event.srcAddress);
  let userReserve = init.userReserve;
  let poolReserve = init.reserve;

  let user = await getOrInitUser(context, from);
  if (userReserve.scaledVariableDebt === ZERO_BI && userReserve.principalStableDebt === ZERO_BI) {
    user = { ...user, borrowedReservesCount: user.borrowedReservesCount + 1 };
    context.User.set(user);
  }

  poolReserve = {
    ...poolReserve,
    totalPrincipalStableDebt: event.params.newTotalSupply,
    lifetimePrincipalStableDebt:
      poolReserve.lifetimePrincipalStableDebt + balanceChangeIncludingInterest,
    averageStableRate: event.params.avgStableRate,
    lifetimeBorrows: poolReserve.lifetimeBorrows + borrowedAmount,
    availableLiquidity: poolReserve.availableLiquidity - borrowedAmount,
    totalLiquidity: poolReserve.totalLiquidity + event.params.balanceIncrease,
    stableDebtLastUpdateTimestamp: event.block.timestamp,
  };
  await saveReserve(context, poolReserve, event);

  const principalStableDebt = userReserve.principalStableDebt + balanceChangeIncludingInterest;
  userReserve = {
    ...userReserve,
    principalStableDebt,
    currentStableDebt: principalStableDebt,
    currentTotalDebt: principalStableDebt + userReserve.currentVariableDebt,
    oldStableBorrowRate: userReserve.stableBorrowRate,
    stableBorrowRate: event.params.newRate,
    liquidityRate: poolReserve.liquidityRate,
    variableBorrowIndex: poolReserve.variableBorrowIndex,
    stableBorrowLastUpdateTimestamp: event.block.timestamp,
    lastUpdateTimestamp: event.block.timestamp,
  };
  context.UserReserve.set(userReserve);
  saveUserReserveSHistory(context, userReserve, event, event.params.avgStableRate);
});

indexer.onEvent({ contract: "StableDebtToken", event: "Burn" }, async ({ event, context }) => {
  const sToken = await getOrInitSubToken(context, event.srcAddress);
  const init = await getOrInitUserReserve(
    context,
    event.params.from,
    sToken.underlyingAssetAddress,
    event.srcAddress,
  );
  let userReserve = init.userReserve;
  let poolReserve = init.reserve;
  const balanceIncrease = event.params.balanceIncrease;
  const amount = event.params.amount;

  poolReserve = {
    ...poolReserve,
    totalPrincipalStableDebt: event.params.newTotalSupply,
    lifetimeRepayments: poolReserve.lifetimeRepayments + amount,
    averageStableRate: event.params.avgStableRate,
    stableDebtLastUpdateTimestamp: event.block.timestamp,
    availableLiquidity: poolReserve.availableLiquidity + amount + balanceIncrease,
    totalLiquidity: poolReserve.totalLiquidity + balanceIncrease,
    totalATokenSupply: poolReserve.totalATokenSupply + balanceIncrease,
  };
  await saveReserve(context, poolReserve, event);

  const principalStableDebt = userReserve.principalStableDebt - amount;
  userReserve = {
    ...userReserve,
    principalStableDebt,
    currentStableDebt: principalStableDebt,
    currentTotalDebt: principalStableDebt + userReserve.currentVariableDebt,
    liquidityRate: poolReserve.liquidityRate,
    variableBorrowIndex: poolReserve.variableBorrowIndex,
    stableBorrowLastUpdateTimestamp: event.block.timestamp,
    lastUpdateTimestamp: event.block.timestamp,
  };
  context.UserReserve.set(userReserve);

  const user = await getOrInitUser(context, event.params.from);
  if (userReserve.scaledVariableDebt === ZERO_BI && userReserve.principalStableDebt === ZERO_BI) {
    context.User.set({ ...user, borrowedReservesCount: user.borrowedReservesCount - 1 });
  }
  saveUserReserveSHistory(context, userReserve, event, event.params.avgStableRate);
});

// ============ delegated allowances ============

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
      "stable" + low(event.params.fromUser) + low(event.params.toUser) + low(event.params.asset);
    context.StableTokenDelegatedAllowance.set({
      id,
      fromUser_id: low(event.params.fromUser),
      toUser_id: low(event.params.toUser),
      userReserve_id: userReserve.id,
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
      "variable" + low(event.params.fromUser) + low(event.params.toUser) + low(event.params.asset);
    context.VariableTokenDelegatedAllowance.set({
      id,
      fromUser_id: low(event.params.fromUser),
      toUser_id: low(event.params.toUser),
      userReserve_id: userReserve.id,
      amountAllowed: event.params.amount,
    });
  },
);

// ============ token Initialized (MapAssetPool) ============

async function initializeToken(
  context: Ctx,
  asset: string,
  underlyingAsset: string,
  pool: string,
): Promise<void> {
  const mapping = await context.ContractToPoolMapping.get(low(pool));
  if (mapping != null) {
    context.MapAssetPool.set({
      id: low(asset),
      pool: mapping.pool_id,
      underlyingAsset: low(underlyingAsset),
    });
  }
}

indexer.onEvent({ contract: "AToken", event: "Initialized" }, async ({ event, context }) => {
  await initializeToken(context, event.srcAddress, event.params.underlyingAsset, event.params.pool);
});
indexer.onEvent({ contract: "StableDebtToken", event: "Initialized" }, async ({ event, context }) => {
  await initializeToken(context, event.srcAddress, event.params.underlyingAsset, event.params.pool);
});
indexer.onEvent({ contract: "VariableDebtToken", event: "Initialized" }, async ({ event, context }) => {
  await initializeToken(context, event.srcAddress, event.params.underlyingAsset, event.params.pool);
});
