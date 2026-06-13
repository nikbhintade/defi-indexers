/**
 * Port of src/mapping/lending-pool-address-provider/v3.ts.
 *
 * PoolAddressesProvider proxy/impl updates write the corresponding Pool field
 * and (for proxies) create a ContractToPoolMapping. ProxyCreated additionally
 * instantiates the Pool / PoolConfigurator templates.
 *
 * The bytes32 `id` in ProxyCreated is the keccak-less raw string id used by
 * Aave ("POOL", "POOL_CONFIGURATOR"); it arrives as a 0x-padded hex string, so
 * we decode the trailing utf8 bytes to recover the label.
 */
import { indexer } from "envio";
import type { Pool } from "envio";
import { low } from "../common/constants";
import type { Ctx, Ev } from "../common/types";
import { createMapContractToPool, getOrInitPriceOracle } from "../mappingHelpers/initializers";

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

type PoolComponent =
  | "poolDataProviderImpl"
  | "poolConfigurator"
  | "poolConfiguratorImpl"
  | "pool"
  | "poolImpl"
  | "proxyPriceProvider";

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
  const updated: Pool = {
    ...pool,
    [component]: low(newAddress),
    lastUpdateTimestamp: event.block.timestamp,
  };
  context.Pool.set(updated);
  if (createMapContract) {
    await createMapContractToPool(context, newAddress, pool.id);
  }
  if (component === "poolConfigurator") {
    const cfgId = low(newAddress);
    const existing = await context.ContractToPoolMapping.get(cfgId);
    if (!existing) {
      context.ContractToPoolMapping.set({ id: cfgId, pool_id: poolAddress });
    }
  }
}

// ---- contractRegister: instantiate Pool / PoolConfigurator templates ----
indexer.contractRegister(
  { contract: "PoolAddressesProvider", event: "ProxyCreated" },
  async ({ event, context }) => {
    const contractId = decodeBytes32(event.params.id);
    if (contractId === "POOL_CONFIGURATOR") {
      context.chain.PoolConfigurator.add(event.params.proxyAddress);
    } else if (contractId === "POOL") {
      context.chain.Pool.add(event.params.proxyAddress);
    }
  },
);

indexer.onEvent(
  { contract: "PoolAddressesProvider", event: "ProxyCreated" },
  async ({ event, context }) => {
    const contractId = decodeBytes32(event.params.id);
    let component: PoolComponent | undefined;
    if (contractId === "POOL_CONFIGURATOR") component = "poolConfigurator";
    else if (contractId === "POOL") component = "pool";
    if (component === undefined) return;
    await genericAddressProviderUpdate(context, component, event.params.proxyAddress, event);
  },
);

indexer.onEvent(
  { contract: "PoolAddressesProvider", event: "PriceOracleUpdated" },
  async ({ event, context }) => {
    await genericAddressProviderUpdate(
      context,
      "proxyPriceProvider",
      event.params.newAddress,
      event,
      false,
    );
    const priceOracle = await getOrInitPriceOracle(context);
    context.PriceOracle.set({ ...priceOracle, proxyPriceProvider: low(event.params.newAddress) });
  },
);

indexer.onEvent(
  { contract: "PoolAddressesProvider", event: "PoolUpdated" },
  async ({ event, context }) => {
    await genericAddressProviderUpdate(context, "poolImpl", event.params.newAddress, event, false);
  },
);

indexer.onEvent(
  { contract: "PoolAddressesProvider", event: "PoolConfiguratorUpdated" },
  async ({ event, context }) => {
    await genericAddressProviderUpdate(
      context,
      "poolConfiguratorImpl",
      event.params.newAddress,
      event,
      false,
    );
  },
);

indexer.onEvent(
  { contract: "PoolAddressesProvider", event: "PoolDataProviderUpdated" },
  async ({ event, context }) => {
    await genericAddressProviderUpdate(
      context,
      "poolDataProviderImpl",
      event.params.newAddress,
      event,
      false,
    );
  },
);
