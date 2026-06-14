/**
 * Ported from src/mappings/rocketNodeStakingMapping.ts.
 * RPLStaked / RPLWithdrawn / RPLSlashed -> NodeRPLStakeTransaction + Node RPL state.
 *
 * eth_calls (block-pinned):
 *   rocketNetworkPrices.getRPLPrice()
 *   rocketNodeStaking.getNodeRPLStake(addr), getNodeEffectiveRPLStake(addr)
 */
import { indexer } from "envio";
import {
  a,
  ONE_ETHER_IN_WEI,
  ROCKET_NODE_STAKING_CONTRACT_ADDRESS,
  ROCKET_NETWORK_PRICES_CONTRACT_ADDRESS,
  NODERPLSTAKETRANSACTIONTYPE_STAKED,
  NODERPLSTAKETRANSACTIONTYPE_WITHDRAWAL,
  NODERPLSTAKETRANSACTIONTYPE_SLASHED,
} from "../constants";
import {
  type HandlerContext,
  type Mutable,
  extractIdForEntity,
  createNodeRPLStakeTransaction,
} from "../helpers";
import { getRPLPrice, getNodeRPLStake, getNodeEffectiveRPLStake } from "../effects";
import type { Node } from "envio";

type RplTxType = "Staked" | "Withdrawal" | "Slashed";

async function saveNodeRPLStakeTransaction(
  event: {
    params: object;
    block: { number: number; timestamp: number };
    transaction: { hash: string };
    logIndex: number;
  },
  ctx: HandlerContext,
  nodeId: string,
  transactionType: RplTxType,
  amount: bigint
): Promise<void> {
  // amount === 0 short-circuits (entityfactory/mapping guard).
  if (amount === 0n) return;

  const node = await ctx.Node.get(nodeId);
  if (!node) return;
  const mutNode: Mutable<Node> = { ...node };

  // RPL/ETH exchange rate at the time of the transaction.
  const rplETHExchangeRate = await getRPLPrice(
    ctx.effect,
    ROCKET_NETWORK_PRICES_CONTRACT_ADDRESS,
    event.block.number
  );
  const ethAmount = (amount * rplETHExchangeRate) / ONE_ETHER_IN_WEI;

  const tx = createNodeRPLStakeTransaction(
    extractIdForEntity(event),
    nodeId,
    amount,
    ethAmount,
    transactionType,
    BigInt(event.block.number),
    BigInt(event.block.timestamp)
  );

  // updateNodeRPLBalances
  mutNode.rplStaked = await getNodeRPLStake(
    ctx.effect,
    ROCKET_NODE_STAKING_CONTRACT_ADDRESS,
    nodeId,
    event.block.number
  );
  mutNode.effectiveRPLStaked = await getNodeEffectiveRPLStake(
    ctx.effect,
    ROCKET_NODE_STAKING_CONTRACT_ADDRESS,
    nodeId,
    event.block.number
  );
  if (transactionType === NODERPLSTAKETRANSACTIONTYPE_SLASHED && amount > 0n) {
    mutNode.totalRPLSlashed = mutNode.totalRPLSlashed + amount;
  }

  ctx.NodeRPLStakeTransaction.set(tx);
  ctx.Node.set(mutNode);
}

indexer.onEvent(
  { contract: "RocketNodeStaking", event: "RPLStaked" },
  async ({ event, context }) => {
    await saveNodeRPLStakeTransaction(
      event,
      context as HandlerContext,
      a(event.params.from),
      NODERPLSTAKETRANSACTIONTYPE_STAKED,
      event.params.amount
    );
  }
);

indexer.onEvent(
  { contract: "RocketNodeStaking", event: "RPLWithdrawn" },
  async ({ event, context }) => {
    await saveNodeRPLStakeTransaction(
      event,
      context as HandlerContext,
      a(event.params.to),
      NODERPLSTAKETRANSACTIONTYPE_WITHDRAWAL,
      event.params.amount
    );
  }
);

indexer.onEvent(
  { contract: "RocketNodeStaking", event: "RPLSlashed" },
  async ({ event, context }) => {
    await saveNodeRPLStakeTransaction(
      event,
      context as HandlerContext,
      a(event.params.node),
      NODERPLSTAKETRANSACTIONTYPE_SLASHED,
      event.params.amount
    );
  }
);
