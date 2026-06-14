/**
 * Ported from liquity/dev packages/subgraph/src/mappings/BorrowerOperations.ts.
 *
 * NB: BorrowerOperations.TroveUpdated uses param names `stake`/`operation`
 * (no leading underscore), whereas TroveManager.TroveUpdated uses
 * `_stake`/`_operation`. The signatures in config.yaml reflect this.
 */
import { indexer } from "envio";

import { getTroveOperationFromBorrowerOperation } from "../types/TroveOperation";
import { setBorrowingFeeOfLastTroveChange, updateTrove } from "../entities/Trove";
import { increaseTotalBorrowingFeesPaid } from "../entities/Global";

indexer.onEvent(
  { contract: "BorrowerOperations", event: "TroveUpdated" },
  async ({ event, context }) => {
    await updateTrove(
      context,
      event,
      getTroveOperationFromBorrowerOperation(event.params.operation),
      event.params._borrower,
      event.params._coll,
      event.params._debt,
      event.params.stake,
    );
  },
);

indexer.onEvent(
  { contract: "BorrowerOperations", event: "LUSDBorrowingFeePaid" },
  async ({ event, context }) => {
    await setBorrowingFeeOfLastTroveChange(context, event.params._LUSDFee);
    await increaseTotalBorrowingFeesPaid(context, event.params._LUSDFee);
  },
);
