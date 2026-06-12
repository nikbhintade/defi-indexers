/**
 * Port of packages/utils/pricing.ts (mainnet).
 *
 * All state-dependent calls are pinned to the triggering event's block
 * (graph-node pinned every call to the event block).
 *
 * Deviation: a few calls in the original were non-`try_` and would have
 * crashed the subgraph on revert (getPair, getReserves, token0). Here they
 * fall back to a zero price instead.
 */
import { BigDecimal, type EffectCaller } from "envio";
import {
  ADDRESS_ZERO,
  BIG_DECIMAL_1E18,
  BIG_DECIMAL_1E8,
  BIG_DECIMAL_ONE,
  BIG_DECIMAL_ZERO,
  CRV_FRAX_ADDRESS,
  CTOKENS,
  FOREX_ORACLES,
  FRAXBP_ADDRESS,
  MATIC_FOUR_EUR_LP_TOKEN_ADDRESS,
  POLYGON_AGEUR_TOKEN,
  SIDECHAIN_SUBSTITUTES,
  SUSHI_FACTORY_ADDRESS,
  THREE_CRV_TOKEN,
  TRIPOOL_ADDRESS,
  UNI_FACTORY_ADDRESS,
  UNI_V3_FACTORY_ADDRESS,
  UNI_V3_QUOTER_ADDRESS,
  USDT_ADDRESS,
  WBTC_ADDRESS,
  WETH_ADDRESS,
  YTOKENS,
} from "../constants";
import { exponentToBigDecimal, exponentToBigInt, toBigDecimal } from "./index";
import {
  cTokenExchangeRateStored,
  cTokenUnderlying,
  chainlinkLatestAnswer,
  erc20Decimals,
  erc20Symbol,
  poolVirtualPrice,
  uniV2GetPair,
  uniV2GetReserves,
  uniV2Token0,
  uniV3GetPool,
  uniV3QuoteExactInputSingle,
  yTokenGetPricePerFullShare,
} from "../effects/contracts";

type EC = EffectCaller | null;

export async function getRateFromUniFork(
  ec: EC,
  block: number,
  token: string,
  numeraire: string,
  factoryContract: string,
): Promise<BigDecimal> {
  const address = await uniV2GetPair(ec, factoryContract, token, numeraire, block);
  if (address === null || address == ADDRESS_ZERO) {
    return BIG_DECIMAL_ZERO;
  }
  const reserves = await uniV2GetReserves(ec, address, block);
  if (reserves === null) {
    return BIG_DECIMAL_ZERO;
  }
  // if reserves are below a certain threshold we consider them invalid
  if (reserves[1] < 100000000n || reserves[0] < 100000000n) {
    return BIG_DECIMAL_ZERO;
  }
  const token0 = await uniV2Token0(ec, address);
  const price =
    token0 == numeraire
      ? toBigDecimal(reserves[0]).times(BIG_DECIMAL_1E18).div(toBigDecimal(reserves[1]))
      : toBigDecimal(reserves[1]).times(BIG_DECIMAL_1E18).div(toBigDecimal(reserves[0]));
  return price.div(BIG_DECIMAL_1E18);
}

export async function getNumeraireRate(ec: EC, block: number, token: string, numeraire: string): Promise<BigDecimal> {
  if (token != numeraire) {
    const sushiPrice = await getRateFromUniFork(ec, block, token, numeraire, SUSHI_FACTORY_ADDRESS);
    if (!sushiPrice.eq(BIG_DECIMAL_ZERO)) {
      return sushiPrice;
    }
    const uniV2Price = await getRateFromUniFork(ec, block, token, numeraire, UNI_FACTORY_ADDRESS);
    if (!uniV2Price.eq(BIG_DECIMAL_ZERO)) {
      return uniV2Price;
    }
    return getRateUniV3(ec, block, token, numeraire);
  }
  return BIG_DECIMAL_ONE;
}

export async function getEthRate(ec: EC, block: number, token: string): Promise<BigDecimal> {
  return getNumeraireRate(ec, block, token, WETH_ADDRESS);
}

