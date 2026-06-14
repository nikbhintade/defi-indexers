/**
 * Port of src/utils/rate.ts. cloneRate snapshots an InterestRate at a given
 * timestamp under a derived id (`{rateId}-{timestamp}`) so historical event
 * entities (Deposit/Withdraw/Borrow/Repay, MetaMorpho deposit/withdraw/transfer)
 * keep an immutable copy of the rate that applied when they happened.
 */
import type { Context } from "../context";
import type { InterestRate } from "envio";

export async function cloneRate(
  context: Context,
  rateId: string,
  timestamp: bigint,
): Promise<InterestRate> {
  const rate = await context.InterestRate.get(rateId);
  if (!rate) throw new Error(`InterestRate ${rateId} not found`);

  const newRateId = rate.id + "-" + timestamp.toString();
  const existing = await context.InterestRate.get(newRateId);
  if (existing) return existing;

  const newRate: InterestRate = {
    id: newRateId,
    rate: rate.rate,
    market_id: rate.market_id,
    side: rate.side,
    type: rate.type,
  };
  context.InterestRate.set(newRate);
  return newRate;
}

export async function cloneRates(
  context: Context,
  rateIds: readonly string[],
  timestamp: bigint,
): Promise<string[]> {
  const rates: string[] = [];
  for (const rateId of rateIds) {
    rates.push((await cloneRate(context, rateId, timestamp)).id);
  }
  return rates;
}
