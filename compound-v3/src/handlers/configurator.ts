/**
 * Port of src/mappings/configurator.ts.
 *
 * `Comet.create(event.params.cometProxy)` (subgraph template instantiation)
 * maps to `indexer.contractRegister` adding the address to the Comet
 * contract. The market itself gets created later on the Comet proxy's
 * Upgraded event (deployment), exactly like the original.
 */
import { indexer } from "envio";
import { low } from "../common/utils";
import { getOrCreateProtocol } from "../mappingHelpers/protocol";

indexer.onEvent(
  { contract: "Configurator", event: "Upgraded" },
  async ({ event, context }) => {
    const protocol = await getOrCreateProtocol(context, event);
    protocol.configuratorImplementation = low(event.params.implementation);
    context.Protocol.set({ ...protocol });
  },
);

// Create dynamic data source, market gets created later on upgrade (deployment)
indexer.contractRegister(
  { contract: "Configurator", event: "SetFactory" },
  async ({ event, context }) => {
    context.chain.Comet.add(event.params.cometProxy);
  },
);
