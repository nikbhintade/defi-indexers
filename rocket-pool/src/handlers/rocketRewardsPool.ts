/**
 * Ported from src/mappings/rocketRewardsPoolMapping.ts.
 * RPLTokensClaimed -> RPLRewardInterval lifecycle + RPLRewardClaim + Node reward state.
 * RewardSnapshot   -> RPLRewardSubmitted (Redstone/Atlas only).
 *
 * eth_calls (block-pinned on the emitting rewards-pool contract / static addrs):
 *   rocketRewardsPool.getClaimIntervalTimeStart/getClaimIntervalRewardsTotal/
 *     getClaimIntervalTime/getClaimingContractAllowance(name)
 *   rocketNetworkPrices.getRPLPrice()
 */
import { indexer } from "envio";
import {
  a,
  ONE_ETHER_IN_WEI,
  ROCKETPOOL_RPL_REWARD_INTERVAL_ID_PREFIX,
  ROCKET_NETWORK_PRICES_CONTRACT_ADDRESS,
  ROCKET_DAO_PROTOCOL_REWARD_CLAIM_CONTRACT_ADDRESS,
  ROCKET_DAO_PROTOCOL_REWARD_CLAIM_CONTRACT_NAME,
  ROCKET_DAO_TRUSTED_NODE_REWARD_CLAIM_CONTRACT_NAME,
  ROCKET_NODE_REWARD_CLAIM_CONTRACT_NAME,
  ROCKET_DAO_TRUSTED_NODE_REWARD_CLAIM_CONTRACT_ADDRESS,
  RPLREWARDCLAIMERTYPE_PDAO,
  RPLREWARDCLAIMERTYPE_ODAO,
  RPLREWARDCLAIMERTYPE_NODE,
} from "../constants";
import {
  type HandlerContext,
  type Mutable,
  extractIdForEntity,
  getOrCreateProtocol,
  createRPLRewardInterval,
  createRPLRewardClaim,
} from "../helpers";
import {
  getClaimIntervalTimeStart,
  getClaimIntervalTime,
  getClaimIntervalRewardsTotal,
  getClaimingContractAllowance,
  getRPLPrice,
} from "../effects";
import type { RPLRewardInterval, Node, RPLRewardSubmitted } from "envio";

type ClaimerType = "PDAO" | "ODAO" | "Node";

async function getRplRewardClaimerType(
  ctx: HandlerContext,
  claimingContract: string,
  claimingAddress: string
): Promise<ClaimerType | null> {
  let claimerType: ClaimerType | null = null;
  const cc = a(claimingContract);
  if (cc === ROCKET_DAO_PROTOCOL_REWARD_CLAIM_CONTRACT_ADDRESS)
    claimerType = RPLREWARDCLAIMERTYPE_PDAO;
  if (cc === ROCKET_DAO_TRUSTED_NODE_REWARD_CLAIM_CONTRACT_ADDRESS)
    claimerType = RPLREWARDCLAIMERTYPE_ODAO;
  if (claimerType === null) {
    const associatedNode = await ctx.Node.get(a(claimingAddress));
    if (associatedNode) claimerType = RPLREWARDCLAIMERTYPE_NODE;
  }
  return claimerType;
}

async function getClaimingContractAllowanceFor(
  ctx: HandlerContext,
  claimType: ClaimerType,
  rewardsPoolAddress: string,
  block: number
): Promise<bigint> {
  if (claimType === RPLREWARDCLAIMERTYPE_PDAO)
    return getClaimingContractAllowance(
      ctx.effect,
      rewardsPoolAddress,
      ROCKET_DAO_PROTOCOL_REWARD_CLAIM_CONTRACT_NAME,
      block
    );
  if (claimType === RPLREWARDCLAIMERTYPE_ODAO)
    return getClaimingContractAllowance(
      ctx.effect,
      rewardsPoolAddress,
      ROCKET_DAO_TRUSTED_NODE_REWARD_CLAIM_CONTRACT_NAME,
      block
    );
  if (claimType === RPLREWARDCLAIMERTYPE_NODE)
    return getClaimingContractAllowance(
      ctx.effect,
      rewardsPoolAddress,
      ROCKET_NODE_REWARD_CLAIM_CONTRACT_NAME,
      block
    );
  return 0n;
}

