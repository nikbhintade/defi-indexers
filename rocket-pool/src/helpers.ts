/**
 * Ported from src/entityfactory.ts, src/utilities/* and src/Models/* of the
 * Rocket Pool subgraph. Entity-creation defaults are reproduced exactly.
 * Entities are plain immutable objects in HyperIndex; factories return a fully
 * initialized object that handlers spread-update and `context.*.set(...)`.
 *
 * graph-node BigInt is arbitrary-precision integer; JS `bigint` matches it
 * (including truncating division). BigDecimal is bignumber.js (re-exported by
 * envio).
 */
import { BigDecimal, type EvmOnEventContext } from "envio";
import type {
  RocketPoolProtocol,
  Staker,
  Node,
  NetworkNodeTimezone,
  NodeRPLStakeTransaction,
  RPLRewardInterval,
  RPLRewardClaim,
  NetworkStakerBalanceCheckpoint,
  NetworkNodeBalanceCheckpoint,
  NodeBalanceCheckpoint,
  Minipool,
  RocketETHTransaction,
} from "envio";
import { ROCKETPOOL_PROTOCOL_ROOT_ID, ONE_ETHER_IN_WEI } from "./constants";

export type HandlerContext = EvmOnEventContext;
export type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const ZERO = 0n;

/** subgraph generalUtilities.extractIdForEntity: txHash.toHex()-logIndex */
export function extractIdForEntity(event: {
  transaction: { hash: string };
  logIndex: number;
}): string {
  return event.transaction.hash.toLowerCase() + "-" + event.logIndex.toString();
}

// ---- Protocol ----
export async function getOrCreateProtocol(
  context: HandlerContext
): Promise<RocketPoolProtocol> {
  const existing = await context.RocketPoolProtocol.get(
    ROCKETPOOL_PROTOCOL_ROOT_ID
  );
  if (existing) return existing;
  return {
    id: ROCKETPOOL_PROTOCOL_ROOT_ID,
    stakersWithETHRewards: [],
    activeStakers: [],
    stakers: [],
    lastNetworkStakerBalanceCheckPoint: undefined,
    nodes: [],
    nodeTimezones: [],
    lastRPLRewardInterval: undefined,
    lastNetworkNodeBalanceCheckPoint: undefined,
    networkNodeBalanceCheckpoints: [],
    stakersWithAnRETHBalance: ZERO,
  };
}

// ---- Staker ----
export function createStaker(
  id: string,
  blockNumber: bigint,
  blockTime: bigint
): Staker {
  return {
    id,
    rETHBalance: ZERO,
    avgEntry: ZERO,
    AvgEntryTime: ZERO,
    block: blockNumber,
    blockTime,
  };
}

// ---- Node timezone ----
export function createNodeTimezone(timezoneId: string): NetworkNodeTimezone {
  return {
    id: timezoneId,
    totalRegisteredNodes: ZERO,
    block: ZERO,
    blockTime: ZERO,
  };
}

// ---- Node ----
export function createNode(
  id: string,
  timezoneId: string,
  blockNumber: bigint,
  blockTime: bigint
): Node {
  return {
    id,
    timezone_id: timezoneId,
    isOracleNode: false,
    oracleNodeBlockTime: ZERO,
    oracleNodeRPLBond: ZERO,
    rplStaked: ZERO,
    effectiveRPLStaked: ZERO,
    minimumEffectiveRPL: ZERO,
    maximumEffectiveRPL: ZERO,
    totalRPLSlashed: ZERO,
    totalODAORewardsClaimed: ZERO,
    totalNodeRewardsClaimed: ZERO,
    averageODAORewardClaim: ZERO,
    averageNodeRewardClaim: ZERO,
    odaoRewardClaimCount: ZERO,
    nodeRewardClaimCount: ZERO,
    queuedMinipools: ZERO,
    stakingMinipools: ZERO,
    stakingUnbondedMinipools: ZERO,
    withdrawableMinipools: ZERO,
    totalFinalizedMinipools: ZERO,
    averageFeeForActiveMinipools: ZERO,
    lastNodeBalanceCheckpoint: undefined,
    minipoolIds: [],
    smoothingPool: false,
    block: blockNumber,
    blockTime,
  };
}

