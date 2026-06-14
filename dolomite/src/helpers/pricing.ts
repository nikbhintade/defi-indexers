import { BigDecimal } from "envio";
import type { EvmOnEventContext, Token } from "envio";
type handlerContext = EvmOnEventContext;
import {
  DAI_WETH_PAIR,
  DOLOMITE_MARGIN_ADDRESS,
  ONE_BD,
  USDT_WETH_PAIR,
  WETH_ADDRESS,
  WETH_USDC_ADDRESS,
  WHITELIST,
  ZERO_BD,
} from "../constants.js";
import { convertTokenToDecimal } from "./math.js";
import { getMarketPrice } from "../effects/contracts.js";

type Ctx = handlerContext;

const MINIMUM_LIQUIDITY_THRESHOLD_ETH = new BigDecimal("2");

function convertPriceToDecimal(rawPrice: bigint, token: Token): BigDecimal {
  return convertTokenToDecimal(rawPrice, 36n - token.decimals);
}

/**
 * getTokenOraclePriceUSD: cached per-block via OraclePrice.blockHash. On a new
 * block, reads DolomiteMargin.getMarketPrice (block-pinned eth_call) and
 * persists. On revert, keeps the old price (mirrors try_getMarketPrice).
 *
 * NOTE: the subgraph branched on ProtocolType to bind a different generated
 * contract; on-chain it is always DolomiteMargin.getMarketPrice, so we collapse
 * the branches into a single call.
 */
export async function getTokenOraclePriceUSD(
  context: Ctx,
  token: Token,
  blockNumber: bigint,
  blockHash: string,
): Promise<BigDecimal> {
  const oraclePrice = await context.OraclePrice.getOrThrow(token.id);
  if (oraclePrice.blockHash === blockHash.toLowerCase()) {
    return oraclePrice.price;
  }
  const call = await getMarketPrice(
    context.effect,
    DOLOMITE_MARGIN_ADDRESS,
    token.marketId,
    Number(blockNumber),
  );
  const price = call === null ? oraclePrice.price : convertPriceToDecimal(call.value, token);
  context.OraclePrice.set({
    ...oraclePrice,
    price,
    blockHash: blockHash.toLowerCase(),
    blockNumber,
  });
  return price;
}

export async function getEthPriceInUSD(context: Ctx): Promise<BigDecimal> {
  const daiPair = await context.AmmPair.get(DAI_WETH_PAIR);
  const usdcPair = await context.AmmPair.get(WETH_USDC_ADDRESS);
  const usdtPair = await context.AmmPair.get(USDT_WETH_PAIR);
  const weth = WETH_ADDRESS;

  if (daiPair !== undefined && usdcPair !== undefined && usdtPair !== undefined) {
    const daiReserveETH = daiPair.token0_id === weth ? daiPair.reserve0 : daiPair.reserve1;
    const usdcReserveETH = usdcPair.token0_id === weth ? usdcPair.reserve0 : usdcPair.reserve1;
    const usdtReserveETH = usdtPair.token0_id === weth ? usdtPair.reserve0 : usdtPair.reserve1;
    const total = daiReserveETH.plus(usdcReserveETH).plus(usdtReserveETH);
    if (total.eq(ZERO_BD)) return ZERO_BD;
    const daiWeight = daiReserveETH.div(total);
    const usdcWeight = usdcReserveETH.div(total);
    const usdtWeight = usdtReserveETH.div(total);
    const daiPrice = daiPair.token0_id === weth ? daiPair.token1Price : daiPair.token0Price;
    const usdcPrice = usdcPair.token0_id === weth ? usdcPair.token1Price : usdcPair.token0Price;
    const usdtPrice = usdtPair.token0_id === weth ? usdtPair.token1Price : usdtPair.token0Price;
    return daiPrice.times(daiWeight).plus(usdcPrice.times(usdcWeight)).plus(usdtPrice.times(usdtWeight));
  } else if (daiPair !== undefined && usdcPair !== undefined) {
    const daiReserveETH = daiPair.token0_id === weth ? daiPair.reserve0 : daiPair.reserve1;
    const usdcReserveETH = usdcPair.token0_id === weth ? usdcPair.reserve0 : usdcPair.reserve1;
    const total = daiReserveETH.plus(usdcReserveETH);
    if (total.eq(ZERO_BD)) return ZERO_BD;
    const daiWeight = daiReserveETH.div(total);
    const usdcWeight = usdcReserveETH.div(total);
    const daiPrice = daiPair.token0_id === weth ? daiPair.token1Price : daiPair.token0Price;
    const usdcPrice = usdcPair.token0_id === weth ? usdcPair.token1Price : usdcPair.token0Price;
    return daiPrice.times(daiWeight).plus(usdcPrice.times(usdcWeight));
  } else if (usdcPair !== undefined) {
    return usdcPair.token0_id === weth ? usdcPair.token1Price : usdcPair.token0Price;
  }
  return ZERO_BD;
}

export async function findEthPerToken(context: Ctx, token: Token): Promise<BigDecimal> {
  if (token.id === WETH_ADDRESS) {
    return ONE_BD;
  }
  for (let i = 0; i < WHITELIST.length; i += 1) {
    const lookup = await context.AmmPairReverseLookup.get(`${token.id}-${WHITELIST[i]}`);
    if (lookup !== undefined) {
      const pair = await context.AmmPair.getOrThrow(lookup.pair_id);
      if (pair.token0_id === token.id && pair.reserveETH.gt(MINIMUM_LIQUIDITY_THRESHOLD_ETH)) {
        const token1 = await context.Token.getOrThrow(pair.token1_id);
        return pair.token1Price.times(token1.derivedETH ?? ZERO_BD);
      } else if (pair.token1_id === token.id && pair.reserveETH.gt(MINIMUM_LIQUIDITY_THRESHOLD_ETH)) {
        const token0 = await context.Token.getOrThrow(pair.token0_id);
        return pair.token0Price.times(token0.derivedETH ?? ZERO_BD);
      }
    }
  }
  return ZERO_BD;
}

export async function getTrackedLiquidityUSD(
  context: Ctx,
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token,
): Promise<BigDecimal> {
  const bundle = await context.Bundle.getOrThrow("1");
  const price0 = (token0.derivedETH ?? ZERO_BD).times(bundle.ethPrice);
  const price1 = (token1.derivedETH ?? ZERO_BD).times(bundle.ethPrice);
  const TWO = new BigDecimal("2");

  if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0).plus(tokenAmount1.times(price1));
  }
  if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0).times(TWO);
  }
  if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount1.times(price1).times(TWO);
  }
  return ZERO_BD;
}
