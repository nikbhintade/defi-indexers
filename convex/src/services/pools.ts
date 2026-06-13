/**
 * Port of src/services/pools.ts.
 *
 * envio entities are immutable plain objects, so the mutate-then-`pool.save()`
 * pattern becomes: build/spread a new object and `context.Pool.set(...)`.
 * Functions that the original mutated in place (getPoolCoins / getPoolExtras*)
 * here take the current pool, perform their reads + entity writes, and RETURN
 * the updated pool so callers keep working with the latest copy.
 */
import { BigDecimal, type EffectCaller, type EvmOnEventContext, type ExtraReward, type Pool } from "envio";
import {
  ADDRESS_ZERO,
  BIG_DECIMAL_1E18,
  BIG_DECIMAL_ONE,
  BIG_DECIMAL_ZERO,
  BIG_INT_MINUS_ONE,
  BIG_INT_ONE,
  BIG_INT_ZERO,
  CONVEX_PLATFORM_ID,
  CRV_ADDRESS,
  CVX_ADDRESS,
} from "../constants";
import { toBigDecimal } from "../utils";
import { getCvxMintAmount, getUsdRate } from "./pricing";
import {
  erc20TotalSupply,
  poolCoins,
  poolXcpProfit,
  poolXcpProfitA,
  rewardPoolPeriodFinish,
  rewardPoolRewardRate,
  rewardPoolTotalSupply,
  stashGetName,
  stashTokenCount,
  stashTokenList,
  stashV1TokenInfo,
  stashV2TokenInfo,
  stashV3TokenInfo,
} from "../effects/contracts";

type EC = EffectCaller | null;

export async function getPool(context: EvmOnEventContext, pid: string): Promise<Pool> {
  let pool = await context.Pool.get(pid);
  if (!pool) {
    pool = createNewPool(context, BigInt(pid));
  }
  return pool;
}

/** Builds, persists and returns a new Pool entity (mirrors `createNewPool`). */
export function createNewPool(context: EvmOnEventContext, pid: bigint): Pool {
  const pool: Pool = {
    id: pid.toString(),
    poolid: pid,
    platform_id: CONVEX_PLATFORM_ID,
    name: "",
    lpToken: ADDRESS_ZERO,
    lpTokenBalance: 0n,
    lpTokenUSDPrice: BIG_DECIMAL_ZERO,
    token: ADDRESS_ZERO,
    gauge: ADDRESS_ZERO,
    crvRewardsPool: ADDRESS_ZERO,
    swap: ADDRESS_ZERO,
    stash: ADDRESS_ZERO,
    stashVersion: 0n,
    stashMinorVersion: 0n,
    active: true,
    isV2: false,
    isLending: false,
    creationBlock: 0n,
    creationDate: 0n,
    tvl: BIG_DECIMAL_ZERO,
    crvApr: BIG_DECIMAL_ZERO,
    curveTvlRatio: BIG_DECIMAL_ZERO,
    cvxApr: BIG_DECIMAL_ZERO,
    extraRewardsApr: BIG_DECIMAL_ZERO,
    baseApr: BIG_DECIMAL_ZERO,
    rawBaseApr: BIG_DECIMAL_ZERO,
    assetType: 0,
    coins: [],
    extras: [],
  };
  context.Pool.set(pool);
  return pool;
}

/** Mirrors `getPoolCoins`: walk coins(0..) until revert. Returns updated pool. */
export async function getPoolCoins(context: EvmOnEventContext, ec: EC, pool: Pool): Promise<Pool> {
  let i = 0;
  const coins: string[] = [...pool.coins];
  let coinResult = await poolCoins(ec, pool.swap, i);
  while (coinResult !== null) {
    coins.push(coinResult);
    i += 1;
    coinResult = await poolCoins(ec, pool.swap, i);
  }
  const updated: Pool = { ...pool, coins };
  context.Pool.set(updated);
  return updated;
}

export function createNewExtraReward(
  context: EvmOnEventContext,
  poolid: bigint,
  rewardContract: string,
  rewardToken: string,
): string {
  const extraRewardId = poolid.toString() + rewardContract.toLowerCase() + rewardToken.toLowerCase();
  const extraReward: ExtraReward = {
    id: extraRewardId,
    poolid_id: poolid.toString(),
    contract: rewardContract.toLowerCase(),
    token: rewardToken.toLowerCase(),
  };
  context.ExtraReward.set(extraReward);
  return extraRewardId;
}

