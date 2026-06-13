/**
 * Port of src/uniswap/pricing.ts plus getSushiLpPrice / getPendlePrice
 * (originally in helpers.ts / sushiswap/factory.ts — colocated here to keep the
 * pricing graph in one module).
 *
 * `context` and `block` are threaded through so the original's contract
 * bindings become cached, block-pinned eth_call Effects. State-dependent
 * reads (slot0, cToken rate, sushi reserves, balances) are pinned to the event
 * block; immutable reads (token0/token1) are not.
 *
 * This port targets mainnet (isMainnet = true), so the kovan price branches in
 * the original are unreachable; they are preserved for fidelity.
 */
import { BigDecimal, type EvmOnEventContext, type Token } from "envio";
import {
  COMPOUND_EXCHANGE_RATE_DECIMAL,
  ONE_BD,
  PENDLE_ETH_SUSHISWAP,
  PENDLE_TOKEN_ADDRESS,
  STABLE_USD_TOKENS,
  TWO_BD,
  UNISWAP_Q192,
  USDC_WETH_03_POOL,
  WETH_ADDRESS,
  ZERO_BD,
  exponentToBigDecimal,
  isMainnet,
  low,
  toBD,
} from "../utils";
import {
  cTokenExchangeRate,
  erc20BalanceOf,
  sushiReserve0,
  sushiToken0,
  sushiTotalSupply,
  uniSlot0SqrtPrice,
  uniToken0,
  uniToken1,
} from "../effects/contracts";
import { getUniswapPoolAddress } from "./uniswap-pools";
import { loadToken } from "./tokens";

type Ctx = EvmOnEventContext;

/**
 * Port of getBalanceOf (helpers.ts): non-try ERC20.balanceOf, converted to
 * decimals. Pinned to the event block.
 */
export async function getBalanceOf(
  context: Ctx,
  block: number,
  tokenAddress: string,
  ofAddress: string,
): Promise<BigDecimal> {
  const token = await loadToken(context, tokenAddress, block);
  const raw = await erc20BalanceOf(context.effect, low(tokenAddress), low(ofAddress), block);
  const value = raw === null ? 0n : raw;
  return convert(value, token.decimals);
}

function convert(tokenAmount: bigint, exchangeDecimals: bigint): BigDecimal {
  if (exchangeDecimals === 0n) return toBD(tokenAmount);
  return toBD(tokenAmount).div(exponentToBigDecimal(exchangeDecimals));
}

/** Port of getCTokenCurrentRate. */
export async function getCTokenCurrentRate(context: Ctx, block: number, token: Token): Promise<BigDecimal> {
  const underlyingAssetAddress = token.underlyingAsset as string;
  const underlyingAsset = await loadToken(context, underlyingAssetAddress, block);

  const rate = await cTokenExchangeRate(context.effect, low(token.id), block);
  const rateBD = rate === null ? ZERO_BD : toBD(rate);
  return rateBD
    .div(COMPOUND_EXCHANGE_RATE_DECIMAL)
    .div(exponentToBigDecimal(underlyingAsset.decimals - token.decimals));
}

/** Port of getPoolPrice (UniswapV3). */
export async function getPoolPrice(context: Ctx, block: number, poolAddress: string, inToken: string): Promise<BigDecimal> {
  const tryPrice = kovanHardcodedPrice(poolAddress);
  if (tryPrice.gt(ZERO_BD)) {
    return tryPrice;
  }

  const token0Address = (await uniToken0(context.effect, poolAddress)) ?? "";
  const token1Address = (await uniToken1(context.effect, poolAddress)) ?? "";
  const token0Decimals = exponentToBigDecimal((await loadToken(context, token0Address, block)).decimals);
  const token1Decimals = exponentToBigDecimal((await loadToken(context, token1Address, block)).decimals);

  const slot0 = await uniSlot0SqrtPrice(context.effect, poolAddress, block);
  const poolState = slot0 === null ? ZERO_BD : toBD(slot0);
  const price0 = poolState
    .times(poolState)
    .div(UNISWAP_Q192)
    .times(token0Decimals)
    .div(token1Decimals);

  // original compares `inToken.toString() == token0Address.toString()` (both
  // checksummed/lowercased addresses); compare lowercase strings here.
  if (low(inToken) == low(token0Address)) {
    return price0;
  } else {
    return ONE_BD.div(price0);
  }
}

/** Port of getEthPrice. */
export async function getEthPrice(context: Ctx, block: number): Promise<BigDecimal> {
  return getPoolPrice(context, block, USDC_WETH_03_POOL, WETH_ADDRESS);
}

