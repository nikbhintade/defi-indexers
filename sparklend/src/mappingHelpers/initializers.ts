/**
 * Entity getOrInit helpers ported from src/helpers/v3/initializers.ts.
 *
 * The subgraph mutates a loaded entity then `.save()`s it. In HyperIndex
 * entities are immutable objects: these helpers return a fully-initialized
 * object that the caller mutates via spread and writes back with
 * `context.<Entity>.set`. Helpers that the subgraph persisted on creation
 * (User, Referrer, Protocol, PriceOracle, PriceOracleAsset) `.set` here too so
 * later loads find them.
 */
import { BigDecimal } from "envio";
import type { Ctx } from "../common/types";
import type {
  ContractToPoolMapping,
  PriceOracle,
  PriceOracleAsset,
  Protocol,
  Referrer,
  Reserve,
  SubToken,
  User,
  UserReserve,
} from "envio";
import { ZERO_ADDRESS, ZERO_BI, low, zeroBD } from "../common/constants";
import { getReserveId, getUserReserveId } from "../common/ids";

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
export async function getPoolByContract(
  context: Ctx,
  srcAddress: string,
): Promise<string> {
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
      rewardsLastUpdated: 0,
      lifetimeRewards: ZERO_BI,
      eModeCategoryId_id: undefined,
    };
    context.User.set(user);
  }
  return user;
}

export async function getOrInitPriceOracle(context: Ctx): Promise<PriceOracle> {
  let priceOracle = await context.PriceOracle.get("1");
  if (!priceOracle) {
    priceOracle = {
      id: "1",
      proxyPriceProvider: ZERO_ADDRESS,
      usdPriceEth: ZERO_BI,
      usdPriceEthMainSource: ZERO_ADDRESS,
      usdPriceEthFallbackRequired: false,
      fallbackPriceOracle: ZERO_ADDRESS,
      tokensWithFallback: [],
      lastUpdateTimestamp: 0,
      usdDependentAssets: [],
      version: 1,
      baseCurrency: ZERO_ADDRESS,
      baseCurrencyUnit: ZERO_BI,
    };
    context.PriceOracle.set(priceOracle);
  }
  return priceOracle;
}

export async function getPriceOracleAsset(
  context: Ctx,
  id: string,
  save = true,
): Promise<PriceOracleAsset> {
  let asset = await context.PriceOracleAsset.get(id);
  if (!asset && save) {
    await getOrInitPriceOracle(context);
    asset = {
      id,
      oracle_id: "1",
      priceSource: ZERO_ADDRESS,
      dependentAssets: [],
      type: "Simple",
      platform: "Simple",
      priceInEth: ZERO_BI,
      isFallbackRequired: false,
      lastUpdateTimestamp: 0,
      fromChainlinkSourcesRegistry: false,
    };
    context.PriceOracleAsset.set(asset);
  }
  // graph-ts returns a fresh default object even when save=false
  return (
    asset ?? {
      id,
      oracle_id: "1",
      priceSource: ZERO_ADDRESS,
      dependentAssets: [],
      type: "Simple",
      platform: "Simple",
      priceInEth: ZERO_BI,
      isFallbackRequired: false,
      lastUpdateTimestamp: 0,
      fromChainlinkSourcesRegistry: false,
    }
  );
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
    const price = await getPriceOracleAsset(context, low(underlyingAsset));
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
      totalScaledVariableDebt: ZERO_BI,
      totalCurrentVariableDebt: ZERO_BI,
      totalPrincipalStableDebt: ZERO_BI,
      totalSupplies: ZERO_BI,
      accruedToTreasury: ZERO_BI,
      isPaused: false,
      isDropped: false,
      siloedBorrowing: false,
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
      lifetimeFlashLoanLPPremium: ZERO_BI,
      lifetimeFlashLoanProtocolPremium: ZERO_BI,
      stableDebtLastUpdateTimestamp: 0,
      lastUpdateTimestamp: 0,
      lifetimeReserveFactorAccrued: ZERO_BI,
      lifetimeSuppliersInterestEarned: ZERO_BI,
      lifetimePortalLPFee: ZERO_BI,
      lifetimePortalProtocolFee: ZERO_BI,
      price_id: price.id,
      borrowCap: undefined,
      supplyCap: undefined,
      debtCeiling: undefined,
      unbackedMintCap: undefined,
      liquidationProtocolFee: undefined,
      borrowableInIsolation: undefined,
      eMode_id: undefined,
    };
  }
  return reserve;
}

export function initUserReserve(
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

export async function getOrInitSubToken(
  context: Ctx,
  subTokenAddress: string,
): Promise<SubToken> {
  const id = low(subTokenAddress);
  let sToken = await context.SubToken.get(id);
  if (!sToken) {
    sToken = {
      id,
      // graph-ts `new Bytes(1)`
      underlyingAssetAddress: "0x00",
      pool_id: "",
      underlyingAssetDecimals: 18,
      tokenContractImpl: undefined,
    };
  }
  return sToken;
}

export async function getOrInitReferrer(
  context: Ctx,
  id: number,
): Promise<Referrer> {
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
  const mapping: ContractToPoolMapping = { id, pool_id: pool };
  context.ContractToPoolMapping.set(mapping);
}

/** calculateUtilizationRate from src/helpers/reserve-logic.ts (truncate to 8 dp). */
export function calculateUtilizationRate(reserve: Reserve): BigDecimal {
  if (reserve.totalLiquidity === ZERO_BI) {
    return zeroBD();
  }
  const avail = new BigDecimal(reserve.availableLiquidity.toString());
  const total = new BigDecimal(reserve.totalLiquidity.toString());
  return new BigDecimal(1).minus(avail.div(total)).decimalPlaces(8, BigDecimal.ROUND_DOWN);
}
