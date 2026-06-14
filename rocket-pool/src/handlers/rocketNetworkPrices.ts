/**
 * Ported from src/mappings/rocketNetworkPricesMapping.ts + src/utilities/nodeutilities.ts.
 * PricesUpdated (legacy, 4 args) and PricesUpdatedAtlas (3 args) -> a new
 * NetworkNodeBalanceCheckpoint, regenerating a NodeBalanceCheckpoint per node.
 *
 * eth_calls (block-pinned):
 *   rocketNetworkFees.getNodeFee()
 *   rocketDAOProtocolSettingsMinipool V1/V2.getHalfDepositNodeAmount()
 *   rocketDAOProtocolSettingsNode.getMinimum/MaximumPerMinipoolStake()
 *   rocketNodeStaking.getNodeEffectiveRPLStake/getNodeMinimumRPLStake/getNodeMaximumRPLStake(addr)
 */
import { indexer, BigDecimal } from "envio";
import {
  a,
  ONE_ETHER_IN_WEI,
  ROCKET_NETWORK_FEES_CONTRACT_ADDRESS,
  ROCKET_NODE_STAKING_CONTRACT_ADDRESS,
  ROCKET_DAO_PROTOCOL_SETTINGS_MINIPOOL_CONTRACT_ADDRESS_V1,
  ROCKET_DAO_PROTOCOL_SETTINGS_MINIPOOL_CONTRACT_ADDRESS_V2,
  ROCKET_DAO_PROTOCOL_SETTINGS_NODE_CONTRACT_ADDRESS,
} from "../constants";
import {
  type HandlerContext,
  type Mutable,
  extractIdForEntity,
  getOrCreateProtocol,
  createNetworkNodeBalanceCheckpoint,
  createNodeBalanceCheckpoint,
  bd,
  bigDecimalToBigInt,
} from "../helpers";
import {
  getNodeFee,
  getHalfDepositNodeAmount,
  getMinimumPerMinipoolStake,
  getMaximumPerMinipoolStake,
  getNodeEffectiveRPLStake,
  getNodeMinimumRPLStake,
  getNodeMaximumRPLStake,
} from "../effects";
import type { Node, NetworkNodeBalanceCheckpoint } from "envio";

type MutCheckpoint = Mutable<NetworkNodeBalanceCheckpoint>;

// ---- nodeUtilities helpers ----

function getMinimumRPLForNewMinipool(
  nodeDepositAmount: bigint,
  minimumEthCollateralRatio: bigint,
  rplPrice: bigint
): bigint {
  if (
    nodeDepositAmount === 0n ||
    minimumEthCollateralRatio === 0n ||
    rplPrice === 0n
  )
    return 0n;
  return (nodeDepositAmount * minimumEthCollateralRatio) / rplPrice;
}

function getMaximumRPLForNewMinipool(
  nodeDepositAmount: bigint,
  maximumETHCollateralRatio: bigint,
  rplPrice: bigint
): bigint {
  if (
    nodeDepositAmount === 0n ||
    maximumETHCollateralRatio === 0n ||
    rplPrice === 0n
  )
    return 0n;
  return (nodeDepositAmount * maximumETHCollateralRatio) / rplPrice;
}

function updateNetworkNodeBalanceCheckpointForNode(
  cp: MutCheckpoint,
  node: Node
): void {
  cp.nodesRegistered = cp.nodesRegistered + 1n;
  if (node.isOracleNode)
    cp.oracleNodesRegistered = cp.oracleNodesRegistered + 1n;
  cp.rplStaked = cp.rplStaked + node.rplStaked;
  cp.effectiveRPLStaked = cp.effectiveRPLStaked + node.effectiveRPLStaked;
  cp.totalRPLSlashed = cp.totalRPLSlashed + node.totalRPLSlashed;
  cp.totalODAORewardsClaimed =
    cp.totalODAORewardsClaimed + node.totalODAORewardsClaimed;
  cp.totalNodeRewardsClaimed =
    cp.totalNodeRewardsClaimed + node.totalNodeRewardsClaimed;
  cp.queuedMinipools = cp.queuedMinipools + node.queuedMinipools;
  cp.stakingMinipools = cp.stakingMinipools + node.stakingMinipools;
  cp.stakingUnbondedMinipools =
    cp.stakingUnbondedMinipools + node.stakingUnbondedMinipools;
  cp.withdrawableMinipools =
    cp.withdrawableMinipools + node.withdrawableMinipools;
  cp.totalFinalizedMinipools =
    cp.totalFinalizedMinipools + node.totalFinalizedMinipools;
}

