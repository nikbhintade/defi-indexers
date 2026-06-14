/**
 * Ported from src/mappings/rocketDAONodeTrustedActionMapping.ts.
 * ActionJoined/Leave/Kick/ChallengeDecided -> Node ODAO state.
 */
import { indexer } from "envio";
import { a } from "../constants";
import { type HandlerContext, type Mutable } from "../helpers";
import type { Node } from "envio";

async function updateOracleNodeState(
  ctx: HandlerContext,
  nodeAddress: string,
  rplBondAmount: bigint,
  isOracleNode: boolean,
  blockTime: bigint
): Promise<void> {
  const node = await ctx.Node.get(a(nodeAddress));
  if (!node) return;
  const mutNode: Mutable<Node> = { ...node };
  mutNode.isOracleNode = isOracleNode;
  mutNode.oracleNodeRPLBond = isOracleNode ? rplBondAmount : 0n;
  mutNode.oracleNodeBlockTime = blockTime;
  ctx.Node.set(mutNode);
}

indexer.onEvent(
  { contract: "RocketDAONodeTrustedActions", event: "ActionJoined" },
  async ({ event, context }) => {
    await updateOracleNodeState(
      context as HandlerContext,
      event.params.nodeAddress,
      event.params.rplBondAmount,
      true,
      event.params.time
    );
  }
);

indexer.onEvent(
  { contract: "RocketDAONodeTrustedActions", event: "ActionLeave" },
  async ({ event, context }) => {
    await updateOracleNodeState(
      context as HandlerContext,
      event.params.nodeAddress,
      0n,
      false,
      event.params.time
    );
  }
);

indexer.onEvent(
  { contract: "RocketDAONodeTrustedActions", event: "ActionKick" },
  async ({ event, context }) => {
    await updateOracleNodeState(
      context as HandlerContext,
      event.params.nodeAddress,
      0n,
      false,
      event.params.time
    );
  }
);

indexer.onEvent(
  { contract: "RocketDAONodeTrustedActions", event: "ActionChallengeDecided" },
  async ({ event, context }) => {
    if (!event.params.success) return;
    await updateOracleNodeState(
      context as HandlerContext,
      event.params.nodeChallengedAddress,
      0n,
      false,
      event.params.time
    );
  }
);
