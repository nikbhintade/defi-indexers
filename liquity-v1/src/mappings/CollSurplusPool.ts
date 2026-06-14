/**
 * Ported from liquity/dev packages/subgraph/src/mappings/CollSurplusPool.ts.
 */
import { indexer } from "envio";

import { updateUserClaimColl } from "../entities/User";

indexer.onEvent(
  { contract: "CollSurplusPool", event: "CollBalanceUpdated" },
  async ({ event, context }) => {
    await updateUserClaimColl(context, event, event.params._account, event.params._newBalance);
  },
);
