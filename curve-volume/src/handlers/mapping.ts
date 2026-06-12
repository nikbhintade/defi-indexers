/**
 * Port of src/mapping.template.ts event handlers (mainnet):
 * AddressProvider, MainRegistry (RegistryTemplate), StableFactory
 * (StableFactoryTemplate) and CurvePool (CurvePoolTemplate).
 *
 * NOTE: the original also had a call handler (`handleAddExistingMetaPools`,
 * add_existing_metapools(address[10])) on StableFactory templates. envio has
 * no call handlers; see MIGRATION.md for the implications.
 */
import { indexer } from "envio";
import { low } from "../utils";
import { addAddress, addRegistryPool } from "../services/registries";
import { createNewFactoryPool } from "../services/pools";
import { handleExchange } from "../services/swaps";
import { ADDRESS_ZERO, BIG_INT_ZERO } from "../constants";

indexer.onEvent(
  { contract: "AddressProvider", event: "NewAddressIdentifier" },
  async ({ event, context }) => {
    await addAddress(
      context,
      event.params.id,
      low(event.params.addr),
      BigInt(event.block.number),
      BigInt(event.block.timestamp),
      low(event.transaction.hash),
    );
  },
);

indexer.onEvent(
  { contract: "AddressProvider", event: "AddressModified" },
  async ({ event, context }) => {
    await addAddress(
      context,
      event.params.id,
      low(event.params.new_address),
      BigInt(event.block.number),
      BigInt(event.block.timestamp),
      low(event.transaction.hash),
    );
  },
);

indexer.onEvent(
  { contract: "MainRegistry", event: "PoolAdded" },
  async ({ event, context }) => {
    await addRegistryPool(
      context,
      low(event.params.pool),
      low(event.srcAddress),
      BigInt(event.block.number),
      BigInt(event.block.timestamp),
      low(event.transaction.hash),
    );
  },
);

indexer.onEvent(
  { contract: "CurvePool", event: "TokenExchange" },
  async ({ event, context }) => {
    context.log.info(`Plain swap for pool: ${low(event.srcAddress)} at ${event.transaction.hash}`);
    const trade = event.params;
    await handleExchange(
      context,
      low(trade.buyer),
      trade.sold_id,
      trade.bought_id,
      trade.tokens_sold,
      trade.tokens_bought,
      BigInt(event.block.timestamp),
      BigInt(event.block.number),
      low(event.srcAddress),
      low(event.transaction.hash),
      event.transaction.gas,
      event.transaction.gasUsed ?? BIG_INT_ZERO,
      false,
    );
  },
);

indexer.onEvent(
  { contract: "CurvePool", event: "TokenExchangeUnderlying" },
  async ({ event, context }) => {
    context.log.info(`Underlying swap for pool: ${low(event.srcAddress)} at ${event.transaction.hash}`);
    const trade = event.params;
    await handleExchange(
      context,
      low(trade.buyer),
      trade.sold_id,
      trade.bought_id,
      trade.tokens_sold,
      trade.tokens_bought,
      BigInt(event.block.timestamp),
      BigInt(event.block.number),
      low(event.srcAddress),
      low(event.transaction.hash),
      event.transaction.gas,
      event.transaction.gasUsed ?? BIG_INT_ZERO,
      true,
    );
  },
);

indexer.onEvent(
  { contract: "StableFactory", event: "PlainPoolDeployed" },
  async ({ event, context }) => {
    context.log.info(`New factory plain pool deployed at ${event.transaction.hash}`);
    await createNewFactoryPool(
      context,
      event.block.number,
      1,
      low(event.srcAddress),
      false,
      ADDRESS_ZERO,
      ADDRESS_ZERO,
      BigInt(event.block.timestamp),
      BigInt(event.block.number),
      low(event.transaction.hash),
    );
  },
);

// second PlainPoolDeployed overload (with the pool address as last param);
// the original bound both signatures to the same handler and ignored the
// extra param.
indexer.onEvent(
  { contract: "StableFactory", event: "PlainPoolDeployedV2" },
  async ({ event, context }) => {
    context.log.info(`New factory plain pool deployed at ${event.transaction.hash}`);
    await createNewFactoryPool(
      context,
      event.block.number,
      1,
      low(event.srcAddress),
      false,
      ADDRESS_ZERO,
      ADDRESS_ZERO,
      BigInt(event.block.timestamp),
      BigInt(event.block.number),
      low(event.transaction.hash),
    );
  },
);

indexer.onEvent(
  { contract: "StableFactory", event: "MetaPoolDeployed" },
  async ({ event, context }) => {
    context.log.info(`New meta pool (version 1), basepool: ${low(event.params.base_pool)}, deployed at ${event.transaction.hash}`);
    await createNewFactoryPool(
      context,
      event.block.number,
      1,
      low(event.srcAddress),
      true,
      low(event.params.base_pool),
      ADDRESS_ZERO,
      BigInt(event.block.timestamp),
      BigInt(event.block.number),
      low(event.transaction.hash),
    );
  },
);