type MinipoolMeta = {
  totalNodesWithActiveMinipools: bigint;
  totalAverageFeeForAllActiveMinipools: BigDecimal;
  totalMinimumEffectiveRPL: bigint;
  totalMaximumEffectiveRPL: bigint;
};
type RplMeta = {
  totalNodesWithRewardClaim: bigint;
  totalNodeRewardClaimCount: bigint;
  totalNodesWithAnODAORewardClaim: bigint;
  totalODAORewardClaimCount: bigint;
};

function updateMinipoolMetadataWithNode(m: MinipoolMeta, node: Node): void {
  if (node.averageFeeForActiveMinipools > 0n) {
    m.totalAverageFeeForAllActiveMinipools =
      m.totalAverageFeeForAllActiveMinipools.plus(
        bd(node.averageFeeForActiveMinipools).div(bd(ONE_ETHER_IN_WEI))
      );
    m.totalNodesWithActiveMinipools = m.totalNodesWithActiveMinipools + 1n;
  }
  m.totalMinimumEffectiveRPL =
    m.totalMinimumEffectiveRPL + node.minimumEffectiveRPL;
  m.totalMaximumEffectiveRPL =
    m.totalMaximumEffectiveRPL + node.maximumEffectiveRPL;
}

function updateRPLMetadataWithNode(m: RplMeta, node: Node): void {
  if (node.totalODAORewardsClaimed > 0n)
    m.totalNodesWithAnODAORewardClaim = m.totalNodesWithAnODAORewardClaim + 1n;
  if (node.odaoRewardClaimCount > 0n)
    m.totalODAORewardClaimCount =
      m.totalODAORewardClaimCount + node.odaoRewardClaimCount;
  if (node.totalNodeRewardsClaimed > 0n)
    m.totalNodesWithRewardClaim = m.totalNodesWithRewardClaim + 1n;
  if (node.nodeRewardClaimCount > 0n)
    m.totalNodeRewardClaimCount =
      m.totalNodeRewardClaimCount + node.nodeRewardClaimCount;
}

function updateNetworkNodeBalanceCheckpointForMinipoolMetadata(
  cp: MutCheckpoint,
  m: MinipoolMeta
): void {
  if (
    m.totalNodesWithActiveMinipools > 0n &&
    m.totalAverageFeeForAllActiveMinipools.gt(bd(0n))
  ) {
    cp.averageFeeForActiveMinipools = bigDecimalToBigInt(
      m.totalAverageFeeForAllActiveMinipools
        .div(new BigDecimal(m.totalNodesWithActiveMinipools.toString()))
        .times(bd(ONE_ETHER_IN_WEI))
    );
  }
  cp.minimumEffectiveRPL = m.totalMinimumEffectiveRPL;
  cp.maximumEffectiveRPL = m.totalMaximumEffectiveRPL;
}

