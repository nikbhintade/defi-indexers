/**
 * Port of src/m-token.ts (M0 `protocol` subgraph). All MToken handlers are
 * pure event-entity writers (no eth_calls). The subgraph aliases each MToken
 * event to an `MToken*` entity (e.g. AuthorizationCanceled -> MTokenAuthorizationCanceled).
 * id = `tx.hash.concatI32(logIndex)`.
 */
import { indexer } from "envio";
import { a, txHashConcatLogIndex } from "../utils";

// AuthorizationCanceled -> MTokenAuthorizationCanceled
indexer.onEvent(
  { contract: "MToken", event: "AuthorizationCanceled" },
  async ({ event, context }) => {
    const id = txHashConcatLogIndex(event.transaction.hash, event.logIndex);
    context.MTokenAuthorizationCanceled.set({
      id,
      authorizer: a(event.params.authorizer),
      nonce: a(event.params.nonce),
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: a(event.transaction.hash),
    });
  },
);

// AuthorizationUsed -> MTokenAuthorizationUsed
indexer.onEvent(
  { contract: "MToken", event: "AuthorizationUsed" },
  async ({ event, context }) => {
    const id = txHashConcatLogIndex(event.transaction.hash, event.logIndex);
    context.MTokenAuthorizationUsed.set({
      id,
      authorizer: a(event.params.authorizer),
      nonce: a(event.params.nonce),
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: a(event.transaction.hash),
    });
  },
);

// IndexUpdated -> MTokenIndexUpdated
indexer.onEvent(
  { contract: "MToken", event: "IndexUpdated" },
  async ({ event, context }) => {
    const id = txHashConcatLogIndex(event.transaction.hash, event.logIndex);
    context.MTokenIndexUpdated.set({
      id,
      index: event.params.index,
      rate: event.params.rate,
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: a(event.transaction.hash),
    });
  },
);

// StartedEarning -> MTokenStartedEarning
indexer.onEvent(
  { contract: "MToken", event: "StartedEarning" },
  async ({ event, context }) => {
    const id = txHashConcatLogIndex(event.transaction.hash, event.logIndex);
    context.MTokenStartedEarning.set({
      id,
      account: a(event.params.account),
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: a(event.transaction.hash),
    });
  },
);

// StoppedEarning -> MTokenStoppedEarning
indexer.onEvent(
  { contract: "MToken", event: "StoppedEarning" },
  async ({ event, context }) => {
    const id = txHashConcatLogIndex(event.transaction.hash, event.logIndex);
    context.MTokenStoppedEarning.set({
      id,
      account: a(event.params.account),
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: a(event.transaction.hash),
    });
  },
);
