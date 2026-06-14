/** Ported from src/utils/commons.ts and src/utils/transaction.ts id helpers. */
import { BIGINT_ZERO } from "./constants";

/** lowercase an address/hex string (HyperIndex delivers checksummed). */
export const low = (x: string): string => x.toLowerCase();

/** graph-node getTimeInMillis: time * 1000 */
export function getTimeInMillis(time: bigint): bigint {
  return time * 1000n;
}

/** graph-node getTimestampInMillis(block): block.timestamp * 1000 */
export function getTimestampInMillis(blockTimestamp: number): bigint {
  return BigInt(blockTimestamp) * 1000n;
}

/** Transaction id = txHash-logIndex (src/utils/transaction.ts getTransactionId). */
export function getTransactionId(transactionHash: string, logIndex: number): string {
  return low(transactionHash) + "-" + logIndex.toString();
}

export function booleanToString(value: boolean): string {
  return value ? "true" : "false";
}

/** Returns a new array without the specified element (commons.removeElementFromArray). */
export function removeElementFromArray<T>(arr: ReadonlyArray<T>, e: T): T[] {
  const out: T[] = [];
  for (const cur of arr) {
    if (cur === e) continue;
    out.push(cur);
  }
  return out;
}

// amount = (shares * totalAssets) / totalSupply
export function fromSharesToAmount(sharesAmount: bigint, totalAssets: bigint, totalSupply: bigint): bigint {
  if (totalSupply === 0n) return BIGINT_ZERO;
  return (sharesAmount * totalAssets) / totalSupply;
}

// share = (amount * totalSupply) / totalAssets
export function fromAmountToShares(amount: bigint, totalAssets: bigint, totalSupply: bigint): bigint {
  if (totalAssets === 0n) return BIGINT_ZERO;
  return (amount * totalSupply) / totalAssets;
}
