/**
 * Port of src/mappingHelpers/protocol.ts.
 */
import type { Protocol, ProtocolAccounting } from "envio";
import type { Ctx, Ev, Mutable } from "../common/types";
import { SECONDS_PER_DAY, SECONDS_PER_HOUR, SECONDS_PER_WEEK, ZERO_BD, ZERO_BI } from "../common/constants";
import { bigIntBytes, hexConcat, utf8Hex } from "../common/graphBytes";
import { getConfiguratorProxyAddress } from "../common/networkSpecific";
import { bigDecimalSafeDiv } from "../common/utils";
import { getOrCreateUsage } from "./usage";
import { getOrCreateMarket, getOrCreateMarketAccounting } from "./market";

////
// Protocol Accounting
////

export async function getOrCreateProtocolAccounting(
  ctx: Ctx,
  protocol: Protocol,
  event: Ev,
): Promise<Mutable<ProtocolAccounting>> {
  const id = protocol.id;
  const protocolAccounting = await ctx.ProtocolAccounting.get(id);

  if (!protocolAccounting) {
    const created: Mutable<ProtocolAccounting> = {
      id,
      protocol_id: protocol.id,
      lastUpdatedBlock: ZERO_BI,
      totalSupplyUsd: ZERO_BD,
      totalBorrowUsd: ZERO_BD,
      reserveBalanceUsd: ZERO_BD,
      collateralBalanceUsd: ZERO_BD,
      collateralReservesBalanceUsd: ZERO_BD,
      totalReserveBalanceUsd: ZERO_BD,
      utilization: ZERO_BD,
      collateralization: ZERO_BD,
      avgSupplyApr: ZERO_BD,
      avgBorrowApr: ZERO_BD,
      avgRewardSupplyApr: ZERO_BD,
      avgRewardBorrowApr: ZERO_BD,
      avgNetSupplyApr: ZERO_BD,
      avgNetBorrowApr: ZERO_BD,
    };

    await updateProtocolAccounting(ctx, protocol, created, event);

    ctx.ProtocolAccounting.set({ ...created });
    return created;
  }

  return { ...protocolAccounting };
}

export async function updateProtocolAccounting(
  ctx: Ctx,
  protocol: Protocol,
  accounting: Mutable<ProtocolAccounting>,
  event: Ev,
): Promise<void> {
  let totalSupplyUsd = ZERO_BD;
  let totalBorrowUsd = ZERO_BD;
  let reserveBalanceUsd = ZERO_BD;
  let collateralBalanceUsd = ZERO_BD;
  let collateralReserversBalanceUsd = ZERO_BD;
  let totalReserveBalanceUsd = ZERO_BD;
  let weightedSumSupplyApr = ZERO_BD;
  let weightedSumBorrowApr = ZERO_BD;
  let weightedSumRewardSupplyApr = ZERO_BD;
  let weightedSumRewardBorrowApr = ZERO_BD;
  let weightedSumNetSupplyApr = ZERO_BD;
  let weightedSumNetBorrowApr = ZERO_BD;

  const marketIds = protocol.markets;
  const numMarkets = marketIds.length;
  for (let i = 0; i < numMarkets; i++) {
    const market = await getOrCreateMarket(ctx, marketIds[i]!, event);
    const marketAccounting = await getOrCreateMarketAccounting(ctx, market, event);

    totalSupplyUsd = totalSupplyUsd.plus(marketAccounting.totalBaseSupplyUsd);
    totalBorrowUsd = totalBorrowUsd.plus(marketAccounting.totalBaseBorrowUsd);
    reserveBalanceUsd = reserveBalanceUsd.plus(marketAccounting.baseReserveBalanceUsd);
    collateralBalanceUsd = collateralBalanceUsd.plus(marketAccounting.collateralBalanceUsd);
    collateralReserversBalanceUsd = collateralReserversBalanceUsd.plus(marketAccounting.collateralReservesBalanceUsd);
    totalReserveBalanceUsd = totalReserveBalanceUsd.plus(marketAccounting.totalReserveBalanceUsd);
    weightedSumSupplyApr = weightedSumSupplyApr.plus(
      marketAccounting.supplyApr.times(marketAccounting.totalBaseSupplyUsd),
    );
    weightedSumBorrowApr = weightedSumBorrowApr.plus(
      marketAccounting.borrowApr.times(marketAccounting.totalBaseBorrowUsd),
    );
    weightedSumRewardSupplyApr = weightedSumRewardSupplyApr.plus(
      marketAccounting.rewardSupplyApr.times(marketAccounting.totalBaseSupplyUsd),
    );
    weightedSumRewardBorrowApr = weightedSumRewardBorrowApr.plus(
      marketAccounting.rewardBorrowApr.times(marketAccounting.totalBaseBorrowUsd),
    );
    weightedSumNetSupplyApr = weightedSumNetSupplyApr.plus(
      marketAccounting.netSupplyApr.times(marketAccounting.totalBaseSupplyUsd),
    );
    weightedSumNetBorrowApr = weightedSumNetBorrowApr.plus(
      marketAccounting.netBorrowApr.times(marketAccounting.totalBaseBorrowUsd),
    );
  }

  accounting.lastUpdatedBlock = BigInt(event.block.number);
  accounting.protocol_id = protocol.id;
  accounting.totalSupplyUsd = totalSupplyUsd;
  accounting.totalBorrowUsd = totalBorrowUsd;
  accounting.reserveBalanceUsd = reserveBalanceUsd;
  accounting.collateralBalanceUsd = collateralBalanceUsd;
  accounting.collateralReservesBalanceUsd = collateralReserversBalanceUsd;
  accounting.totalReserveBalanceUsd = totalReserveBalanceUsd;
  accounting.utilization = bigDecimalSafeDiv(accounting.totalBorrowUsd, accounting.totalSupplyUsd);
  accounting.avgSupplyApr = bigDecimalSafeDiv(weightedSumSupplyApr, accounting.totalSupplyUsd);
  accounting.avgBorrowApr = bigDecimalSafeDiv(weightedSumBorrowApr, accounting.totalBorrowUsd);
  accounting.avgRewardSupplyApr = bigDecimalSafeDiv(weightedSumRewardSupplyApr, accounting.totalSupplyUsd);
  accounting.avgRewardBorrowApr = bigDecimalSafeDiv(weightedSumRewardBorrowApr, accounting.totalBorrowUsd);
  accounting.avgNetSupplyApr = bigDecimalSafeDiv(weightedSumNetSupplyApr, accounting.totalSupplyUsd);
  accounting.avgNetBorrowApr = bigDecimalSafeDiv(weightedSumNetBorrowApr, accounting.totalBorrowUsd);
  accounting.collateralization = bigDecimalSafeDiv(accounting.totalSupplyUsd, accounting.totalBorrowUsd);
  ctx.ProtocolAccounting.set({ ...accounting });

  await createProtocolAccountingSnapshots(ctx, accounting, event);
}

