/**
 * Port of src/mappingHelpers/usage.ts.
 *
 * Id layouts (graph-ts Bytes, replicated as lowercase hex):
 * - Usage:               utf8 / market-id / time-bytes combos (see call sites)
 * - ProtocolHourlyUsage: Bytes.fromBigInt(hour)
 * - ProtocolDailyUsage:  Bytes.fromBigInt(day)
 * - MarketHourlyUsage:   market.id ++ Bytes.fromBigInt(hour)
 * - MarketDailyUsage:    market.id ++ Bytes.fromBigInt(day)
 * - _ActiveAccount:      address ++ utf8(metadata)
 */
import type { Account, Market, MarketDailyUsage, MarketHourlyUsage, ProtocolDailyUsage, ProtocolHourlyUsage, Usage } from "envio";
import type { Ctx, Ev, Mutable } from "../common/types";
import { InteractionType, ONE_BI, SECONDS_PER_DAY, SECONDS_PER_HOUR, ZERO_BI } from "../common/constants";
import { bigIntBytes, hexConcat, utf8Hex } from "../common/graphBytes";
import { getConfiguratorProxyAddress } from "../common/networkSpecific";
import { getOrCreateProtocol } from "./protocol";

export async function getOrCreateUsage(ctx: Ctx, id: string): Promise<Mutable<Usage>> {
  let usage = await ctx.Usage.get(id);

  if (!usage) {
    usage = {
      id,
      protocol_id: getConfiguratorProxyAddress(),
      uniqueUsersCount: ZERO_BI,
      interactionCount: ZERO_BI,
      supplyBaseCount: ZERO_BI,
      withdrawBaseCount: ZERO_BI,
      transferBaseCount: ZERO_BI,
      liquidationCount: ZERO_BI,
      supplyCollateralCount: ZERO_BI,
      withdrawCollateralCount: ZERO_BI,
      transferCollateralCount: ZERO_BI,
    };

    ctx.Usage.set(usage);
  }

  return { ...usage };
}

async function getOrCreateProtocolHourlyUsage(ctx: Ctx, hour: bigint, event: Ev): Promise<ProtocolHourlyUsage> {
  const id = hexConcat(bigIntBytes(hour));
  let hourlyUsage = await ctx.ProtocolHourlyUsage.get(id);

  if (!hourlyUsage) {
    const protocol = await getOrCreateProtocol(ctx, event);
    const usage = await getOrCreateUsage(ctx, hexConcat(utf8Hex("PROTOCOL_HOUR"), id));

    hourlyUsage = {
      id,
      hour,
      timestamp: BigInt(event.block.timestamp),
      protocol_id: protocol.id,
      usage_id: usage.id,
    };

    ctx.ProtocolHourlyUsage.set(hourlyUsage);
  }

  return hourlyUsage;
}

async function getOrCreateProtocolDailyUsage(ctx: Ctx, day: bigint, event: Ev): Promise<ProtocolDailyUsage> {
  const id = hexConcat(bigIntBytes(day));
  let dailyUsage = await ctx.ProtocolDailyUsage.get(id);

  if (!dailyUsage) {
    const protocol = await getOrCreateProtocol(ctx, event);
    const usage = await getOrCreateUsage(ctx, hexConcat(utf8Hex("PROTOCOL_DAY"), id));

    dailyUsage = {
      id,
      day,
      timestamp: BigInt(event.block.timestamp),
      protocol_id: protocol.id,
      usage_id: usage.id,
    };

    ctx.ProtocolDailyUsage.set(dailyUsage);
  }

  return dailyUsage;
}

async function getOrCreateMarketDailyUsage(ctx: Ctx, market: Market, day: bigint, event: Ev): Promise<MarketDailyUsage> {
  const id = hexConcat(market.id, bigIntBytes(day));
  let dailyUsage = await ctx.MarketDailyUsage.get(id);

  if (!dailyUsage) {
    const usage = await getOrCreateUsage(ctx, id);

    dailyUsage = {
      id,
      day,
      timestamp: BigInt(event.block.timestamp),
      market_id: market.id,
      usage_id: usage.id,
    };

    ctx.MarketDailyUsage.set(dailyUsage);
  }

  return dailyUsage;
}

async function getOrCreateMarketHourlyUsage(ctx: Ctx, market: Market, hour: bigint, event: Ev): Promise<MarketHourlyUsage> {
  const id = hexConcat(market.id, bigIntBytes(hour));
  let hourlyUsage = await ctx.MarketHourlyUsage.get(id);

  if (!hourlyUsage) {
    const usage = await getOrCreateUsage(ctx, id);

    hourlyUsage = {
      id,
      hour,
      timestamp: BigInt(event.block.timestamp),
      market_id: market.id,
      usage_id: usage.id,
    };

    ctx.MarketHourlyUsage.set(hourlyUsage);
  }

  return hourlyUsage;
}

async function tryToCreateActiveAccount(ctx: Ctx, address: string, metadata: string): Promise<boolean> {
  const id = hexConcat(address, utf8Hex(metadata));
  const activeAccount = await ctx._ActiveAccount.get(id);

  let newAcc = false;
  if (!activeAccount) {
    ctx._ActiveAccount.set({ id });
    newAcc = true;
  }

  return newAcc;
}

