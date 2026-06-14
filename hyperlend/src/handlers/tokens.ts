/**
 * HTokens (aToken) handler — port of `HTokens:BalanceTransfer` in the Ponder
 * source. `reserve` is the emitting aToken contract address (Ponder
 * `event.log.address` -> envio `event.srcAddress`).
 */
import { indexer } from "envio";
import { logId, low } from "../common/ids";

indexer.onEvent({ contract: "HTokens", event: "BalanceTransfer" }, async ({ event, context }) => {
  context.HTokenTransfer.set({
    id: logId(event),
    txHash: event.transaction.hash,
    reserve: low(event.srcAddress),
    from: low(event.params.from),
    to: low(event.params.to),
    value: event.params.value,
    index: event.params.index,
  });
});