indexer.onEvent(
  { contract: "RocketRewardsPool", event: "RPLTokensClaimed" },
  async ({ event, context }) => {
    const ctx = context as HandlerContext;
    const block = event.block.number;
    const blockTime = BigInt(event.block.timestamp);
    const rewardsPoolAddress = a(event.srcAddress);

    const protocol = { ...(await getOrCreateProtocol(ctx)) };

    // last active reward interval
    let activeInterval: Mutable<RPLRewardInterval> | undefined;
    if (protocol.lastRPLRewardInterval != null) {
      const loaded = await ctx.RPLRewardInterval.get(
        protocol.lastRPLRewardInterval
      );
      if (loaded) activeInterval = { ...loaded };
    }

    const claimerType = await getRplRewardClaimerType(
      ctx,
      event.params.claimingContract,
      event.params.claimingAddress
    );
    if (claimerType === null) return;

    const smartContractCurrentRewardIntervalStartTime =
      await getClaimIntervalTimeStart(ctx.effect, rewardsPoolAddress, block);

    let previousActiveInterval: Mutable<RPLRewardInterval> | undefined;
    let previousActiveIntervalId: string | undefined;

    if (
      activeInterval === undefined ||
      activeInterval.intervalStartTime !==
        smartContractCurrentRewardIntervalStartTime
    ) {
      if (activeInterval !== undefined) {
        activeInterval.intervalClosedTime = blockTime;
        activeInterval.isClosed = true;
        let intervalDurationActual =
          blockTime - activeInterval.intervalStartTime;
        if (intervalDurationActual < 0n) {
          intervalDurationActual = activeInterval.intervalDuration;
        }
        activeInterval.intervalDurationActual = intervalDurationActual;
        previousActiveInterval = activeInterval;
        previousActiveIntervalId = previousActiveInterval.id;
      }

      const claimableRewardsFromPrev =
        previousActiveInterval !== undefined &&
        previousActiveInterval.claimableRewards > 0n
          ? previousActiveInterval.claimableRewards -
            previousActiveInterval.totalRPLClaimed
          : 0n;

      const newInterval = createRPLRewardInterval(
        ROCKETPOOL_RPL_REWARD_INTERVAL_ID_PREFIX + extractIdForEntity(event),
        previousActiveIntervalId,
        await getClaimIntervalRewardsTotal(ctx.effect, rewardsPoolAddress, block),
        await getClaimingContractAllowanceFor(
          ctx,
          RPLREWARDCLAIMERTYPE_PDAO,
          rewardsPoolAddress,
          block
        ),
        await getClaimingContractAllowanceFor(
          ctx,
          RPLREWARDCLAIMERTYPE_ODAO,
          rewardsPoolAddress,
          block
        ),
        await getClaimingContractAllowanceFor(
          ctx,
          RPLREWARDCLAIMERTYPE_NODE,
          rewardsPoolAddress,
          block
        ),
        claimableRewardsFromPrev,
        smartContractCurrentRewardIntervalStartTime,
        await getClaimIntervalTime(ctx.effect, rewardsPoolAddress, block),
        BigInt(event.block.number),
        blockTime
      );
      activeInterval = { ...newInterval };
      protocol.lastRPLRewardInterval = activeInterval.id;

      if (previousActiveInterval !== undefined) {
        previousActiveInterval.nextIntervalId = activeInterval.id;
      }
    }
    if (activeInterval === undefined) return;

    // RPL/ETH price for the reward.
    const rplETHExchangeRate = await getRPLPrice(
      ctx.effect,
      ROCKET_NETWORK_PRICES_CONTRACT_ADDRESS,
      block
    );
    let rplRewardETHAmount = 0n;
    if (rplETHExchangeRate > 0n) {
      rplRewardETHAmount =
        (event.params.amount * rplETHExchangeRate) / ONE_ETHER_IN_WEI;
    }

    const rplRewardClaim = createRPLRewardClaim(
      extractIdForEntity(event),
      activeInterval.id,
      a(event.params.claimingAddress),
      claimerType,
      event.params.amount,
      rplRewardETHAmount,
      event.transaction.hash.toLowerCase(),
      BigInt(event.block.number),
      blockTime
    );
    if (rplRewardClaim === null) return;

    // associated node update
    let associatedNode: Mutable<Node> | undefined;
    const loadedNode = await ctx.Node.get(a(event.params.claimingAddress));
    if (
      loadedNode &&
      (claimerType === RPLREWARDCLAIMERTYPE_ODAO ||
        claimerType === RPLREWARDCLAIMERTYPE_NODE)
    ) {
      associatedNode = { ...loadedNode };
      if (claimerType === RPLREWARDCLAIMERTYPE_ODAO) {
        associatedNode.totalODAORewardsClaimed =
          associatedNode.totalODAORewardsClaimed + event.params.amount;
        associatedNode.odaoRewardClaimCount =
          associatedNode.odaoRewardClaimCount + 1n;
        associatedNode.averageODAORewardClaim =
          associatedNode.totalODAORewardsClaimed /
          associatedNode.odaoRewardClaimCount;

        activeInterval.totalODAORewardsClaimed =
          activeInterval.totalODAORewardsClaimed + event.params.amount;
        activeInterval.odaoRewardClaimCount =
          activeInterval.odaoRewardClaimCount + 1n;
      } else {
        associatedNode.totalNodeRewardsClaimed =
          associatedNode.totalNodeRewardsClaimed + event.params.amount;
        associatedNode.nodeRewardClaimCount =
          associatedNode.nodeRewardClaimCount + 1n;
        associatedNode.averageNodeRewardClaim =
          associatedNode.totalNodeRewardsClaimed /
          associatedNode.nodeRewardClaimCount;

        activeInterval.totalNodeRewardsClaimed =
          activeInterval.totalNodeRewardsClaimed + event.params.amount;
        activeInterval.nodeRewardClaimCount =
          activeInterval.nodeRewardClaimCount + 1n;
      }
    } else if (claimerType === RPLREWARDCLAIMERTYPE_PDAO) {
      activeInterval.totalPDAORewardsClaimed =
        activeInterval.totalPDAORewardsClaimed + event.params.amount;
    }

    // grand total + averages
    activeInterval.totalRPLClaimed =
      activeInterval.totalRPLClaimed + rplRewardClaim.amount;

    if (
      activeInterval.totalODAORewardsClaimed > 0n &&
      activeInterval.odaoRewardClaimCount > 0n
    ) {
      activeInterval.averageODAORewardClaim =
        activeInterval.totalODAORewardsClaimed /
        activeInterval.odaoRewardClaimCount;
    }
    if (
      activeInterval.totalNodeRewardsClaimed > 0n &&
      activeInterval.nodeRewardClaimCount > 0n
    ) {
      activeInterval.averageNodeRewardClaim =
        activeInterval.totalNodeRewardsClaimed /
        activeInterval.nodeRewardClaimCount;
    }

    const claims = activeInterval.rplRewardClaims.slice();
    claims.push(rplRewardClaim.id);
    activeInterval.rplRewardClaims = claims;

    ctx.RPLRewardClaim.set(rplRewardClaim);
    if (associatedNode) ctx.Node.set(associatedNode);
    if (previousActiveInterval)
      ctx.RPLRewardInterval.set(previousActiveInterval);
    ctx.RPLRewardInterval.set(activeInterval);
    ctx.RocketPoolProtocol.set(protocol);
  }
);

indexer.onEvent(
  { contract: "RocketRewardsPoolRedstone", event: "RewardSnapshot" },
  async ({ event, context }) => {
    const ctx = context as HandlerContext;
    const id = event.params.submission.rewardIndex.toString();
    if (await ctx.RPLRewardSubmitted.get(id)) return;

    const s = event.params.submission;
    const submitted: RPLRewardSubmitted = {
      id,
      rewardIndex: s.rewardIndex,
      executionBlock: s.executionBlock,
      consensusBlock: s.consensusBlock,
      merkleRoot: s.merkleRoot.toLowerCase(),
      merkleTreeCID: s.merkleTreeCID,
      intervalsPassed: s.intervalsPassed,
      treasuryRPL: s.treasuryRPL,
      trustedNodeRPL: s.trustedNodeRPL.slice(),
      nodeRPL: s.nodeRPL.slice(),
      nodeETH: s.nodeETH.slice(),
      userETH: s.userETH,
      block: BigInt(event.block.number),
      blockTime: BigInt(event.block.timestamp),
    };
    ctx.RPLRewardSubmitted.set(submitted);
  }
);