export async function getPoolExtras(
  context: EvmOnEventContext,
  ec: EC,
  block: number,
  pool: Pool,
): Promise<Pool> {
  switch (Number(pool.stashVersion)) {
    case 1:
      return getPoolExtrasV1(context, ec, pool);
    case 2:
      return getPoolExtrasV2(context, ec, block, pool);
    case 3:
      return getPoolExtrasV3(context, ec, block, pool);
  }
  return pool;
}

export async function getPoolExtrasV1(context: EvmOnEventContext, ec: EC, pool: Pool): Promise<Pool> {
  // rewards already set
  if (pool.extras.length > 0) {
    return pool;
  }
  const tokenInfoResult = await stashV1TokenInfo(ec, pool.stash);
  if (tokenInfoResult === null) {
    context.log.warn(`Failed to get token info for ${pool.stash}`);
    return pool;
  }
  const rewardToken = tokenInfoResult[0].toLowerCase();
  const rewardContract = tokenInfoResult[1].toLowerCase();
  if (rewardToken != ADDRESS_ZERO || rewardContract != ADDRESS_ZERO) {
    const extras = [...pool.extras, createNewExtraReward(context, pool.poolid, rewardContract, rewardToken)];
    const updated: Pool = { ...pool, extras };
    context.Pool.set(updated);
    return updated;
  }
  return pool;
}

export async function getPoolExtrasV2(
  context: EvmOnEventContext,
  ec: EC,
  block: number,
  pool: Pool,
): Promise<Pool> {
  const tokenCountResult = await stashTokenCount(ec, pool.stash, block);
  const tokenCount = tokenCountResult === null ? BigInt(pool.extras.length) : tokenCountResult;
  let current = pool;
  // we only add new rewards if tokenCount is different from what we already know
  for (let i = current.extras.length; i < Number(tokenCount); i++) {
    const tokenInfoResult = await stashV2TokenInfo(ec, current.stash, BigInt(i));
    if (tokenInfoResult === null) {
      context.log.warn(`Failed to get token info for ${current.stash}`);
      continue;
    }
    const rewardToken = tokenInfoResult[0].toLowerCase();
    const rewardContract = tokenInfoResult[1].toLowerCase();
    if (rewardToken != ADDRESS_ZERO || rewardContract != ADDRESS_ZERO) {
      const extras = [...current.extras, createNewExtraReward(context, current.poolid, rewardContract, rewardToken)];
      current = { ...current, extras };
      context.Pool.set(current);
    }
  }
  return current;
}

export async function getPoolExtrasV30(
  context: EvmOnEventContext,
  ec: EC,
  block: number,
  pool: Pool,
): Promise<Pool> {
  // same shape as v2 (tokenInfo(uint256))
  const tokenCountResult = await stashTokenCount(ec, pool.stash, block);
  const tokenCount = tokenCountResult === null ? BigInt(pool.extras.length) : tokenCountResult;
  let current = pool;
  for (let i = current.extras.length; i < Number(tokenCount); i++) {
    const tokenInfoResult = await stashV2TokenInfo(ec, current.stash, BigInt(i));
    if (tokenInfoResult === null) {
      context.log.warn(`Failed to get token info for ${current.stash}`);
      continue;
    }
    const rewardToken = tokenInfoResult[0].toLowerCase();
    const rewardContract = tokenInfoResult[1].toLowerCase();
    if (rewardToken != ADDRESS_ZERO || rewardContract != ADDRESS_ZERO) {
      const extras = [...current.extras, createNewExtraReward(context, current.poolid, rewardContract, rewardToken)];
      current = { ...current, extras };
      context.Pool.set(current);
    }
  }
  return current;
}