export async function getRateUniV3(ec: EC, block: number, token: string, numeraire: string): Promise<BigDecimal> {
  let fee = 3000;
  // first try the 0.3% pool
  let poolCall = await uniV3GetPool(ec, UNI_V3_FACTORY_ADDRESS, token, numeraire, fee, block);
  if (poolCall === null || poolCall == ADDRESS_ZERO) {
    // if it fails, try 1%
    fee = 10000;
    poolCall = await uniV3GetPool(ec, UNI_V3_FACTORY_ADDRESS, token, numeraire, fee, block);
    if (poolCall === null || poolCall == ADDRESS_ZERO) {
      return BIG_DECIMAL_ZERO;
    }
  }
  const decimals = await getDecimals(ec, token);
  const rate = await uniV3QuoteExactInputSingle(
    ec,
    UNI_V3_QUOTER_ADDRESS,
    token,
    numeraire,
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

/** Note: like the original, `getName` actually fetches the *symbol*. */
export async function getName(ec: EC, token: string): Promise<string> {
  const nameResult = await erc20Symbol(ec, token);
  return nameResult === null ? token.slice(0, 6) : nameResult;
}

export async function getForexUsdRate(ec: EC, block: number, token: string): Promise<BigDecimal> {
  // returns the amount of USD 1 unit of the foreign currency is worth
  const oracle = FOREX_ORACLES[token];
  if (!oracle) {
    return BIG_DECIMAL_ONE;
  }
  const conversionRateResponse = await chainlinkLatestAnswer(ec, oracle, block);
  const conversionRate =
    conversionRateResponse === null ? BIG_DECIMAL_ONE : toBigDecimal(conversionRateResponse).div(BIG_DECIMAL_1E8);
  return conversionRate;
}

// Computes the value of one unit of Token A in units of Token B
export async function getTokenAValueInTokenB(ec: EC, block: number, tokenA: string, tokenB: string): Promise<BigDecimal> {
  if (tokenA == tokenB) {
    return BIG_DECIMAL_ONE;
  }
  const decimalsA = await getDecimals(ec, tokenA);
  const decimalsB = await getDecimals(ec, tokenB);
  const ethRateA = (await getEthRate(ec, block, tokenA)).times(BIG_DECIMAL_1E18);
  const ethRateB = (await getEthRate(ec, block, tokenB)).times(BIG_DECIMAL_1E18);
  if (ethRateB.eq(BIG_DECIMAL_ZERO)) {
    return BIG_DECIMAL_ZERO;
  }
  return ethRateA.div(ethRateB).times(exponentToBigDecimal(decimalsA)).div(exponentToBigDecimal(decimalsB));
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

export async function getFraxBpVirtualPrice(ec: EC, block: number): Promise<BigDecimal> {
  const virtualPriceResult = await poolVirtualPrice(ec, FRAXBP_ADDRESS, block);
  let vPrice = BIG_DECIMAL_ONE;
  if (virtualPriceResult !== null) {
    vPrice = toBigDecimal(virtualPriceResult).div(BIG_DECIMAL_1E18);
  }
  return vPrice;
}

export async function getFourEurPrice(ec: EC, block: number): Promise<BigDecimal> {
  const virtualPriceResult = await poolVirtualPrice(ec, MATIC_FOUR_EUR_LP_TOKEN_ADDRESS, block);
  let vPrice = BIG_DECIMAL_ONE;
  if (virtualPriceResult !== null) {
    vPrice = toBigDecimal(virtualPriceResult).div(BIG_DECIMAL_1E18);
  }
  // multiply vPrice by euro exchange rate
  return vPrice.times(await getForexUsdRate(ec, block, POLYGON_AGEUR_TOKEN));
}

export async function get3CrvVirtualPrice(ec: EC, block: number): Promise<BigDecimal> {
  const virtualPriceResult = await poolVirtualPrice(ec, TRIPOOL_ADDRESS, block);
  let vPrice = BIG_DECIMAL_ONE;
  if (virtualPriceResult !== null) {
    vPrice = toBigDecimal(virtualPriceResult).div(BIG_DECIMAL_1E18);
  }
  return vPrice;
}

export async function getUsdRate(ec: EC, block: number, token: string): Promise<BigDecimal> {
  const usdt = BIG_DECIMAL_ONE;
  const substitute = SIDECHAIN_SUBSTITUTES[token];
  if (substitute !== undefined) {
    token = substitute;
  }
  if (CTOKENS.includes(token)) {
    return getCTokenExchangeRate(ec, block, token);
  } else if (YTOKENS.includes(token)) {
    return getYTokenExchangeRate(ec, block, token);
  } else if (token == CRV_FRAX_ADDRESS) {
    return getFraxBpVirtualPrice(ec, block);
  } else if (token == MATIC_FOUR_EUR_LP_TOKEN_ADDRESS) {
    return getFourEurPrice(ec, block);
  } else if (token == THREE_CRV_TOKEN) {
    return get3CrvVirtualPrice(ec, block);
  } else if (token != USDT_ADDRESS) {
    let usdPrice = await getTokenAValueInTokenB(ec, block, token, USDT_ADDRESS);
    // if it fails we try to go directly via a stable pair
    if (usdPrice.eq(BIG_DECIMAL_ZERO)) {
      usdPrice = await getNumeraireRate(ec, block, token, USDT_ADDRESS);
    }
    return usdPrice;
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
