/**
 * Port of src/mappingHelpers/market.ts.
 */
import type { Market, MarketAccounting, MarketConfiguration, MarketRewardConfiguration } from "envio";
import type { Ctx, Ev, Mutable } from "../common/types";
import {
  BASE_INDEX_SCALE,
  COMET_FACTOR_SCALE,
  DAYS_PER_YEAR,
  REWARD_FACTOR_SCALE,
  SECONDS_PER_DAY,
  SECONDS_PER_HOUR,
  SECONDS_PER_WEEK,
  SECONDS_PER_YEAR,
  ZERO_ADDRESS,
  ZERO_BD,
  ZERO_BI,
} from "../common/constants";
import { bigIntBytes, hexConcat, utf8Hex } from "../common/graphBytes";
import { getCometRewardAddress, getConfiguratorProxyAddress } from "../common/networkSpecific";
import { bigDecimalSafeDiv, computeTokenValueUsd, formatUnits, getRewardConfigData, toBD } from "../common/utils";
import {
  cometAddress,
  cometGetAssetInfo,
  cometGetBorrowRate,
  cometGetReserves,
  cometGetSupplyRate,
  cometGetUtilization,
  cometName,
  cometNumAssets,
  cometSymbol,
  cometTotalBorrow,
  cometTotalSupply,
  cometTotalsBasic,
  cometUint,
  configuratorFactory,
} from "../effects/contracts";
import {
  createCollateralTokenSnapshot,
  getBaseTokenPriceUsd,
  getOrCreateBaseToken,
  getOrCreateCollateralToken,
  getOrCreateToken,
  getTokenPriceWithGenericOracleUsd,
  updateBaseTokenConfig,
  updateCollateralTokenConfig,
} from "./token";
import { getOrCreateUsage } from "./usage";
import {
  createMarketCollateralBalanceSnapshot,
  getOrCreateMarketCollateralBalance,
  updateMarketCollateralBalanceUsd,
} from "./collateralBalance";
import { getOrCreateProtocol, getOrCreateProtocolAccounting, updateProtocolAccounting } from "./protocol";

////
// Market Configuration
////

export async function getOrCreateMarketConfiguration(
  ctx: Ctx,
  market: { id: string },
  event: Ev,
): Promise<Mutable<MarketConfiguration>> {
  const id = market.id; // One per market
  const config = await ctx.MarketConfiguration.get(id);

  if (!config) {
    const created: Mutable<MarketConfiguration> = {
      id,
      market_id: market.id,
      cometImplementation: undefined,
      lastConfigurationUpdateBlockNumber: ZERO_BI,
      name: "",
      symbol: "",
      factory: ZERO_ADDRESS,
      governor: ZERO_ADDRESS,
      pauseGuardian: ZERO_ADDRESS,
      extensionDelegate: ZERO_ADDRESS,
      supplyKink: ZERO_BD,
      supplyPerSecondInterestRateSlopeLow: ZERO_BI,
      supplyPerSecondInterestRateSlopeHigh: ZERO_BI,
      supplyPerSecondInterestRateBase: ZERO_BI,
      borrowKink: ZERO_BD,
      borrowPerSecondInterestRateSlopeLow: ZERO_BI,
      borrowPerSecondInterestRateSlopeHigh: ZERO_BI,
      borrowPerSecondInterestRateBase: ZERO_BI,
      storeFrontPriceFactor: ZERO_BI,
      trackingIndexScale: ZERO_BI,
      baseTrackingSupplySpeed: ZERO_BI,
      baseTrackingBorrowSpeed: ZERO_BI,
      baseMinForRewards: ZERO_BI,
      baseBorrowMin: ZERO_BI,
      targetReserves: ZERO_BI,
      baseToken_id: "",
      collateralTokens: [],
    };

    await updateMarketConfiguration(ctx, market, created, event);

    ctx.MarketConfiguration.set({ ...created });
    return created;
  }

  return { ...config };
}

