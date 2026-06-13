/**
 * Port of src/utils/helpers.ts (calc* + loadPendleData + isMarketLiquidityMiningV2
 * + printDebug) and the entity loaders from src/utils/load-entity.ts (loadUser,
 * loadUserMarketData). `getSushiLpPrice` / `getBalanceOf` live in pricing.ts.
 *
 * `context` / `block` are threaded so the original contract bindings become
 * cached, block-pinned eth_call Effects.
 */
import { BigDecimal, type EvmOnEventContext, type PendleData, type Pair, type Token, type User, type UserMarketData } from "envio";
import { ONE_BD, ONE_BI, RONE, RONE_BD, ZERO_BD, ZERO_BI, low, toBD } from "../utils";
import { marketGetReserves, marketTotalSupply } from "../effects/contracts";
import { getUniswapTokenPrice } from "./pricing";
import { loadToken } from "./tokens";

type Ctx = EvmOnEventContext;

function exponentToBigDecimal(decimals: bigint): BigDecimal {
  let bd = new BigDecimal("1");
  const ten = new BigDecimal("10");
  for (let i = 0n; i < decimals; i++) {
    bd = bd.times(ten);
  }
  return bd;
}

/** Port of loadUser (load-entity.ts). */
export async function loadUser(context: Ctx, address: string): Promise<User> {
  const id = low(address);
  const existing = await context.User.get(id);
  if (existing === undefined) {
    const user: User = { id, usdSwapped: ZERO_BD };
    context.User.set(user);
    return user;
  }
  return existing;
}

/** Port of loadPendleData (helpers.ts / load-entity.ts) — id is always "1". */
export async function loadPendleData(context: Ctx): Promise<PendleData> {
  const existing = await context.PendleData.get("1");
  const pendleData: PendleData =
    existing ?? { id: "1", protocolSwapFee: ZERO_BD, swapFee: ZERO_BD, exitFee: ZERO_BD };
  context.PendleData.set(pendleData);
  return pendleData;
}

/** Port of loadUserMarketData (load-entity.ts). id = user-market. */
export async function loadUserMarketData(context: Ctx, user: string, market: string): Promise<UserMarketData> {
  const id = low(user).concat("-").concat(low(market));
  const existing = await context.UserMarketData.get(id);
  if (existing !== undefined) {
    return existing;
  }
  const u = await loadUser(context, user);
  const ins: UserMarketData = {
    id,
    user_id: u.id,
    market_id: low(market),
    lpHolding: ZERO_BI,
    recordedUSDValue: ZERO_BD,
    capitalProvided: ZERO_BD,
    capitalWithdrawn: ZERO_BD,
    yieldClaimedRaw: ZERO_BD,
    yieldClaimedUsd: ZERO_BD,
    pendleRewardReceivedRaw: ZERO_BD,
    pendleRewardReceivedUSD: ZERO_BD,
  };
  context.UserMarketData.set(ins);
  return ins;
}

/** Port of calcLpPrice (helpers.ts). */
export async function calcLpPrice(
  context: Ctx,
  block: number,
  marketAddress: string,
  baseTokenAddress: string,
  baseTokenAmount: bigint,
  lpAmount: BigDecimal,
  isJoin: boolean,
): Promise<BigDecimal> {
  const baseToken = await loadToken(context, baseTokenAddress, block);
  const reserves = await marketGetReserves(context.effect, low(marketAddress), block);
  let tokenBalance = reserves === null ? 0n : reserves.tokenBalance;
  const tokenWeight = reserves === null ? 0n : reserves.tokenWeight;

  let totalLpSupply = toBD((await marketTotalSupply(context.effect, low(marketAddress), block)) ?? 0n);

  if (isJoin) {
    totalLpSupply = totalLpSupply.plus(lpAmount);
    tokenBalance = tokenBalance + baseTokenAmount;
  } else {
    totalLpSupply = totalLpSupply.minus(lpAmount);
    tokenBalance = tokenBalance - baseTokenAmount;
  }

  const priceOfBaseToken = await getUniswapTokenPrice(context, block, baseToken);
  const totalValueOfBaseToken = priceOfBaseToken
    .times(toBD(tokenBalance))
    .div(exponentToBigDecimal(baseToken.decimals));
  const baseTokenWeight = toBD(tokenWeight).div(RONE_BD);
  const lpPrice = totalValueOfBaseToken.div(baseTokenWeight).div(totalLpSupply);
  return lpPrice;
}

/** Port of calcMarketWorthUSD (helpers.ts). */
export async function calcMarketWorthUSD(context: Ctx, block: number, market: Pair): Promise<BigDecimal> {
  const baseToken = await loadToken(context, market.token1_id, block);
  const baseTokenWeight = toBD(market.token1WeightRaw).div(RONE_BD);
  const baseTokenBalance = market.reserve1;
  const baseTokenPrice = await getUniswapTokenPrice(context, block, baseToken);
  return baseTokenBalance.times(baseTokenPrice).div(baseTokenWeight);
}

/** Port of calcYieldTokenPrice (helpers.ts). */
export async function calcYieldTokenPrice(context: Ctx, block: number, market: Pair): Promise<BigDecimal> {
  const baseToken = await loadToken(context, market.token1_id, block);
  const baseTokenWeight = toBD(market.token1WeightRaw).div(RONE_BD);
  const yieldTokenWeight = ONE_BD.minus(baseTokenWeight);
  const baseTokenBalance = market.reserve1;
  const yieldTokenBalance = market.reserve0;
  const marketWorth = baseTokenBalance
    .times(await getUniswapTokenPrice(context, block, baseToken))
    .div(baseTokenWeight);
  return marketWorth.times(yieldTokenWeight).div(yieldTokenBalance);
}

/** Port of getLpPrice (helpers.ts). */
export function getLpPrice(market: Pair): BigDecimal {
  return market.reserveUSD.div(market.totalSupply);
}

/** Port of isMarketLiquidityMiningV2 (helpers.ts). */
export async function isMarketLiquidityMiningV2(context: Ctx, marketAddress: string): Promise<boolean> {
  const lm = await context.LiquidityMining.get(low(marketAddress));
  return lm !== undefined;
}

/**
 * Port of printDebug (helpers.ts). Writes a sequentially-keyed DebugLog entity.
 * DebugLog is diagnostic-only and excluded from validation.json; the sequential
 * id may differ from graph-node under HyperIndex's parallel preload, which is
 * acceptable since it is never compared. See MIGRATION.md.
 */
export async function printDebug(context: Ctx, message: string, type: string): Promise<void> {
  let id = "";
  const root = await context.DebugLog.get("0");
  if (root === undefined || root === null) {
    id = "0";
  } else {
    const newLength = (root.length ?? ZERO_BI) + ONE_BI;
    context.DebugLog.set({ ...root, length: newLength });
    id = newLength.toString();
  }
  context.DebugLog.set({ id, message, type, length: ZERO_BI });
}

export { exponentToBigDecimal };
