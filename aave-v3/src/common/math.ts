/**
 * Ray/Wad math ported 1:1 from src/helpers/math.ts (graph-ts BigInt → bigint).
 * All operations are integer; graph-node BigInt.div truncates toward zero, as
 * does native bigint division for the non-negative operands used here.
 */
import { BigDecimal } from "envio";

const RAY = 10n ** 27n;
const WAD_RAY_RATIO = 10n ** 9n;
const halfRAY = RAY / 2n;
const SECONDS_PER_YEAR = 31556952n;

export function rayToWad(a: bigint): bigint {
  const halfRatio = WAD_RAY_RATIO / 2n;
  return (halfRatio + a) / WAD_RAY_RATIO;
}

export function wadToRay(a: bigint): bigint {
  return a * WAD_RAY_RATIO;
}

export function rayDiv(a: bigint, b: bigint): bigint {
  const halfB = b / 2n;
  return (a * RAY + halfB) / b;
}

export function rayMul(a: bigint, b: bigint): bigint {
  return (a * b + halfRAY) / RAY;
}

export function calculateLinearInterest(
  rate: bigint,
  lastUpdatedTimestamp: bigint,
  nowTimestamp: bigint,
): bigint {
  const timeDifference = nowTimestamp - lastUpdatedTimestamp;
  const timeDelta = rayDiv(wadToRay(timeDifference), wadToRay(SECONDS_PER_YEAR));
  return rayMul(rate, timeDelta);
}

export function calculateGrowth(
  amount: bigint,
  rate: bigint,
  lastUpdatedTimestamp: bigint,
  nowTimestamp: bigint,
): bigint {
  const growthRate = calculateLinearInterest(rate, lastUpdatedTimestamp, nowTimestamp);
  const growth = rayMul(wadToRay(amount), growthRate);
  return rayToWad(growth);
}

/** graph-node BigInt.divDecimal(BigDecimal): integer over decimal divisor. */
export function divDecimal(value: bigint, divisor: BigDecimal): BigDecimal {
  return new BigDecimal(value.toString()).div(divisor);
}
