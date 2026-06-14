import type { ClaimableCollateral, ClaimableCollateralGroup } from "envio";
import type { handlerContext } from "../types";
import type { EventData } from "../utils/eventData";

export async function handleClaimableCollateralUpdated(
  context: handlerContext,
  eventData: EventData,
): Promise<void> {
  const account = eventData.getAddressItemString("account")!;
  const market = eventData.getAddressItemString("market")!;
  const token = eventData.getAddressItemString("token")!;
  const timeKey = eventData.getUintItem("timeKey")!.toString();
  const nextValue = eventData.getUintItem("nextValue")!;

  let entity = await getOrCreateClaimableCollateral(context, account, market, token, timeKey);
  const groupEntity = await getOrCreateClaimableCollateralGroup(context, market, token, timeKey);

  entity = { ...entity, value: nextValue, factorByTime: groupEntity.factor };

  const claimables = [...groupEntity.claimables];
  if (!claimables.includes(entity.id)) {
    claimables.push(entity.id);
  }

  context.ClaimableCollateral.set(entity);
  context.ClaimableCollateralGroup.set({ ...groupEntity, claimables });
}

export async function handleSetClaimableCollateralFactorForTime(
  context: handlerContext,
  eventData: EventData,
): Promise<void> {
  const market = eventData.getAddressItemString("market")!;
  const token = eventData.getAddressItemString("token")!;
  const timeKey = eventData.getUintItem("timeKey")!.toString();
  const factor = eventData.getUintItem("factor")!;

  const entity = await getOrCreateClaimableCollateralGroup(context, market, token, timeKey);

  for (const id of entity.claimables) {
    const claimable = await context.ClaimableCollateral.get(id);
    if (claimable == null) {
      context.log.warn(`ClaimableCollateral not found ${id}`);
      throw new Error("ClaimableCollateral not found");
    }
    context.ClaimableCollateral.set({ ...claimable, factorByTime: factor });
  }

  context.ClaimableCollateralGroup.set({ ...entity, factor });
}

export async function handleSetClaimableCollateralFactorForAccount(
  context: handlerContext,
  eventData: EventData,
): Promise<void> {
  const market = eventData.getAddressItemString("market")!;
  const token = eventData.getAddressItemString("token")!;
  const account = eventData.getAddressItemString("account")!;
  const timeKey = eventData.getUintItem("timeKey")!.toString();
  const factor = eventData.getUintItem("factor")!;

  const entity = await getOrCreateClaimableCollateral(context, account, market, token, timeKey);
  context.ClaimableCollateral.set({ ...entity, factor });
}

export async function handleCollateralClaimed(context: handlerContext, eventData: EventData): Promise<void> {
  const market = eventData.getAddressItemString("market")!;
  const token = eventData.getAddressItemString("token")!;
  const account = eventData.getAddressItemString("account")!;
  const timeKey = eventData.getUintItem("timeKey")!.toString();

  const entity = await getOrCreateClaimableCollateral(context, account, market, token, timeKey);
  context.ClaimableCollateral.set({ ...entity, claimed: true });
}

async function getOrCreateClaimableCollateral(
  context: handlerContext,
  account: string,
  market: string,
  token: string,
  timeKey: string,
): Promise<ClaimableCollateral> {
  const id = account + ":" + market + ":" + token + ":" + timeKey;
  let entity = await context.ClaimableCollateral.get(id);
  if (entity == null) {
    entity = {
      id,
      account,
      marketAddress: market,
      tokenAddress: token,
      timeKey,
      claimed: false,
      factor: 0n,
      value: 0n,
      factorByTime: 0n,
    };
  }
  return entity;
}

async function getOrCreateClaimableCollateralGroup(
  context: handlerContext,
  market: string,
  token: string,
  timeKey: string,
): Promise<ClaimableCollateralGroup> {
  const id = market + ":" + token + ":" + timeKey;
  let entity = await context.ClaimableCollateralGroup.get(id);
  if (entity == null) {
    entity = {
      id,
      marketAddress: market,
      tokenAddress: token,
      timeKey,
      claimables: [],
      factor: 0n,
    };
  }
  return entity;
}
