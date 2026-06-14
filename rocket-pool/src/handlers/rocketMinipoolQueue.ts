/**
 * Ported from src/mappings/rocketMinipoolQueueMapping.ts.
 * MinipoolEnqueued / MinipoolDequeued -> minipool queue timestamps + node queue counter.
 */
import { indexer } from "envio";
import { a } from "../constants";
import { type HandlerContext, type Mutable } from "../helpers";
import type { Node, Minipool } from "envio";

indexer.onEvent(
  { contract: "RocketMinipoolQueue", event: "MinipoolEnqueued" },
  async ({ event, context }) => {
    const ctx = context as HandlerContext;
    const minipool = await ctx.Minipool.get(a(event.params.minipool));
    if (!minipool || minipool.node_id == null) return;

    const node = await ctx.Node.get(minipool.node_id);
    if (!node) return;

    const mutMinipool: Mutable<Minipool> = {
      ...minipool,
      queuedBlockTime: BigInt(event.block.timestamp),
    };
    const mutNode: Mutable<Node> = {
      ...node,
      queuedMinipools: node.queuedMinipools + 1n,
    };

    ctx.Minipool.set(mutMinipool);
    ctx.Node.set(mutNode);
  }
);

indexer.onEvent(
  { contract: "RocketMinipoolQueue", event: "MinipoolDequeued" },
  async ({ event, context }) => {
    const ctx = context as HandlerContext;
    const minipool = await ctx.Minipool.get(a(event.params.minipool));
    if (!minipool || minipool.node_id == null) return;

    const node = await ctx.Node.get(minipool.node_id);
    if (!node) return;

    const mutMinipool: Mutable<Minipool> = {
      ...minipool,
      dequeuedBlockTime: BigInt(event.block.timestamp),
    };
    let queued = node.queuedMinipools - 1n;
    if (queued < 0n) queued = 0n;
    const mutNode: Mutable<Node> = { ...node, queuedMinipools: queued };

    ctx.Minipool.set(mutMinipool);
    ctx.Node.set(mutNode);
  }
);
