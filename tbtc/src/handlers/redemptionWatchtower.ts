/**
 * RedemptionWatchtower data source — redemption veto + redeemer banning.
 * Faithful port of src/mappingRedemptionWatchtower.ts.
 */
import { indexer } from "envio";
import * as Utils from "../utils/utils.js";
import * as Const from "../utils/constants.js";
import { getOrCreateRedemption, getOrCreateTransaction, getOrCreateUser, lc } from "../utils/helper.js";

indexer.onEvent(
  { contract: "RedemptionWatchtower", event: "VetoFinalized" },
  async ({ event, context }) => {
    const redemptionKey = event.params.redemptionKey;
    let count = Const.ZERO_BI;

    const txId = Utils.getIDFromEvent(event.transaction.hash, event.logIndex);
    const transaction = await getOrCreateTransaction(context, txId);
    context.Transaction.set({
      ...transaction,
      txHash: lc(event.transaction.hash),
      timestamp: BigInt(event.block.timestamp),
      from: lc(event.transaction.from ?? ""),
      to: event.transaction.to ? lc(event.transaction.to) : undefined,
      description: "Redemption Vetoed",
    });

    for (let i = 0; i < Const.MAXIMUM_BATCH_SIZE; i++) {
      const id = Utils.calculateRedemptionKeyByBigInt(redemptionKey, count);
      const redemption = await getOrCreateRedemption(context, id);
      if (redemption.updateTimestamp === Const.ZERO_BI) break;

      context.Redemption.set({
        ...redemption,
        status: "VETOED",
        updateTimestamp: BigInt(event.block.timestamp),
        transactions: [...redemption.transactions, txId],
      });
      count = count + Const.ONE_BI;
    }
  },
);

indexer.onEvent(
  { contract: "RedemptionWatchtower", event: "Banned" },
  async ({ event, context }) => {
    const user = await getOrCreateUser(context, lc(event.params.redeemer));
    context.User.set({ ...user, isRedeemerBanned: true });
  },
);

indexer.onEvent(
  { contract: "RedemptionWatchtower", event: "Unbanned" },
  async ({ event, context }) => {
    const user = await getOrCreateUser(context, lc(event.params.redeemer));
    context.User.set({ ...user, isRedeemerBanned: false });
  },
);
