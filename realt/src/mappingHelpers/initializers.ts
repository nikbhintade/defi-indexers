/**
 * Entity getOrInit helpers ported from src/helpers/initializers.ts.
 *
 * The subgraph mutates a loaded entity then `.save()`s it. In HyperIndex
 * entities are immutable objects: these helpers return a fully-initialized
 * object that the caller mutates via spread and writes back with
 * `context.<Entity>.set`. Helpers that the subgraph persisted on creation
 * (User, Referrer, Protocol) `.set` here too so later loads find them.
 *
 * UserReserve / Reserve / SubToken are NOT persisted on creation here — the
 * subgraph's getOrInit returns an un-saved object and only persists when the
 * handler calls `.save()`; we replicate by returning the fresh object and
 * letting the handler `.set` it (matching when/whether each entity appears).
 */
import type { Ctx } from "../common/types";
import type {
  AToken,
  Protocol,
  Referrer,
  Reserve,
  ReserveConfigurationHistoryItem,
  ReserveParamsHistoryItem,
  SToken,
  User,
  UserReserve,
  VToken,
} from "envio";
import { ZERO_ADDRESS, ZERO_BI, low, zeroBD } from "../common/constants";
import { getAtokenId, getReserveId, getUserReserveId } from "../common/ids";

export async function getProtocol(context: Ctx): Promise<Protocol> {
  const id = "1";
  let protocol = await context.Protocol.get(id);
  if (protocol == null) {
    protocol = { id };
    context.Protocol.set(protocol);
  }
  return protocol;
}

/** Throws like the subgraph when a contract isn't mapped to a pool. */
export async function getPoolByContract(context: Ctx, srcAddress: string): Promise<string> {
  const contractAddress = low(srcAddress);
  const mapping = await context.ContractToPoolMapping.get(contractAddress);
  if (mapping == null) {
    throw new Error(contractAddress + "is not registered in ContractToPoolMapping");
  }
  return mapping.pool_id;
}

export async function getOrInitUser(context: Ctx, address: string): Promise<User> {
  const id = low(address);
  let user = await context.User.get(id);
  if (!user) {
    user = {
      id,
      borrowedReservesCount: 0,
      unclaimedRewards: ZERO_BI,
      incentivesLastUpdated: 0,
      lifetimeRewards: ZERO_BI,
    };
    context.User.set(user);
  }
  return user;
}

export async function getOrInitReserve(
  context: Ctx,
  underlyingAsset: string,
  srcAddress: string,
): Promise<Reserve> {
  const poolId = await getPoolByContract(context, srcAddress);
  const reserveId = getReserveId(underlyingAsset, poolId);
  let reserve = await context.Reserve.get(reserveId);
  if (reserve == null) {
    reserve = {
      id: reserveId,
      underlyingAsset: low(underlyingAsset),
      pool_id: poolId,
      symbol: "",
      name: "",
      decimals: 0,
      usageAsCollateralEnabled: false,
      borrowingEnabled: false,
      stableBorrowRateEnabled: false,
      isActive: false,
      isFrozen: false,
      baseLTVasCollateral: ZERO_BI,
      reserveLiquidationThreshold: ZERO_BI,
      reserveLiquidationBonus: ZERO_BI,
      // graph-ts `new Bytes(1)` -> single zero byte
      reserveInterestRateStrategy: "0x00",
      baseVariableBorrowRate: ZERO_BI,
      optimalUtilisationRate: ZERO_BI,
      variableRateSlope1: ZERO_BI,
      variableRateSlope2: ZERO_BI,
      stableRateSlope1: ZERO_BI,
      stableRateSlope2: ZERO_BI,
      utilizationRate: zeroBD(),
      totalLiquidity: ZERO_BI,
      totalATokenSupply: ZERO_BI,
      totalLiquidityAsCollateral: ZERO_BI,
      availableLiquidity: ZERO_BI,
      liquidityRate: ZERO_BI,
      variableBorrowRate: ZERO_BI,
      stableBorrowRate: ZERO_BI,
      averageStableRate: ZERO_BI,
      liquidityIndex: ZERO_BI,
      variableBorrowIndex: ZERO_BI,
      reserveFactor: ZERO_BI,
      aToken_id: ZERO_ADDRESS,
      vToken_id: ZERO_ADDRESS,
      sToken_id: ZERO_ADDRESS,
      aEmissionPerSecond: ZERO_BI,
      vEmissionPerSecond: ZERO_BI,
      sEmissionPerSecond: ZERO_BI,
      aTokenIncentivesIndex: ZERO_BI,
      vTokenIncentivesIndex: ZERO_BI,
      sTokenIncentivesIndex: ZERO_BI,
      aIncentivesLastUpdateTimestamp: 0,
      vIncentivesLastUpdateTimestamp: 0,
      sIncentivesLastUpdateTimestamp: 0,
      totalScaledVariableDebt: ZERO_BI,
      totalCurrentVariableDebt: ZERO_BI,
      totalPrincipalStableDebt: ZERO_BI,
      totalDeposits: ZERO_BI,
      lifetimePrincipalStableDebt: ZERO_BI,
      lifetimeScaledVariableDebt: ZERO_BI,
      lifetimeCurrentVariableDebt: ZERO_BI,
      lifetimeLiquidity: ZERO_BI,
      lifetimeBorrows: ZERO_BI,
      lifetimeRepayments: ZERO_BI,
      lifetimeWithdrawals: ZERO_BI,
      lifetimeLiquidated: ZERO_BI,
      lifetimeFlashLoans: ZERO_BI,
      lifetimeFlashLoanPremium: ZERO_BI,
      stableDebtLastUpdateTimestamp: 0,
      lastUpdateTimestamp: 0,
      lifetimeReserveFactorAccrued: ZERO_BI,
      lifetimeDepositorsInterestEarned: ZERO_BI,
    };
  }
  return reserve;
}