export async function updateMarketConfiguration(
  ctx: Ctx,
  market: { id: string },
  config: Mutable<MarketConfiguration>,
  event: Ev,
): Promise<void> {
  const comet = market.id;
  const block = event.block.number;
  const tryFactory = await configuratorFactory(ctx.effect, getConfiguratorProxyAddress(), market.id, block);

  // Helper mirroring non-try semantics: graph-node would abort on revert;
  // the port logs and falls back to a neutral value.
  const must = <T>(value: T | null, fallback: T, what: string): T => {
    if (value === null) {
      ctx.log.error(`comet.${what}() reverted for ${comet} (original would abort)`);
      return fallback;
    }
    return value;
  };

  // cometImplementation must be added externally
  config.market_id = market.id;
  config.lastConfigurationUpdateBlockNumber = BigInt(block);
  config.name = must(await cometName(ctx.effect, comet, block), "", "name");
  config.symbol = must(await cometSymbol(ctx.effect, comet, block), "", "symbol");
  config.factory = tryFactory === null ? ZERO_ADDRESS : tryFactory;
  config.governor = must(await cometAddress(ctx.effect, comet, "governor", block), ZERO_ADDRESS, "governor");
  config.pauseGuardian = must(await cometAddress(ctx.effect, comet, "pauseGuardian", block), ZERO_ADDRESS, "pauseGuardian");
  config.extensionDelegate = must(
    await cometAddress(ctx.effect, comet, "extensionDelegate", block),
    ZERO_ADDRESS,
    "extensionDelegate",
  );

  config.supplyKink = formatUnits(must(await cometUint(ctx.effect, comet, "supplyKink", block), ZERO_BI, "supplyKink"), 18);
  config.supplyPerSecondInterestRateSlopeLow = must(
    await cometUint(ctx.effect, comet, "supplyPerSecondInterestRateSlopeLow", block),
    ZERO_BI,
    "supplyPerSecondInterestRateSlopeLow",
  );
  config.supplyPerSecondInterestRateSlopeHigh = must(
    await cometUint(ctx.effect, comet, "supplyPerSecondInterestRateSlopeHigh", block),
    ZERO_BI,
    "supplyPerSecondInterestRateSlopeHigh",
  );
  config.supplyPerSecondInterestRateBase = must(
    await cometUint(ctx.effect, comet, "supplyPerSecondInterestRateBase", block),
    ZERO_BI,
    "supplyPerSecondInterestRateBase",
  );

  config.borrowKink = formatUnits(must(await cometUint(ctx.effect, comet, "borrowKink", block), ZERO_BI, "borrowKink"), 18);
  config.borrowPerSecondInterestRateSlopeLow = must(
    await cometUint(ctx.effect, comet, "borrowPerSecondInterestRateSlopeLow", block),
    ZERO_BI,
    "borrowPerSecondInterestRateSlopeLow",
  );
  config.borrowPerSecondInterestRateSlopeHigh = must(
    await cometUint(ctx.effect, comet, "borrowPerSecondInterestRateSlopeHigh", block),
    ZERO_BI,
    "borrowPerSecondInterestRateSlopeHigh",
  );
  config.borrowPerSecondInterestRateBase = must(
    await cometUint(ctx.effect, comet, "borrowPerSecondInterestRateBase", block),
    ZERO_BI,
    "borrowPerSecondInterestRateBase",
  );

  config.storeFrontPriceFactor = must(
    await cometUint(ctx.effect, comet, "storeFrontPriceFactor", block),
    ZERO_BI,
    "storeFrontPriceFactor",
  );
  config.trackingIndexScale = must(
    await cometUint(ctx.effect, comet, "trackingIndexScale", block),
    ZERO_BI,
    "trackingIndexScale",
  );

  config.baseTrackingSupplySpeed = must(
    await cometUint(ctx.effect, comet, "baseTrackingSupplySpeed", block),
    ZERO_BI,
    "baseTrackingSupplySpeed",
  );
  config.baseTrackingBorrowSpeed = must(
    await cometUint(ctx.effect, comet, "baseTrackingBorrowSpeed", block),
    ZERO_BI,
    "baseTrackingBorrowSpeed",
  );
  config.baseMinForRewards = must(await cometUint(ctx.effect, comet, "baseMinForRewards", block), ZERO_BI, "baseMinForRewards");
  config.baseBorrowMin = must(await cometUint(ctx.effect, comet, "baseBorrowMin", block), ZERO_BI, "baseBorrowMin");
  config.targetReserves = must(await cometUint(ctx.effect, comet, "targetReserves", block), ZERO_BI, "targetReserves");

  // Base token
  const baseTokenAddress = must(await cometAddress(ctx.effect, comet, "baseToken", block), ZERO_ADDRESS, "baseToken");
  const token = await getOrCreateToken(ctx, baseTokenAddress, event);
  const baseToken = await getOrCreateBaseToken(ctx, market, token, event);
  await updateBaseTokenConfig(ctx, baseToken, event);
  ctx.BaseToken.set({ ...baseToken });

  config.baseToken_id = baseToken.id;

  // Collateral tokens
  const numCollateralTokens = must(await cometNumAssets(ctx.effect, comet, block), 0, "numAssets");
  const collateralTokens: string[] = [];
  for (let i = 0; i < numCollateralTokens; i++) {
    const assetInfo = await cometGetAssetInfo(ctx.effect, comet, i, block);
    if (assetInfo === null) {
      ctx.log.error(`comet.getAssetInfo(${i}) reverted for ${comet} (original would abort)`);
      continue;
    }
    const collateralTokenToken = await getOrCreateToken(ctx, assetInfo.asset, event);
    const collateralToken = await getOrCreateCollateralToken(ctx, market, collateralTokenToken, event);
    await updateCollateralTokenConfig(ctx, collateralToken, event);
    ctx.CollateralToken.set({ ...collateralToken });
    collateralTokens.push(collateralToken.id);
  }
  config.collateralTokens = collateralTokens;

  // Create snapshot of new config on every update
  await createMarketConfigurationSnapshot(ctx, config, event);
}

