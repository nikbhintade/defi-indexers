/**
 * Port of src/minter-gateway.ts (M0 `protocol` subgraph).
 *
 * Each event handler stores its immutable event entity (id =
 * `tx.hash.concatI32(logIndex)`), then most handlers call
 * `handleMinterAttributes` (timeseries + per-minter eth_call reads).
 * `handleIndexUpdated` and `handleMintProposed` do NOT call it, matching the
 * subgraph exactly.
 */
import { indexer } from "envio";
import { a, txHashConcatLogIndex } from "../utils";
import { handleMinterAttributes, type BlockMeta } from "../minter-attributes";

const GATEWAY = "0xf7f9638cb444d65e5a40bf5ff98ebe4ff319f04e";

function blockMeta(event: {
  block: { number: number; timestamp: number; hash: string };
}): BlockMeta {
  return {
    number: event.block.number,
    hash: event.block.hash.toLowerCase(),
    timestamp: BigInt(event.block.timestamp),
  };
}

// BurnExecuted(minter, amount, payer) — active-owed-M overload
indexer.onEvent(
  { contract: "MinterGateway", event: "BurnExecuted" },
  async ({ event, context }) => {
    const id = txHashConcatLogIndex(event.transaction.hash, event.logIndex);
    context.BurnExecuted.set({
      id,
      minter: a(event.params.minter),
      principalAmount: undefined,
      amount: event.params.amount,
      payer: a(event.params.payer),
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: a(event.transaction.hash),
    });
    if (context.isPreload) return;
    await handleMinterAttributes(
      context,
      context.effect,
      GATEWAY,
      a(event.params.minter),
      blockMeta(event),
    );
  },
);

// BurnExecuted(minter, principalAmount, amount, payer) — inactive-owed-M overload
indexer.onEvent(
  { contract: "MinterGateway", event: "BurnExecutedWithPrincipal" },
  async ({ event, context }) => {
    const id = txHashConcatLogIndex(event.transaction.hash, event.logIndex);
    context.BurnExecuted.set({
      id,
      minter: a(event.params.minter),
      principalAmount: event.params.principalAmount,
      amount: event.params.amount,
      payer: a(event.params.payer),
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: a(event.transaction.hash),
    });
    if (context.isPreload) return;
    await handleMinterAttributes(
      context,
      context.effect,
      GATEWAY,
      a(event.params.minter),
      blockMeta(event),
    );
  },
);

// CollateralUpdated
indexer.onEvent(
  { contract: "MinterGateway", event: "CollateralUpdated" },
  async ({ event, context }) => {
    const id = txHashConcatLogIndex(event.transaction.hash, event.logIndex);
    context.CollateralUpdated.set({
      id,
      minter: a(event.params.minter),
      collateral: event.params.collateral,
      totalResolvedCollateralRetrieval:
        event.params.totalResolvedCollateralRetrieval,
      metadataHash: a(event.params.metadataHash),
      timestamp: event.params.timestamp,
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: a(event.transaction.hash),
    });
    if (context.isPreload) return;
    await handleMinterAttributes(
      context,
      context.effect,
      GATEWAY,
      a(event.params.minter),
      blockMeta(event),
    );
  },
);

// IndexUpdated — no handleMinterAttributes
indexer.onEvent(
  { contract: "MinterGateway", event: "IndexUpdated" },
  async ({ event, context }) => {
    const id = txHashConcatLogIndex(event.transaction.hash, event.logIndex);
    context.IndexUpdated.set({
      id,
      index: event.params.index,
      rate: event.params.rate,
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: a(event.transaction.hash),
    });
  },
);

// MintCanceled
indexer.onEvent(
  { contract: "MinterGateway", event: "MintCanceled" },
  async ({ event, context }) => {
    const id = txHashConcatLogIndex(event.transaction.hash, event.logIndex);
    context.MintCanceled.set({
      id,
      mintId: event.params.mintId,
      minter: a(event.params.minter),
      canceller: a(event.params.canceller),
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: a(event.transaction.hash),
    });
    if (context.isPreload) return;
    await handleMinterAttributes(
      context,
      context.effect,
      GATEWAY,
      a(event.params.minter),
      blockMeta(event),
    );
  },
);

// MintExecuted
indexer.onEvent(
  { contract: "MinterGateway", event: "MintExecuted" },
  async ({ event, context }) => {
    const id = txHashConcatLogIndex(event.transaction.hash, event.logIndex);
    context.MintExecuted.set({
      id,
      mintId: event.params.mintId,
      minter: a(event.params.minter),
      principalAmount: event.params.principalAmount,
      amount: event.params.amount,
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: a(event.transaction.hash),
    });
    if (context.isPreload) return;
    await handleMinterAttributes(
      context,
      context.effect,
      GATEWAY,
      a(event.params.minter),
      blockMeta(event),
    );
  },
);

