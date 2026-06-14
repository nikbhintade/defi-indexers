/**
 * Ported from src/mappings/rocketMinipoolDelegate.ts (subgraph template).
 * Registered dynamically per minipool via contractRegister in rocketMinipoolManager.
 * StatusUpdated -> staking / withdrawable transitions.
 * EtherDeposited -> node vs user deposit accounting.
 *
 * GUARD: contractRegister cannot read entities, so registration is unconditional
 * for every created minipool. The handlers below load the Minipool entity and
 * bail if it is absent (e.g. minipool created before the node existed) — this
 * matches the subgraph's `Minipool.load(...) === null` guards.
 */
import { indexer } from "envio";
import {
  a,
  MINIPOOLSTATUS_STAKING,
  MINIPOOLSTATUS_WITHDRAWABLE,
  ROCKET_NODE_DEPOSIT_CONTRACT_ADDRESS_V1,
  ROCKET_NODE_DEPOSIT_CONTRACT_ADDRESS_V2,
} from "../constants";
import { type HandlerContext, type Mutable } from "../helpers";
import type { Node, Minipool } from "envio";

function handleMinipoolStakingStatus(
  node: Mutable<Node>,
  minipool: Mutable<Minipool>,
  blockTimeStamp: bigint
): void {
  if (minipool.stakingBlockTime === 0n) {
    minipool.stakingBlockTime = blockTimeStamp;
    node.stakingMinipools = node.stakingMinipools + 1n;
    if (
      minipool.nodeDepositETHAmount === 0n &&
      minipool.userDepositETHAmount > 0n
    ) {
      node.stakingUnbondedMinipools = node.stakingUnbondedMinipools + 1n;
    }
  }
}

function handleMinipoolWithdrawableStatus(
  node: Mutable<Node>,
  minipool: Mutable<Minipool>,
  blockTimeStamp: bigint
): void {
  if (minipool.withdrawableBlockTime === 0n) {
    minipool.withdrawableBlockTime = blockTimeStamp;
    node.withdrawableMinipools = node.withdrawableMinipools + 1n;
    node.stakingMinipools = node.stakingMinipools - 1n;
    if (node.stakingMinipools < 0n) node.stakingMinipools = 0n;
    if (
      minipool.nodeDepositETHAmount === 0n &&
      minipool.userDepositETHAmount > 0n &&
      node.stakingUnbondedMinipools > 0n
    ) {
      node.stakingUnbondedMinipools = node.stakingUnbondedMinipools - 1n;
    }
  }
}

indexer.onEvent(
  { contract: "RocketMinipoolDelegate", event: "StatusUpdated" },
  async ({ event, context }) => {
    const ctx = context as HandlerContext;
    const minipool = await ctx.Minipool.get(a(event.srcAddress));
    if (!minipool || minipool.node_id == null) return;

    const node = await ctx.Node.get(minipool.node_id);
    if (!node) return;

    const mutMinipool: Mutable<Minipool> = { ...minipool };
    const mutNode: Mutable<Node> = { ...node };

    if (event.params.status === MINIPOOLSTATUS_STAKING)
      handleMinipoolStakingStatus(
        mutNode,
        mutMinipool,
        BigInt(event.block.timestamp)
      );
    else if (event.params.status === MINIPOOLSTATUS_WITHDRAWABLE)
      handleMinipoolWithdrawableStatus(
        mutNode,
        mutMinipool,
        BigInt(event.block.timestamp)
      );

    ctx.Minipool.set(mutMinipool);
    ctx.Node.set(mutNode);
  }
);

indexer.onEvent(
  { contract: "RocketMinipoolDelegate", event: "EtherDeposited" },
  async ({ event, context }) => {
    const ctx = context as HandlerContext;
    const minipool = await ctx.Minipool.get(a(event.srcAddress));
    if (!minipool) return;

    const mutMinipool: Mutable<Minipool> = { ...minipool };
    const from = a(event.params.from);
    if (
      ROCKET_NODE_DEPOSIT_CONTRACT_ADDRESS_V1 === from ||
      ROCKET_NODE_DEPOSIT_CONTRACT_ADDRESS_V2 === from
    ) {
      mutMinipool.nodeDepositBlockTime = BigInt(event.block.timestamp);
      mutMinipool.nodeDepositETHAmount = event.params.amount;
    } else {
      mutMinipool.userDepositBlockTime = BigInt(event.block.timestamp);
      mutMinipool.userDepositETHAmount = event.params.amount;
    }
    ctx.Minipool.set(mutMinipool);
  }
);
