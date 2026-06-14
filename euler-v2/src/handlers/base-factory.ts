/**
 * Port of src/factories/base-factory.ts (the SecuritizeFactory data source).
 *
 * Subgraph: handleContractDeployed -> registerVault(deployedContract, factory) +
 *           ERC4626Vault template create(deployedContract).
 */
import { indexer } from "envio";
import { registerVault } from "../utils/vault";

indexer.contractRegister(
  { contract: "SecuritizeFactory", event: "ContractDeployed" },
  async ({ event, context }) => {
    context.chain.ERC4626Vault.add(event.params.deployedContract);
  },
);

indexer.onEvent(
  { contract: "SecuritizeFactory", event: "ContractDeployed" },
  async ({ event, context }) => {
    registerVault(context, event.params.deployedContract, event.srcAddress);
  },
);
