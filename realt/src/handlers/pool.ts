/**
 * Port of src/mapping/lending-pool/lending-pool.ts.
 */
import { indexer } from "envio";
import { BORROW_MODE_STABLE, BORROW_MODE_VARIABLE, getBorrowRateMode, low } from "../common/constants";
import { calculateGrowth } from "../common/math";
import { getHistoryEntityId } from "../common/ids";
import {
  getOrInitReferrer,
  getOrInitReserve,
  getOrInitUser,
  getOrInitUserReserve,
  getPoolByContract,
} from "../mappingHelpers/initializers";

indexer.onEvent({ contract: "LendingPool", event: "Deposit" }, async ({ event, context }) => {
  const caller = event.params.user;
  const user = event.params.onBehalfOf;
  const { userReserve, reserve } = await getOrInitUserReserve(
    context,
    user,
    event.params.reserve,
    event.srcAddress,
  );
  context.Deposit.set({
    id: getHistoryEntityId(event),
    pool_id: reserve.pool_id,
    user_id: userReserve.user_id,
    caller_id: (await getOrInitUser(context, caller)).id,
    userReserve_id: userReserve.id,
    reserve_id: reserve.id,
    amount: event.params.amount,
    timestamp: event.block.timestamp,
    referrer_id: event.params.referral
      ? (await getOrInitReferrer(context, Number(event.params.referral))).id
      : undefined,
  });
});

indexer.onEvent({ contract: "LendingPool", event: "Withdraw" }, async ({ event, context }) => {
  const toUser = await getOrInitUser(context, event.params.to);
  const { userReserve, reserve } = await getOrInitUserReserve(
    context,
    event.params.user,
    event.params.reserve,
    event.srcAddress,
  );
  context.RedeemUnderlying.set({
    id: getHistoryEntityId(event),
    pool_id: reserve.pool_id,
    user_id: userReserve.user_id,
    to_id: toUser.id,
    userReserve_id: userReserve.id,
    reserve_id: reserve.id,
    amount: event.params.amount,
    timestamp: event.block.timestamp,
  });
});

indexer.onEvent({ contract: "LendingPool", event: "Borrow" }, async ({ event, context }) => {
  const caller = event.params.user;
  const user = event.params.onBehalfOf;
  const { userReserve, reserve } = await getOrInitUserReserve(
    context,
    user,
    event.params.reserve,
    event.srcAddress,
  );
  context.Borrow.set({
    id: getHistoryEntityId(event),
    pool_id: reserve.pool_id,
    user_id: userReserve.user_id,
    caller_id: (await getOrInitUser(context, caller)).id,
    userReserve_id: userReserve.id,
    reserve_id: reserve.id,
    amount: event.params.amount,
    stableTokenDebt: userReserve.principalStableDebt,
    variableTokenDebt: userReserve.scaledVariableDebt,
    borrowRate: event.params.borrowRate,
    borrowRateMode: getBorrowRateMode(event.params.borrowRateMode),
    timestamp: event.block.timestamp,
    referrer_id: event.params.referral
      ? (await getOrInitReferrer(context, Number(event.params.referral))).id
      : undefined,
  });
});

indexer.onEvent({ contract: "LendingPool", event: "Paused" }, async ({ event, context }) => {
  const poolId = await getPoolByContract(context, event.srcAddress);
  const pool = await context.Pool.get(poolId);
  if (pool) context.Pool.set({ ...pool, paused: true });
});

indexer.onEvent({ contract: "LendingPool", event: "Unpaused" }, async ({ event, context }) => {
  const poolId = await getPoolByContract(context, event.srcAddress);
  const pool = await context.Pool.get(poolId);
  if (pool) context.Pool.set({ ...pool, paused: false });
});

indexer.onEvent({ contract: "LendingPool", event: "Swap" }, async ({ event, context }) => {
  const { userReserve, reserve } = await getOrInitUserReserve(
    context,
    event.params.user,
    event.params.reserve,
    event.srcAddress,
  );
  const from = getBorrowRateMode(event.params.rateMode);
  context.Swap.set({
    id: getHistoryEntityId(event),
    pool_id: reserve.pool_id,
    borrowRateModeFrom: from,
    borrowRateModeTo: from === BORROW_MODE_STABLE ? BORROW_MODE_VARIABLE : BORROW_MODE_STABLE,
    variableBorrowRate: reserve.variableBorrowRate,
    stableBorrowRate: reserve.stableBorrowRate,
    user_id: userReserve.user_id,
    userReserve_id: userReserve.id,
    reserve_id: reserve.id,
    timestamp: event.block.timestamp,
  });
});

indexer.onEvent(
  { contract: "LendingPool", event: "RebalanceStableBorrowRate" },
  async ({ event, context }) => {
    const { userReserve, reserve } = await getOrInitUserReserve(
      context,
      event.params.user,
      event.params.reserve,
      event.srcAddress,
    );
    context.RebalanceStableBorrowRate.set({
      id: getHistoryEntityId(event),
      userReserve_id: userReserve.id,
      borrowRateFrom: userReserve.oldStableBorrowRate,
      borrowRateTo: userReserve.stableBorrowRate,
      pool_id: reserve.pool_id,
      reserve_id: reserve.id,
      user_id: low(event.params.user),
      timestamp: event.block.timestamp,
    });
  },
);

