/**
 * Port of packages/utils/time.ts. Timestamps are kept as bigint seconds to
 * match the subgraph's BigInt semantics (envio delivers `number` seconds).
 */
export const YEAR = BigInt(60 * 60 * 24 * 365);
export const DAY = BigInt(60 * 60 * 24);
export const WEEK = BigInt(60 * 60 * 24 * 7);
export const HOUR = BigInt(60 * 60);
export const PERIODS = [HOUR, DAY, WEEK];

export function getIntervalFromTimestamp(timestamp: bigint, interval: bigint): bigint {
  return (timestamp / interval) * interval;
}
