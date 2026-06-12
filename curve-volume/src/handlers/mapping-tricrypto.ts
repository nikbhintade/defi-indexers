/**
 * Port of src/mapping-tricrypto.ts: TriCryptoFactory (TriCryptoFactoryTemplate)
 * and CurveTricryptoOptimized (TriCryptoOptimizedTemplateV2).
 */
import { indexer } from "envio";
import { low } from "../utils";
import { createNewPool } from "../services/pools";
import { handleExchange } from "../services/swaps";
import { ADDRESS_ZERO, BIG_INT_ZERO, TRICRYPTO_FACTORY } from "../constants";

indexer.onEvent(
  { contract: "TriCryptoFactory", event: "TricryptoPoolDeployed" },
  async ({ event, context }) => {
    context.log.debug(`New tricrypto factory crypto pool deployed at ${event.transaction.hash}`);
    // template creation (TriCryptoOptimizedTemplateV2) handled in registration.ts
    await createNewPool(
      context,
      low(event.params.pool),
      low(event.params.pool),
      event.params.name,
      event.params.symbol,
      TRICRYPTO_FACTORY,
      false,
      true,
      false,
      BigInt(event.block.number),
      low(event.transaction.hash),
      BigInt(event.block.timestamp),
      ADDRESS_ZERO,
    );
  },
);

indexer.onEvent(
  { contract: "CurveTricryptoOptimized", event: "TokenExchange" },
  async ({ event, context }) => {
    context.log.debug(`swap for tricrypto factory pool: ${low(event.srcAddress)} at ${event.transaction.hash}`);
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