async function createMarketConfigurationSnapshot(ctx: Ctx, config: MarketConfiguration, event: Ev): Promise<void> {
  const snapshotId = hexConcat(bigIntBytes(BigInt(event.block.number)), bigIntBytes(BigInt(event.logIndex)));

  // Copy existing config (deep copy of collateral tokens)
  const collateralTokenSnapshots: string[] = [];
  for (let i = 0; i < config.collateralTokens.length; i++) {
    const collateralToken = await ctx.CollateralToken.getOrThrow(config.collateralTokens[i]!); // Guaranteed to exist
    const collateralTokenSnapshot = createCollateralTokenSnapshot(ctx, collateralToken, event);
    collateralTokenSnapshots.push(collateralTokenSnapshot.id);
  }

  const configSnapshot: MarketConfiguration = {
    ...config,
    id: snapshotId,
    collateralTokens: collateralTokenSnapshots,
  };
  ctx.MarketConfiguration.set(configSnapshot);

  // Create snapshot
  ctx.MarketConfigurationSnapshot.set({
    id: snapshotId,
    timestamp: BigInt(event.block.timestamp),
    market_id: config.market_id,
    configuration_id: configSnapshot.id,
  });
}

export async function getOrCreateMarketRewardConfiguration(
  ctx: Ctx,
  market: { id: string },
  event: Ev,
): Promise<Mutable<MarketRewardConfiguration>> {
  const id = hexConcat(market.id, getCometRewardAddress());
  const config = await ctx.MarketRewardConfiguration.get(id);

  if (!config) {
    const configData = await getRewardConfigData(ctx.effect, ctx.log, market.id, event.block.number);
    const created: Mutable<MarketRewardConfiguration> = {
      id,
      tokenAddress: configData.tokenAddress,
      rescaleFactor: configData.rescaleFactor,
      shouldUpscale: configData.shouldUpscale,
      multiplier: configData.multiplier,
    };
    ctx.MarketRewardConfiguration.set({ ...created });
    return created;
  } else if (config.tokenAddress === ZERO_ADDRESS) {
    // Check for config
    const configData = await getRewardConfigData(ctx.effect, ctx.log, market.id, event.block.number);

    if (configData.tokenAddress !== ZERO_ADDRESS) {
      const updated: Mutable<MarketRewardConfiguration> = {
        ...config,
        tokenAddress: configData.tokenAddress,
        rescaleFactor: configData.rescaleFactor,
        shouldUpscale: configData.shouldUpscale,
        multiplier: configData.multiplier,
      };
      ctx.MarketRewardConfiguration.set({ ...updated });
      return updated;
    }
  }

  return { ...config };
}