indexer.onEvent({ contract: "LendingPool", event: "Repay" }, async ({ event, context }) => {
  const repayer = event.params.repayer;
  const { userReserve, reserve } = await getOrInitUserReserve(
    context,
    event.params.user,
    event.params.reserve,
    event.srcAddress,
  );
  // source re-saves the reserve unchanged
  context.Reserve.set({ ...reserve });
  context.Repay.set({
    id: getHistoryEntityId(event),
    pool_id: reserve.pool_id,
    user_id: userReserve.user_id,
    repayer_id: (await getOrInitUser(context, repayer)).id,
    userReserve_id: userReserve.id,
    reserve_id: reserve.id,
    amount: event.params.amount,
    timestamp: event.block.timestamp,
  });
});

indexer.onEvent(
  { contract: "LendingPool", event: "LiquidationCall" },
  async ({ event, context }) => {
    const user = await getOrInitUser(context, event.params.user);

    const collateral = await getOrInitUserReserve(
      context,
      event.params.user,
      event.params.collateralAsset,
      event.srcAddress,
    );
    const liquidatedCollateralAmount = event.params.liquidatedCollateralAmount;
    const collateralPoolReserve = {
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
    });
  },
);

indexer.onEvent({ contract: "LendingPool", event: "FlashLoan" }, async ({ event, context }) => {
  const initiator = await getOrInitUser(context, event.params.initiator);
  const reserve = await getOrInitReserve(context, event.params.asset, event.srcAddress);
  const premium = event.params.premium;

  const updated = {
    ...reserve,
    availableLiquidity: reserve.availableLiquidity + premium,
    lifetimeFlashLoans: reserve.lifetimeFlashLoans + event.params.amount,
    lifetimeFlashLoanPremium: reserve.lifetimeFlashLoanPremium + premium,
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
    amount: event.params.amount,
    timestamp: event.block.timestamp,
  });
});

indexer.onEvent(
  { contract: "LendingPool", event: "ReserveUsedAsCollateralEnabled" },
  async ({ event, context }) => {
    const { userReserve, reserve } = await getOrInitUserReserve(
      context,
      event.params.user,
      event.params.reserve,
      event.srcAddress,
    );
    const timestamp = event.block.timestamp;
    context.UsageAsCollateral.set({
      id: getHistoryEntityId(event),
      pool_id: reserve.pool_id,
      fromState: userReserve.usageAsCollateralEnabledOnUser,
      toState: true,
      user_id: userReserve.user_id,
      userReserve_id: userReserve.id,
      reserve_id: reserve.id,
      timestamp,
    });
    context.UserReserve.set({
      ...userReserve,
      lastUpdateTimestamp: timestamp,
      usageAsCollateralEnabledOnUser: true,
    });
  },
);

indexer.onEvent(
  { contract: "LendingPool", event: "ReserveUsedAsCollateralDisabled" },
  async ({ event, context }) => {
    const { userReserve, reserve } = await getOrInitUserReserve(
      context,
      event.params.user,
      event.params.reserve,
      event.srcAddress,
    );
    const timestamp = event.block.timestamp;
    context.UsageAsCollateral.set({
      id: getHistoryEntityId(event),
      pool_id: reserve.pool_id,
      fromState: userReserve.usageAsCollateralEnabledOnUser,
      toState: false,
      user_id: userReserve.user_id,
      userReserve_id: userReserve.id,
      reserve_id: reserve.id,
      timestamp,
    });
    context.UserReserve.set({
      ...userReserve,
      lastUpdateTimestamp: timestamp,
      usageAsCollateralEnabledOnUser: false,
    });
  },
);

indexer.onEvent(
  { contract: "LendingPool", event: "ReserveDataUpdated" },
  async ({ event, context }) => {
    const reserve = await getOrInitReserve(context, event.params.reserve, event.srcAddress);
    let r = {
      ...reserve,
      stableBorrowRate: event.params.stableBorrowRate,
      variableBorrowRate: event.params.variableBorrowRate,
      variableBorrowIndex: event.params.variableBorrowIndex,
    };
    const timestamp = BigInt(event.block.timestamp);
    const prevTimestamp = BigInt(reserve.lastUpdateTimestamp);
    if (timestamp > prevTimestamp) {
      const growth = calculateGrowth(
        r.totalATokenSupply,
        r.liquidityRate,
        prevTimestamp,
        timestamp,
      );
      r = {
        ...r,
        totalATokenSupply: r.totalATokenSupply + growth,
        lifetimeDepositorsInterestEarned: r.lifetimeDepositorsInterestEarned + growth,
      };
    }
    r = {
      ...r,
      liquidityRate: event.params.liquidityRate,
      liquidityIndex: event.params.liquidityIndex,
      lastUpdateTimestamp: event.block.timestamp,
    };
    context.Reserve.set(r);
  },
);