function updateNetworkNodeBalanceCheckpointForRPLMetadata(
  cp: MutCheckpoint,
  m: RplMeta
): void {
  if (m.totalNodesWithAnODAORewardClaim > 0n && cp.totalODAORewardsClaimed > 0n)
    cp.averageTotalODAORewardsClaimed =
      cp.totalODAORewardsClaimed / m.totalNodesWithAnODAORewardClaim;
  if (m.totalODAORewardClaimCount > 0n && cp.totalODAORewardsClaimed > 0n)
    cp.averageODAORewardClaim =
      cp.totalODAORewardsClaimed / m.totalODAORewardClaimCount;
  if (m.totalNodesWithRewardClaim > 0n && cp.totalNodeRewardsClaimed > 0n)
    cp.averageNodeTotalRewardsClaimed =
      cp.totalNodeRewardsClaimed / m.totalNodesWithRewardClaim;
  if (m.totalNodeRewardClaimCount > 0n && cp.totalNodeRewardsClaimed > 0n)
    cp.averageNodeRewardClaim =
      cp.totalNodeRewardsClaimed / m.totalNodeRewardClaimCount;
}

function coerceRunningTotalsBasedOnPreviousCheckpoint(
  cp: MutCheckpoint,
  prev: NetworkNodeBalanceCheckpoint | undefined
): void {
  if (!prev) return;
  if (cp.totalODAORewardsClaimed === 0n && prev.totalODAORewardsClaimed > 0n)
    cp.totalODAORewardsClaimed = prev.totalODAORewardsClaimed;
  if (cp.totalNodeRewardsClaimed === 0n && prev.totalNodeRewardsClaimed > 0n)
    cp.totalNodeRewardsClaimed = prev.totalNodeRewardsClaimed;
  if (cp.averageODAORewardClaim === 0n && prev.averageODAORewardClaim > 0n)
    cp.averageODAORewardClaim = prev.averageODAORewardClaim;
  if (
    cp.averageTotalODAORewardsClaimed === 0n &&
    prev.averageTotalODAORewardsClaimed > 0n
  )
    cp.averageTotalODAORewardsClaimed = prev.averageTotalODAORewardsClaimed;
  if (cp.averageNodeRewardClaim === 0n && prev.averageNodeRewardClaim > 0n)
    cp.averageNodeRewardClaim = prev.averageNodeRewardClaim;
  if (
    cp.averageNodeTotalRewardsClaimed === 0n &&
    prev.averageNodeTotalRewardsClaimed > 0n
  )
    cp.averageNodeTotalRewardsClaimed = prev.averageNodeTotalRewardsClaimed;
  if (cp.totalRPLSlashed === 0n && prev.totalRPLSlashed > 0n)
    cp.totalRPLSlashed = prev.totalRPLSlashed;
  if (cp.totalFinalizedMinipools === 0n && prev.totalFinalizedMinipools > 0n)
    cp.totalFinalizedMinipools = prev.totalFinalizedMinipools;
}

/** hasNetworkNodeBalanceCheckpointHasBeenIndexed — dedup by UTC calendar day. */
async function hasBeenIndexed(
  ctx: HandlerContext,
  protocol: { lastNetworkNodeBalanceCheckPoint?: string },
  blockTimestamp: number,
  eventId: string
): Promise<boolean> {
  if (await ctx.NetworkNodeBalanceCheckpoint.get(eventId)) return true;
  const lastId = protocol.lastNetworkNodeBalanceCheckPoint;
  if (lastId == null) return false;
  const last = await ctx.NetworkNodeBalanceCheckpoint.get(lastId);
  if (!last || last.blockTime === 0n) return false;
  const dNew = new Date(blockTimestamp * 1000);
  const dLast = new Date(Number(last.blockTime) * 1000);
  return (
    dNew.getUTCFullYear() === dLast.getUTCFullYear() &&
    dNew.getUTCMonth() === dLast.getUTCMonth() &&
    dNew.getUTCDate() === dLast.getUTCDate()
  );
}

