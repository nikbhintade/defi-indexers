/**
 * Ported from src/sdk/metamorpho.ts. Loaders + updateMMRate (weighted supply
 * rate across the vault's withdraw queue positions).
 */
import type { Context } from "../context";
import {
  BigDecimal,
  type InterestRate,
  type Market,
  type MetaMorpho,
  type MetaMorphoMarket,
} from "envio";
import { getMarket } from "../initializers/markets";
import { toAssetsDown } from "../maths/shares";
import { getCurrentPosition } from "./position";
import { PositionSide, BIGDECIMAL_ZERO, toBD } from "./constants";
import { hexConcat } from "../utils/graphBytes";

export const PendingValueStatus = {
  PENDING: "PENDING",
  ACCEPTED: "ACCEPTED",
  REJECTED: "REJECTED",
  OVERRIDDEN: "OVERRIDDEN",
} as const;

export const QueueType = {
  SUPPLY_QUEUE: "SUPPLY_QUEUE",
  WITHDRAW_QUEUE: "WITHDRAW_QUEUE",
} as const;


export async function loadMetaMorpho(
  context: Context,
  address: string,
): Promise<MetaMorpho> {
  const mm = await context.MetaMorpho.get(address.toLowerCase());
  if (!mm) throw new Error(`MetaMorpho ${address} not found`);
  return mm;
}

export async function loadMetaMorphoMarketFromId(
  context: Context,
  id: string,
): Promise<MetaMorphoMarket> {
  const m = await context.MetaMorphoMarket.get(id);
  if (!m) throw new Error(`MetaMorphoMarket ${id} not found`);
  return m;
}

export async function loadMetaMorphoMarket(
  context: Context,
  address: string,
  marketId: string,
): Promise<MetaMorphoMarket> {
  const id = hexConcat(address, marketId);
  const m = await context.MetaMorphoMarket.get(id);
  if (!m) throw new Error(`MetaMorphoMarket ${id} not found`);
  return m;
}

export async function updateMMRate(
  context: Context,
  address: string,
): Promise<void> {
  const mm = await loadMetaMorpho(context, address);
  let accumulator = BIGDECIMAL_ZERO;
  let total = BIGDECIMAL_ZERO;
  for (const mmMarketId of mm.withdrawQueue) {
    const mmMarket = await context.MetaMorphoMarket.get(mmMarketId);
    if (!mmMarket) throw new Error(`MetaMorphoMarket ${mmMarketId} not found`);
    const market = await getMarket(context, mmMarket.market_id);
    if (!market.rates || !market.rates[0]) {
      throw new Error(`Market ${mmMarket.market_id} has no supply rate`);
    }
    const marketSupplyRate = await context.InterestRate.get(market.rates[0]);
    if (!marketSupplyRate) {
      throw new Error(`Market ${mmMarket.market_id} has no supply rate`);
    }
    const currentPosition = await getCurrentPosition(
      context,
      address.toLowerCase(),
      market.id,
      PositionSide.SUPPLIER,
    );
    if (currentPosition && currentPosition.shares != null) {
      const totalSupply = toAssetsDown(
        currentPosition.shares,
        market.totalSupplyShares,
        market.totalSupply,
      );
      accumulator = accumulator.plus(
        toBD(totalSupply).times(marketSupplyRate.rate),
      );
      total = total.plus(toBD(totalSupply));
    }
  }
  if (total.eq(BIGDECIMAL_ZERO)) return;
  const weightedRate = accumulator.div(total);
  const rate = await context.InterestRate.get(mm.rate_id);
  if (!rate) throw new Error(`InterestRate ${mm.rate_id} not found`);
  context.InterestRate.set({ ...rate, rate: weightedRate });
}

void BigDecimal;
void (null as unknown as Market);