/** Port of getUnderlyingPrice. */
export async function getUnderlyingPrice(context: Ctx, block: number, tokenAddress: string): Promise<BigDecimal> {
  if (!isMainnet) {
    return getKovanTokenPrice(await loadToken(context, tokenAddress, block));
  }
  const poolAddress = await getUniswapPoolAddress(context, tokenAddress, WETH_ADDRESS);
  if (poolAddress) {
    // tokenPrice = token/eth * eth price
    return (await getPoolPrice(context, block, poolAddress, tokenAddress)).times(await getEthPrice(context, block));
  } else {
    for (let i = 0; i < STABLE_USD_TOKENS.length; ++i) {
      const usdToken = STABLE_USD_TOKENS[i]!;
      const pool = await getUniswapPoolAddress(context, tokenAddress, usdToken);
      if (pool) {
        return getPoolPrice(context, block, pool, tokenAddress);
      }
    }
  }
  return ZERO_BD;
}

/** Port of getUniswapTokenPrice. */
export async function getUniswapTokenPrice(context: Ctx, block: number, token: Token): Promise<BigDecimal> {
  if (low(token.id) == PENDLE_TOKEN_ADDRESS) return getPendlePrice(context, block);
  if (token.underlyingAsset != null && (token.forgeId ?? "").startsWith("Sushi")) {
    return getSushiLpPrice(context, block, low(token.id));
  }

  const isYieldBearingToken = token.underlyingAsset != null;
  const tokenHexString = isYieldBearingToken ? (token.underlyingAsset as string) : token.id;
  let tokenPrice = await getUnderlyingPrice(context, block, tokenHexString);

  // When there are new forges, you will need to hardcode their formulas yourself
  if (isYieldBearingToken) {
    if ((token.forgeId ?? "").startsWith("Compound")) {
      tokenPrice = tokenPrice.times(await getCTokenCurrentRate(context, block, token));
    }
    if ((token.forgeId ?? "").startsWith("Aave")) {
      // Currently we just leave 1 token = 1 aave token
    }
  }
  return tokenPrice;
}

/** Port of getUniswapAddressPrice. */
export async function getUniswapAddressPrice(context: Ctx, block: number, tokenAddress: string): Promise<BigDecimal> {
  const token = await loadToken(context, tokenAddress, block);
  return getUniswapTokenPrice(context, block, token);
}

/** Port of getSushiLpPrice (helpers.ts). */
export async function getSushiLpPrice(context: Ctx, block: number, lpAddress: string): Promise<BigDecimal> {
  const lpToken = await loadToken(context, lpAddress, block);
  const totalSupplyRaw = (await sushiTotalSupply(context.effect, low(lpAddress), block)) ?? 0n;
  const totalSupply = convert(totalSupplyRaw, lpToken.decimals);

  const token0Addr = (await sushiToken0(context.effect, low(lpAddress))) ?? "";
  const token = await loadToken(context, token0Addr, block);
  const tokenPrice = await getUniswapTokenPrice(context, block, token);
  const reserve0 = (await sushiReserve0(context.effect, low(lpAddress), block)) ?? 0n;
  const tokenBalance = convert(reserve0, token.decimals);
  return tokenBalance.times(tokenPrice).times(TWO_BD).div(totalSupply);
}

/** Port of getPendlePrice (sushiswap/factory.ts). */
export async function getPendlePrice(context: Ctx, block: number): Promise<BigDecimal> {
  if (!isMainnet) return ONE_BD;
  const pendleBalance = await getBalanceOf(context, block, PENDLE_TOKEN_ADDRESS, PENDLE_ETH_SUSHISWAP);
  const wethBalance = await getBalanceOf(context, block, WETH_ADDRESS, PENDLE_ETH_SUSHISWAP);
  const wethPrice = await getEthPrice(context, block);
  return wethPrice.times(wethBalance).div(pendleBalance);
}

// ---------- kovan branches (unreachable on mainnet, preserved for fidelity) ----------

export function kovanHardcodedPrice(pool: string): BigDecimal {
  const p = low(pool);
  if (p == "0x89007e48d47484245805679ab37114db117afab2") return new BigDecimal("0.0005");
  if (p == "0x877bd57caf5a8620f06e80688070f23f091df3b1") return new BigDecimal("0.0005");
  if (p == "0xbaca9d50c2ae0cd5b9a457e7dbe38c673197caa3") return new BigDecimal("2000");
  return new BigDecimal("0");
}

export function getKovanTokenPrice(token: Token): BigDecimal {
  const id = low(token.id);
  if (id == "0xd0a1e359811322d97991e03f863a0c30c2cf029c") return new BigDecimal("2000");
  if (id == "0x4f96fe3b7a6cf9725f59d353f723c1bdb64ca6aa") return ONE_BD;
  if (id == "0xe22da380ee6b445bb8273c81944adeb6e8450422") return ONE_BD;
  if (id == "0x13512979ade267ab5100878e2e0f485b568328a4") return ONE_BD;
  if (id == "0xb7a4f3e9097c08da09517b5ab877f7a917224ede") return ONE_BD;
  if (id == PENDLE_TOKEN_ADDRESS) return ONE_BD;
  return new BigDecimal("0");
}
