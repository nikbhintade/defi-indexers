/**
 * Port of src/services/apr.ts — Curve LP pricing & APR helpers.
 *
 * All on-chain reads go through Effects pinned to the event block (the
 * subgraph pinned every call to the event block). `Pool`-mutating helpers
 * return the updated pool where relevant.
 */
import { BigDecimal, type EffectCaller, type EvmOnEventContext, type Pool } from "envio";
import {
  BIG_DECIMAL_1E8,
  BIG_DECIMAL_1E18,
  BIG_DECIMAL_ONE,
  BIG_DECIMAL_TWO,
  BIG_DECIMAL_ZERO,
  CRV_ADDRESS,
  CURVE_ONLY_TOKENS,
  CURVE_REGISTRY,
  CVX_CRV_LP_TOKEN,
  EURS_ADDRESS,
  EUR_LP_TOKEN,
  EURT_ADDRESS,
  FOREX_ORACLES,
  LINK_ADDRESS,
  LINK_LP_TOKEN_ADDRESS,
  USDT_ADDRESS,
  WBTC_ADDRESS,
  WETH_ADDRESS,
} from "../constants";
import { bytesToAddress, exponentToBigDecimal, getIntervalFromTimestamp, DAY, toBigDecimal } from "../utils";
import { getTokenAValueInTokenB, getUsdRate } from "./pricing";
import {
  chainlinkLatestAnswer,
  erc20Decimals,
  erc20BalanceOf,
  erc20TotalSupply,
  lendingVaultLendApr,
  lendingVaultPricePerShare,
  poolGetVirtualPrice,
  poolPriceOracle,
  registryGetVirtualPriceFromLpToken,
} from "../effects/contracts";

type EC = EffectCaller | null;

export async function getV2LpTokenPrice(context: EvmOnEventContext, ec: EC, block: number, pool: Pool): Promise<BigDecimal> {
  const lpToken = bytesToAddress(pool.lpToken);
  const supplyResult = await erc20TotalSupply(ec, lpToken, block);
  const supply = supplyResult === null ? BIG_DECIMAL_ZERO : toBigDecimal(supplyResult).div(BIG_DECIMAL_1E18);
  let total = BIG_DECIMAL_ZERO;
  let missingCoins = 0;

  for (let i = 0; i < pool.coins.length; ++i) {
    const currentCoin = bytesToAddress(pool.coins[i]!);
    const balanceResult = await erc20BalanceOf(ec, currentCoin, bytesToAddress(pool.swap), block);
    const decimalsResult = await erc20Decimals(ec, currentCoin);
    let balance = balanceResult === null ? BIG_DECIMAL_ZERO : toBigDecimal(balanceResult);
    const decimals = decimalsResult === null ? 18n : BigInt(decimalsResult);
    balance = balance.div(exponentToBigDecimal(decimals));
    let price = BIG_DECIMAL_ONE;
    // handling edge cases that are not traded on Sushi
    if (currentCoin == EURT_ADDRESS || currentCoin == EURS_ADDRESS) {
      price = await getForexUsdRate(ec, block, EUR_LP_TOKEN);
    } else {
      price = await getUsdRate(ec, block, currentCoin);
    }
    // for wrapped tokens and synths, we use a mapping: get the price of the
    // original asset and multiply that by the pool's price oracle
    const oracleInfo = CURVE_ONLY_TOKENS.get(currentCoin);
    if (price.eq(BIG_DECIMAL_ZERO) && oracleInfo !== undefined) {
      price = await getUsdRate(ec, block, oracleInfo.pricingToken);
      const priceOracleResult = await poolPriceOracle(ec, bytesToAddress(pool.swap), block);
      let priceOracle =
        priceOracleResult === null ? BIG_DECIMAL_ONE : toBigDecimal(priceOracleResult).div(BIG_DECIMAL_1E18);
      priceOracle =
        oracleInfo.tokenIndex == 1 && !priceOracle.eq(BIG_DECIMAL_ZERO) ? priceOracle : BIG_DECIMAL_ONE.div(priceOracle);
      price = price.times(priceOracle);
    }
    // Some pools have WETH listed under "coins" but actually use native ETH.
    // We keep track of missing coins and multiply the final result as if the
    // pool were perfectly balanced (no way to get native ETH balance).
    if (balance.eq(BIG_DECIMAL_ZERO) && currentCoin == WETH_ADDRESS) {
      missingCoins += 1;
    }
    total = total.plus(price.times(balance));
  }
  let value = supply.eq(BIG_DECIMAL_ZERO) ? BIG_DECIMAL_ZERO : total.div(supply);

  if (missingCoins > 0) {
    context.log.warn(`Missing ${missingCoins} coins for ${pool.name}`);
    // NB: integer division mirrors the AssemblyScript `pool.coins.length / missingCoins`
    const missingProportion = new BigDecimal(Math.trunc(pool.coins.length / missingCoins).toString());
    value = value.times(missingProportion);
  }
  return value;
}

