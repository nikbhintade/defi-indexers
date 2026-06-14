/**
 * Ray/Wad math ported 1:1 from src/helpers/math.ts (graph-ts BigInt -> bigint).
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

export function calculateCompoundedInterest(
  rate: bigint,
  lastUpdatedTimestamp: bigint,
  nowTimestamp: bigint,
): bigint {
  const timeDiff = nowTimestamp - lastUpdatedTimestamp;
  if (timeDiff === 0n) return RAY;

  const expMinusOne = timeDiff - 1n;
  const expMinusTwo = timeDiff > 2n ? timeDiff - 2n : 0n;

  const ratePerSecond = rate / SECONDS_PER_YEAR;

  const basePowerTwo = rayMul(ratePerSecond, ratePerSecond);
  const basePowerThree = rayMul(basePowerTwo, ratePerSecond);

  const secondTerm = (timeDiff * expMinusOne * basePowerTwo) / 2n;
  const thirdTerm = (timeDiff * expMinusOne * expMinusTwo * basePowerThree) / 6n;

  return RAY + ratePerSecond * timeDiff + secondTerm + thirdTerm;
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

/** calculateUtilizationRate from src/helpers/reserve-logic.ts (truncate to 8 dp). */
export function calculateUtilizationRate(
  totalLiquidity: bigint,
  availableLiquidity: bigint,
): BigDecimal {
  if (totalLiquidity === 0n) return new BigDecimal(0);
  const avail = new BigDecimal(availableLiquidity.toString());
  const total = new BigDecimal(totalLiquidity.toString());
  return new BigDecimal(1).minus(avail.div(total)).decimalPlaces(8, BigDecimal.ROUND_DOWN);
}
