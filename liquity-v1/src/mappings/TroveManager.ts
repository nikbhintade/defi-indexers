/**
 * Ported from liquity/dev packages/subgraph/src/mappings/TroveManager.ts.
 */
import { indexer } from "envio";

import {
  getTroveOperationFromTroveManagerOperation,
} from "../types/TroveOperation";
import { finishCurrentLiquidation } from "../entities/Liquidation";
import { finishCurrentRedemption } from "../entities/Redemption";
import {
  applyRedistributionToTroveBeforeLiquidation,
  updateTrove,
} from "../entities/Trove";
import { updateTotalRedistributed } from "../entities/Global";

indexer.onEvent(
  { contract: "TroveManager", event: "TroveUpdated" },
  async ({ event, context }) => {
    await updateTrove(
      context,
      event,
      getTroveOperationFromTroveManagerOperation(event.params._operation),
      event.params._borrower,
      event.params._coll,
      event.params._debt,
      event.params._stake,
    );
  },
);

indexer.onEvent(
  { contract: "TroveManager", event: "TroveLiquidated" },
  async ({ event, context }) => {
    await applyRedistributionToTroveBeforeLiquidation(context, event, event.params._borrower);
    // No need to close the Trove yet: TroveLiquidated is followed by a
    // TroveUpdated event that sets collateral and debt to 0.
  },
);

indexer.onEvent(
  { contract: "TroveManager", event: "Liquidation" },
  async ({ event, context }) => {
    await finishCurrentLiquidation(
      context,
      event,
      event.params._liquidatedColl,
      event.params._liquidatedDebt,
      event.params._collGasCompensation,
      event.params._LUSDGasCompensation,
    );
  },
);

indexer.onEvent(
  { contract: "TroveManager", event: "Redemption" },
  async ({ event, context }) => {
    await finishCurrentRedemption(
      context,
      event,
      event.params._attemptedLUSDAmount,
      event.params._actualLUSDAmount,
      event.params._ETHSent,
      event.params._ETHFee,
    );
  },
);

indexer.onEvent(
  { contract: "TroveManager", event: "LTermsUpdated" },
  async ({ event, context }) => {
    await updateTotalRedistributed(context, event.params._L_ETH, event.params._L_LUSDDebt);
  },
);
