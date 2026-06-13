/** Ported from src/WithdrawalQueue.ts. */
import { indexer } from "envio";
import type { WithdrawalQueueConfig } from "envio";
import { ZERO, low } from "../constants";
import type { HandlerContext } from "../helpers";

const CONFIG_ID = "";

async function loadWQConfig(
  context: HandlerContext
): Promise<WithdrawalQueueConfig> {
  const existing = await context.WithdrawalQueueConfig.get(CONFIG_ID);
  if (existing) return existing;
  return {
    id: CONFIG_ID,
    isBunkerMode: false,
    bunkerModeSince: ZERO,
    contractVersion: ZERO,
    isPaused: true,
    pauseDuration: ZERO,
  };
}

indexer.onEvent(
  { contract: "WithdrawalQueue", event: "WithdrawalClaimed" },
  async ({ event, context }) => {
    context.WithdrawalClaimed.set({
      id: `${low(event.transaction.hash)}-${event.logIndex}`,
      requestId: event.params.requestId,
      owner: low(event.params.owner),
      receiver: low(event.params.receiver),
      amountOfETH: event.params.amountOfETH,
      block: BigInt(event.block.number),
      blockTime: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
      logIndex: BigInt(event.logIndex),
    });
  }
);

indexer.onEvent(
  { contract: "WithdrawalQueue", event: "WithdrawalRequested" },
  async ({ event, context }) => {
    context.WithdrawalRequested.set({
      id: `${low(event.transaction.hash)}-${event.logIndex}`,
      requestId: event.params.requestId,
      requestor: low(event.params.requestor),
      owner: low(event.params.owner),
      amountOfStETH: event.params.amountOfStETH,
      amountOfShares: event.params.amountOfShares,
      block: BigInt(event.block.number),
      blockTime: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
      logIndex: BigInt(event.logIndex),
    });
  }
);

async function finalizeWithdrawals(
  context: HandlerContext,
  event: {
    params: {
      from: bigint;
      to: bigint;
      amountOfETHLocked: bigint;
      sharesToBurn: bigint;
      timestamp: bigint;
    };
    block: { number: number; timestamp: number };
    transaction: { hash: string };
    logIndex: number;
  }
): Promise<void> {
  context.WithdrawalsFinalized.set({
    id: `${low(event.transaction.hash)}-${event.logIndex}`,
    from: event.params.from,
    to: event.params.to,
    amountOfETHLocked: event.params.amountOfETHLocked,
    sharesToBurn: event.params.sharesToBurn,
    timestamp: event.params.timestamp,
    block: BigInt(event.block.number),
    blockTime: BigInt(event.block.timestamp),
    transactionHash: low(event.transaction.hash),
    logIndex: BigInt(event.logIndex),
  });
}

indexer.onEvent(
  { contract: "WithdrawalQueue", event: "WithdrawalsFinalized" },
  async ({ event, context }) => finalizeWithdrawals(context, event)
);

indexer.onEvent(
  { contract: "WithdrawalQueue", event: "WithdrawalBatchFinalized" },
  async ({ event, context }) => finalizeWithdrawals(context, event)
);

indexer.onEvent(
  { contract: "WithdrawalQueue", event: "BunkerModeDisabled" },
  async ({ context }) => {
    const c = await loadWQConfig(context);
    context.WithdrawalQueueConfig.set({
      ...c,
      isBunkerMode: false,
      bunkerModeSince: ZERO,
    });
  }
);

indexer.onEvent(
  { contract: "WithdrawalQueue", event: "BunkerModeEnabled" },
  async ({ event, context }) => {
    const c = await loadWQConfig(context);
    context.WithdrawalQueueConfig.set({
      ...c,
      isBunkerMode: true,
      bunkerModeSince: event.params._sinceTimestamp,
    });
  }
);

indexer.onEvent(
  { contract: "WithdrawalQueue", event: "ContractVersionSet" },
  async ({ event, context }) => {
    const c = await loadWQConfig(context);
    context.WithdrawalQueueConfig.set({
      ...c,
      contractVersion: event.params.version,
    });
  }
);

indexer.onEvent(
  { contract: "WithdrawalQueue", event: "Paused" },
  async ({ event, context }) => {
    const c = await loadWQConfig(context);
    context.WithdrawalQueueConfig.set({
      ...c,
      isPaused: true,
      pauseDuration: event.params.duration,
    });
  }
);

indexer.onEvent(
  { contract: "WithdrawalQueue", event: "Resumed" },
  async ({ context }) => {
    const c = await loadWQConfig(context);
    context.WithdrawalQueueConfig.set({
      ...c,
      isPaused: false,
      pauseDuration: ZERO,
    });
  }
);