export async function updateUsageMetrics(
  ctx: Ctx,
  account: Account,
  market: Market,
  interactionType: string,
  event: Ev,
): Promise<void> {
  const day = BigInt(event.block.timestamp) / SECONDS_PER_DAY;
  const hour = BigInt(event.block.timestamp) / SECONDS_PER_HOUR;

  const protocol = await getOrCreateProtocol(ctx, event);

  const newProtocolCumulativeAcc = await tryToCreateActiveAccount(ctx, account.id, "PROTOCOL");
  const newProtocolHourlyAcc = await tryToCreateActiveAccount(ctx, account.id, "PROTOCOL_HOUR".concat(hour.toString()));
  const newProtocolDailyAcc = await tryToCreateActiveAccount(ctx, account.id, "PROTOCOL_DAY".concat(day.toString()));

  // original: "MARKET".concat(market.id.toHexString()) — market.id is already the 0x hex string
  const baseMarketAccId = "MARKET".concat(market.id);
  const newMarketCumulativeAcc = await tryToCreateActiveAccount(ctx, account.id, baseMarketAccId);
  const newMarketHourlyAcc = await tryToCreateActiveAccount(ctx, account.id, baseMarketAccId.concat(hour.toString()));
  const newMarketDailyAcc = await tryToCreateActiveAccount(ctx, account.id, baseMarketAccId.concat(day.toString()));

  const protocolHourlyUsageContainer = await getOrCreateProtocolHourlyUsage(ctx, hour, event);
  const protocolDailyUsageContainer = await getOrCreateProtocolDailyUsage(ctx, day, event);

  const marketHourlyUsageContainer = await getOrCreateMarketHourlyUsage(ctx, market, hour, event);
  const marketDailyUsageContainer = await getOrCreateMarketDailyUsage(ctx, market, day, event);

  const protocolCumulativeUsage = await getOrCreateUsage(ctx, protocol.cumulativeUsage_id);
  const protocolHourlyUsage = await getOrCreateUsage(ctx, protocolHourlyUsageContainer.usage_id);
  const protocolDailyUsage = await getOrCreateUsage(ctx, protocolDailyUsageContainer.usage_id);

  const marketCumulativeUsage = await getOrCreateUsage(ctx, market.cumulativeUsage_id);
  const marketHourlyUsage = await getOrCreateUsage(ctx, marketHourlyUsageContainer.usage_id);
  const marketDailyUsage = await getOrCreateUsage(ctx, marketDailyUsageContainer.usage_id);

  // Unique accounts
  protocolCumulativeUsage.uniqueUsersCount += newProtocolCumulativeAcc ? ONE_BI : ZERO_BI;
  protocolHourlyUsage.uniqueUsersCount += newProtocolHourlyAcc ? ONE_BI : ZERO_BI;
  protocolDailyUsage.uniqueUsersCount += newProtocolDailyAcc ? ONE_BI : ZERO_BI;

  marketCumulativeUsage.uniqueUsersCount += newMarketCumulativeAcc ? ONE_BI : ZERO_BI;
  marketHourlyUsage.uniqueUsersCount += newMarketHourlyAcc ? ONE_BI : ZERO_BI;
  marketDailyUsage.uniqueUsersCount += newMarketDailyAcc ? ONE_BI : ZERO_BI;

  // Update txs
  const all = [
    protocolCumulativeUsage,
    protocolHourlyUsage,
    protocolDailyUsage,
    marketCumulativeUsage,
    marketHourlyUsage,
    marketDailyUsage,
  ] as Mutable<Usage>[];

  for (const usage of all) {
    usage.interactionCount += ONE_BI;
  }
  if (InteractionType.SUPPLY_BASE === interactionType) {
    for (const usage of all) usage.supplyBaseCount += ONE_BI;
  } else if (InteractionType.WITHDRAW_BASE === interactionType) {
    for (const usage of all) usage.withdrawBaseCount += ONE_BI;
  } else if (InteractionType.TRANSFER_BASE === interactionType) {
    for (const usage of all) usage.transferBaseCount += ONE_BI;
  } else if (InteractionType.LIQUIDATION === interactionType) {
    for (const usage of all) usage.liquidationCount += ONE_BI;
  } else if (InteractionType.SUPPLY_COLLATERAL === interactionType) {
    for (const usage of all) usage.supplyCollateralCount += ONE_BI;
  } else if (InteractionType.WITHDRAW_COLLATERAL === interactionType) {
    for (const usage of all) usage.withdrawCollateralCount += ONE_BI;
  } else if (InteractionType.TRANSFER_COLLATERAL === interactionType) {
    for (const usage of all) usage.transferCollateralCount += ONE_BI;
  } else {
    ctx.log.warn(`updateUsageMetrics called with invalid interactionType: ${interactionType}`);
  }

  ctx.Usage.set({ ...protocolCumulativeUsage });
  ctx.Usage.set({ ...protocolHourlyUsage });
  ctx.Usage.set({ ...protocolDailyUsage });
  ctx.Usage.set({ ...marketCumulativeUsage });
  ctx.Usage.set({ ...marketHourlyUsage });
  ctx.Usage.set({ ...marketDailyUsage });
}
