/**
 * Port of `src/utils/time.ts`. Uses i32-equivalent integer math (Number);
 * timestamps fit in a 32-bit signed int well within the indexer's lifetime.
 */
export function timestampToPeriodStart(timestamp: number, period: string): number {
  const seconds = periodToSeconds(period);

  // in case of "1w" period it is rounded to start on Thursday (GMX weekly
  // distributions start on Wednesdays), so the timestamp is shifted before
  // rounding and shifted back after.
  let ts = timestamp;
  if (period === "1w") {
    ts += 86400;
  }
  let start = Math.floor(ts / seconds) * seconds;

  if (period === "1w") {
    start -= 86400;
  }

  return start;
}

export function periodToSeconds(period: string): number {
  let seconds = 0;

  if (period === "5m") {
    seconds = 5 * 60;
  } else if (period === "15m") {
    seconds = 15 * 60;
  } else if (period === "1h") {
    seconds = 60 * 60;
  } else if (period === "4h") {
    seconds = 4 * 60 * 60;
  } else if (period === "1d") {
    seconds = 24 * 60 * 60;
  } else if (period === "1w") {
    seconds = 7 * 24 * 60 * 60;
  } else if (period === "total") {
    seconds = 1;
  }

  return seconds;
}
