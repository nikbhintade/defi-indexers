/** Port of src/services/candles.ts */
import { BigDecimal, type Candle, type EvmOnEventContext, type Pool } from "envio";
import { BIG_DECIMAL_ZERO, BIG_INT_ONE } from "../constants";

export async function updateCandles(
  context: EvmOnEventContext,
  pool: Pool,
  timestamp: bigint,
  token0: string,
  token0Amount: BigDecimal,
  token1: string,
  token1Amount: BigDecimal,
  block: bigint,
): Promise<void> {
  if (token1Amount.eq(BIG_DECIMAL_ZERO) || token0Amount.eq(BIG_DECIMAL_ZERO)) {
    return;
  }
  const periods: number[] = [60 * 60, 24 * 60 * 60, 7 * 24 * 60 * 60];
  const pair = [token0, token1].sort();
  const orderedToken0 = pair[0]!;
  const orderedToken1 = pair[1]!;
  // make sure that we always record the same price
  // front end can inverse the pair and prices on the fly
  const price = token0 == orderedToken0 ? token0Amount.div(token1Amount) : token1Amount.div(token0Amount);
  for (let i = 0; i < periods.length; i++) {
    const period = periods[i]!;
    const time_id = Math.floor(Number(timestamp) / period);
    const candle_id = pool.id + "-" + pair.join("-") + "-" + time_id.toString() + "-" + period.toString();
    let candle = await context.Candle.get(candle_id);
    if (!candle) {
      candle = {
        id: candle_id,
        pool_id: pool.id,
        timestamp,
        period,
        lastBlock: block,
        token0: orderedToken0,
        token1: orderedToken1,
        open: price,
        low: price,
        high: price,
        close: price,
        txs: BIG_INT_ONE,
        token0TotalAmount: BIG_DECIMAL_ZERO,
        token1TotalAmount: BIG_DECIMAL_ZERO,
      };
    } else {
      candle = {
        ...candle,
        low: price.lt(candle.low) ? price : candle.low,
        high: price.gt(candle.high) ? price : candle.high,
        txs: candle.txs + BIG_INT_ONE,
      };
    }

    candle = {
      ...candle,
      close: price,
      lastBlock: block,
      token0TotalAmount: candle.token0TotalAmount.plus(token0Amount),
      token1TotalAmount: candle.token1TotalAmount.plus(token1Amount),
    };

    context.Candle.set(candle);
  }
}
