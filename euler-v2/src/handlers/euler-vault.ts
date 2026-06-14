/**
 * Port of src/euler-vault.ts — EulerVault (EVK vault) template handlers.
 *
 * Transfer  -> trackActions(from) then trackActions(to)
 * Borrow    -> trackActions(account)
 * Repay     -> trackActions(account)
 */
import { indexer } from "envio";
import { trackActions } from "../utils/tracking";

indexer.onEvent(
  { contract: "EulerVault", event: "Transfer" },
  async ({ event, context }) => {
    await trackActions({
      context,
      effect: context.effect,
      account: event.params.from,
      vault: event.srcAddress,
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: event.transaction.hash,
      block: event.block.number,
    });

    await trackActions({
      context,
      effect: context.effect,
      account: event.params.to,
      vault: event.srcAddress,
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: event.transaction.hash,
      block: event.block.number,
    });
  },
);

indexer.onEvent(
  { contract: "EulerVault", event: "Borrow" },
  async ({ event, context }) => {
    await trackActions({
      context,
      effect: context.effect,
      account: event.params.account,
      vault: event.srcAddress,
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: event.transaction.hash,
      block: event.block.number,
    });
  },
);

indexer.onEvent(
  { contract: "EulerVault", event: "Repay" },
  async ({ event, context }) => {
    await trackActions({
      context,
      effect: context.effect,
      account: event.params.account,
      vault: event.srcAddress,
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: event.transaction.hash,
      block: event.block.number,
    });
  },
);
