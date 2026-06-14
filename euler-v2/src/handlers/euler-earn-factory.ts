/**
 * Port of src/factories/euler-earn-factory.ts.
 *
 * Subgraph: handleCreateEulerEarn -> registerVault(eulerEarn, factory) +
 *           ERC4626Vault template create(eulerEarn).
 */
import { indexer } from "envio";
import { registerVault } from "../utils/vault";

indexer.contractRegister(
  { contract: "EulerEarnFactory", event: "CreateEulerEarn" },
  async ({ event, context }) => {
    context.chain.ERC4626Vault.add(event.params.eulerEarn);
  },
);

indexer.onEvent(
  { contract: "EulerEarnFactory", event: "CreateEulerEarn" },
  async ({ event, context }) => {
    registerVault(context, event.params.eulerEarn, event.srcAddress);
  },
);