export async function getPoolExtrasV33(
  context: EvmOnEventContext,
  ec: EC,
  block: number,
  pool: Pool,
): Promise<Pool> {
  const tokenCountResult = await stashTokenCount(ec, pool.stash, block);
  const tokenCount = tokenCountResult === null ? BigInt(pool.extras.length) : tokenCountResult;
  let current = pool;
  for (let i = current.extras.length; i < Number(tokenCount); i++) {
    const tokenListResult = await stashTokenList(ec, current.stash, BigInt(i));
    if (tokenListResult === null) {
      context.log.warn(`Failed to get token list from ${current.stash}`);
      continue;
    }
    const tokenInfoResult = await stashV3TokenInfo(ec, current.stash, tokenListResult);
    if (tokenInfoResult === null) {
      context.log.warn(`Failed to get token info for ${tokenListResult}`);
      continue;
    }
    const rewardToken = tokenInfoResult[0].toLowerCase();
    const rewardContract = tokenInfoResult[1].toLowerCase();
    if (rewardToken != ADDRESS_ZERO || rewardContract != ADDRESS_ZERO) {
      const extras = [...current.extras, createNewExtraReward(context, current.poolid, rewardContract, rewardToken)];
      current = { ...current, extras };
      context.Pool.set(current);
    }
  }
  return current;
}

export async function getPoolExtrasV3(
  context: EvmOnEventContext,
  ec: EC,
  block: number,
  pool: Pool,
): Promise<Pool> {
  let current = pool;

  // determine the minor version of v3 contracts if not done before
  if (current.stashMinorVersion == BIG_INT_MINUS_ONE) {
    const contractNameResult = await stashGetName(ec, current.stash);
    if (contractNameResult !== null) {
      // account for "ExtraRewardStashV3", "V3.1", "V3.2", "V3.3"
      const suffix = contractNameResult.slice(contractNameResult.length - 2, contractNameResult.length);
      let minorVersion = 0;
      if (suffix == ".1") {
        minorVersion = 1;
      } else if (suffix == ".2") {
        minorVersion = 2;
      } else if (suffix == ".3") {
        minorVersion = 3;
      }
      current = { ...current, stashMinorVersion: BigInt(minorVersion) };
      context.Pool.set(current);
    }
  }

  if (current.stashMinorVersion == BIG_INT_ZERO) {
    return getPoolExtrasV30(context, ec, block, current);
  }
  if (current.stashMinorVersion == 3n) {
    return getPoolExtrasV33(context, ec, block, current);
  }

  // v3.1 and v3.2 share the same ABI (tokenList(uint256) + tokenInfo(address))
  const tokenCountResult = await stashTokenCount(ec, current.stash, block);
  const tokenCount = tokenCountResult === null ? BigInt(current.extras.length) : tokenCountResult;
  if (tokenCountResult === null) {
    context.log.warn(`Failed to get token count for ${current.stash}`);
  }
  for (let i = current.extras.length; i < Number(tokenCount); i++) {
    const tokenListResult = await stashTokenList(ec, current.stash, BigInt(i));
    if (tokenListResult === null) {
      context.log.warn(`Failed to get token list from ${current.stash}`);
      continue;
    }
    const tokenInfoResult = await stashV3TokenInfo(ec, current.stash, tokenListResult);
    if (tokenInfoResult === null) {
      context.log.warn(`Failed to get token info for ${tokenListResult}`);
      continue;
    }
    const rewardToken = tokenInfoResult[0].toLowerCase();
    const rewardContract = tokenInfoResult[1].toLowerCase();
    if (rewardToken != ADDRESS_ZERO || rewardContract != ADDRESS_ZERO) {
      const extras = [...current.extras, createNewExtraReward(context, current.poolid, rewardContract, rewardToken)];
      current = { ...current, extras };
      context.Pool.set(current);
    }
  }
  return current;
}

export async function getLpTokenSupply(context: EvmOnEventContext, ec: EC, lpToken: string, block: number): Promise<bigint> {
  const lpTokenSupplyResult = await erc20TotalSupply(ec, lpToken, block);
  let totalSupply = BIG_INT_ZERO;
  if (lpTokenSupplyResult === null) {
    context.log.warn(`Failed to fetch total supply for LP Token ${lpToken}`);
  } else {
    totalSupply = lpTokenSupplyResult;
  }
  return totalSupply;
}

