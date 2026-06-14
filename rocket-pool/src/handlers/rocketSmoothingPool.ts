/**
 * Ported from src/mappings/rocketSmoothingPool.ts.
 * NodeSmoothingPoolStateChanged -> Node.smoothingPool flag.
 *
 * NOTE: the source also wires a NodeRegistered handler that delegates to the
 * node manager's handleNodeRegister, but the manifest only registers
 * NodeSmoothingPoolStateChanged for this data source (NodeRegistered is handled
 * by the node-manager data sources). We mirror the manifest, not the unused
 * mapping code.
 */
import { indexer } from "envio";
import { a } from "../constants";
import { type HandlerContext, type Mutable } from "../helpers";
import type { Node } from "envio";

indexer.onEvent(
  { contract: "RocketSmoothingPool", event: "NodeSmoothingPoolStateChanged" },
  async ({ event, context }) => {
    const ctx = context as HandlerContext;
    const node = await ctx.Node.get(a(event.params.node));
    if (!node) return;
    const mutNode: Mutable<Node> = {
      ...node,
      smoothingPool: event.params.state,
    };
    ctx.Node.set(mutNode);
  }
);
