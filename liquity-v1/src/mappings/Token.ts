/**
 * Ported from liquity/dev packages/subgraph/src/mappings/Token.ts.
 * Shared by the LUSDToken and LQTYToken ERC20 data sources. The subgraph used
 * `event.address` (the emitting contract) to identify the token; here that is
 * `event.srcAddress`.
 */
import { indexer } from "envio";

import { updateBalance } from "../entities/TokenBalance";
import { updateAllowance } from "../entities/TokenAllowance";

for (const contract of ["LUSDToken", "LQTYToken"] as const) {
  indexer.onEvent(
    { contract, event: "Transfer" },
    async ({ event, context }) => {
      await updateBalance(
        context,
        context.effect,
        event.srcAddress,
        event.params.from,
        event.params.to,
        event.params.value,
      );
    },
  );

  indexer.onEvent(
    { contract, event: "Approval" },
    async ({ event, context }) => {
      await updateAllowance(
        context,
        event.srcAddress,
        event.params.owner,
        event.params.spender,
        event.params.value,
      );
    },
  );
}
