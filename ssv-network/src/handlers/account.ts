/** Ported from ssv-subgraph src/handlers/account.ts (commit e2f1aa0). */
import { indexer } from "envio";
import { buildEventEntityId, low } from "../helpers";

indexer.onEvent(
  { contract: "SSVNetwork", event: "FeeRecipientAddressUpdated" },
  async ({ event, context }) => {
    context.FeeRecipientAddressUpdated.set({
      id: buildEventEntityId(event.transaction.hash, event.logIndex),
      owner: low(event.params.owner),
      recipientAddress: low(event.params.recipientAddress),
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
    });

    const owner = await context.Account.get(low(event.params.owner));
    if (!owner) return; // subgraph logs error and bails
    context.Account.set({
      ...owner,
      feeRecipient: low(event.params.recipientAddress),
    });
  },
);