////
// Market Accounting
////

export async function getOrCreateMarketAccounting(
  ctx: Ctx,
  market: { id: string },
  event: Ev,
): Promise<Mutable<MarketAccounting>> {
  const id = market.id; // One per market
  const accounting = await ctx.MarketAccounting.get(id);

  if (!accounting) {
    const created: Mutable<MarketAccounting> = {
      id,
      market_id: market.id,
      // Set here to solve init issue, since we optimize to not update when block number didn't change
      lastAccountingUpdatedBlockNumber: ZERO_BI,
      baseSupplyIndex: ZERO_BI,
      baseBorrowIndex: ZERO_BI,
      trackingSupplyIndex: ZERO_BI,
      trackingBorrowIndex: ZERO_BI,
      lastAccrualTime: ZERO_BI,
      totalBasePrincipalSupply: ZERO_BI,
      totalBasePrincipalBorrow: ZERO_BI,
      baseReserveBalance: ZERO_BI,
      totalBaseSupply: ZERO_BI,
      totalBaseBorrow: ZERO_BI,
      collateralBalances: [],
      totalBaseSupplyUsd: ZERO_BD,
      totalBaseBorrowUsd: ZERO_BD,
      baseReserveBalanceUsd: ZERO_BD,
      collateralBalanceUsd: ZERO_BD,
      collateralReservesBalanceUsd: ZERO_BD,
      totalReserveBalanceUsd: ZERO_BD,
      utilization: ZERO_BD,
      collateralization: ZERO_BD,
      supplyApr: ZERO_BD,
      borrowApr: ZERO_BD,
      rewardSupplyApr: ZERO_BD,
      rewardBorrowApr: ZERO_BD,
      netSupplyApr: ZERO_BD,
      netBorrowApr: ZERO_BD,
      rewardTokenUsdPrice: ZERO_BD,
    };

    await updateMarketAccounting(ctx, market, created, event);

    ctx.MarketAccounting.set({ ...created });
    return created;
  }

  return { ...accounting };
}