export async function getXcpProfitResult(ec: EC, pool: Pool, block: number): Promise<[BigDecimal, BigDecimal]> {
  const xcpProfitResult = await poolXcpProfit(ec, pool.swap, block);
  const xcpProfitAResult = await poolXcpProfitA(ec, pool.swap, block);
  const xcpProfit = xcpProfitResult === null ? BIG_DECIMAL_ZERO : toBigDecimal(xcpProfitResult);
  const xcpProfitA = xcpProfitAResult === null ? BIG_DECIMAL_ZERO : toBigDecimal(xcpProfitAResult);
  return [xcpProfit, xcpProfitA];
}

/**
 * Mirrors `getPoolApr`. Returns [crvApr, cvxApr, extraRewardsApr] and the
 * (possibly extras-updated) pool, since getPoolExtras mutates it.
 */
export async function getPoolApr(
  context: EvmOnEventContext,
  ec: EC,
  block: number,
  pool: Pool,
  timestamp: bigint,
  vPrice: BigDecimal,
): Promise<{ aprs: [BigDecimal, BigDecimal, BigDecimal]; pool: Pool }> {
  const finishPeriodResult = await rewardPoolPeriodFinish(ec, pool.crvRewardsPool, block);
  const finishPeriod = finishPeriodResult === null ? timestamp + BIG_INT_ONE : finishPeriodResult;
  const supplyResult = await rewardPoolTotalSupply(ec, pool.crvRewardsPool, block);
  const supply = supplyResult === null ? BIG_DECIMAL_ZERO : toBigDecimal(supplyResult).div(BIG_DECIMAL_1E18);
  const virtualSupply = supply.times(vPrice);
  const exchangeRate = BIG_DECIMAL_ONE;

  const crvPrice = await getUsdRate(ec, block, CRV_ADDRESS);
  const cvxPrice = await getUsdRate(ec, block, CVX_ADDRESS);

  let crvApr = BIG_DECIMAL_ZERO;
  let cvxApr = BIG_DECIMAL_ZERO;
  if (timestamp < finishPeriod) {
    const rateResult = await rewardPoolRewardRate(ec, pool.crvRewardsPool, block);
    const rate = rateResult === null ? BIG_DECIMAL_ZERO : toBigDecimal(rateResult).div(BIG_DECIMAL_1E18);
    if (rateResult === null) {
      context.log.warn(`Failed to get CRV reward rate for ${pool.crvRewardsPool}`);
    }
    let crvPerUnderlying = BIG_DECIMAL_ZERO;
    if (virtualSupply.gt(BIG_DECIMAL_ZERO)) {
      crvPerUnderlying = rate.div(virtualSupply);
    }

    const crvPerYear = crvPerUnderlying.times(new BigDecimal("31536000"));
    const cvxPerYear = await getCvxMintAmount(ec, block, crvPerYear);

    crvApr = crvPerYear.times(crvPrice);
    cvxApr = cvxPerYear.times(cvxPrice);
  }

  let extraRewardsApr = BIG_DECIMAL_ZERO;
  // look for updates to extra rewards
  let current = await getPoolExtras(context, ec, block, pool);
  for (let i = 0; i < current.extras.length; i++) {
    const extra = await context.ExtraReward.get(current.extras[i]!);
    if (extra) {
      const rewardContractAddress = extra.contract;
      const rewardTokenAddress = extra.token;
      const extraFinishPeriodResult = await rewardPoolPeriodFinish(ec, rewardContractAddress, block);
      const extraFinishPeriod = extraFinishPeriodResult === null ? timestamp + BIG_INT_ONE : extraFinishPeriodResult;
      if (timestamp >= extraFinishPeriod) {
        continue;
      }

      const rewardRateResult = await rewardPoolRewardRate(ec, rewardContractAddress, block);
      const rewardRate =
        rewardRateResult === null ? BIG_DECIMAL_ZERO : toBigDecimal(rewardRateResult).div(BIG_DECIMAL_1E18);
      const perUnderlying = virtualSupply.eq(BIG_DECIMAL_ZERO) ? BIG_DECIMAL_ZERO : rewardRate.div(virtualSupply);
      const perYear = perUnderlying.times(new BigDecimal("31536000")); // 86400 * 365
      const rewardTokenPrice = (await getUsdRate(ec, block, rewardTokenAddress)).div(exchangeRate);
      extraRewardsApr = extraRewardsApr.plus(rewardTokenPrice.times(perYear));
    }
  }
  return { aprs: [crvApr, cvxApr, extraRewardsApr], pool: current };
}
