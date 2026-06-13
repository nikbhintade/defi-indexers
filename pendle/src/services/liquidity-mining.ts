/**
 * Port of the liquidity-mining + sushiswap APR logic shared across handlers:
 *  - updateMarketLiquidityMiningApr (src/pendle/market.ts)
 *  - getMarketLiquidityMining / hardcodedLiquidityMining / loadLiquidityMiningV1
 *    (src/pendle/liquidity-mining-v1.ts, src/utils/load-entity.ts)
 *  - getExpiryMarket (src/pendle/liquidity-mining-v1.ts)
 *  - updateSushiswapPair / getOtApr (src/sushiswap/factory.ts)
 *
 * Template registration (`PendleLiquidityMiningV1.create`) is split out: the
 * address is added via `indexer.contractRegister` in the handlers; the entity
 * creation stays here.
 */
import { BigDecimal, type EvmOnEventContext, type LiquidityMining, type Pair, type SushiswapPair } from "envio";
import {
  ADDRESS_ZERO,
  DAYS_PER_WEEK_BD,
  DAYS_PER_YEAR_BD,
  LM_ALLOC_DENOM,
  ONE_BD,
  ONE_BI,
  PENDLE_TOKEN_ADDRESS,
  TWO_BD,
  ZERO_BD,
  ZERO_BI,
  convertTokenToDecimal,
  low,
  toBD,
} from "../utils";
import {
  lm1AllocationSettings,
  lm1EpochDuration,
  lm1LatestSetting,
  lm1ReadEpochData,
  lm1ReadExpiryData,
  lm1StartTime,
  lm1TryStartTime,
  lm2EpochDuration,
  lm2ReadEpochData,
  lm2StartTime,
  lm2TotalStake,
  lpHolderPendleMarket,
  sushiTotalSupply,
} from "../effects/contracts";
import { getBalanceOf, getPendlePrice, getUniswapAddressPrice, getUniswapTokenPrice } from "./pricing";
import { getLpPrice, isMarketLiquidityMiningV2, loadUserMarketData } from "./helpers";
import { loadToken } from "./tokens";

type Ctx = EvmOnEventContext;

/**
 * mainnet market -> liquidity-mining-v1 hardcoded mapping (from
 * hardcodedLiquidityMining). Returns the LM address (lowercase) or "".
 */
export function hardcodedLmV1Address(marketAddress: string): string {
  const str = low(marketAddress);
  // mainnet eth-usdc slp - usdc
  if (str == "0x79c05da47dc20ff9376b2f7dbf8ae0c994c3a0d0") return "0xa78029ab5235b9a83ec45ed036042db26c6e4300";
  // mainnet pendle-eth slp
  if (str == "0x685d32f394a5f03e78a1a0f6a91b4e2bf6f52cfe") return "0x0f3bccbfef1dc227f33a11d7a51cd02dead208c8";
  // mainnet cdai
  if (str == "0xb26c86330fc7f97533051f2f8cd0a90c2e82b5ee" || str == "0x944d1727d0b656f497e74044ff589871c330334f")
    return "0x5b1c59eb6872f88a92469751a034b9b5ada9a73f";
  // mainnet ausdc
  if (str == "0x8315bcbc2c5c1ef09b71731ab3827b0808a2d6bd" || str == "0x9e382e5f78b06631e4109b5d48151f2b3f326df0")
    return "0x6f40a68e99645c60f14b497e75ae024777d61726";
  // kovan addresses are unreachable on mainnet but preserved for fidelity
  if (str == "0x68fc791abd6339c064146ddc9506774aa142efbe") return "0x63faa1e8faebafa0209e8a9fb4c418828485de85";
  if (str == "0x4835f1f01102ea3c033ae193ec6ec63961863335") return "0x5fdbb48fced67425ab0598544de1aa63c220ea9d";
  if (str == "0x16d7dd5673ed2f1adaaa0feabba2271585e498cc" || str == "0xba83823e364646d0d60ecfc9b2b31311abf66688")
    return "0x25fc31df947eb3d92cfbdbbc38ebcf8519be49bc";
  if (str == "0xbcd2962e406a3265a90d4ed54880cc089bc8ec1f" || str == "0x2c49cf6bba5b6263d15c2afe79d98fa8a0386ec2")
    return "0x4a7e31f01119c921fda702e54a882a289cf7c637";
  return "";
}

