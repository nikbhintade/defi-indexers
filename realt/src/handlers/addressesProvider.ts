/**
 * Port of src/mapping/lending-pool-address-provider/lending-pool-address-provider.ts.
 *
 * LendingPoolAddressesProvider proxy/impl updates write the corresponding Pool
 * field and (for proxies via createMapContract) create a ContractToPoolMapping.
 * ProxyCreated additionally instantiates the LendingPool / LendingPoolConfigurator
 * templates.
 *
 * The bytes32 `id` in ProxyCreated/AddressSet is a raw ascii string id
 * ("LENDING_POOL", "LENDING_POOL_CONFIGURATOR", ...); graph-ts `Bytes.toString()`
 * decodes the utf8 bytes, which we replicate via decodeBytes32.
 */
import { indexer } from "envio";
import type { Pool } from "envio";
import { low } from "../common/constants";
import type { Ctx, Ev } from "../common/types";
import { getHistoryEntityId } from "../common/ids";
import { createMapContractToPool } from "../mappingHelpers/initializers";

/** Decode a bytes32 id (0x + hex) to its ascii label, trimming zero bytes. */
function decodeBytes32(id: string): string {
  const hex = id.startsWith("0x") ? id.slice(2) : id;
  let out = "";
  for (let i = 0; i + 1 < hex.length; i += 2) {
    const code = parseInt(hex.slice(i, i + 2), 16);
    if (code !== 0) out += String.fromCharCode(code);
  }
  return out;
}

// POOL_COMPONENTS order from the source. Two of these ("proxyPriceProvider",
// "ethereumAddress") are NOT fields on PoolConfigurationHistoryItem in the
// schema, so the source's `configurationHistoryItem.set(param, ...)` for those
// would have been a no-op on a typed entity; we skip them when copying.
const POOL_COMPONENTS = [
  "lendingPoolConfigurator",
  "lendingPoolConfiguratorImpl",
  "lendingPool",
  "lendingPoolImpl",
  "configurationAdmin",
  "proxyPriceProvider",
  "lendingRateOracle",
  "lendingPoolCollateralManager",
  "emergencyAdmin",
  "ethereumAddress",
] as const;

type PoolComponent = (typeof POOL_COMPONENTS)[number];

// fields that exist on both Pool and PoolConfigurationHistoryItem
const HISTORY_FIELDS = [
  "lendingPoolConfigurator",
  "lendingPoolConfiguratorImpl",
  "lendingPool",
  "lendingPoolImpl",
  "configurationAdmin",
  "lendingRateOracle",
  "lendingPoolCollateralManager",
] as const;

/**
 * saveAddressProvider: persist Pool, then build a PoolConfigurationHistoryItem
 * by copying each POOL_COMPONENT off the pool. QUIRK (preserved): the source
 * loops over ALL 10 components and `return`s early as soon as any is unset, so
 * the history item is only ever written once every component is populated.
 */
function saveAddressProvider(context: Ctx, pool: Pool, event: Ev): void {
  context.Pool.set({ ...pool, lastUpdateTimestamp: event.block.timestamp });

  // replicate early-return-on-unset over the full component list
  for (const param of POOL_COMPONENTS) {
    const value = pool[param as keyof Pool];
    if (!value) return;
  }

  const item: Record<string, unknown> = {
    id: getHistoryEntityId(event),
    pool_id: pool.id,
    timestamp: event.block.timestamp,
    active: undefined,
  };
  for (const f of HISTORY_FIELDS) {
    item[f] = pool[f as keyof Pool];
  }
  context.PoolConfigurationHistoryItem.set(
    item as unknown as Parameters<typeof context.PoolConfigurationHistoryItem.set>[0],
  );
}

async function genericAddressProviderUpdate(
  context: Ctx,
  component: PoolComponent,
  newAddress: string,
  event: Ev,
  createMapContract = true,
): Promise<void> {
  const poolAddress = low(event.srcAddress);
  const pool = await context.Pool.get(poolAddress);
  if (pool == null) {
    context.log.error(`pool ${poolAddress} is not registered!`);
    throw new Error("pool" + poolAddress + "is not registered!");
  }
  const updated = { ...pool, [component]: low(newAddress) } as Pool;
  if (createMapContract) {
    await createMapContractToPool(context, newAddress, pool.id);
  }
  saveAddressProvider(context, updated, event);
}

