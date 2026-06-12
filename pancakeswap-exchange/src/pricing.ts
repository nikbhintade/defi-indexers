/**
 * Port of mappings/pricing.ts (BSC-rendered values: WBNB priced via the
 * BUSD-WBNB and USDT-WBNB pairs, 7-token whitelist, 10 BNB minimum
 * liquidity threshold).
 *
 * The original's only eth_call here — `factoryContract.getPair(token,
 * whitelist[i])` — is served from the PairTokenLookup entity written on
 * PairCreated, which carries exactly the same information (the factory's
 * symmetric pair mapping) without an RPC roundtrip. See MIGRATION.md.
 *
 * Store-staleness semantics match graph-node: entities are read through
 * `context.X.get`, so values set later in the calling handler (e.g. the
 * synced pair's own new reserves, which handleSync only saves at the end)
 * are not visible here — exactly like `Pair.load` against graph-node's
 * entity cache before `pair.save()`.
 */
import { BigDecimal, type Bundle, type EvmOnEventContext, type Token } from "envio";
import { ONE_BD, ZERO_BD } from "./utils";

const WBNB_ADDRESS = "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c";
const BUSD_WBNB_PAIR = "0x58f876857a02d6762e0101bb5c46a8c1ed44dc16"; // created block 589414
const USDT_WBNB_PAIR = "0x16b9a82891338f9ba80e2d6970fdda79d1eb0dae"; // created block 648115

export async function getBnbPriceInUSD(context: EvmOnEventContext): Promise<BigDecimal> {
  // fetch eth prices for each stablecoin
  const usdtPair = await context.Pair.get(USDT_WBNB_PAIR); // usdt is token0
  const busdPair = await context.Pair.get(BUSD_WBNB_PAIR); // busd is token1

  if (busdPair !== undefined && usdtPair !== undefined) {
    const totalLiquidityBNB = busdPair.reserve0.plus(usdtPair.reserve1);
    if (!totalLiquidityBNB.eq(ZERO_BD)) {
      const busdWeight = busdPair.reserve0.div(totalLiquidityBNB);
      const usdtWeight = usdtPair.reserve1.div(totalLiquidityBNB);
      return busdPair.token1Price.times(busdWeight).plus(usdtPair.token0Price.times(usdtWeight));
    } else {
      return ZERO_BD;
    }
  } else if (busdPair !== undefined) {
    return busdPair.token1Price;
  } else if (usdtPair !== undefined) {
    return usdtPair.token0Price;
  } else {
    return ZERO_BD;
  }
}

// token where amounts should contribute to tracked volume and liquidity
const WHITELIST: string[] = [
  "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c", // WBNB
  "0xe9e7cea3dedca5984780bafc599bd69add087d56", // BUSD
  "0x55d398326f99059ff775485246999027b3197955", // USDT
  "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d", // USDC
  "0x23396cf899ca06c4472205fc903bdb4de249d6fc", // UST
  "0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c", // BTCB
  "0x2170ed0880ac9a755fd29b2688956bd959f933f8", // WETH
];

// minimum liquidity for price to get tracked
const MINIMUM_LIQUIDITY_THRESHOLD_BNB = new BigDecimal("10");

/**
 * Search through graph to find derived BNB per token.
 * @todo update to be derived BNB (add stablecoin estimates)
 **/
export async function findBnbPerToken(context: EvmOnEventContext, token: Token): Promise<BigDecimal> {
  if (token.id == WBNB_ADDRESS) {
    return ONE_BD;
  }
  // loop through whitelist and check if paired with any
  for (let i = 0; i < WHITELIST.length; ++i) {
    // original: factoryContract.getPair(token, WHITELIST[i]) eth_call; the
    // lookup entity holds the same mapping (missing row == ADDRESS_ZERO).
    const lookup = await context.PairTokenLookup.get(token.id.concat("-").concat(WHITELIST[i]!));
    if (lookup !== undefined) {
      // original `Pair.load(...)` would null-deref-crash if the entity were
      // missing; the lookup row is written together with the Pair entity, so
      // getOrThrow mirrors that.
      const pair = await context.Pair.getOrThrow(lookup.pair_id);
      if (pair.token0_id == token.id && pair.reserveBNB.gt(MINIMUM_LIQUIDITY_THRESHOLD_BNB)) {
        const token1 = await context.Token.getOrThrow(pair.token1_id);
        return pair.token1Price.times(token1.derivedBNB as BigDecimal); // return token1 per our token * BNB per token 1
      }
      if (pair.token1_id == token.id && pair.reserveBNB.gt(MINIMUM_LIQUIDITY_THRESHOLD_BNB)) {
        const token0 = await context.Token.getOrThrow(pair.token0_id);
        return pair.token0Price.times(token0.derivedBNB as BigDecimal); // return token0 per our token * BNB per token 0
      }
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
  bundle: Bundle,
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token,
): BigDecimal {
  const price0 = (token0.derivedBNB as BigDecimal).times(bundle.bnbPrice);
  const price1 = (token1.derivedBNB as BigDecimal).times(bundle.bnbPrice);

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
 * Accepts tokens and amounts, return tracked fee amount based on token whitelist
 * If both are, return the difference between the token amounts
 * If not, return 0
 */
export function getTrackedFeeVolumeUSD(
  bundle: Bundle,
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token,
): BigDecimal {
  const price0 = (token0.derivedBNB as BigDecimal).times(bundle.bnbPrice);
  const price1 = (token1.derivedBNB as BigDecimal).times(bundle.bnbPrice);

  // both are whitelist tokens, take average of both amounts
  if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    const tokenAmount0USD = tokenAmount0.times(price0);
    const tokenAmount1USD = tokenAmount1.times(price1);
    if (tokenAmount0USD.gte(tokenAmount1USD)) {
      return tokenAmount0USD.minus(tokenAmount1USD);
    } else {
      return tokenAmount1USD.minus(tokenAmount0USD);
    }
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
  bundle: Bundle,
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token,
): BigDecimal {
  const price0 = (token0.derivedBNB as BigDecimal).times(bundle.bnbPrice);
  const price1 = (token1.derivedBNB as BigDecimal).times(bundle.bnbPrice);

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
