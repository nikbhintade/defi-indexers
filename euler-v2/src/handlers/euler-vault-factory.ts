/**
 * Port of src/factories/euler-vault-factory.ts.
 *
 * Subgraph: handleProxyCreated -> registerVault(proxy, factory) +
 *           EulerVault template create(proxy).
 *
 * `EulerVaultTemplate.create(proxy)` -> indexer.contractRegister adding the
 * proxy address to the EulerVault dynamic contract.
 */
import { indexer } from "envio";
import { registerVault } from "../utils/vault";

indexer.contractRegister(
  { contract: "EulerVaultFactory", event: "ProxyCreated" },
  async ({ event, context }) => {
    context.chain.EulerVault.add(event.params.proxy);
  },
);

indexer.onEvent(
  { contract: "EulerVaultFactory", event: "ProxyCreated" },
  async ({ event, context }) => {
    registerVault(context, event.params.proxy, event.srcAddress);
  },
);
