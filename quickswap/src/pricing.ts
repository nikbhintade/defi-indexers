/**
 * Port of mappings/pricing.ts (Polygon/matic-rendered values: WMATIC
 * ("WETH_ADDRESS") priced via the single USDC-WMATIC pair, 13-token whitelist,
 * 1-MATIC minimum liquidity threshold). The original keeps Uniswap's ETH naming
 * (WETH_ADDRESS, derivedETH, ethPrice) even though the priced asset is MATIC.
 *
 * NO eth_call here: QuickSwap's findEthPerToken iterates the per-token
 * `whitelist` array (pair addresses written on PairCreated whenever the *other*
 * token is a whitelist token), then loads each Pair from the store. This is the
 * subgraph's own mechanism — there is no Factory.getPair lookup to replace.
 *
 * Store-staleness semantics match graph-node: entities are read through
 * `context.X.get`, so values set later in the calling handler (e.g. the synced
 * pair's own new reserves, which handleSync only saves at the end) are not
 * visible here.
 */
import { BigDecimal, type Bundle, type EvmOnEventContext, type Token } from "envio";
import { ONE_BD, ZERO_BD } from "./utils";

const WETH_ADDRESS = "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619"; // WMATIC
const USDC_WETH_PAIR = "0x853ee4b2a13f8a742d64c8f088be7ba2131f670d"; // created 10008355

export async function getEthPriceInUSD(context: EvmOnEventContext): Promise<BigDecimal> {
  // For now we only use the USDC-WMATIC pair for the MATIC price (USDC is token0).
  const usdcPair = await context.Pair.get(USDC_WETH_PAIR);
  if (usdcPair !== undefined) {
    return usdcPair.token0Price;
  } else {
    return ZERO_BD;
  }
}

// tokens where amounts should contribute to tracked volume and liquidity
export const WHITELIST: string[] = [
  "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619", // WMATIC (WETH)
  "0x2791bca1f2de4661ed88a30c99a7a9449aa84174", // USDC
  "0x831753dd7087cac61ab5644b308642cc1c33dc13", // QUICK
  "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270", // WMATIC (native wrapper variant)
  "0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6", // WBTC
  "0x8f3cf7ad23cd3cadbd9735aff958023239c6a063", // DAI
  "0xc2132d05d31c914a87c6611c10748aeb04b58e8f", // USDT
  "0x9719d867a500ef117cc201206b8ab51e794d3f82", // MAUSDC
  "0x104592a158490a9228070e0a8e5343b499e125d0", // FRAX
  "0x033d942a6b495c4071083f4cde1f17e986fe856c", // AGA
  "0xd6df932a45c0f255f85145f286ea0b292b21c90b", // AAVE
  "0xa7051c5a22d963b81d71c2ba64d46a877fbc1821", // EROWAN
  "0x8497842420cfdbc97896c2353d75d89fc8d5be5d", // VERSA
];

const BLACKLIST: string[] = ["0x5d76fa95c308fce88d347556785dd1dd44416272"];

export function isOnWhitelist(token: string): boolean {
  for (let i = 0; i < WHITELIST.length; i++) {
    if (token == WHITELIST[i]) return true;
  }
  return false;
}

export function isOnBlacklist(token: string): boolean {
  for (let i = 0; i < BLACKLIST.length; i++) {
    if (token == BLACKLIST[i]) return true;
  }
  return false;
}

// minimum liquidity for price to get tracked
const MINIMUM_LIQUIDITY_THRESHOLD_ETH = new BigDecimal("1");

/**
 * Search through graph to find derived ETH (MATIC) per token.
 * Iterates the token's `whitelist` (list of pair addresses paired with a
 * whitelist token, written in factory.ts on PairCreated).
 **/
export async function findEthPerToken(context: EvmOnEventContext, token: Token): Promise<BigDecimal> {
  if (token.id == WETH_ADDRESS) {
    return ONE_BD;
  }

  // loop through whitelist and check if paired with any
  const whitelist = token.whitelist;
  for (let i = 0; i < whitelist.length; ++i) {
    const pairAddress = whitelist[i]!;
    // original `Pair.load(pairAddress)` would null-deref-crash if missing; the
    // whitelist row is written together with the Pair entity, so getOrThrow
    // mirrors that.
    const pair = await context.Pair.getOrThrow(pairAddress);
    if (pair.token0_id == token.id && pair.reserveETH.gt(MINIMUM_LIQUIDITY_THRESHOLD_ETH)) {
      const token1 = await context.Token.getOrThrow(pair.token1_id);
      return pair.token1Price.times(token1.derivedETH as BigDecimal); // token1 per our token * ETH per token1
    }
    if (pair.token1_id == token.id && pair.reserveETH.gt(MINIMUM_LIQUIDITY_THRESHOLD_ETH)) {
      const token0 = await context.Token.getOrThrow(pair.token0_id);
      return pair.token0Price.times(token0.derivedETH as BigDecimal); // token0 per our token * ETH per token0
    }
  }
  return ZERO_BD; // nothing was found return 0
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD.
 * If both are, return average of two amounts
 * If neither is, return 0
 *
 * NOTE: the "neither" branch returns the shared ZERO_BD *object* on purpose —
 * handleSwap compares the result with `===` like the AssemblyScript original.
 */
export function getTrackedVolumeUSD(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token,
  bundle: Bundle,
): BigDecimal {
  const price0 = (token0.derivedETH as BigDecimal).times(bundle.ethPrice);
  const price1 = (token1.derivedETH as BigDecimal).times(bundle.ethPrice);

  // both are whitelist tokens, take average of both amounts
  if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0).plus(tokenAmount1.times(price1)).div(new BigDecimal("2"));
  }

  // take full value of the whitelisted token amount
  if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0);
  }

  // take full value of the whitelisted token amount
  if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount1.times(price1);
  }

  // neither token is on white list, tracked volume is 0
  return ZERO_BD;
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD * 2.
 * If both are, return sum of two amounts
 * If neither is, return 0
 */
export function getTrackedLiquidityUSD(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token,
  bundle: Bundle,
): BigDecimal {
  const price0 = (token0.derivedETH as BigDecimal).times(bundle.ethPrice);
  const price1 = (token1.derivedETH as BigDecimal).times(bundle.ethPrice);

  // both are whitelist tokens, take average of both amounts
  if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0).plus(tokenAmount1.times(price1));
  }

  // take double value of the whitelisted token amount
  if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0).times(new BigDecimal("2"));
  }

  // take double value of the whitelisted token amount
  if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount1.times(price1).times(new BigDecimal("2"));
  }

  // neither token is on white list, tracked volume is 0
  return ZERO_BD;
}
