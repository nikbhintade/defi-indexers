/**
 * Port of src/mapping/address-provider-registry/address-provider-registry.ts.
 *
 * LendingPoolAddressesProviderRegistry.AddressesProviderRegistered creates the
 * Pool entity (id = addresses-provider address) and instantiates the
 * LendingPoolAddressesProvider template. The V2 event carries only `newAddress`
 * (no `id` param, unlike V3).
 */
import { indexer } from "envio";
import { low } from "../common/constants";
import { getProtocol } from "../mappingHelpers/initializers";

indexer.contractRegister(
  { contract: "LendingPoolAddressesProviderRegistry", event: "AddressesProviderRegistered" },
  async ({ event, context }) => {
    context.chain.LendingPoolAddressesProvider.add(event.params.newAddress);
  },
);

indexer.onEvent(
  { contract: "LendingPoolAddressesProviderRegistry", event: "AddressesProviderRegistered" },
  async ({ event, context }) => {
    const protocol = await getProtocol(context);
    const address = low(event.params.newAddress);
    const existing = await context.Pool.get(address);
    if (existing == null) {
      context.Pool.set({
        id: address,
        protocol_id: protocol.id,
        active: true,
        paused: false,
        lastUpdateTimestamp: event.block.timestamp,
        lendingPool: undefined,
        lendingPoolCollateralManager: undefined,
        lendingPoolConfiguratorImpl: undefined,
        lendingPoolImpl: undefined,
        lendingPoolConfigurator: undefined,
        lendingRateOracle: undefined,
        configurationAdmin: undefined,
        ethereumAddress: undefined,
        emergencyAdmin: undefined,
        proxyPriceProvider: undefined,
      });
    }
  },
);

indexer.onEvent(
  { contract: "LendingPoolAddressesProviderRegistry", event: "AddressesProviderUnregistered" },
  async ({ event, context }) => {
    const address = low(event.params.newAddress);
    const pool = await context.Pool.get(address);
    if (pool != null) {
      context.Pool.set({ ...pool, active: false });
    }
  },
);
