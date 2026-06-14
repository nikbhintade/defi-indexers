/**
 * `indexer.onBlock` handlers receive only `{ number }` (block timestamp/hash
 * are not exposed to block handlers in envio 3.1.2, unlike subgraph block
 * handlers which get the full `ethereum.Block`). The M0 polling block handler
 * (`handleNewBlock`, every 300 blocks) keys its timeseries entities by
 * `block.hash` and stores `block.timestamp`, so we recover those two fields via
 * a cached `eth_getBlockByNumber` effect.
 *
 * NOTE: this effect requires RPC and is only exercised during live indexing.
 * Offline tests cover the equivalent per-event path (`handleMinterAttributes`),
 * where block.hash / block.timestamp are delivered natively on the event.
 */
import { createEffect, S } from "envio";
import { createPublicClient, http, type PublicClient } from "viem";

let client: PublicClient | undefined;
function getClient(): PublicClient {
  if (!client) {
    client = createPublicClient({
      transport: http(process.env.RPC_URL_1, { batch: true }),
    });
  }
  return client;
}

export const getBlockMeta = createEffect(
  {
    name: "getBlockMeta",
    input: { number: S.number },
    output: S.nullable(S.schema({ hash: S.string, timestamp: S.bigint })),
    rateLimit: false,
    cache: true,
  },
  async ({ input }) => {
    try {
      const block = await getClient().getBlock({
        blockNumber: BigInt(input.number),
        includeTransactions: false,
      });
      return { hash: block.hash as string, timestamp: block.timestamp };
    } catch (_e) {
      return null;
    }
  },
);