export async function getForexUsdRate(ec: EC, block: number, lpToken: string): Promise<BigDecimal> {
  // returns the amount of USD 1 unit of the foreign currency is worth
  const oracle = FOREX_ORACLES.get(lpToken.toLowerCase());
  if (oracle === undefined) {
    return BIG_DECIMAL_ONE;
  }
  const conversionRateResponse = await chainlinkLatestAnswer(ec, oracle, block);
  const conversionRate =
    conversionRateResponse === null ? BIG_DECIMAL_ONE : toBigDecimal(conversionRateResponse).div(BIG_DECIMAL_1E8);
  return conversionRate;
}

export async function getTokenValueInLpUnderlyingToken(ec: EC, block: number, token: string, pool: Pool): Promise<BigDecimal> {
  const lpToken = pool.lpToken;
  if (lpToken == LINK_LP_TOKEN_ADDRESS) {
    return getTokenAValueInTokenB(ec, block, token, LINK_ADDRESS);
  } else if (lpToken == CVX_CRV_LP_TOKEN) {
    return getTokenAValueInTokenB(ec, block, token, CRV_ADDRESS);
  } else if (pool.coins.length > 0) {
    return getTokenAValueInTokenB(ec, block, token, bytesToAddress(pool.coins[0]!));
  }
  return BIG_DECIMAL_ONE;
}

export async function getLpUnderlyingTokenValueInOtherToken(ec: EC, block: number, pool: Pool, token: string): Promise<BigDecimal> {
  return BIG_DECIMAL_ONE.div(await getTokenValueInLpUnderlyingToken(ec, block, token, pool));
}

export async function getLpTokenVirtualPrice(ec: EC, block: number, pool: Pool): Promise<BigDecimal> {
  const lpTokenAddress = bytesToAddress(pool.lpToken);
  let vPriceCallResult = await registryGetVirtualPriceFromLpToken(ec, CURVE_REGISTRY, lpTokenAddress, block);
  let vPrice = BIG_DECIMAL_ZERO;
  if (vPriceCallResult !== null) {
    vPrice = toBigDecimal(vPriceCallResult).div(BIG_DECIMAL_1E18);
  }
  // most likely for when factory pools are not included in the registry
  else {
    let vp = await poolGetVirtualPrice(ec, lpTokenAddress, block);
    if (vp !== null) {
      vPrice = toBigDecimal(vp).div(BIG_DECIMAL_1E18);
    }
    // for v2 pools
    else {
      vp = await poolGetVirtualPrice(ec, bytesToAddress(pool.swap), block);
      vPrice = vp === null ? vPrice : toBigDecimal(vp).div(BIG_DECIMAL_1E18);
    }
  }
  return vPrice;
}

async function getPreviousDaySnapshot(context: EvmOnEventContext, pool: Pool, timestamp: bigint) {
  const yesterday = getIntervalFromTimestamp(timestamp - DAY, DAY);
  const snapId = pool.name + "-" + pool.poolid.toString() + "-" + yesterday.toString();
  return context.DailyPoolSnapshot.get(snapId);
}