async function getEffectiveMinipoolRPLBounds(
  ctx: HandlerContext,
  blockNumber: number,
  rplPrice: bigint
): Promise<{ minimum: bigint; maximum: bigint }> {
  let halfDepositAmount: bigint;
  if (blockNumber < 13555066) {
    halfDepositAmount = await getHalfDepositNodeAmount(
      ctx.effect,
      ROCKET_DAO_PROTOCOL_SETTINGS_MINIPOOL_CONTRACT_ADDRESS_V1,
      blockNumber
    );
  } else {
    halfDepositAmount = await getHalfDepositNodeAmount(
      ctx.effect,
      ROCKET_DAO_PROTOCOL_SETTINGS_MINIPOOL_CONTRACT_ADDRESS_V2,
      blockNumber
    );
  }
  const minPerStake = await getMinimumPerMinipoolStake(
    ctx.effect,
    ROCKET_DAO_PROTOCOL_SETTINGS_NODE_CONTRACT_ADDRESS,
    blockNumber
  );
  const maxPerStake = await getMaximumPerMinipoolStake(
    ctx.effect,
    ROCKET_DAO_PROTOCOL_SETTINGS_NODE_CONTRACT_ADDRESS,
    blockNumber
  );
  return {
    minimum: getMinimumRPLForNewMinipool(halfDepositAmount, minPerStake, rplPrice),
    maximum: getMaximumRPLForNewMinipool(halfDepositAmount, maxPerStake, rplPrice),
  };
}

async function setAverageRplEthRatio(
  ctx: HandlerContext,
  protocol: { networkNodeBalanceCheckpoints: readonly string[] },
  currentCheckpoint: MutCheckpoint
): Promise<void> {
  if (currentCheckpoint.rplPriceInETH === 0n) return;
  let totalRplPriceInEth = bd(0n);
  let totalCheckpointsWithAnRplPriceInETH = bd(0n);
  for (const cpId of protocol.networkNodeBalanceCheckpoints) {
    if (cpId == null) continue;
    const it = await ctx.NetworkNodeBalanceCheckpoint.get(cpId);
    if (!it || it.rplPriceInETH === 0n) continue;
    totalCheckpointsWithAnRplPriceInETH =
      totalCheckpointsWithAnRplPriceInETH.plus(bd(1n));
    totalRplPriceInEth = totalRplPriceInEth.plus(
      bd(it.rplPriceInETH).div(bd(ONE_ETHER_IN_WEI))
    );
  }
  if (
    totalRplPriceInEth.gt(bd(0n)) &&
    totalCheckpointsWithAnRplPriceInETH.gt(bd(0n))
  ) {
    currentCheckpoint.averageRplPriceInETH = bigDecimalToBigInt(
      totalRplPriceInEth
        .div(totalCheckpointsWithAnRplPriceInETH)
        .times(bd(ONE_ETHER_IN_WEI))
    );
  } else {
    currentCheckpoint.averageRplPriceInETH = currentCheckpoint.rplPriceInETH;
  }
}

