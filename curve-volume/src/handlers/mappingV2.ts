/**
 * Port of src/mappingV2.ts: CryptoRegistry (CryptoRegistryTemplate),
 * CryptoFactory (CryptoFactoryTemplate) and CurvePoolV2 (CurvePoolTemplateV2).
 */
import { indexer } from "envio";
import { low } from "../utils";
import { addCryptoRegistryPool } from "../services/registries";
import { createNewFactoryPool } from "../services/pools";
import { handleExchange } from "../services/swaps";
import { ADDRESS_ZERO, BIG_INT_ZERO } from "../constants";

indexer.onEvent(
  { contract: "CryptoRegistry", event: "PoolAdded" },
  async ({ event, context }) => {
    await addCryptoRegistryPool(
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
  { contract: "CryptoFactory", event: "CryptoPoolDeployed" },
  async ({ event, context }) => {
    context.log.debug(`New V2 factory crypto pool deployed at ${event.transaction.hash}`);
    await createNewFactoryPool(
      context,
      event.block.number,
      2,
      low(event.srcAddress),
      false,
      ADDRESS_ZERO,
      low(event.params.token),
      BigInt(event.block.timestamp),
      BigInt(event.block.number),
      low(event.transaction.hash),
    );
  },
);

indexer.onEvent(
  { contract: "CurvePoolV2", event: "TokenExchange" },
  async ({ event, context }) => {
    context.log.debug(`swap for v2 pool: ${low(event.srcAddress)} at ${event.transaction.hash}`);
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
