/**
 * Ported from liquity/dev packages/subgraph/src/mappings/PriceFeed.ts.
 */
import { indexer } from "envio";

import { updatePrice } from "../entities/SystemState";

indexer.onEvent(
  { contract: "PriceFeed", event: "LastGoodPriceUpdated" },
  async ({ event, context }) => {
    await updatePrice(context, event, event.params._lastGoodPrice);
  },
);
