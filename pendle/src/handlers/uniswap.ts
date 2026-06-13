/**
 * Port of src/uniswap/factory.ts (UniswapFactory data source handler):
 * handleUniswapPoolCreated.
 */
import { indexer } from "envio";
import { createUniswapPool } from "../services/uniswap-pools";

indexer.onEvent({ contract: "UniswapFactory", event: "PoolCreated" }, async ({ event, context }) => {
  await createUniswapPool(context, event.params.pool, event.params.token0, event.params.token1);
});
