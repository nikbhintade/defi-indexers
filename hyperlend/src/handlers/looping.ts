/**
 * LoopingStrategyManagerFactory handler — port of
 * `LoopingStrategyManagerFactory:StrategyDeployed` in the Ponder source.
 */
import { indexer } from "envio";
import { logId, low } from "../common/ids";

indexer.onEvent(
  { contract: "LoopingStrategyManagerFactory", event: "StrategyDeployed" },
  async ({ event, context }) => {
    context.StrategyDeployed.set({
      id: logId(event),
      txHash: event.transaction.hash,
      owner: low(event.params.owner),
      stratManager: low(event.params.stratManager),
      pool: low(event.params.pool),
      yieldAsset: low(event.params.yieldAsset),
      debtAsset: low(event.params.debtAsset),
    });
  },
);