/** initUserReserve from src/helpers/initializers.ts. Returns existing or fresh. */
function initUserReserve(
  underlyingAssetAddress: string,
  userAddress: string,
  poolId: string,
  reserveId: string,
  existing: UserReserve | undefined,
): UserReserve {
  if (existing) return existing;
  return {
    id: getUserReserveId(userAddress, underlyingAssetAddress, poolId),
    pool_id: poolId,
    usageAsCollateralEnabledOnUser: false,
    scaledATokenBalance: ZERO_BI,
    scaledVariableDebt: ZERO_BI,
    principalStableDebt: ZERO_BI,
    currentATokenBalance: ZERO_BI,
    currentVariableDebt: ZERO_BI,
    currentStableDebt: ZERO_BI,
    stableBorrowRate: ZERO_BI,
    oldStableBorrowRate: ZERO_BI,
    currentTotalDebt: ZERO_BI,
    variableBorrowIndex: ZERO_BI,
    lastUpdateTimestamp: 0,
    liquidityRate: ZERO_BI,
    stableBorrowLastUpdateTimestamp: 0,
    aTokenincentivesUserIndex: ZERO_BI,
    vTokenincentivesUserIndex: ZERO_BI,
    sTokenincentivesUserIndex: ZERO_BI,
    aIncentivesLastUpdateTimestamp: 0,
    vIncentivesLastUpdateTimestamp: 0,
    sIncentivesLastUpdateTimestamp: 0,
    user_id: low(userAddress),
    reserve_id: reserveId,
  };
}

export async function getOrInitUserReserve(
  context: Ctx,
  user: string,
  underlyingAsset: string,
  srcAddress: string,
): Promise<{ userReserve: UserReserve; reserve: Reserve }> {
  const poolId = await getPoolByContract(context, srcAddress);
  const reserve = await getOrInitReserve(context, underlyingAsset, srcAddress);
  const id = getUserReserveId(user, underlyingAsset, poolId);
  const existing = await context.UserReserve.get(id);
  // subgraph creates the User on first init
  await getOrInitUser(context, user);
  const userReserve = initUserReserve(underlyingAsset, user, poolId, reserve.id, existing);
  return { userReserve, reserve };
}

// ---- sub-tokens (a/s/v). Source seeds underlyingAssetDecimals=18 on creation. ----