export async function updateMarketAccounting(
  ctx: Ctx,
  market: { id: string },
  accounting: Mutable<MarketAccounting>,
  event: Ev,
): Promise<void> {
  if (accounting.lastAccountingUpdatedBlockNumber === BigInt(event.block.number)) {
    // Don't bother to update if we already did this block, assume this gets set on init
    return;
  }

  const comet = market.id;
  const block = event.block.number;
  const configuration = await getOrCreateMarketConfiguration(ctx, market, event);
  const rewardConfigData = await getOrCreateMarketRewardConfiguration(ctx, market, event);

  const must = <T>(value: T | null, fallback: T, what: string): T => {
    if (value === null) {
      ctx.log.error(`comet.${what}() reverted for ${comet} (original would abort)`);
      return fallback;
    }
    return value;
  };

  const totalsBasic = must(await cometTotalsBasic(ctx.effect, comet, block), {
    baseSupplyIndex: ZERO_BI,
    baseBorrowIndex: ZERO_BI,
    trackingSupplyIndex: ZERO_BI,
    trackingBorrowIndex: ZERO_BI,
    totalSupplyBase: ZERO_BI,
    totalBorrowBase: ZERO_BI,
    lastAccrualTime: ZERO_BI,
    pauseFlags: ZERO_BI,
  }, "totalsBasic");

  accounting.market_id = market.id;
  accounting.lastAccountingUpdatedBlockNumber = BigInt(block);

  accounting.baseSupplyIndex = totalsBasic.baseSupplyIndex;
  accounting.baseBorrowIndex = totalsBasic.baseBorrowIndex;
  accounting.trackingSupplyIndex = totalsBasic.trackingSupplyIndex;
  accounting.trackingBorrowIndex = totalsBasic.trackingBorrowIndex;
  accounting.lastAccrualTime = totalsBasic.lastAccrualTime;

  accounting.totalBasePrincipalSupply = totalsBasic.totalSupplyBase;
  accounting.totalBasePrincipalBorrow = totalsBasic.totalBorrowBase;

  accounting.baseReserveBalance = must(await cometGetReserves(ctx.effect, comet, block), ZERO_BI, "getReserves");

  accounting.totalBaseSupply = must(await cometTotalSupply(ctx.effect, comet, block), ZERO_BI, "totalSupply");
  accounting.totalBaseBorrow = must(await cometTotalBorrow(ctx.effect, comet, block), ZERO_BI, "totalBorrow");

  const scaledUtilization = must(await cometGetUtilization(ctx.effect, comet, block), ZERO_BI, "getUtilization");
  accounting.utilization = toBD(scaledUtilization).div(toBD(COMET_FACTOR_SCALE));

  const supplyRatePerSec = must(
    await cometGetSupplyRate(ctx.effect, comet, scaledUtilization, block),
    ZERO_BI,
    "getSupplyRate",
  );
  const borrowRatePerSec = must(
    await cometGetBorrowRate(ctx.effect, comet, scaledUtilization, block),
    ZERO_BI,
    "getBorrowRate",
  );

  accounting.supplyApr = toBD(supplyRatePerSec * SECONDS_PER_YEAR).div(toBD(COMET_FACTOR_SCALE));
  accounting.borrowApr = toBD(borrowRatePerSec * SECONDS_PER_YEAR).div(toBD(COMET_FACTOR_SCALE));

  const baseToken = { ...(await ctx.BaseToken.getOrThrow(configuration.baseToken_id)) }; // Guaranteed to exist
  const baseTokenToken = await ctx.Token.getOrThrow(baseToken.token_id); // Guaranteed to exist
  const baseTokenDecimals = baseTokenToken.decimals ?? 0;
  const baseTokenPriceUsd = await getBaseTokenPriceUsd(ctx, baseToken, event);

  accounting.totalBaseSupplyUsd = computeTokenValueUsd(accounting.totalBaseSupply, baseTokenDecimals, baseTokenPriceUsd);
  accounting.totalBaseBorrowUsd = computeTokenValueUsd(accounting.totalBaseBorrow, baseTokenDecimals, baseTokenPriceUsd);
  accounting.baseReserveBalanceUsd = computeTokenValueUsd(
    accounting.baseReserveBalance,
    baseTokenDecimals,
    baseTokenPriceUsd,
  );

  if (rewardConfigData.tokenAddress === ZERO_ADDRESS) {
    // No rewards
    accounting.rewardSupplyApr = ZERO_BD;
    accounting.rewardBorrowApr = ZERO_BD;

    accounting.rewardTokenUsdPrice = ZERO_BD;
  } else {
    const rewardToken = await getOrCreateToken(ctx, rewardConfigData.tokenAddress, event);
    const rewardMultiplier = rewardConfigData.multiplier;
    const rewardTokenDecimals = BigInt(rewardToken.decimals ?? 0);

    const supplyRewardTokensPerDay =
      (((configuration.baseTrackingSupplySpeed * 10n ** rewardTokenDecimals * SECONDS_PER_DAY) * rewardMultiplier) /
        REWARD_FACTOR_SCALE) /
      BASE_INDEX_SCALE;
    const borrowRewardTokensPerDay =
      (((configuration.baseTrackingBorrowSpeed * 10n ** rewardTokenDecimals * SECONDS_PER_DAY) * rewardMultiplier) /
        REWARD_FACTOR_SCALE) /
      BASE_INDEX_SCALE;

    const rewardTokenPriceUsd = await getTokenPriceWithGenericOracleUsd(ctx, rewardToken, event);

    const supplyRewardTokenPerDayUsd = computeTokenValueUsd(
      supplyRewardTokensPerDay,
      rewardToken.decimals ?? 0,
      rewardTokenPriceUsd,
    );
    const rewardSupplyYieldPerDay =
      accounting.totalBaseSupply > configuration.baseMinForRewards
        ? bigDecimalSafeDiv(supplyRewardTokenPerDayUsd, accounting.totalBaseSupplyUsd)
        : ZERO_BD;

    const borrowRewardTokenPerDayUsd = computeTokenValueUsd(
      borrowRewardTokensPerDay,
      rewardToken.decimals ?? 0,
      rewardTokenPriceUsd,
    );
    const rewardBorrowYieldPerDay =
      accounting.totalBaseBorrow > configuration.baseMinForRewards
        ? bigDecimalSafeDiv(borrowRewardTokenPerDayUsd, accounting.totalBaseBorrowUsd)
        : ZERO_BD;

    accounting.rewardSupplyApr = rewardSupplyYieldPerDay.times(toBD(DAYS_PER_YEAR));
    accounting.rewardBorrowApr = rewardBorrowYieldPerDay.times(toBD(DAYS_PER_YEAR));

    accounting.rewardTokenUsdPrice = await getTokenPriceWithGenericOracleUsd(ctx, rewardToken, event);
  }

  // Collateral USD balances
  const collateralTokenIds = configuration.collateralTokens;

  let totalCollateralBalanceUsd = ZERO_BD;
  let totalCollateralReservesUsd = ZERO_BD;
  const collateralBalances: string[] = [];
  for (let i = 0; i < collateralTokenIds.length; i++) {
    const token = await ctx.CollateralToken.getOrThrow(collateralTokenIds[i]!); // Guaranteed to exist
    const collateralBalance = await getOrCreateMarketCollateralBalance(ctx, token, event);
    await updateMarketCollateralBalanceUsd(ctx, collateralBalance, event);
    ctx.MarketCollateralBalance.set({ ...collateralBalance });

    collateralBalances.push(collateralBalance.id);

    totalCollateralBalanceUsd = totalCollateralBalanceUsd.plus(collateralBalance.balanceUsd);
    totalCollateralReservesUsd = totalCollateralReservesUsd.plus(collateralBalance.reservesUsd);
  }
  accounting.collateralBalanceUsd = totalCollateralBalanceUsd;
  accounting.collateralReservesBalanceUsd = totalCollateralReservesUsd;
  accounting.collateralBalances = collateralBalances;

  accounting.totalReserveBalanceUsd = accounting.baseReserveBalanceUsd.plus(accounting.collateralReservesBalanceUsd);

  accounting.netSupplyApr = accounting.supplyApr.plus(accounting.rewardSupplyApr);
  accounting.netBorrowApr = accounting.borrowApr.minus(accounting.rewardBorrowApr);

  accounting.collateralization = bigDecimalSafeDiv(toBD(accounting.totalBaseSupply), toBD(accounting.totalBaseBorrow));

  // Update protocol accounting whenever market accounting changes
  const protocol = await getOrCreateProtocol(ctx, event);
  const protocolAccounting = await getOrCreateProtocolAccounting(ctx, protocol, event);
  await updateProtocolAccounting(ctx, protocol, protocolAccounting, event);

  // Create snapshots (if necessary)
  await createMarketAccountingSnapshots(ctx, accounting, event);
}

