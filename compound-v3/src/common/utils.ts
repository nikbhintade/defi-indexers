/**
 * Port of src/common/utils.ts.
 */
import { BigDecimal } from "envio";
import { BASE_INDEX_SCALE, REWARD_FACTOR_SCALE, ZERO_ADDRESS, ZERO_BD, ZERO_BI } from "./constants";
import { getCometRewardAddress } from "./networkSpecific";
import { rewardConfigV1, rewardConfigV2 } from "../effects/contracts";
import type { EffectCaller } from "envio";

/** lowercase an address / hash (HyperIndex delivers checksummed addresses). */
export function low(input: string): string {
  return input.toLowerCase();
}

/** AssemblyScript BigInt.toBigDecimal() */
export function toBD(input: bigint): BigDecimal {
  return new BigDecimal(input.toString());
}

/**
 * graph-node `BigDecimal.truncate(n)`: truncate (not round) to n decimal
 * places, toward zero.
 */
export function truncate(value: BigDecimal, decimals: number): BigDecimal {
  return value.decimalPlaces(decimals, BigDecimal.ROUND_DOWN);
}

/**
 * Divides a value by a given exponent of base 10 (10^exponent), and formats
 * it as a BigDecimal.
 */
export function formatUnits(value: bigint, exponent: number): BigDecimal {
  const powerTerm = toBD(10n ** BigInt(exponent));
  return toBD(value).div(powerTerm);
}

/**
 * Multiply value by a given exponent of base 10 (10^exponent), and formats
 * it as a BigInt.
 */
export function parseUnits(value: BigDecimal, exponent: number): bigint {
  const powerTerm = toBD(10n ** BigInt(exponent));
  return BigInt(truncate(value.times(powerTerm), 0).toString());
}

export function computeTokenValueUsd(input: bigint, decimals: number, priceUsd: BigDecimal): BigDecimal {
  return formatUnits(input, decimals).times(priceUsd);
}

export function presentValue(principal: bigint, index: bigint): bigint {
  return (principal * index) / BASE_INDEX_SCALE;
}

export function principalValue(presentVal: bigint, index: bigint): bigint {
  return bigIntSafeDiv(presentVal * BASE_INDEX_SCALE, index);
}

export function bigDecimalSafeDiv(num: BigDecimal, den: BigDecimal): BigDecimal {
  if (den.eq(ZERO_BD)) {
    return ZERO_BD;
  } else {
    return num.div(den);
  }
}

export function bigDecimalMin(a: BigDecimal, b: BigDecimal): BigDecimal {
  return a.lt(b) ? a : b;
}

export function bigDecimalMax(a: BigDecimal, b: BigDecimal): BigDecimal {
  return a.gt(b) ? a : b;
}

export function bigIntMin(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

export function bigIntMax(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

/** Compute a - b, clamping at 0 */
export function bigIntSafeMinus(a: bigint, b: bigint): bigint {
  return b > a ? ZERO_BI : a - b;
}

export function bigIntSafeDiv(num: bigint, den: bigint): bigint {
  if (den === ZERO_BI) {
    return ZERO_BI;
  } else {
    return num / den;
  }
}

export type RewardConfigData = {
  tokenAddress: string;
  rescaleFactor: bigint;
  shouldUpscale: boolean;
  multiplier: bigint;
};

/**
 * Port of getRewardConfigData. Note that there are 2 versions of
 * CometRewards at the same address; the first one didn't have a multiplier.
 * Decoding V1 data with the V2 ABI fails, which graph-node (and our
 * tryContractCall) treats as a revert, falling through to V1.
 */
export async function getRewardConfigData(
  ec: EffectCaller | null,
  log: { warn(msg: string): void },
  marketAddress: string,
  block: number,
): Promise<RewardConfigData> {
  const rewardsAddress = getCometRewardAddress();

  const v2 = await rewardConfigV2(ec, rewardsAddress, marketAddress, block);
  if (v2 === null) {
    // It is V1 instead
    const v1 = await rewardConfigV1(ec, rewardsAddress, marketAddress, block);
    if (v1 === null) {
      log.warn(`All reward configs reverted - ${marketAddress}`);
      return {
        tokenAddress: ZERO_ADDRESS,
        rescaleFactor: ZERO_BI,
        shouldUpscale: true,
        multiplier: REWARD_FACTOR_SCALE,
      };
    } else {
      return {
        tokenAddress: v1.token,
        rescaleFactor: v1.rescaleFactor,
        shouldUpscale: v1.shouldUpscale,
        multiplier: REWARD_FACTOR_SCALE,
      };
    }
  } else {
    return {
      tokenAddress: v2.token,
      rescaleFactor: v2.rescaleFactor,
      shouldUpscale: v2.shouldUpscale,
      multiplier: v2.multiplier,
    };
  }
}