// MintProposed — no handleMinterAttributes
indexer.onEvent(
  { contract: "MinterGateway", event: "MintProposed" },
  async ({ event, context }) => {
    const id = txHashConcatLogIndex(event.transaction.hash, event.logIndex);
    context.MintProposed.set({
      id,
      mintId: event.params.mintId,
      minter: a(event.params.minter),
      amount: event.params.amount,
      destination: a(event.params.destination),
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: a(event.transaction.hash),
    });
  },
);

// MinterActivated
indexer.onEvent(
  { contract: "MinterGateway", event: "MinterActivated" },
  async ({ event, context }) => {
    const id = txHashConcatLogIndex(event.transaction.hash, event.logIndex);
    context.MinterActivated.set({
      id,
      minter: a(event.params.minter),
      caller: a(event.params.caller),
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: a(event.transaction.hash),
    });
    if (context.isPreload) return;
    await handleMinterAttributes(
      context,
      context.effect,
      GATEWAY,
      a(event.params.minter),
      blockMeta(event),
    );
  },
);

// MinterDeactivated
indexer.onEvent(
  { contract: "MinterGateway", event: "MinterDeactivated" },
  async ({ event, context }) => {
    const id = txHashConcatLogIndex(event.transaction.hash, event.logIndex);
    context.MinterDeactivated.set({
      id,
      minter: a(event.params.minter),
      inactiveOwedM: event.params.inactiveOwedM,
      caller: a(event.params.caller),
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: a(event.transaction.hash),
    });
    if (context.isPreload) return;
    await handleMinterAttributes(
      context,
      context.effect,
      GATEWAY,
      a(event.params.minter),
      blockMeta(event),
    );
  },
);

// MinterFrozen
indexer.onEvent(
  { contract: "MinterGateway", event: "MinterFrozen" },
  async ({ event, context }) => {
    const id = txHashConcatLogIndex(event.transaction.hash, event.logIndex);
    context.MinterFrozen.set({
      id,
      minter: a(event.params.minter),
      frozenUntil: event.params.frozenUntil,
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: a(event.transaction.hash),
    });
    if (context.isPreload) return;
    await handleMinterAttributes(
      context,
      context.effect,
      GATEWAY,
      a(event.params.minter),
      blockMeta(event),
    );
  },
);

// MissedIntervalsPenaltyImposed
indexer.onEvent(
  { contract: "MinterGateway", event: "MissedIntervalsPenaltyImposed" },
  async ({ event, context }) => {
    const id = txHashConcatLogIndex(event.transaction.hash, event.logIndex);
    context.MissedIntervalsPenaltyImposed.set({
      id,
      minter: a(event.params.minter),
      missedIntervals: event.params.missedIntervals,
      penaltyAmount: event.params.penaltyAmount,
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: a(event.transaction.hash),
    });
    if (context.isPreload) return;
    await handleMinterAttributes(
      context,
      context.effect,
      GATEWAY,
      a(event.params.minter),
      blockMeta(event),
    );
  },
);

// RetrievalCreated
indexer.onEvent(
  { contract: "MinterGateway", event: "RetrievalCreated" },
  async ({ event, context }) => {
    const id = txHashConcatLogIndex(event.transaction.hash, event.logIndex);
    context.RetrievalCreated.set({
      id,
      retrievalId: event.params.retrievalId,
      minter: a(event.params.minter),
      amount: event.params.amount,
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: a(event.transaction.hash),
    });
    if (context.isPreload) return;
    await handleMinterAttributes(
      context,
      context.effect,
      GATEWAY,
      a(event.params.minter),
      blockMeta(event),
    );
  },
);

// RetrievalResolved
indexer.onEvent(
  { contract: "MinterGateway", event: "RetrievalResolved" },
  async ({ event, context }) => {
    const id = txHashConcatLogIndex(event.transaction.hash, event.logIndex);
    context.RetrievalResolved.set({
      id,
      retrievalId: event.params.retrievalId,
      minter: a(event.params.minter),
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: a(event.transaction.hash),
    });
    if (context.isPreload) return;
    await handleMinterAttributes(
      context,
      context.effect,
      GATEWAY,
      a(event.params.minter),
      blockMeta(event),
    );
  },
);

// UndercollateralizedPenaltyImposed
indexer.onEvent(
  { contract: "MinterGateway", event: "UndercollateralizedPenaltyImposed" },
  async ({ event, context }) => {
    const id = txHashConcatLogIndex(event.transaction.hash, event.logIndex);
    context.UndercollateralizedPenaltyImposed.set({
      id,
      minter: a(event.params.minter),
      excessOwedM: event.params.excessOwedM,
      timeSpan: event.params.timeSpan,
      penaltyAmount: event.params.penaltyAmount,
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: a(event.transaction.hash),
    });
    if (context.isPreload) return;
    await handleMinterAttributes(
      context,
      context.effect,
      GATEWAY,
      a(event.params.minter),
      blockMeta(event),
    );
  },
);
