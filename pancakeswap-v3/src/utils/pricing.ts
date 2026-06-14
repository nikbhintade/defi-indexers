/**
 * Port of template/utils/pricing.template.ts rendered with BSC (config/bsc.js)
 * values. Store reads are async (context.Pool.get / getOrLoadToken).
 */
import { BigDecimal, type Bundle, type EvmOnEventContext, type Token } from "envio";
import { ONE_BD, ZERO_BD, ZERO_BI } from "./constants";
import { exponentToBigDecimal, safeDiv } from "./index";
import { getOrLoadToken } from "./entity";

// BSC wNative (WBNB)
const WETH_ADDRESS = "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c";
// BSC wNativeStablePool: WBNB-USDT 500
const USDC_WETH_03_POOL = "0x36696169c63e42cd08ce11f5deebbcebae652050";
// BSC stableIsToken0 = true
const STABLE_IS_TOKEN0 = "true";

// token whitelist for tracked volume/liquidity (config/bsc.js whitelistAddresses)
export const WHITELIST_TOKENS: string[] = [
  "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c", // WBNB
  "0x55d398326f99059ff775485246999027b3197955", // USDT
  "0xe9e7cea3dedca5984780bafc599bd69add087d56", // BUSD
  "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d", // USDC
  "0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c", // BTCB
  "0x2170ed0880ac9a755fd29b2688956bd959f933f8", // WETH
  "0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82", // CAKE
];

// config/bsc.js stableCoins
const STABLE_COINS: string[] = [
  "0x55d398326f99059ff775485246999027b3197955", // USDT
  "0xe9e7cea3dedca5984780bafc599bd69add087d56", // BUSD
  "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d", // USDC
];

// config/bsc.js minETHLocked = 10
const MINIMUM_ETH_LOCKED = new BigDecimal("10");

// 2 ** 192
const Q192 = new BigDecimal((2n ** 192n).toString());

export function sqrtPriceX96ToTokenPrices(sqrtPriceX96: bigint, token0: Token, token1: Token): BigDecimal[] {
  const num = new BigDecimal((sqrtPriceX96 * sqrtPriceX96).toString());
  const denom = Q192;
  const price1 = num.div(denom).times(exponentToBigDecimal(token0.decimals)).div(exponentToBigDecimal(token1.decimals));
  const price0 = safeDiv(new BigDecimal("1"), price1);
  return [price0, price1];
}

export async function getEthPriceInUSD(context: EvmOnEventContext): Promise<BigDecimal> {
  const usdcPool = await context.Pool.get(USDC_WETH_03_POOL);
  if (usdcPool !== undefined) {
    if (STABLE_IS_TOKEN0 === "true") {
      return usdcPool.token0Price;
    }
    return usdcPool.token1Price;
  }
  return ZERO_BD;
}

/**
 * Search through graph to find derived Eth per token.
 */
export async function findEthPerToken(context: EvmOnEventContext, bundle: Bundle, token: Token): Promise<BigDecimal> {
  if (token.id === WETH_ADDRESS) {
    return ONE_BD;
  }
  const whiteList = token.whitelistPools;
  let largestLiquidityETH = ZERO_BD;
  let priceSoFar = ZERO_BD;

  if (STABLE_COINS.includes(token.id)) {
    priceSoFar = safeDiv(ONE_BD, bundle.ethPriceUSD);
  } else {
    for (let i = 0; i < whiteList.length; ++i) {
      const poolAddress = whiteList[i]!;
      const pool = await context.Pool.get(poolAddress);
      if (pool === undefined) {
        continue;
      }
      if (pool.liquidity > ZERO_BI) {
        if (pool.token0_id === token.id) {
          // whitelist token is token1
          const token1 = await getOrLoadToken(context, pool.token1_id);
          const ethLocked = pool.totalValueLockedToken1.times(token1.derivedETH);
          if (
            ethLocked.gt(largestLiquidityETH) &&
            (ethLocked.gt(MINIMUM_ETH_LOCKED) || WHITELIST_TOKENS.includes(pool.token0_id))
          ) {
            largestLiquidityETH = ethLocked;
            priceSoFar = pool.token1Price.times(token1.derivedETH);
          }
        }
        if (pool.token1_id === token.id) {
          const token0 = await getOrLoadToken(context, pool.token0_id);
          const ethLocked = pool.totalValueLockedToken0.times(token0.derivedETH);
          if (
            ethLocked.gt(largestLiquidityETH) &&
            (ethLocked.gt(MINIMUM_ETH_LOCKED) || WHITELIST_TOKENS.includes(pool.token1_id))
          ) {
            largestLiquidityETH = ethLocked;
            priceSoFar = pool.token0Price.times(token0.derivedETH);
          }
        }
      }
    }
  }
  return priceSoFar;
}

export type AmountType = {
  eth: BigDecimal;
  usd: BigDecimal;
  ethUntracked: BigDecimal;
  usdUntracked: BigDecimal;
};

export function getAdjustedAmounts(
  bundle: Bundle,
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token,
): AmountType {
  const derivedETH0 = token0.derivedETH;
  const derivedETH1 = token1.derivedETH;

  let eth = ZERO_BD;
  const ethUntracked = tokenAmount0.times(derivedETH0).plus(tokenAmount1.times(derivedETH1));

  const t0 = WHITELIST_TOKENS.includes(token0.id);
  const t1 = WHITELIST_TOKENS.includes(token1.id);

  if (t0 && t1) {
    eth = ethUntracked;
  }
  if (t0 && !t1) {
    eth = tokenAmount0.times(derivedETH0).times(new BigDecimal("2"));
  }
  if (!t0 && t1) {
    eth = tokenAmount1.times(derivedETH1).times(new BigDecimal("2"));
  }

  const usd = eth.times(bundle.ethPriceUSD);
  const usdUntracked = ethUntracked.times(bundle.ethPriceUSD);

  return { eth, usd, ethUntracked, usdUntracked };
}
