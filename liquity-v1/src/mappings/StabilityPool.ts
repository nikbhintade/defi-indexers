/**
 * Ported from liquity/dev packages/subgraph/src/mappings/StabilityPool.ts.
 *
 * Stability-pool deposit accounting hinges on the `tmpDepositUpdate` field of
 * the Global entity, used as a single-slot mailbox between the
 * ETHGainWithdrawn and UserDepositChanged events emitted in the same provideToSP/
 * withdrawFromSP call. `swapTmpDepositUpdate` reads the current value and
 * atomically replaces it with `valueToSetIfNull` (if it was null) or null (if
 * it was set), returning the previous value. We preserve graph-node's
 * BigInt-vs-null semantics exactly (null means "unset").
 */
import { indexer } from "envio";
import type { EvmOnEventContext as handlerContext } from "envio";

import { BIGINT_ZERO } from "../utils/bignumbers";
import { getGlobal } from "../entities/Global";
import {
  updateStabilityDeposit,
  withdrawCollateralGainFromStabilityDeposit,
} from "../entities/StabilityDeposit";
import { registerFrontend, assignFrontendToDepositor } from "../entities/Frontend";

/**
 * Read tmpDepositUpdate from Global and replace it with null (if it was set) or
 * valueToSetIfNull (if it was null). Returns the value before the swap.
 */
async function swapTmpDepositUpdate(
  context: handlerContext,
  valueToSetIfNull: bigint,
): Promise<bigint | null> {
  const global = await getGlobal(context);

  const tmpDepositUpdate = global.tmpDepositUpdate ?? null;
  context.Global.set({
    ...global,
    tmpDepositUpdate: tmpDepositUpdate == null ? valueToSetIfNull : undefined,
  });

  return tmpDepositUpdate;
}

indexer.onEvent(
  { contract: "StabilityPool", event: "UserDepositChanged" },
  async ({ event, context }) => {
    const ethGainWithdrawn = await swapTmpDepositUpdate(context, event.params._newDeposit);

    if (ethGainWithdrawn != null) {
      await updateStabilityDeposit(context, event, event.params._depositor, event.params._newDeposit);
    }
  },
);

indexer.onEvent(
  { contract: "StabilityPool", event: "ETHGainWithdrawn" },
  async ({ event, context }) => {
    // Leave a non-null dummy value to signal to handleUserDepositChanged()
    // that ETH gains have been withdrawn.
    const depositUpdate = await swapTmpDepositUpdate(context, BIGINT_ZERO);

    await withdrawCollateralGainFromStabilityDeposit(
      context,
      event,
      event.params._depositor,
      event.params._ETH,
      event.params._LUSDLoss,
    );

    if (depositUpdate != null) {
      await updateStabilityDeposit(context, event, event.params._depositor, depositUpdate);
    }
  },
);

indexer.onEvent(
  { contract: "StabilityPool", event: "FrontEndRegistered" },
  async ({ event, context }) => {
    await registerFrontend(context, event.params._frontEnd, event.params._kickbackRate);
  },
);

indexer.onEvent(
  { contract: "StabilityPool", event: "FrontEndTagSet" },
  async ({ event, context }) => {
    await assignFrontendToDepositor(context, event.params._depositor, event.params._frontEnd);
  },
);