/** Port of loadLiquidityMiningV1 (entity creation only; registration is done in the handler). */
export async function loadLiquidityMiningV1(context: Ctx, lmAddress: string): Promise<LiquidityMining> {
  const id = low(lmAddress);
  const existing = await context.LiquidityMining.get(id);
  if (existing !== undefined) {
    return existing;
  }
  const lm: LiquidityMining = { id, lmAddress: undefined };
  context.LiquidityMining.set(lm);
  return lm;
}

/** Port of getMarketLiquidityMining. Returns the LM entity (v2 if present, else hardcoded v1) or null. */
export async function getMarketLiquidityMining(context: Ctx, marketAddress: string): Promise<LiquidityMining | null> {
  const lm = await context.LiquidityMining.get(low(marketAddress));
  if (lm === undefined) {
    return hardcodedLiquidityMining(context, marketAddress);
  }
  return lm;
}

/** Port of hardcodedLiquidityMining. */
export async function hardcodedLiquidityMining(context: Ctx, marketAddress: string): Promise<LiquidityMining | null> {
  const lmAddress = hardcodedLmV1Address(marketAddress);
  if (lmAddress.length > 0) {
    return loadLiquidityMiningV1(context, lmAddress);
  }
  return null;
}

/** Port of getExpiryMarket (liquidity-mining-v1.ts). Returns market address (lowercase) or null. */
export async function getExpiryMarket(
  context: Ctx,
  block: number,
  liquidityMining: string,
  expiry: bigint,
): Promise<string | null> {
  const expiryData = await lm1ReadExpiryData(context.effect, low(liquidityMining), expiry, block);
  if (expiryData === null) return null;
  const lpHolder = expiryData.lpHolder;
  return lpHolderPendleMarket(context.effect, lpHolder);
}