export async function getOrInitAToken(context: Ctx, address: string): Promise<AToken> {
  const id = getAtokenId(address);
  let token = await context.AToken.get(id);
  if (!token) {
    token = {
      id,
      underlyingAssetAddress: "0x00", // graph-ts `new Bytes(1)`
      tokenContractImpl: ZERO_ADDRESS,
      pool_id: "",
      underlyingAssetDecimals: 18,
    };
  }
  return token;
}

export async function getOrInitSToken(context: Ctx, address: string): Promise<SToken> {
  const id = getAtokenId(address);
  let token = await context.SToken.get(id);
  if (!token) {
    token = {
      id,
      underlyingAssetAddress: "0x00",
      tokenContractImpl: ZERO_ADDRESS,
      pool_id: "",
      underlyingAssetDecimals: 18,
    };
  }
  return token;
}

export async function getOrInitVToken(context: Ctx, address: string): Promise<VToken> {
  const id = getAtokenId(address);
  let token = await context.VToken.get(id);
  if (!token) {
    token = {
      id,
      underlyingAssetAddress: "0x00",
      tokenContractImpl: ZERO_ADDRESS,
      pool_id: "",
      underlyingAssetDecimals: 18,
    };
  }
  return token;
}

export async function getOrInitReferrer(context: Ctx, id: number): Promise<Referrer> {
  const sid = id.toString();
  let referrer = await context.Referrer.get(sid);
  if (!referrer) {
    referrer = { id: sid };
    context.Referrer.set(referrer);
  }
  return referrer;
}

export async function createMapContractToPool(
  context: Ctx,
  contractAddress: string,
  pool: string,
): Promise<void> {
  const id = low(contractAddress);
  const existing = await context.ContractToPoolMapping.get(id);
  if (existing) {
    context.log.error(`contract ${id} is already registered in the protocol`);
    // subgraph throws; keep indexing instead to stay resilient to re-registration
    return;
  }
  context.ContractToPoolMapping.set({ id, pool_id: pool });
}

/** getOrInitReserveParamsHistoryItem: id = txHash ++ reserveId. */
export function initReserveParamsHistoryItem(
  itemId: string,
  reserveId: string,
): ReserveParamsHistoryItem {
  return {
    id: itemId,
    variableBorrowRate: ZERO_BI,
    variableBorrowIndex: ZERO_BI,
    utilizationRate: zeroBD(),
    stableBorrowRate: ZERO_BI,
    averageStableBorrowRate: ZERO_BI,
    liquidityIndex: ZERO_BI,
    liquidityRate: ZERO_BI,
    totalLiquidity: ZERO_BI,
    totalATokenSupply: ZERO_BI,
    availableLiquidity: ZERO_BI,
    totalLiquidityAsCollateral: ZERO_BI,
    reserve_id: reserveId,
    totalScaledVariableDebt: ZERO_BI,
    totalCurrentVariableDebt: ZERO_BI,
    totalPrincipalStableDebt: ZERO_BI,
    lifetimePrincipalStableDebt: ZERO_BI,
    lifetimeScaledVariableDebt: ZERO_BI,
    lifetimeCurrentVariableDebt: ZERO_BI,
    lifetimeLiquidity: ZERO_BI,
    lifetimeBorrows: ZERO_BI,
    lifetimeRepayments: ZERO_BI,
    lifetimeWithdrawals: ZERO_BI,
    lifetimeLiquidated: ZERO_BI,
    lifetimeFlashLoans: ZERO_BI,
    lifetimeFlashLoanPremium: ZERO_BI,
    lifetimeReserveFactorAccrued: ZERO_BI,
    lifetimeDepositorsInterestEarned: ZERO_BI,
    timestamp: 0,
  };
}

/** getOrInitReserveConfigurationHistoryItem: id = txHash. */
export function initReserveConfigurationHistoryItem(
  id: string,
  reserveId: string,
): ReserveConfigurationHistoryItem {
  return {
    id,
    usageAsCollateralEnabled: false,
    borrowingEnabled: false,
    stableBorrowRateEnabled: false,
    isActive: false,
    isFrozen: false,
    reserveInterestRateStrategy: "0x00",
    baseLTVasCollateral: ZERO_BI,
    reserveLiquidationThreshold: ZERO_BI,
    reserveLiquidationBonus: ZERO_BI,
    reserve_id: reserveId,
    timestamp: 0,
  };
}
