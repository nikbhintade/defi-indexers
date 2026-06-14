/**
 * Port of the M0 subgraph's polling block handler:
 *
 *   blockHandlers:
 *     - handler: handleNewBlock
 *       filter: { kind: polling, every: 300 }
 *
 * The subgraph runs `handleNewBlock` every 300 blocks (aligned to the
 * MinterGateway startBlock, 19818447), reading 5 aggregate values from
 * MinterGateway and writing the *OwedM timeseries + daily snapshot.
 *
 * envio's `onBlock` handler only receives `{ number }` (block timestamp/hash
 * are not exposed), whereas the subgraph keys timeseries entities by
 * `block.hash` and stores `block.timestamp`. We recover those via the
 * `getBlockMeta` eth_getBlockByNumber effect so the live behaviour matches.
 * This path requires RPC and is therefore exercised only during live indexing;
 * offline tests cover the identical logic through the per-event path
 * (`handleMinterAttributes`), where block.hash / block.timestamp arrive on the
 * event natively.
 */
import { indexer } from "envio";
import { getBlockMeta } from "../effects/block";
import { handleNewBlock } from "../minter-attributes";

const GATEWAY = "0xf7f9638cb444d65e5a40bf5ff98ebe4ff319f04e";

// MinterGateway startBlock — polling alignment anchor in the subgraph.
const POLL_ANCHOR = 19818447;
const POLL_EVERY = 300;

indexer.onBlock(
  {
    name: "handleNewBlock",
    where: ({ chain }) =>
      chain.id === 1
        ? { block: { number: { _gte: POLL_ANCHOR, _every: POLL_EVERY } } }
        : false,
  },
  async ({ block, context }) => {
    if (context.isPreload) return;
    const meta = await context.effect(getBlockMeta, { number: block.number });
    if (meta === null) return; // RPC unavailable / reverted
    await handleNewBlock(context, context.effect, GATEWAY, {
      number: block.number,
      hash: meta.hash.toLowerCase(),
      timestamp: meta.timestamp,
    });
  },
);
