/**
 * Port of src/mapping/address-provider-registry/v3.ts.
 *
 * PoolAddressesProviderRegistry.AddressesProviderRegistered creates the Pool
 * entity (id = addressesProvider address) and instantiates the
 * PoolAddressesProvider template (subgraph `PoolAddressesProvider.create`).
 * The address to register is in the event params, so contractRegister can add
 * it directly.
 */
import { indexer } from "envio";
import { low } from "../common/constants";
import { getProtocol } from "../mappingHelpers/initializers";

indexer.contractRegister(
  { contract: "PoolAddressesProviderRegistry", event: "AddressesProviderRegistered" },
  async ({ event, context }) => {
    context.chain.PoolAddressesProvider.add(event.params.addressesProvider);
  },
);

indexer.onEvent(
  { contract: "PoolAddressesProviderRegistry", event: "AddressesProviderRegistered" },
  async ({ event, context }) => {
    const protocol = await getProtocol(context);
    const address = low(event.params.addressesProvider);
    const existing = await context.Pool.get(address);
    if (existing == null) {
      context.Pool.set({
        id: address,
        protocol_id: protocol.id,
        addressProviderId: event.params.id,
        active: true,
        paused: false,
        lastUpdateTimestamp: event.block.timestamp,
        pool: undefined,
        poolCollateralManager: undefined,
        poolConfiguratorImpl: undefined,
        poolImpl: undefined,
        poolDataProviderImpl: undefined,
        poolConfigurator: undefined,
        proxyPriceProvider: undefined,
        bridgeProtocolFee: undefined,
        flashloanPremiumTotal: undefined,
        flashloanPremiumToProtocol: undefined,
      });
    }
  },
);

indexer.onEvent(
  { contract: "PoolAddressesProviderRegistry", event: "AddressesProviderUnregistered" },
  async ({ event, context }) => {
    const address = low(event.params.addressesProvider);
    const pool = await context.Pool.get(address);
    if (pool != null) {
      context.Pool.set({ ...pool, active: false, lastUpdateTimestamp: event.block.timestamp });
    }
  },
);
