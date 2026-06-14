/**
 * Dynamic template registration, mirroring the Ponder `factory(...)` sources in
 * ponder.config.ts:
 *
 *   HTokens: factory(address: 0x8CB4310..., event: ReserveInitialized,
 *            parameter: "aToken")
 *     -> register the per-reserve aToken (HToken) child on every
 *        HTokenFactory.ReserveInitialized, keyed by the `aToken` event param.
 *
 *   IsolatedPair: factory(address: 0x9A32C32..., event: AddPair,
 *                 parameter: "pairAddress")
 *     -> register the new isolated pair on every IsolatedPairRegistry.AddPair.
 *
 * The Aave-v3 port registers a/s/v debt tokens the same way from
 * PoolConfigurator.ReserveInitialized; HyperLend only tracks the aToken child.
 */
import { indexer } from "envio";

indexer.contractRegister(
  { contract: "HTokenFactory", event: "ReserveInitialized" },
  async ({ event, context }) => {
    context.chain.HTokens.add(event.params.aToken);
  },
);

indexer.contractRegister(
  { contract: "IsolatedPairRegistry", event: "AddPair" },
  async ({ event, context }) => {
    context.chain.IsolatedPair.add(event.params.pairAddress);
  },
);