async function createMarketAccountingSnapshots(ctx: Ctx, accounting: MarketAccounting, event: Ev): Promise<void> {
  const hour = BigInt(event.block.timestamp) / SECONDS_PER_HOUR;
  const day = BigInt(event.block.timestamp) / SECONDS_PER_DAY;
  const week = BigInt(event.block.timestamp) / SECONDS_PER_WEEK;

  const hourlyId = hexConcat(accounting.market_id, bigIntBytes(hour));
  const dailyId = hexConcat(accounting.market_id, bigIntBytes(day));
  const weeklyId = hexConcat(accounting.market_id, bigIntBytes(week));

  let hourlyAccounting = await ctx.HourlyMarketAccounting.get(hourlyId);
  let dailyAccounting = await ctx.DailyMarketAccounting.get(dailyId);
  let weeklyAccounting = await ctx.WeeklyMarketAccounting.get(weeklyId);

  if (!hourlyAccounting || !dailyAccounting || !weeklyAccounting) {
    // Original quirk: the copy id is market.id ++ hourlyId where hourlyId
    // already starts with market.id (market id appears twice).
    const accountingId = hexConcat(accounting.market_id, hourlyId);

    // Copy collateral balances (needs special handling since we need to deep copy)
    const collateralBalancesSnapshot: string[] = [];
    for (let i = 0; i < accounting.collateralBalances.length; i++) {
      const collateralBalance = await ctx.MarketCollateralBalance.getOrThrow(accounting.collateralBalances[i]!); // Guaranteed to exist
      const collateralBalanceSnapshot = createMarketCollateralBalanceSnapshot(ctx, collateralBalance, event);
      collateralBalancesSnapshot.push(collateralBalanceSnapshot.id);
    }

    // Copy existing accounting
    const copiedAccounting: MarketAccounting = {
      ...accounting,
      id: accountingId,
      collateralBalances: collateralBalancesSnapshot,
    };

    ctx.MarketAccounting.set(copiedAccounting);

    if (!hourlyAccounting) {
      hourlyAccounting = {
        id: hourlyId,
        hour,
        timestamp: BigInt(event.block.timestamp),
        market_id: accounting.market_id,
        accounting_id: copiedAccounting.id,
      };
      ctx.HourlyMarketAccounting.set(hourlyAccounting);
    }

    if (!dailyAccounting) {
      dailyAccounting = {
        id: dailyId,
        day,
        timestamp: BigInt(event.block.timestamp),
        market_id: accounting.market_id,
        accounting_id: copiedAccounting.id,
      };
      ctx.DailyMarketAccounting.set(dailyAccounting);
    }
    if (!weeklyAccounting) {
      weeklyAccounting = {
        id: weeklyId,
        week,
        timestamp: BigInt(event.block.timestamp),
        market_id: accounting.market_id,
        accounting_id: copiedAccounting.id,
      };
      ctx.WeeklyMarketAccounting.set(weeklyAccounting);
    }
  }
}