/** Port of updateMarketLiquidityMiningApr (market.ts). Mutates + persists the Pair. */
export async function updateMarketLiquidityMiningApr(context: Ctx, block: number, timestamp: bigint, pairInput: Pair): Promise<void> {
  let pair = pairInput;
  const marketAddress = low(pair.id);

  if (!(await isMarketLiquidityMiningV2(context, marketAddress))) {
    // ---- LMV1 ----
    if (pair.liquidityMining_id == null) return; // LMV1 not found as well

    const lm = pair.liquidityMining_id as string;
    const pendleToken = await loadToken(context, PENDLE_TOKEN_ADDRESS, block);

    // see if Liquidity Mining is deployed?
    const tryContract = await lm1TryStartTime(context.effect, lm);
    if (tryContract === null) {
      return;
    }

    if (pair.yieldTokenHolderAddress == null) {
      const expiryData = await lm1ReadExpiryData(context.effect, lm, pair.expiry, block);
      pair = { ...pair, yieldTokenHolderAddress: expiryData === null ? undefined : expiryData.lpHolder };
      context.Pair.set(pair);
    }

    const lpPrice = pair.lpPriceUSD;
    if (lpPrice.eq(ZERO_BD)) {
      return;
    }

    let currentEpoch = ZERO_BI;
    const t = timestamp;
    const startTime = (await lm1StartTime(context.effect, lm)) ?? 0n;
    const epochDuration = (await lm1EpochDuration(context.effect, lm)) ?? 0n;
    if (t >= startTime && epochDuration !== 0n) {
      currentEpoch = (t - startTime) / epochDuration + ONE_BI;
    }

    const epochData = await lm1ReadEpochData(context.effect, lm, currentEpoch, block);
    const totalReward = epochData === null ? 0n : epochData.totalRewards;
    let settingId = epochData === null ? 0n : epochData.settingId;

    if (settingId === ZERO_BI) {
      const latest = await lm1LatestSetting(context.effect, lm, block);
      settingId = latest === null ? 0n : latest.id;
    }
    const alloc = (await lm1AllocationSettings(context.effect, lm, settingId, pair.expiry, block)) ?? 0n;
    const actualReward = (totalReward * alloc) / LM_ALLOC_DENOM;
    const expiryData2 = await lm1ReadExpiryData(context.effect, lm, pair.expiry, block);
    const totalStakeLp = expiryData2 === null ? 0n : expiryData2.totalStakeLP;
    if (totalStakeLp === ZERO_BI) {
      return;
    }

    pair = { ...pair, lpStaked: toBD(totalStakeLp) };
    pair = { ...pair, lpStakedUSD: pair.lpPriceUSD.times(pair.lpStaked) };

    const pendlePerLpBD = convertTokenToDecimal(actualReward, pendleToken.decimals).div(pair.lpStakedUSD);

    const apw = pendlePerLpBD.times(await getPendlePrice(context, block));
    pair = { ...pair, lpAPR: apw.times(DAYS_PER_YEAR_BD).div(DAYS_PER_WEEK_BD) };
    context.Pair.set(pair);
    return;
  } else {
    // ---- LMV2 ----
    if (pair.liquidityMining_id == null) {
      const lmInstance = await context.LiquidityMining.getOrThrow(marketAddress);
      pair = { ...pair, liquidityMining_id: lmInstance.lmAddress ?? undefined };
      pair = { ...pair, yieldTokenHolderAddress: pair.liquidityMining_id ?? undefined };
      context.Pair.set(pair);
    }

    const lmAddress = pair.liquidityMining_id as string;

    const startTime = (await lm2StartTime(context.effect, lmAddress)) ?? 0n;
    const epochDuration = (await lm2EpochDuration(context.effect, lmAddress)) ?? 0n;
    let currentEpoch = ZERO_BI;

    if (timestamp >= startTime && epochDuration !== 0n) {
      currentEpoch = (timestamp - startTime) / epochDuration + ONE_BI;
    }

    const epochData = await lm2ReadEpochData(context.effect, lmAddress, currentEpoch, ADDRESS_ZERO, block);
    const totalStaked = (await lm2TotalStake(context.effect, lmAddress, block)) ?? 0n;
    const totalReward = epochData === null ? 0n : epochData.totalRewards;

    pair = { ...pair, lpStaked: toBD(totalStaked) };
    pair = { ...pair, lpStakedUSD: pair.lpStaked.times(pair.lpPriceUSD) };

    const pendleToken = await loadToken(context, PENDLE_TOKEN_ADDRESS, block);
    const pendlePerLp = convertTokenToDecimal(totalReward, pendleToken.decimals).div(toBD(totalStaked));

    const apw = pendlePerLp.times(await getPendlePrice(context, block)).div(pair.lpPriceUSD);
    pair = {
      ...pair,
      lpAPR: apw.times(DAYS_PER_YEAR_BD).div(DAYS_PER_WEEK_BD).times(new BigDecimal("100")),
    };
    context.Pair.set(pair);
  }
}

/** Port of updateSushiswapPair (sushiswap/factory.ts). Returns the updated SushiswapPair. */
export async function updateSushiswapPair(context: Ctx, block: number, pairAddress: string, timestamp: bigint): Promise<SushiswapPair> {
  const pair = await context.SushiswapPair.getOrThrow(low(pairAddress));
  const otAddress = low(pair.otToken_id);
  const baseTokenAddress = low(pair.baseToken_id);
  const otBalance = await getBalanceOf(context, block, otAddress, low(pairAddress));
  const baseTokenBalance = await getBalanceOf(context, block, baseTokenAddress, low(pairAddress));
  const baseTokenPrice = await getUniswapAddressPrice(context, block, baseTokenAddress);
  const marketWorth = baseTokenPrice.times(baseTokenBalance).times(TWO_BD);

  if (otBalance.eq(ZERO_BD) || marketWorth.eq(ZERO_BD)) {
    return pair;
  }

  const otPrice = marketWorth.div(TWO_BD).div(otBalance);
  const updated: SushiswapPair = {
    ...pair,
    baseTokenPrice,
    updatedAt: timestamp,
    marketWorthUSD: marketWorth,
    baseTokenBalance,
    otBalance,
    otPrice,
    lpPrice: ONE_BD,
    totalStaked: ZERO_BI,
    aprPercentage: ZERO_BD,
  };
  context.SushiswapPair.set(updated);

  await getOtApr(context, block, updated, timestamp);
  // getOtApr may have re-persisted the pair with apr/lpPrice/totalStaked/
  // totalReward; in the AssemblyScript original these mutations are on the same
  // object the caller continues to use, so return the latest persisted state
  // (re-read) rather than the pre-getOtApr `updated` copy.
  return (await context.SushiswapPair.get(low(pairAddress))) ?? updated;
}