// ---- RocketETHTransaction ----
export function createRocketETHTransaction(
  id: string,
  fromId: string,
  toId: string,
  amount: bigint,
  event: {
    block: { number: number; timestamp: number };
    transaction: { hash: string };
  }
): RocketETHTransaction {
  return {
    id,
    from_id: fromId,
    amount,
    to_id: toId,
    block: BigInt(event.block.number),
    blockTime: BigInt(event.block.timestamp),
    transactionHash: event.transaction.hash.toLowerCase(),
  };
}

// ---- NetworkStakerBalanceCheckpoint ----
export function createNetworkStakerBalanceCheckpoint(
  id: string,
  previousCheckpointId: string | undefined,
  params: { stakingEth: bigint; totalEth: bigint; rethSupply: bigint },
  blockNumber: bigint,
  blockTime: bigint,
  stakerETHWaitingInDepositPool: bigint,
  stakerETHInRocketEthContract: bigint,
  rEthExchangeRate: bigint
): NetworkStakerBalanceCheckpoint {
  return {
    id,
    previousCheckpointId,
    nextCheckpointId: undefined,
    stakerETHActivelyStaking: params.stakingEth,
    stakerETHWaitingInDepositPool,
    stakerETHInRocketETHContract: stakerETHInRocketEthContract,
    stakerETHInProtocol: params.totalEth,
    totalRETHSupply: params.rethSupply,
    averageStakerETHRewards: ZERO,
    rETHExchangeRate: rEthExchangeRate,
    block: blockNumber,
    blockTime,
    stakersWithAnRETHBalance: ZERO,
  };
}

// ---- NodeRPLStakeTransaction ----
export function createNodeRPLStakeTransaction(
  id: string,
  nodeId: string,
  amount: bigint,
  ethAmount: bigint,
  type: "Staked" | "Withdrawal" | "Slashed",
  blockNumber: bigint,
  blockTime: bigint
): NodeRPLStakeTransaction {
  return {
    id,
    node_id: nodeId,
    amount,
    ethAmount,
    type,
    block: blockNumber,
    blockTime,
  };
}

// ---- RPLRewardInterval ----
export function createRPLRewardInterval(
  id: string,
  previousIntervalId: string | undefined,
  claimableRewards: bigint,
  claimablePDAORewards: bigint,
  claimableODAORewards: bigint,
  claimableNodeRewards: bigint,
  claimableRewardsFromPreviousInterval: bigint,
  intervalStartTime: bigint,
  intervalDuration: bigint,
  blockNumber: bigint,
  blockTime: bigint
): RPLRewardInterval {
  return {
    id,
    previousIntervalId,
    nextIntervalId: undefined,
    claimableRewards,
    claimablePDAORewards,
    claimableODAORewards,
    claimableNodeRewards,
    claimableRewardsFromPreviousInterval:
      claimableRewardsFromPreviousInterval < ZERO
        ? ZERO
        : claimableRewardsFromPreviousInterval,
    totalRPLClaimed: ZERO,
    totalPDAORewardsClaimed: ZERO,
    totalODAORewardsClaimed: ZERO,
    totalNodeRewardsClaimed: ZERO,
    averageODAORewardClaim: ZERO,
    averageNodeRewardClaim: ZERO,
    odaoRewardClaimCount: ZERO,
    nodeRewardClaimCount: ZERO,
    rplRewardClaims: [],
    isClosed: false,
    intervalStartTime,
    intervalClosedTime: undefined,
    intervalDuration,
    intervalDurationActual: undefined,
    block: blockNumber,
    blockTime,
  };
}

// ---- RPLRewardClaim ----
export function createRPLRewardClaim(
  id: string,
  rplRewardIntervalId: string,
  claimer: string,
  claimerType: "PDAO" | "ODAO" | "Node",
  amount: bigint,
  ethAmount: bigint,
  transactionHash: string,
  blockNumber: bigint,
  blockTime: bigint
): RPLRewardClaim | null {
  // Mirrors entityfactory guard: amount/ethAmount must be non-zero.
  if (amount === ZERO || ethAmount === ZERO) return null;
  return {
    id,
    rplRewardIntervalId,
    claimer,
    claimerType,
    amount,
    ethAmount,
    transactionHash,
    block: blockNumber,
    blockTime,
  };
}

