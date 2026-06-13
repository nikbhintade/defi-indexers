/**
 * Port of src/uniswap/factory.ts: UniswapPool entity bookkeeping used by the
 * pricing layer. `getUniswapPoolAddress` marks a pool as used (a write), so it
 * takes `context`.
 */
import { type EvmOnEventContext } from "envio";
import { low } from "../utils";

type Ctx = EvmOnEventContext;

export async function createUniswapPool(
  context: Ctx,
  poolAddress: string,
  token0Address: string,
  token1Address: string,
): Promise<void> {
  const id = low(token0Address).concat("-").concat(low(token1Address));
  const existing = await context.UniswapPool.get(id);
  if (existing !== undefined) {
    return;
  }
  context.UniswapPool.set({
    id,
    poolAddress: low(poolAddress),
    token0Address: low(token0Address),
    token1Address: low(token1Address),
    hasBeenUsed: false,
  });
}

/**
 * Port of initializeUniswapPools (mainnet pools). Called once from
 * handleNewForge.
 */
export async function initializeUniswapPools(context: Ctx): Promise<void> {
  await createUniswapPool(
    context,
    "0xa80964c5bbd1a0e95777094420555fead1a26c1e",
    "0x6b175474e89094c44da98b954eedeac495271d0f",
    "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
  );
  await createUniswapPool(
    context,
    "0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640",
    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
  );
}

/**
 * Port of getUniswapPoolAddress. Returns the pool address (lowercase) for a
 * token pair (looked up in either order) and marks the pool `hasBeenUsed`.
 * Returns null when no pool entity exists.
 */
export async function getUniswapPoolAddress(
  context: Ctx,
  token0Address: string,
  token1Address: string,
): Promise<string | null> {
  let id = low(token0Address).concat("-").concat(low(token1Address));
  let poolInstance = await context.UniswapPool.get(id);
  if (poolInstance === undefined) {
    id = low(token1Address).concat("-").concat(low(token0Address));
    poolInstance = await context.UniswapPool.get(id);
  }
  if (poolInstance === undefined) {
    return null;
  }
  const poolAddress = low(poolInstance.poolAddress);
  context.UniswapPool.set({ ...poolInstance, hasBeenUsed: true });
  return poolAddress;
}
