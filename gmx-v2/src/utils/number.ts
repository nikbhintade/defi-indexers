export const ZERO = 0n;
export const ONE = 1n;

export function expandDecimals(n: bigint, decimals: number): bigint {
  return n * 10n ** BigInt(decimals);
}

/** Port of graph-ts BigInt.pow used in fee fraction math. */
export function pow10(exp: number): bigint {
  return 10n ** BigInt(exp);
}