// ---- NetworkNodeBalanceCheckpoint ----
export function createNetworkNodeBalanceCheckpoint(
  id: string,
  previousCheckpointId: string | undefined,
  minimumEffectiveRPLNewMinipool: bigint,
  maximumEffectiveRPLNewMinipool: bigint,
  newRplPriceInETH: bigint,
  newMinipoolFee: bigint,
  blockNumber: bigint,
  blockTime: bigint
): NetworkNodeBalanceCheckpoint | null {
  // entityfactory guard: rpl price must be non-zero.
  if (newRplPriceInETH === ZERO) return null;
  return {
    id,
    previousCheckpointId,
    nextCheckpointId: undefined,
    nodesRegistered: ZERO,
    oracleNodesRegistered: ZERO,
    rplStaked: ZERO,
    effectiveRPLStaked: ZERO,
    minimumEffectiveRPLNewMinipool,
    maximumEffectiveRPLNewMinipool,
    minimumEffectiveRPL: ZERO,
    maximumEffectiveRPL: ZERO,
    totalRPLSlashed: ZERO,
    totalODAORewardsClaimed: ZERO,
    totalNodeRewardsClaimed: ZERO,
    averageTotalODAORewardsClaimed: ZERO,
    averageODAORewardClaim: ZERO,
    averageNodeTotalRewardsClaimed: ZERO,
    averageNodeRewardClaim: ZERO,
    rplPriceInETH: newRplPriceInETH,
    averageRplPriceInETH: ZERO,
    queuedMinipools: ZERO,
    stakingMinipools: ZERO,
    stakingUnbondedMinipools: ZERO,
    withdrawableMinipools: ZERO,
    totalFinalizedMinipools: ZERO,
    averageFeeForActiveMinipools: ZERO,
    newMinipoolFee,
    block: blockNumber,
    blockTime,
  };
}

// ---- NodeBalanceCheckpoint ----
export function createNodeBalanceCheckpoint(
  id: string,
  networkCheckpointId: string,
  node: Node,
  blockNumber: bigint,
  blockTime: bigint
): NodeBalanceCheckpoint {
  return {
    id,
    NetworkNodeBalanceCheckpoint_id: networkCheckpointId,
    Node_id: node.id,
    isOracleNode: node.isOracleNode,
    oracleNodeRPLBond: node.oracleNodeRPLBond,
    oracleNodeBlockTime: node.oracleNodeBlockTime,
    rplStaked: node.rplStaked,
    effectiveRPLStaked: node.effectiveRPLStaked,
    minimumEffectiveRPL: node.minimumEffectiveRPL,
    maximumEffectiveRPL: node.maximumEffectiveRPL,
    totalRPLSlashed: node.totalRPLSlashed,
    totalODAORewardsClaimed: node.totalODAORewardsClaimed,
    totalNodeRewardsClaimed: node.totalNodeRewardsClaimed,
    averageODAORewardClaim: node.averageODAORewardClaim,
    averageNodeRewardClaim: node.averageNodeRewardClaim,
    odaoRewardClaimCount: node.odaoRewardClaimCount,
    nodeRewardClaimCount: node.nodeRewardClaimCount,
    queuedMinipools: node.queuedMinipools,
    stakingMinipools: node.stakingMinipools,
    stakingUnbondedMinipools: node.stakingUnbondedMinipools,
    withdrawableMinipools: node.withdrawableMinipools,
    totalFinalizedMinipools: node.totalFinalizedMinipools,
    averageFeeForActiveMinipools: node.averageFeeForActiveMinipools,
    block: blockNumber,
    blockTime,
  };
}

// ---- Minipool ----
export function createMinipool(
  id: string,
  nodeId: string,
  fee: bigint
): Minipool {
  return {
    id,
    node_id: nodeId,
    fee,
    nodeDepositETHAmount: ZERO,
    nodeDepositBlockTime: ZERO,
    userDepositETHAmount: ZERO,
    userDepositBlockTime: ZERO,
    queuedBlockTime: ZERO,
    dequeuedBlockTime: ZERO,
    destroyedBlockTime: ZERO,
    stakingBlockTime: ZERO,
    withdrawableBlockTime: ZERO,
    finalizedBlockTime: ZERO,
  };
}

// ---- BigDecimal helper for graph-node `BigInt.fromString(decimal.truncate(0).toString())` ----
export const bd = (x: bigint): BigDecimal => new BigDecimal(x.toString());
export const ONE_ETHER_BD = bd(ONE_ETHER_IN_WEI);

/** graph-node `BigInt.fromString(bigDecimal.truncate(0).toString())` */
export function bigDecimalToBigInt(d: BigDecimal): bigint {
  return BigInt(d.integerValue(BigDecimal.ROUND_DOWN).toFixed(0));
}
