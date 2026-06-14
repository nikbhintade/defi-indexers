/**
 * Ported from src/mappings/rocketNodeManager.ts.
 * NodeRegistered -> Node + NetworkNodeTimezone.
 * NodeTimezoneLocationSet -> move node between timezone counters.
 *
 * Shared by node manager V1 / Redstone / V3 (same address set in config).
 * Also reused by the smoothing pool's NodeRegistered (n/a here; smoothing pool
 * only emits NodeSmoothingPoolStateChanged in this scope).
 *
 * eth_call (block-pinned): rocketNodeManager.getNodeTimezoneLocation(address)
 * on the emitting contract (event.srcAddress).
 */
import { indexer } from "envio";
import { a } from "../constants";
import {
  type HandlerContext,
  type Mutable,
  getOrCreateProtocol,
  createNodeTimezone,
  createNode,
} from "../helpers";
import { getNodeTimezoneLocation } from "../effects";
import type { NetworkNodeTimezone } from "envio";

export async function handleNodeRegister(
  event: {
    params: { node: string };
    srcAddress: string;
    block: { number: number; timestamp: number };
  },
  ctx: HandlerContext
): Promise<void> {
  const nodeId = a(event.params.node);

  // Only register if not registered yet.
  if (await ctx.Node.get(nodeId)) return;

  const blockNumber = BigInt(event.block.number);
  const blockTime = BigInt(event.block.timestamp);

  const nodeTimezoneStringId = await getNodeTimezoneLocation(
    ctx.effect,
    a(event.srcAddress),
    nodeId,
    event.block.number
  );

  let nodeTimezone: Mutable<NetworkNodeTimezone> | undefined =
    await ctx.NetworkNodeTimezone.get(nodeTimezoneStringId);
  if (!nodeTimezone) {
    nodeTimezone = createNodeTimezone(nodeTimezoneStringId);
    nodeTimezone.block = blockNumber;
    nodeTimezone.blockTime = blockTime;
  } else {
    nodeTimezone = { ...nodeTimezone };
  }
  nodeTimezone.totalRegisteredNodes = nodeTimezone.totalRegisteredNodes + 1n;

  const node = createNode(nodeId, nodeTimezone.id, blockNumber, blockTime);

  const protocol = { ...(await getOrCreateProtocol(ctx)) };
  const nodes = protocol.nodes.slice();
  if (nodes.indexOf(node.id) === -1) nodes.push(node.id);
  protocol.nodes = nodes;

  ctx.Node.set(node);
  ctx.NetworkNodeTimezone.set(nodeTimezone);
  ctx.RocketPoolProtocol.set(protocol);
}

indexer.onEvent(
  { contract: "RocketNodeManager", event: "NodeRegistered" },
  async ({ event, context }) => {
    await handleNodeRegister(event, context as HandlerContext);
  }
);

indexer.onEvent(
  { contract: "RocketNodeManager", event: "NodeTimezoneLocationSet" },
  async ({ event, context }) => {
    const ctx = context as HandlerContext;
    const nodeId = a(event.params.node);

    const node = await ctx.Node.get(nodeId);
    if (!node) return;

    const blockNumber = BigInt(event.block.number);
    const blockTime = BigInt(event.block.timestamp);

    // Decrement old timezone.
    let oldNodeTimezone: Mutable<NetworkNodeTimezone> | undefined;
    if (node.timezone_id != null) {
      const loaded = await ctx.NetworkNodeTimezone.get(node.timezone_id);
      if (loaded) {
        oldNodeTimezone = { ...loaded };
        oldNodeTimezone.totalRegisteredNodes =
          oldNodeTimezone.totalRegisteredNodes - 1n;
        if (oldNodeTimezone.totalRegisteredNodes < 0n)
          oldNodeTimezone.totalRegisteredNodes = 0n;
      }
    }

    // Increment new timezone.
    const newNodeTimezoneId = await getNodeTimezoneLocation(
      ctx.effect,
      a(event.srcAddress),
      nodeId,
      event.block.number
    );
    let newNodeTimezone: Mutable<NetworkNodeTimezone> | undefined =
      await ctx.NetworkNodeTimezone.get(newNodeTimezoneId);
    if (!newNodeTimezone) {
      newNodeTimezone = createNodeTimezone(newNodeTimezoneId);
      newNodeTimezone.block = blockNumber;
      newNodeTimezone.blockTime = blockTime;
    } else {
      newNodeTimezone = { ...newNodeTimezone };
    }
    newNodeTimezone.totalRegisteredNodes =
      newNodeTimezone.totalRegisteredNodes + 1n;

    if (oldNodeTimezone) ctx.NetworkNodeTimezone.set(oldNodeTimezone);
    if (newNodeTimezone) ctx.NetworkNodeTimezone.set(newNodeTimezone);
  }
);
