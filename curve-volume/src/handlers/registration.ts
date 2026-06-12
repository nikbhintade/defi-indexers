/**
 * Dynamic contract registration — the envio equivalent of the subgraph's
 * `templates`:
 *
 * - AddressProvider events register registry/factory template instances
 *   (RegistryTemplate / StableFactoryTemplate / CryptoRegistryTemplate /
 *   CryptoFactoryTemplate / TriCryptoFactoryTemplate) and — mirroring
 *   `catchUp` — pool templates for pools already present on the registry.
 * - Registry/factory events register pool template instances
 *   (CurvePoolTemplate -> CurvePool, CurvePoolTemplateV2 -> CurvePoolV2,
 *   TriCryptoOptimizedTemplateV2 -> CurveTricryptoOptimized).
 *
 * contractRegister handlers have no entity access and no `context.effect`,
 * so the original's internal pool-count accounting is replaced by an
 * in-memory cursor per factory plus an on-chain `pool_count` read pinned to
 * the event block. Re-running from scratch (e.g. process restart) is safe:
 * address registrations are deduplicated by envio.
 *
 * The template type per pool matches the original's template creation logic:
 * - main registry pools: CurvePoolTemplateV2 for EARLY_V2_POOLS else
 *   CurvePoolTemplate (lending pools also got CurvePoolTemplate);
 * - stable factory pools: CurvePoolTemplate;
 * - crypto registry / crypto factory pools: CurvePoolTemplateV2;
 * - tricrypto factory pools: TriCryptoOptimizedTemplateV2.
 */
import { indexer, type EvmContractRegisterContext } from "envio";
import { low } from "../utils";
import { EARLY_V2_POOLS } from "../constants";
import { registryPoolCount, registryPoolList } from "../effects/contracts";

type RegisterContext = EvmContractRegisterContext;
type PoolTemplate = "CurvePool" | "CurvePoolV2" | "CurveTricryptoOptimized";

const asAddr = (a: string): `0x${string}` => a as `0x${string}`;

function addPool(context: RegisterContext, template: PoolTemplate, pool: string): void {
  context.chain[template].add(asAddr(pool));
}

function mainRegistryTemplate(pool: string): PoolTemplate {
  return EARLY_V2_POOLS.includes(pool) ? "CurvePoolV2" : "CurvePool";
}

/** in-memory guard so a registry's catch-up enumeration runs only once */
const caughtUp = new Set<string>();
/** in-memory per-factory cursor of already registered pool_list indices */
const factoryCursor = new Map<string, number>();

async function registerExistingPools(
  context: RegisterContext,
  registry: string,
  block: number,
  template: PoolTemplate | "main-registry",
  trackCursor: boolean,
): Promise<void> {
  const poolCount = await registryPoolCount(null, registry, block);
  if (poolCount === null) {
    context.log.error(`Error calling pool count on registry ${registry}`);
    return;
  }
  for (let i = 0; i < Number(poolCount); i++) {
    const pool = await registryPoolList(null, registry, BigInt(i), block);
    if (pool === null) {
      context.log.error(`Unable to get pool ${i} on registry ${registry}`);
      continue;
    }
    addPool(context, template == "main-registry" ? mainRegistryTemplate(pool) : template, pool);
  }
  if (trackCursor) {
    factoryCursor.set(registry, Number(poolCount));
  }
}

