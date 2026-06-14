/**
 * Ported from src/mappings/rocketMinipoolManager.ts.
 * MinipoolCreated -> Minipool (+ register the rocketMinipoolDelegate template
 *   for the minipool address), node.minipoolIds, effective RPL, avg fee.
 * MinipoolDestroyed -> minipool.destroyedBlockTime + recompute node state.
 *
 * Dynamic registration: the subgraph instantiates the rocketMinipoolDelegate
 * template per minipool. We mirror with indexer.contractRegister adding the
 * minipool address to the rocketMinipoolDelegate contract.
 *
 * NOTE: handleIncrementNodeFinalisedMinipoolCount is a *call* handler in the
 * source and is explicitly disabled there ("call handlers don't work on
 * goerli"); HyperIndex has no call handlers, so it is omitted (documented in
 * MIGRATION.md). finalizedBlockTime therefore stays 0, matching the deployed
 * subgraph behavior.
 *
 * eth_calls (block-pinned):
 *   rocketNetworkFees.getNodeFee()
 *   rocketNodeStaking.getNodeEffectiveRPLStake/getNodeMinimum/MaximumRPLStake(addr)
 */
import { indexer } from "envio";
import {
  a,
  ROCKET_NETWORK_FEES_CONTRACT_ADDRESS,
  ROCKET_NODE_STAKING_CONTRACT_ADDRESS,
} from "../constants";
import {
  type HandlerContext,
  type Mutable,
  createMinipool,
} from "../helpers";
import {
  getNodeFee,
  getNodeEffectiveRPLStake,
  getNodeMinimumRPLStake,
  getNodeMaximumRPLStake,
} from "../effects";
import type { Node } from "envio";

// Register a rocketMinipoolDelegate contract instance for each created minipool.
indexer.contractRegister(
  { contract: "RocketMinipoolManager", event: "MinipoolCreated" },
  async ({ event, context }) => {
    context.chain.RocketMinipoolDelegate.add(event.params.minipool);
  }
);

async function setEffectiveRPLStaked(
  ctx: HandlerContext,
  node: Mutable<Node>,
  block: number
): Promise<void> {
  node.effectiveRPLStaked = await getNodeEffectiveRPLStake(
    ctx.effect,
    ROCKET_NODE_STAKING_CONTRACT_ADDRESS,
    node.id,
    block
  );
  node.minimumEffectiveRPL = await getNodeMinimumRPLStake(
    ctx.effect,
    ROCKET_NODE_STAKING_CONTRACT_ADDRESS,
    node.id,
    block
  );
  node.maximumEffectiveRPL = await getNodeMaximumRPLStake(
    ctx.effect,
    ROCKET_NODE_STAKING_CONTRACT_ADDRESS,
    node.id,
    block
  );
}

/** getAverageFeeForActiveMinipools: loop minipools, average fee of non-finalized/non-destroyed. */
async function getAverageFeeForActiveMinipools(
  ctx: HandlerContext,
  minipoolIds: readonly string[]
): Promise<bigint> {
  if (minipoolIds.length === 0) return 0n;
  let totalFee = 0n;
  let totalActive = 0n;
  for (const id of minipoolIds) {
    if (id == null) continue;
    const m = await ctx.Minipool.get(id);
    if (!m || m.finalizedBlockTime !== 0n || m.destroyedBlockTime !== 0n)
      continue;
    totalActive = totalActive + 1n;
    totalFee = totalFee + m.fee;
  }
  if (totalActive > 0n && totalFee > 0n) return totalFee / totalActive;
  return 0n;
}

indexer.onEvent(
  { contract: "RocketMinipoolManager", event: "MinipoolCreated" },
  async ({ event, context }) => {
    const ctx = context as HandlerContext;
    const minipoolId = a(event.params.minipool);

    if (await ctx.Minipool.get(minipoolId)) return;

    const node = await ctx.Node.get(a(event.params.node));
    if (!node) return;
    const mutNode: Mutable<Node> = { ...node };

    const fee = await getNodeFee(
      ctx.effect,
      ROCKET_NETWORK_FEES_CONTRACT_ADDRESS,
      event.block.number
    );
    const minipool = createMinipool(minipoolId, mutNode.id, fee);

    const nodeMinipools = (mutNode.minipoolIds ?? []).slice();
    if (nodeMinipools.indexOf(minipool.id) === -1)
      nodeMinipools.push(minipool.id);
    mutNode.minipoolIds = nodeMinipools;

    ctx.Minipool.set(minipool);

    await setEffectiveRPLStaked(ctx, mutNode, event.block.number);
    mutNode.averageFeeForActiveMinipools =
      await getAverageFeeForActiveMinipools(ctx, nodeMinipools);

    ctx.Node.set(mutNode);
  }
);

indexer.onEvent(
  { contract: "RocketMinipoolManager", event: "MinipoolDestroyed" },
  async ({ event, context }) => {
    const ctx = context as HandlerContext;
    const minipool = await ctx.Minipool.get(a(event.params.minipool));
    if (!minipool) return;

    const node = await ctx.Node.get(a(event.params.node));
    if (!node) return;
    const mutNode: Mutable<Node> = { ...node };
    const minipoolIds = mutNode.minipoolIds;

    ctx.Minipool.set({
      ...minipool,
      destroyedBlockTime: BigInt(event.block.timestamp),
    });

    await setEffectiveRPLStaked(ctx, mutNode, event.block.number);
    if (minipoolIds)
      mutNode.averageFeeForActiveMinipools =
        await getAverageFeeForActiveMinipools(ctx, minipoolIds);

    ctx.Node.set(mutNode);
  }
);