async function createProtocolAccountingSnapshots(ctx: Ctx, accounting: ProtocolAccounting, event: Ev): Promise<void> {
  const hour = BigInt(event.block.timestamp) / SECONDS_PER_HOUR;
  const day = BigInt(event.block.timestamp) / SECONDS_PER_DAY;
  const week = BigInt(event.block.timestamp) / SECONDS_PER_WEEK;

  const hourlyId = hexConcat(bigIntBytes(hour));
  const dailyId = hexConcat(bigIntBytes(day));
  const weeklyId = hexConcat(bigIntBytes(week));

  let hourlyAccounting = await ctx.HourlyProtocolAccounting.get(hourlyId);
  let dailyAccounting = await ctx.DailyProtocolAccounting.get(dailyId);
  let weeklyAccounting = await ctx.WeeklyProtocolAccounting.get(weeklyId);

  if (!hourlyAccounting || !dailyAccounting || !weeklyAccounting) {
    const accountingId = hexConcat(accounting.protocol_id, hourlyId);

    // Copy existing accounting
    const copiedAccounting: ProtocolAccounting = { ...accounting, id: accountingId };
    ctx.ProtocolAccounting.set(copiedAccounting);

    if (!hourlyAccounting) {
      hourlyAccounting = {
        id: hourlyId,
        hour,
        timestamp: BigInt(event.block.timestamp),
        protocol_id: getConfiguratorProxyAddress(),
        accounting_id: copiedAccounting.id,
      };
      ctx.HourlyProtocolAccounting.set(hourlyAccounting);
    }
    if (!dailyAccounting) {
      dailyAccounting = {
        id: dailyId,
        day,
        timestamp: BigInt(event.block.timestamp),
        protocol_id: getConfiguratorProxyAddress(),
        accounting_id: copiedAccounting.id,
      };
      ctx.DailyProtocolAccounting.set(dailyAccounting);
    }
    if (!weeklyAccounting) {
      weeklyAccounting = {
        id: weeklyId,
        week,
        timestamp: BigInt(event.block.timestamp),
        protocol_id: getConfiguratorProxyAddress(),
        accounting_id: copiedAccounting.id,
      };
      ctx.WeeklyProtocolAccounting.set(weeklyAccounting);
    }
  }
}

////
// Protocol
////

export async function getOrCreateProtocol(ctx: Ctx, event: Ev): Promise<Mutable<Protocol>> {
  const protocol = await ctx.Protocol.get(getConfiguratorProxyAddress());

  if (!protocol) {
    const usage = await getOrCreateUsage(ctx, hexConcat(utf8Hex("PROTOCOL_CUMULATIVE")));

    const created: Mutable<Protocol> = {
      id: getConfiguratorProxyAddress(),
      configuratorProxy: getConfiguratorProxyAddress(),
      configuratorImplementation: undefined,
      markets: [],
      cumulativeUsage_id: usage.id,
      accounting_id: "",
    };

    const accounting = await getOrCreateProtocolAccounting(ctx, created, event);
    created.accounting_id = accounting.id;

    ctx.Protocol.set({ ...created });
    return created;
  }

  return { ...protocol, markets: [...protocol.markets] };
}
