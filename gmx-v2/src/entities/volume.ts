import type { PositionVolumeInfo, SwapVolumeInfo, VolumeInfo } from "envio";
import type { handlerContext } from "../types";
import { timestampToPeriodStart } from "../utils/time";
import { getMarketInfo } from "./markets";

export async function saveVolumeInfo(
  context: handlerContext,
  type: string,
  timestamp: number,
  volume: bigint,
): Promise<void> {
  const hourly = await getOrCreateVolumeInfo(context, timestamp, "1h");
  const daily = await getOrCreateVolumeInfo(context, timestamp, "1d");
  const total = await getOrCreateVolumeInfo(context, timestamp, "total");

  const apply = (v: VolumeInfo): VolumeInfo => {
    let next: VolumeInfo = { ...v, volumeUsd: v.volumeUsd + volume };
    if (type === "swap") next = { ...next, swapVolumeUsd: next.swapVolumeUsd + volume };
    if (type === "deposit") next = { ...next, depositVolumeUsd: next.depositVolumeUsd + volume };
    if (type === "withdrawal") next = { ...next, withdrawalVolumeUsd: next.withdrawalVolumeUsd + volume };
    if (type === "margin") next = { ...next, marginVolumeUsd: next.marginVolumeUsd + volume };
    return next;
  };

  context.VolumeInfo.set(apply(hourly));
  context.VolumeInfo.set(apply(daily));
  context.VolumeInfo.set(apply(total));
}

async function getOrCreateVolumeInfo(
  context: handlerContext,
  timestamp: number,
  period: string,
): Promise<VolumeInfo> {
  const timestampGroup = timestampToPeriodStart(timestamp, period);
  let volumeId = period;
  if (period !== "total") {
    volumeId = volumeId + ":" + timestampGroup.toString();
  }
  let volumeInfo = await context.VolumeInfo.get(volumeId);
  if (volumeInfo == null) {
    volumeInfo = {
      id: volumeId,
      period,
      volumeUsd: 0n,
      swapVolumeUsd: 0n,
      marginVolumeUsd: 0n,
      depositVolumeUsd: 0n,
      withdrawalVolumeUsd: 0n,
      timestamp: timestampGroup,
    };
  }
  return volumeInfo;
}

export async function saveSwapVolumeInfo(
  context: handlerContext,
  timestamp: number,
  tokenIn: string,
  tokenOut: string,
  volumeUsd: bigint,
): Promise<void> {
  for (const period of ["1h", "1d", "total"]) {
    const info = await getOrCreateSwapVolumeInfo(context, timestamp, tokenIn, tokenOut, period);
    context.SwapVolumeInfo.set({ ...info, volumeUsd: info.volumeUsd + volumeUsd });
  }
}

async function getOrCreateSwapVolumeInfo(
  context: handlerContext,
  timestamp: number,
  tokenIn: string,
  tokenOut: string,
  period: string,
): Promise<SwapVolumeInfo> {
  const timestampGroup = timestampToPeriodStart(timestamp, period);
  let id = getVolumeInfoId(tokenIn, tokenOut) + ":" + period;
  if (period !== "total") {
    id = id + ":" + timestampGroup.toString();
  }
  let volumeInfo = await context.SwapVolumeInfo.get(id);
  if (volumeInfo == null) {
    volumeInfo = {
      id,
      tokenIn,
      tokenOut,
      timestamp: timestampGroup,
      period,
      volumeUsd: 0n,
    };
  }
  return volumeInfo;
}

export async function savePositionVolumeInfo(
  context: handlerContext,
  timestamp: number,
  collateralToken: string,
  marketToken: string,
  sizeInUsd: bigint,
): Promise<void> {
  const marketInfo = await getMarketInfo(context, marketToken);
  for (const period of ["1h", "1d", "total"]) {
    const info = await getOrCreatePositionVolumeInfo(
      context,
      timestamp,
      collateralToken,
      marketInfo.indexToken,
      period,
    );
    context.PositionVolumeInfo.set({ ...info, volumeUsd: info.volumeUsd + sizeInUsd });
  }
}

async function getOrCreatePositionVolumeInfo(
  context: handlerContext,
  timestamp: number,
  collateralToken: string,
  indexToken: string,
  period: string,
): Promise<PositionVolumeInfo> {
  const timestampGroup = timestampToPeriodStart(timestamp, period);
  let id = getVolumeInfoId(collateralToken, indexToken) + ":" + period;
  if (period !== "total") {
    id = id + ":" + timestampGroup.toString();
  }
  let volumeInfo = await context.PositionVolumeInfo.get(id);
  if (volumeInfo == null) {
    volumeInfo = {
      id,
      collateralToken,
      indexToken,
      timestamp: timestampGroup,
      period,
      volumeUsd: 0n,
    };
  }
  return volumeInfo;
}

function getVolumeInfoId(tokenA: string, tokenB: string): string {
  return tokenA + ":" + tokenB;
}