////
// Market
////
export async function getOrCreateMarket(ctx: Ctx, marketId: string, event: Ev): Promise<Mutable<Market>> {
  const market = await ctx.Market.get(marketId);

  if (!market) {
    const usage = await getOrCreateUsage(ctx, hexConcat(utf8Hex("MARKET_CUMULATIVE"), marketId));

    const created: Mutable<Market> = {
      id: marketId,
      cometProxy: marketId,
      protocol_id: getConfiguratorProxyAddress(),
      creationBlockNumber: BigInt(event.block.number),
      cumulativeUsage_id: usage.id,
      configuration_id: "",
      rewardConfiguration_id: "",
      accounting_id: "",
    };

    const marketConfig = await getOrCreateMarketConfiguration(ctx, created, event);
    created.configuration_id = marketConfig.id;

    const marketRewardConfiguration = await getOrCreateMarketRewardConfiguration(ctx, created, event);
    created.rewardConfiguration_id = marketRewardConfiguration.id;

    const marketAccounting = await getOrCreateMarketAccounting(ctx, created, event);
    created.accounting_id = marketAccounting.id;

    ctx.Market.set({ ...created });

    // Add to protocol
    const protocol = await getOrCreateProtocol(ctx, event);
    const markets = [...protocol.markets];
    markets.push(created.id);
    ctx.Protocol.set({ ...protocol, markets });

    return created;
  }

  return { ...market };
}