// ---- contractRegister: instantiate LendingPool / LendingPoolConfigurator ----
indexer.contractRegister(
  { contract: "LendingPoolAddressesProvider", event: "ProxyCreated" },
  async ({ event, context }) => {
    const contractId = decodeBytes32(event.params.id);
    if (contractId === "LENDING_POOL_CONFIGURATOR") {
      context.chain.LendingPoolConfigurator.add(event.params.newAddress);
    } else if (contractId === "LENDING_POOL") {
      context.chain.LendingPool.add(event.params.newAddress);
    }
  },
);

indexer.onEvent(
  { contract: "LendingPoolAddressesProvider", event: "ProxyCreated" },
  async ({ event, context }) => {
    const contractId = decodeBytes32(event.params.id);
    let component: PoolComponent | undefined;
    if (contractId === "LENDING_POOL_CONFIGURATOR") component = "lendingPoolConfigurator";
    else if (contractId === "LENDING_POOL") component = "lendingPool";
    if (component === undefined) return;
    await genericAddressProviderUpdate(context, component, event.params.newAddress, event);
  },
);

indexer.onEvent(
  { contract: "LendingPoolAddressesProvider", event: "AddressSet" },
  async ({ event, context }) => {
    const id = decodeBytes32(event.params.id);
    let mappedId: PoolComponent | "" = "";
    if (id === "LENDING_POOL") mappedId = "lendingPool";
    else if (id === "LENDING_POOL_CONFIGURATOR") mappedId = "lendingPoolConfigurator";
    else if (id === "POOL_ADMIN") mappedId = "configurationAdmin";
    else if (id === "EMERGENCY_ADMIN") mappedId = "emergencyAdmin";
    else if (id === "COLLATERAL_MANAGER") mappedId = "lendingPoolCollateralManager";
    else if (id === "PRICE_ORACLE") mappedId = "proxyPriceProvider";
    else if (id === "LENDING_RATE_ORACLE") mappedId = "lendingRateOracle";

    if (mappedId !== "") {
      await genericAddressProviderUpdate(context, mappedId, event.params.newAddress, event, false);
    } else {
      context.log.error(
        `Address set: ${low(event.params.newAddress)} | Contract ID: ${id}`,
      );
    }
  },
);

indexer.onEvent(
  { contract: "LendingPoolAddressesProvider", event: "PriceOracleUpdated" },
  async ({ event, context }) => {
    await genericAddressProviderUpdate(
      context,
      "proxyPriceProvider",
      event.params.newAddress,
      event,
      false,
    );
  },
);

indexer.onEvent(
  { contract: "LendingPoolAddressesProvider", event: "LendingRateOracleUpdated" },
  async ({ event, context }) => {
    await genericAddressProviderUpdate(
      context,
      "lendingRateOracle",
      event.params.newAddress,
      event,
      false,
    );
  },
);

indexer.onEvent(
  { contract: "LendingPoolAddressesProvider", event: "LendingPoolUpdated" },
  async ({ event, context }) => {
    await genericAddressProviderUpdate(
      context,
      "lendingPoolImpl",
      event.params.newAddress,
      event,
      false,
    );
  },
);

indexer.onEvent(
  { contract: "LendingPoolAddressesProvider", event: "ConfigurationAdminUpdated" },
  async ({ event, context }) => {
    await genericAddressProviderUpdate(
      context,
      "configurationAdmin",
      event.params.newAddress,
      event,
      false,
    );
  },
);

indexer.onEvent(
  { contract: "LendingPoolAddressesProvider", event: "LendingPoolConfiguratorUpdated" },
  async ({ event, context }) => {
    await genericAddressProviderUpdate(
      context,
      "lendingPoolConfiguratorImpl",
      event.params.newAddress,
      event,
      false,
    );
  },
);

indexer.onEvent(
  { contract: "LendingPoolAddressesProvider", event: "LendingPoolCollateralManagerUpdated" },
  async ({ event, context }) => {
    await genericAddressProviderUpdate(
      context,
      "lendingPoolCollateralManager",
      event.params.newAddress,
      event,
      false,
    );
  },
);

indexer.onEvent(
  { contract: "LendingPoolAddressesProvider", event: "EmergencyAdminUpdated" },
  async ({ event, context }) => {
    await genericAddressProviderUpdate(
      context,
      "emergencyAdmin",
      event.params.newAddress,
      event,
      false,
    );
  },
);