/** Port of getOtApr (sushiswap/factory.ts). Mutates + persists the SushiswapPair. */
export async function getOtApr(context: Ctx, block: number, pairInput: SushiswapPair, timestamp: bigint): Promise<void> {
  const lmInstance = await context.LiquidityMining.get(low(pairInput.id));
  if (lmInstance === undefined) return;
  const lmAddr = lmInstance.lmAddress as string;
  const totalSupply = (await sushiTotalSupply(context.effect, low(pairInput.id), block)) ?? 0n;

  const startTime = (await lm2StartTime(context.effect, lmAddr)) ?? 0n;
  const epochDuration = (await lm2EpochDuration(context.effect, lmAddr)) ?? 0n;
  let currentEpoch = ZERO_BI;
  const lpPrice = (pairInput.marketWorthUSD ?? ZERO_BD).div(toBD(totalSupply));

  if (timestamp >= startTime && epochDuration !== 0n) {
    currentEpoch = (timestamp - startTime) / epochDuration + ONE_BI;
  }

  const epochData = await lm2ReadEpochData(context.effect, lmAddr, currentEpoch, ADDRESS_ZERO, block);
  const totalStaked = (await lm2TotalStake(context.effect, lmAddr, block)) ?? 0n;
  const totalReward = epochData === null ? 0n : epochData.totalRewards;

  if (totalStaked === ZERO_BI) return;

  const pendleToken = await loadToken(context, PENDLE_TOKEN_ADDRESS, block);
  const pendlePerLp = convertTokenToDecimal(totalReward, pendleToken.decimals).div(toBD(totalStaked));

  const apw = pendlePerLp.times(await getPendlePrice(context, block)).div(lpPrice);
  const updated: SushiswapPair = {
    ...pairInput,
    lpPrice,
    totalStaked,
    totalReward,
    aprPercentage: apw.times(DAYS_PER_YEAR_BD).div(DAYS_PER_WEEK_BD).times(new BigDecimal("100")),
  };
  context.SushiswapPair.set(updated);
}

/** Port of isOwnershipToken (sushiswap/factory.ts). */
export async function isOwnershipToken(context: Ctx, tokenAddress: string): Promise<boolean> {
  const token = await context.Token.get(low(tokenAddress));
  if (token === undefined || token.type !== "ot") {
    return false;
  }
  return true;
}

/** Port of redeemLpInterests (market.ts). Used by LM redeem call handlers (omitted) — kept for completeness. */
export async function redeemLpInterests(context: Ctx, block: number, user: string, market: string, amount: bigint): Promise<void> {
  const pair = await context.Pair.getOrThrow(low(market));
  const yt = await context.Token.getOrThrow(pair.token0_id);
  const yieldBearingAsset = await loadToken(context, yt.underlyingAsset as string, block);
  const amountBD = convertTokenToDecimal(amount, yieldBearingAsset.decimals);
  const relation = await loadUserMarketData(context, user, market);
  context.UserMarketData.set({
    ...relation,
    yieldClaimedRaw: relation.yieldClaimedRaw.plus(amountBD),
    yieldClaimedUsd: relation.yieldClaimedUsd.plus(amountBD.times(await getUniswapTokenPrice(context, block, yieldBearingAsset))),
  });
}