export async function getV2PoolBaseApr(
  context: EvmOnEventContext,
  pool: Pool,
  currentXcpProfit: BigDecimal,
  currentXcpProfitA: BigDecimal,
  timestamp: bigint,
): Promise<BigDecimal> {
  const yesterday = getIntervalFromTimestamp(timestamp - DAY, DAY);
  const previousSnapshot = await context.DailyPoolSnapshot.get(pool.id + "-" + yesterday.toString());
  if (!previousSnapshot) {
    return BIG_DECIMAL_ZERO;
  }
  const previousSnapshotXcpProfit = previousSnapshot.xcpProfit;
  // avoid creating an artificial apr jump if pool was just created
  if (previousSnapshotXcpProfit.eq(BIG_DECIMAL_ZERO)) {
    return BIG_DECIMAL_ZERO;
  }
  const previousSnapshotXcpProfitA = previousSnapshot.xcpProfitA;
  const currentProfit = currentXcpProfit
    .div(BIG_DECIMAL_TWO)
    .plus(currentXcpProfitA.div(BIG_DECIMAL_TWO))
    .plus(BIG_DECIMAL_1E18)
    .div(BIG_DECIMAL_TWO);
  const previousProfit = previousSnapshotXcpProfit
    .div(BIG_DECIMAL_TWO)
    .plus(previousSnapshotXcpProfitA.div(BIG_DECIMAL_TWO))
    .plus(BIG_DECIMAL_1E18)
    .div(BIG_DECIMAL_TWO);
  const rate = previousProfit.eq(BIG_DECIMAL_ZERO)
    ? BIG_DECIMAL_ZERO
    : currentProfit.minus(previousProfit).div(previousProfit);
  return rate;
}

export async function getPoolBaseApr(
  context: EvmOnEventContext,
  pool: Pool,
  currentVirtualPrice: BigDecimal,
  timestamp: bigint,
): Promise<BigDecimal> {
  const previousSnapshot = await getPreviousDaySnapshot(context, pool, timestamp);
  const previousSnapshotVPrice = previousSnapshot ? previousSnapshot.lpTokenVirtualPrice : BIG_DECIMAL_ZERO;
  const rate = previousSnapshotVPrice.eq(BIG_DECIMAL_ZERO)
    ? BIG_DECIMAL_ZERO
    : currentVirtualPrice.minus(previousSnapshotVPrice).div(previousSnapshotVPrice);
  return rate;
}

export async function getLendingApr(ec: EC, block: number, pool: Pool): Promise<BigDecimal> {
  const apr = await lendingVaultLendApr(ec, bytesToAddress(pool.lpToken), block);
  if (apr === null) {
    return BIG_DECIMAL_ZERO;
  }
  return toBigDecimal(apr).div(BIG_DECIMAL_1E18).div(new BigDecimal("365"));
}

export async function getLendingTokenPrice(ec: EC, block: number, pool: Pool): Promise<BigDecimal> {
  const pricePerShare = await lendingVaultPricePerShare(ec, bytesToAddress(pool.lpToken), block);
  if (pricePerShare === null) {
    return BIG_DECIMAL_ZERO;
  }
  return toBigDecimal(pricePerShare).div(BIG_DECIMAL_1E18);
}

export async function getLpTokenPriceUSD(context: EvmOnEventContext, ec: EC, block: number, pool: Pool): Promise<BigDecimal> {
  const vPrice = await getLpTokenVirtualPrice(ec, block, pool);
  if (pool.isV2) {
    return getV2LpTokenPrice(context, ec, block, pool);
  }
  if (pool.isLending) {
    return getLendingTokenPrice(ec, block, pool);
  }
  if (FOREX_ORACLES.has(pool.lpToken.toLowerCase())) {
    return vPrice.times(await getForexUsdRate(ec, block, pool.lpToken));
  }
  switch (pool.assetType) {
    default:
      // USD
      return vPrice;
    case 1: // ETH
      return vPrice.times(await getUsdRate(ec, block, WETH_ADDRESS));
    case 2: // BTC
      return vPrice.times(await getUsdRate(ec, block, WBTC_ADDRESS));
    case 3:
      return vPrice.times(await getLpUnderlyingTokenValueInOtherToken(ec, block, pool, USDT_ADDRESS));
  }
}
