/** Ported from src/EasyTrack.ts (only manifest-registered events). */
import { indexer } from "envio";
import type { EasyTrackConfig } from "envio";
import { ZERO, ZERO_ADDRESS, low } from "../constants";
import type { HandlerContext } from "../helpers";

const CONFIG_ID = "";

async function loadETConfig(context: HandlerContext): Promise<EasyTrackConfig> {
  const existing = await context.EasyTrackConfig.get(CONFIG_ID);
  if (existing) return existing;
  return {
    id: CONFIG_ID,
    evmScriptExecutor: ZERO_ADDRESS,
    motionDuration: ZERO,
    motionsCountLimit: ZERO,
    objectionsThreshold: ZERO,
    isPaused: false,
  };
}

indexer.onEvent(
  { contract: "EasyTrack", event: "MotionCreated" },
  async ({ event, context }) => {
    const config = await loadETConfig(context);
    context.Motion.set({
      id: event.params._motionId.toString(),
      snapshotBlock: BigInt(event.block.number),
      startDate: BigInt(event.block.timestamp),
      creator: low(event.params._creator),
      duration: config.motionDuration,
      evmScriptHash: low(event.params._evmScript),
      evmScriptFactory: low(event.params._evmScriptFactory),
      objectionsAmountPct: ZERO,
      objectionsThreshold: config.objectionsThreshold,
      objectionsAmount: ZERO,
      evmScriptCalldata: low(event.params._evmScriptCallData),
      status: "ACTIVE",
      enacted_at: undefined,
      canceled_at: undefined,
      rejected_at: undefined,
      block: BigInt(event.block.number),
      blockTime: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
      logIndex: BigInt(event.logIndex),
    });
  }
);

indexer.onEvent(
  { contract: "EasyTrack", event: "MotionObjected" },
  async ({ event, context }) => {
    const m = await context.Motion.getOrThrow(event.params._motionId.toString());
    context.Motion.set({
      ...m,
      objectionsAmount: event.params._newObjectionsAmount,
      objectionsAmountPct: event.params._newObjectionsAmountPct,
    });
    context.Objection.set({
      id: `${low(event.params._objector)}-${event.params._motionId}`,
      objector: low(event.params._objector),
      motionId: event.params._motionId,
      weight: event.params._weight,
      motion_id: m.id,
      block: BigInt(event.block.number),
      blockTime: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
      logIndex: BigInt(event.logIndex),
    });
  }
);

indexer.onEvent(
  { contract: "EasyTrack", event: "MotionCanceled" },
  async ({ event, context }) => {
    const m = await context.Motion.getOrThrow(event.params._motionId.toString());
    context.Motion.set({
      ...m,
      status: "CANCELED",
      canceled_at: BigInt(event.block.timestamp),
    });
  }
);

indexer.onEvent(
  { contract: "EasyTrack", event: "MotionEnacted" },
  async ({ event, context }) => {
    const m = await context.Motion.getOrThrow(event.params._motionId.toString());
    context.Motion.set({
      ...m,
      status: "ENACTED",
      enacted_at: BigInt(event.block.timestamp),
    });
  }
);

indexer.onEvent(
  { contract: "EasyTrack", event: "MotionRejected" },
  async ({ event, context }) => {
    const m = await context.Motion.getOrThrow(event.params._motionId.toString());
    context.Motion.set({
      ...m,
      status: "REJECTED",
      rejected_at: BigInt(event.block.timestamp),
    });
  }
);

indexer.onEvent(
  { contract: "EasyTrack", event: "EVMScriptFactoryAdded" },
  async ({ event, context }) => {
    context.EVMScriptFactory.set({
      id: low(event.params._evmScriptFactory),
      address: low(event.params._evmScriptFactory),
      permissions: low(event.params._permissions),
      isActive: true,
    });
  }
);

indexer.onEvent(
  { contract: "EasyTrack", event: "EVMScriptFactoryRemoved" },
  async ({ event, context }) => {
    const f = await context.EVMScriptFactory.getOrThrow(
      low(event.params._evmScriptFactory)
    );
    context.EVMScriptFactory.set({ ...f, isActive: false });
  }
);

indexer.onEvent(
  { contract: "EasyTrack", event: "EVMScriptExecutorChanged" },
  async ({ event, context }) => {
    const c = await loadETConfig(context);
    context.EasyTrackConfig.set({
      ...c,
      evmScriptExecutor: low(event.params._evmScriptExecutor),
    });
  }
);

indexer.onEvent(
  { contract: "EasyTrack", event: "MotionDurationChanged" },
  async ({ event, context }) => {
    const c = await loadETConfig(context);
    context.EasyTrackConfig.set({
      ...c,
      motionDuration: event.params._motionDuration,
    });
  }
);

indexer.onEvent(
  { contract: "EasyTrack", event: "MotionsCountLimitChanged" },
  async ({ event, context }) => {
    const c = await loadETConfig(context);
    context.EasyTrackConfig.set({
      ...c,
      motionsCountLimit: event.params._newMotionsCountLimit,
    });
  }
);

indexer.onEvent(
  { contract: "EasyTrack", event: "ObjectionsThresholdChanged" },
  async ({ event, context }) => {
    const c = await loadETConfig(context);
    context.EasyTrackConfig.set({
      ...c,
      objectionsThreshold: event.params._newThreshold,
    });
  }
);

indexer.onEvent(
  { contract: "EasyTrack", event: "Paused" },
  async ({ context }) => {
    const c = await loadETConfig(context);
    context.EasyTrackConfig.set({ ...c, isPaused: true });
  }
);

indexer.onEvent(
  { contract: "EasyTrack", event: "Unpaused" },
  async ({ context }) => {
    const c = await loadETConfig(context);
    context.EasyTrackConfig.set({ ...c, isPaused: false });
  }
);