async function handlePrices(
  event: {
    params: { rplPrice: bigint };
    block: { number: number; timestamp: number };
    transaction: { hash: string };
    logIndex: number;
  },
  ctx: HandlerContext
): Promise<void> {
  const protocol = { ...(await getOrCreateProtocol(ctx)) };
  const eventId = extractIdForEntity(event);

  if (await hasBeenIndexed(ctx, protocol, event.block.timestamp, eventId))
    return;

  const nodeFeeForNewMinipool = await getNodeFee(
    ctx.effect,
    ROCKET_NETWORK_FEES_CONTRACT_ADDRESS,
    event.block.number
  );
  const bounds = await getEffectiveMinipoolRPLBounds(
    ctx,
    event.block.number,
    event.params.rplPrice
  );

  const created = createNetworkNodeBalanceCheckpoint(
    eventId,
    protocol.lastNetworkNodeBalanceCheckPoint,
    bounds.minimum,
    bounds.maximum,
    event.params.rplPrice,
    nodeFeeForNewMinipool,
    BigInt(event.block.number),
    BigInt(event.block.timestamp)
  );
  if (created === null) return;
  const checkpoint: MutCheckpoint = { ...created };

  // previous checkpoint
  let previousCheckpoint:
    | Mutable<NetworkNodeBalanceCheckpoint>
    | undefined;
  if (protocol.lastNetworkNodeBalanceCheckPoint != null) {
    const loaded = await ctx.NetworkNodeBalanceCheckpoint.get(
      protocol.lastNetworkNodeBalanceCheckPoint
    );
    if (loaded) {
      previousCheckpoint = { ...loaded, nextCheckpointId: checkpoint.id };
    }
  }

  // generateNodeBalanceCheckpoints
  const minipoolMeta: MinipoolMeta = {
    totalNodesWithActiveMinipools: 0n,
    totalAverageFeeForAllActiveMinipools: bd(0n),
    totalMinimumEffectiveRPL: 0n,
    totalMaximumEffectiveRPL: 0n,
  };
  const rplMeta: RplMeta = {
    totalNodesWithRewardClaim: 0n,
    totalNodeRewardClaimCount: 0n,
    totalNodesWithAnODAORewardClaim: 0n,
    totalODAORewardClaimCount: 0n,
  };

  for (const nodeId of protocol.nodes) {
    if (nodeId == null) continue;
    const loadedNode = await ctx.Node.get(nodeId);
    if (!loadedNode) continue;
    const node: Mutable<Node> = { ...loadedNode };

    node.effectiveRPLStaked = await getNodeEffectiveRPLStake(
      ctx.effect,
      ROCKET_NODE_STAKING_CONTRACT_ADDRESS,
      node.id,
      event.block.number
    );
    node.minimumEffectiveRPL = await getNodeMinimumRPLStake(
      ctx.effect,
      ROCKET_NODE_STAKING_CONTRACT_ADDRESS,
      node.id,
      event.block.number
    );
    node.maximumEffectiveRPL = await getNodeMaximumRPLStake(
      ctx.effect,
      ROCKET_NODE_STAKING_CONTRACT_ADDRESS,
      node.id,
      event.block.number
    );

    updateNetworkNodeBalanceCheckpointForNode(checkpoint, node);
    updateMinipoolMetadataWithNode(minipoolMeta, node);
    updateRPLMetadataWithNode(rplMeta, node);

    const nodeBalanceCheckpoint = createNodeBalanceCheckpoint(
      checkpoint.id + " - " + node.id,
      checkpoint.id,
      node,
      BigInt(event.block.number),
      BigInt(event.block.timestamp)
    );
    node.lastNodeBalanceCheckpoint = nodeBalanceCheckpoint.id;

    ctx.NodeBalanceCheckpoint.set(nodeBalanceCheckpoint);
    ctx.Node.set(node);
  }

  coerceRunningTotalsBasedOnPreviousCheckpoint(checkpoint, previousCheckpoint);
  updateNetworkNodeBalanceCheckpointForMinipoolMetadata(
    checkpoint,
    minipoolMeta
  );
  updateNetworkNodeBalanceCheckpointForRPLMetadata(checkpoint, rplMeta);
  await setAverageRplEthRatio(ctx, protocol, checkpoint);

  protocol.lastNetworkNodeBalanceCheckPoint = checkpoint.id;
  const cps = protocol.networkNodeBalanceCheckpoints.slice();
  if (cps.indexOf(checkpoint.id) === -1) cps.push(checkpoint.id);
  protocol.networkNodeBalanceCheckpoints = cps;

  ctx.NetworkNodeBalanceCheckpoint.set(checkpoint);
  if (previousCheckpoint)
    ctx.NetworkNodeBalanceCheckpoint.set(previousCheckpoint);
  ctx.RocketPoolProtocol.set(protocol);
}

indexer.onEvent(
  { contract: "RocketNetworkPrices", event: "PricesUpdated" },
  async ({ event, context }) => {
    await handlePrices(event, context as HandlerContext);
  }
);

indexer.onEvent(
  { contract: "RocketNetworkPricesAtlas", event: "PricesUpdated" },
  async ({ event, context }) => {
    await handlePrices(event, context as HandlerContext);
  }
);

// referenced to satisfy "a" import lint when address-normalizing is unused here
void a;