/** Mirror of addAddress / catchUp for the registration side. */
async function registerAddress(
  context: RegisterContext,
  providedId: bigint,
  addedAddress: string,
  block: number,
): Promise<void> {
  const key = providedId.toString() + "-" + addedAddress;
  if (caughtUp.has(key)) {
    return;
  }
  caughtUp.add(key);
  if (providedId == 0n) {
    context.chain.MainRegistry.add(asAddr(addedAddress));
    await registerExistingPools(context, addedAddress, block, "main-registry", false);
  } else if (providedId == 3n || providedId == 8n) {
    context.chain.StableFactory.add(asAddr(addedAddress));
    await registerExistingPools(context, addedAddress, block, "CurvePool", true);
  } else if (providedId == 5n) {
    context.chain.CryptoRegistry.add(asAddr(addedAddress));
    await registerExistingPools(context, addedAddress, block, "CurvePoolV2", false);
  } else if (providedId == 6n) {
    context.chain.CryptoFactory.add(asAddr(addedAddress));
    await registerExistingPools(context, addedAddress, block, "CurvePoolV2", true);
  } else if (providedId == 11n) {
    context.chain.TriCryptoFactory.add(asAddr(addedAddress));
    await registerExistingPools(context, addedAddress, block, "CurveTricryptoOptimized", false);
  }
}

indexer.contractRegister(
  { contract: "AddressProvider", event: "NewAddressIdentifier" },
  async ({ event, context }) => {
    await registerAddress(context, event.params.id, low(event.params.addr), event.block.number);
  },
);

indexer.contractRegister(
  { contract: "AddressProvider", event: "AddressModified" },
  async ({ event, context }) => {
    await registerAddress(context, event.params.id, low(event.params.new_address), event.block.number);
  },
);

indexer.contractRegister(
  { contract: "MainRegistry", event: "PoolAdded" },
  async ({ event, context }) => {
    const pool = low(event.params.pool);
    addPool(context, mainRegistryTemplate(pool), pool);
  },
);

indexer.contractRegister(
  { contract: "CryptoRegistry", event: "PoolAdded" },
  async ({ event, context }) => {
    addPool(context, "CurvePoolV2", low(event.params.pool));
  },
);

indexer.contractRegister(
  { contract: "TriCryptoFactory", event: "TricryptoPoolDeployed" },
  async ({ event, context }) => {
    addPool(context, "CurveTricryptoOptimized", low(event.params.pool));
  },
);

/**
 * Factory deploy events don't carry the pool address (except the second
 * PlainPoolDeployed overload). Register every not-yet-registered pool_list
 * entry up to the on-chain pool_count at the event block (end-of-block
 * state, so same-block multi-deploys are all covered).
 */
async function registerNewFactoryPools(
  context: RegisterContext,
  factory: string,
  block: number,
  template: PoolTemplate,
): Promise<void> {
  const poolCount = await registryPoolCount(null, factory, block);
  if (poolCount === null) {
    context.log.error(`Error calling pool count on factory ${factory}`);
    return;
  }
  const start = factoryCursor.get(factory) ?? 0;
  for (let i = start; i < Number(poolCount); i++) {
    const pool = await registryPoolList(null, factory, BigInt(i), block);
    if (pool === null) {
      context.log.error(`Unable to get pool ${i} on factory ${factory}`);
      continue;
    }
    addPool(context, template, pool);
  }
  factoryCursor.set(factory, Number(poolCount));
}

indexer.contractRegister(
  { contract: "StableFactory", event: "PlainPoolDeployed" },
  async ({ event, context }) => {
    await registerNewFactoryPools(context, low(event.srcAddress), event.block.number, "CurvePool");
  },
);

indexer.contractRegister(
  { contract: "StableFactory", event: "PlainPoolDeployedV2" },
  async ({ event, context }) => {
    await registerNewFactoryPools(context, low(event.srcAddress), event.block.number, "CurvePool");
  },
);

indexer.contractRegister(
  { contract: "StableFactory", event: "MetaPoolDeployed" },
  async ({ event, context }) => {
    await registerNewFactoryPools(context, low(event.srcAddress), event.block.number, "CurvePool");
  },
);

indexer.contractRegister(
  { contract: "CryptoFactory", event: "CryptoPoolDeployed" },
  async ({ event, context }) => {
    await registerNewFactoryPools(context, low(event.srcAddress), event.block.number, "CurvePoolV2");
  },
);
