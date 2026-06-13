/**
 * Port of packages/utils/pricing.ts and packages/utils/convex.ts (mainnet).
 *
 * All state-dependent calls are pinned to the triggering event's block
 * (graph-node pinned every call to the event block).
 *
 * Deviation: a few calls in the original were non-`try_` and would have
 * crashed the subgraph on revert (getPair, getReserves, token0, get_pool_name,
 * RedeemableKeep3r.discount, getCvxMintAmount's totalSupply was `try_`). Here
 * the non-try ones fall back to a sensible default instead of aborting.
 */
import { BigDecimal, type EffectCaller } from "envio";
import {
  ADDRESS_ZERO,
  BIG_DECIMAL_1E6,
  BIG_DECIMAL_1E18,
  BIG_DECIMAL_ONE,
  BIG_DECIMAL_ZERO,
  CRV_FRAX_ADDRESS,
  CRVUSD_ADDRESS,
  CTOKENS,
  FRAXBP_ADDRESS,
  RKP3R_ADDRESS,
  SUSHI_FACTORY_ADDRESS,
  THREE_CRV_ADDRESS,
  TRIPOOL_ADDRESS,
  UNI_FACTORY_ADDRESS,
  UNI_V3_FACTORY_ADDRESS,
  UNI_V3_QUOTER,
  USDT_ADDRESS,
  WBTC_ADDRESS,
  WETH_ADDRESS,
  YTOKENS,
} from "../constants";
import { exponentToBigDecimal, exponentToBigInt, toBigDecimal } from "../utils";
import {
  cTokenExchangeRateStored,
  cTokenUnderlying,
  erc20Decimals,
  erc20TotalSupply,
  poolGetVirtualPrice,
  rKp3rDiscount,
  rKp3rPrice,
  uniV2GetPair,
  uniV2GetReserves,
  uniV2Token0,
  uniV3GetPool,
  uniV3QuoteExactInputSingle,
  yTokenGetPricePerFullShare,
} from "../effects/contracts";

type EC = EffectCaller | null;

export const CVX_CLIFF_SIZE = new BigDecimal("100000"); // new cliff every 100,000 tokens
export const CVX_CLIFF_COUNT = new BigDecimal("1000"); // 1,000 cliffs
export const CVX_MAX_SUPPLY = new BigDecimal("100000000"); // 100 mil max supply
const CVX_ADDRESS = "0x4e3fbd56cd56c3e72c1403e103b45db9da5b9d2b";

/** Port of convex.ts `getCvxMintAmount`. */
export async function getCvxMintAmount(ec: EC, block: number, crvEarned: BigDecimal): Promise<BigDecimal> {
  const cvxSupplyResult = await erc20TotalSupply(ec, CVX_ADDRESS, block);
  if (cvxSupplyResult !== null) {
    const cvxSupply = toBigDecimal(cvxSupplyResult).div(BIG_DECIMAL_1E18);
    const currentCliff = cvxSupply.div(CVX_CLIFF_SIZE);
    if (currentCliff.lt(CVX_CLIFF_COUNT)) {
      const remaining = CVX_CLIFF_COUNT.minus(currentCliff);
      let cvxEarned = crvEarned.times(remaining).div(CVX_CLIFF_COUNT);
      const amountTillMax = CVX_MAX_SUPPLY.minus(cvxSupply);
      if (cvxEarned.gt(amountTillMax)) {
        cvxEarned = amountTillMax;
      }
      return cvxEarned;
    }
  }
  return BIG_DECIMAL_ZERO;
}

export async function getEthRate(ec: EC, block: number, token: string): Promise<BigDecimal> {
  let eth = BIG_DECIMAL_ONE;

  if (token != WETH_ADDRESS) {
    let address = await uniV2GetPair(ec, SUSHI_FACTORY_ADDRESS, token, WETH_ADDRESS, block);

    if (address === null || address == ADDRESS_ZERO) {
      // if no pair on sushi, we try uni v2
      address = await uniV2GetPair(ec, UNI_FACTORY_ADDRESS, token, WETH_ADDRESS, block);

      // if no pair on v2 either we try uni v3
      if (address === null || address == ADDRESS_ZERO) {
        return getEthRateUniV3(ec, block, token);
      }
    }

    const reserves = await uniV2GetReserves(ec, address, block);
    if (reserves === null) {
      return BIG_DECIMAL_ZERO;
    }
    const token0 = await uniV2Token0(ec, address);

    eth =
      token0 == WETH_ADDRESS
        ? toBigDecimal(reserves[0]).times(BIG_DECIMAL_1E18).div(toBigDecimal(reserves[1]))
        : toBigDecimal(reserves[1]).times(BIG_DECIMAL_1E18).div(toBigDecimal(reserves[0]));

    return eth.div(BIG_DECIMAL_1E18);
  }

  return eth;
}

export async function getEthRateUniV3(ec: EC, block: number, token: string): Promise<BigDecimal> {
  let fee = 3000;
  // first try the 0.3% pool
  let poolCall = await uniV3GetPool(ec, UNI_V3_FACTORY_ADDRESS, token, WETH_ADDRESS, fee, block);
  if (poolCall === null || poolCall == ADDRESS_ZERO) {
    // if it fails, try 1%
    fee = 10000;
    poolCall = await uniV3GetPool(ec, UNI_V3_FACTORY_ADDRESS, token, WETH_ADDRESS, fee, block);
    if (poolCall === null || poolCall == ADDRESS_ZERO) {
      return BIG_DECIMAL_ZERO;
    }
  }
  const decimals = await getDecimals(ec, token);
  const rate = await uniV3QuoteExactInputSingle(
    ec,
    UNI_V3_QUOTER,
    token,
    WETH_ADDRESS,
    fee,
    exponentToBigInt(decimals),
    0n,
    block,
  );
  if (rate !== null) {
    return toBigDecimal(rate).div(exponentToBigDecimal(decimals));
  }
  return BIG_DECIMAL_ZERO;
}

export async function getDecimals(ec: EC, token: string): Promise<bigint> {
  const decimalsResult = await erc20Decimals(ec, token);
  return decimalsResult === null ? 18n : BigInt(decimalsResult);
}

// Computes the value of one unit of Token A in units of Token B.
// Only works if both tokens have an ETH pair on Sushi.
export async function getTokenAValueInTokenB(ec: EC, block: number, tokenA: string, tokenB: string): Promise<BigDecimal> {
  if (tokenA == tokenB) {
    return BIG_DECIMAL_ONE;
  }
  const decimalsA = await getDecimals(ec, tokenA);
  const decimalsB = await getDecimals(ec, tokenB);
  const ethRateA = (await getEthRate(ec, block, tokenA)).times(BIG_DECIMAL_1E18);
  const ethRateB = (await getEthRate(ec, block, tokenB)).times(BIG_DECIMAL_1E18);
  if (ethRateB.eq(BIG_DECIMAL_ZERO)) {
    return BIG_DECIMAL_ONE;
  }
  return ethRateA.div(ethRateB).times(exponentToBigDecimal(decimalsA)).div(exponentToBigDecimal(decimalsB));
}

export async function getFraxBpVirtualPrice(ec: EC, block: number): Promise<BigDecimal> {
  const virtualPriceResult = await poolGetVirtualPrice(ec, FRAXBP_ADDRESS, block);
  let vPrice = BIG_DECIMAL_ONE;
  if (virtualPriceResult !== null) {
    vPrice = toBigDecimal(virtualPriceResult).div(BIG_DECIMAL_1E18);
  }
  return vPrice;
}

export async function getCTokenExchangeRate(ec: EC, block: number, token: string): Promise<BigDecimal> {
  const underlyingResult = await cTokenUnderlying(ec, token);
  const exchangeRateResult = await cTokenExchangeRateStored(ec, token, block);
  if (underlyingResult === null || exchangeRateResult === null) {
    // if fail we use the beginning rate
    return new BigDecimal("0.02");
  }
  const underlyingDecimalsResult = await erc20Decimals(ec, underlyingResult);
  const underlyingDecimals = underlyingDecimalsResult === null ? 18 : underlyingDecimalsResult;
  // scaling formula: https://compound.finance/docs/ctokens
  const rateScale = exponentToBigDecimal(BigInt(10 + underlyingDecimals));
  return toBigDecimal(exchangeRateResult).div(rateScale);
}

export async function getYTokenExchangeRate(ec: EC, block: number, token: string): Promise<BigDecimal> {
  const pricePerShareResult = await yTokenGetPricePerFullShare(ec, token, block);
  if (pricePerShareResult === null) {
    // if fail we use 1
    return BIG_DECIMAL_ONE;
  }
  return toBigDecimal(pricePerShareResult).div(BIG_DECIMAL_1E18);
}

export async function get3CrvVirtualPrice(ec: EC, block: number): Promise<BigDecimal> {
  const virtualPriceResult = await poolGetVirtualPrice(ec, TRIPOOL_ADDRESS, block);
  let vPrice = BIG_DECIMAL_ONE;
  if (virtualPriceResult !== null) {
    vPrice = toBigDecimal(virtualPriceResult).div(BIG_DECIMAL_1E18);
  }
  return vPrice;
}

async function getRKp3rPrice(ec: EC, block: number): Promise<BigDecimal> {
  const discount = await rKp3rDiscount(ec, RKP3R_ADDRESS, block);
  const priceResult = await rKp3rPrice(ec, RKP3R_ADDRESS, block);
  if (priceResult === null || discount === null) {
    return BIG_DECIMAL_ZERO;
  }
  // price.times(discount).div(100) / 1e6
  return toBigDecimal((priceResult * discount) / 100n).div(BIG_DECIMAL_1E6);
}

export async function getUsdRate(ec: EC, block: number, token: string): Promise<BigDecimal> {
  const usdt = BIG_DECIMAL_ONE;
  if (token == RKP3R_ADDRESS) {
    return getRKp3rPrice(ec, block);
  } else if (token == CRV_FRAX_ADDRESS) {
    return getFraxBpVirtualPrice(ec, block);
  } else if (token == CRVUSD_ADDRESS) {
    return BIG_DECIMAL_ONE;
  } else if (token == THREE_CRV_ADDRESS) {
    return get3CrvVirtualPrice(ec, block);
  } else if (CTOKENS.includes(token)) {
    return getCTokenExchangeRate(ec, block, token);
  } else if (YTOKENS.includes(token)) {
    return getYTokenExchangeRate(ec, block, token);
  } else if (token != USDT_ADDRESS) {
    return getTokenAValueInTokenB(ec, block, token, USDT_ADDRESS);
  }
  return usdt;
}

export async function getBtcRate(ec: EC, block: number, token: string): Promise<BigDecimal> {
  const wbtc = BIG_DECIMAL_ONE;
  if (token != WBTC_ADDRESS) {
    return getTokenAValueInTokenB(ec, block, token, WBTC_ADDRESS);
  }
  return wbtc;
}
