/**
 * EigenLayer core "on-chain slice" handlers.
 *
 * Ported from Layr-Labs/sidecar (commit 46e8cf4). Maintains the event-derivable
 * core state: operators, delegations, operator/staker shares, deposits,
 * withdrawals, AVS registrations, reward submissions, distribution roots, reward
 * claims, splits, and eigenpods. Off-chain reward-merkle / state-root / snapshot
 * computation is OUT OF SCOPE (see MIGRATION.md).
 *
 * No eth_calls are required — every field below is directly event-derived, so
 * there are no Effects.
 */
import { indexer } from "envio";
import type { Withdrawal } from "envio";
import {
  low,
  eventId,
  AVS_REGISTRATION_STATUS_REGISTERED,
} from "./helpers.js";

// ===================================================================== //
//  DelegationManager — operators
// ===================================================================== //

indexer.onEvent(
  { contract: "DelegationManager", event: "OperatorRegistered" },
  async ({ event, context }) => {
    const id = low(event.params.operator);
    const d = event.params.operatorDetails;
    const existing = await context.Operator.get(id);
    context.Operator.set({
      id,
      delegationApprover: low(d.delegationApprover),
      earningsReceiver: low(d.earningsReceiver),
      stakerOptOutWindowBlocks: d.stakerOptOutWindowBlocks,
      metadataURI: existing?.metadataURI,
      registeredAtBlock: BigInt(event.block.number),
      registeredAtTransactionHash: low(event.transaction.hash),
      lastUpdateBlockNumber: BigInt(event.block.number),
    });
  },
);

indexer.onEvent(
  { contract: "DelegationManager", event: "OperatorMetadataURIUpdated" },
  async ({ event, context }) => {
    const id = low(event.params.operator);
    const existing = await context.Operator.get(id);
    context.Operator.set({
      id,
      delegationApprover: existing?.delegationApprover,
      earningsReceiver: existing?.earningsReceiver,
      stakerOptOutWindowBlocks: existing?.stakerOptOutWindowBlocks,
      metadataURI: event.params.metadataURI,
      registeredAtBlock: existing?.registeredAtBlock ?? BigInt(event.block.number),
      registeredAtTransactionHash:
        existing?.registeredAtTransactionHash ?? low(event.transaction.hash),
      lastUpdateBlockNumber: BigInt(event.block.number),
    });
  },
);

indexer.onEvent(
  { contract: "DelegationManager", event: "OperatorDetailsModified" },
  async ({ event, context }) => {
    const id = low(event.params.operator);
    const d = event.params.newOperatorDetails;
    const existing = await context.Operator.get(id);
    context.Operator.set({
      id,
      delegationApprover: low(d.delegationApprover),
      earningsReceiver: low(d.earningsReceiver),
      stakerOptOutWindowBlocks: d.stakerOptOutWindowBlocks,
      metadataURI: existing?.metadataURI,
      registeredAtBlock: existing?.registeredAtBlock ?? BigInt(event.block.number),
      registeredAtTransactionHash:
        existing?.registeredAtTransactionHash ?? low(event.transaction.hash),
      lastUpdateBlockNumber: BigInt(event.block.number),
    });
  },
);

// Slashing-era impl: replaces OperatorDetails with a single delegationApprover.
indexer.onEvent(
  { contract: "DelegationManager", event: "DelegationApproverUpdated" },
  async ({ event, context }) => {
    const id = low(event.params.operator);
    const existing = await context.Operator.get(id);
    context.Operator.set({
      id,
      delegationApprover: low(event.params.newDelegationApprover),
      earningsReceiver: existing?.earningsReceiver,
      stakerOptOutWindowBlocks: existing?.stakerOptOutWindowBlocks,
      metadataURI: existing?.metadataURI,
      registeredAtBlock: existing?.registeredAtBlock ?? BigInt(event.block.number),
      registeredAtTransactionHash:
        existing?.registeredAtTransactionHash ?? low(event.transaction.hash),
      lastUpdateBlockNumber: BigInt(event.block.number),
    });
  },
);

// ===================================================================== //
//  DelegationManager — staker delegation
// ===================================================================== //

async function applyDelegation(
  context: any,
  event: any,
  delegated: boolean,
): Promise<void> {
  const staker = low(event.params.staker);
  const operator = low(event.params.operator);

  context.StakerDelegationChange.set({
    id: eventId(event.transaction.hash, event.logIndex),
    staker,
    operator,
    delegated,
    blockNumber: BigInt(event.block.number),
    logIndex: event.logIndex,
    transactionHash: low(event.transaction.hash),
  });

  context.Staker.set({
    id: staker,
    delegatedTo_id: delegated ? operator : undefined,
    delegated,
    lastUpdateBlockNumber: BigInt(event.block.number),
    lastUpdateTransactionHash: low(event.transaction.hash),
  });
}

indexer.onEvent(
  { contract: "DelegationManager", event: "StakerDelegated" },
  async ({ event, context }) => applyDelegation(context, event, true),
);
indexer.onEvent(
  { contract: "DelegationManager", event: "StakerUndelegated" },
  async ({ event, context }) => applyDelegation(context, event, false),
);
indexer.onEvent(
  { contract: "DelegationManager", event: "StakerForceUndelegated" },
  async ({ event, context }) => applyDelegation(context, event, false),
);

// ===================================================================== //
//  DelegationManager — operator shares
// ===================================================================== //

async function applyOperatorShareDelta(
  context: any,
  event: any,
  operator: string,
  staker: string,
  strategy: string,
  delta: bigint,
): Promise<void> {
  context.OperatorShareDelta.set({
    id: `${eventId(event.transaction.hash, event.logIndex)}-${operator}-${strategy}-${staker}`,
    operator,
    staker,
    strategy,
    shares: delta,
    blockNumber: BigInt(event.block.number),
    logIndex: event.logIndex,
    transactionHash: low(event.transaction.hash),
  });

  const sharesId = `${operator}-${strategy}`;
  const existing = await context.OperatorShares.get(sharesId);
  context.OperatorShares.set({
    id: sharesId,
    operator_id: operator,
    strategy,
    shares: (existing?.shares ?? 0n) + delta,
    lastUpdateBlockNumber: BigInt(event.block.number),
  });
}

indexer.onEvent(
  { contract: "DelegationManager", event: "OperatorSharesIncreased" },
  async ({ event, context }) => {
    await applyOperatorShareDelta(
      context,
      event,
      low(event.params.operator),
      low(event.params.staker),
      low(event.params.strategy),
      event.params.shares,
    );
  },
);

indexer.onEvent(
  { contract: "DelegationManager", event: "OperatorSharesDecreased" },
  async ({ event, context }) => {
    await applyOperatorShareDelta(
      context,
      event,
      low(event.params.operator),
      low(event.params.staker),
      low(event.params.strategy),
      -event.params.shares,
    );
  },
);

// Slashing-era: OperatorSharesSlashed(operator, strategy, totalSlashedShares).
indexer.onEvent(
  { contract: "DelegationManager", event: "OperatorSharesSlashed" },
  async ({ event, context }) => {
    await applyOperatorShareDelta(
      context,
      event,
      low(event.params.operator),
      "", // no staker on slash event
      low(event.params.strategy),
      -event.params.totalSlashedShares,
    );
  },
);

// ===================================================================== //
//  DelegationManager — withdrawals (queued -> completed by withdrawalRoot)
// ===================================================================== //

indexer.onEvent(
  { contract: "DelegationManager", event: "WithdrawalQueued" },
  async ({ event, context }) => {
    const root = low(event.params.withdrawalRoot);
    const w = event.params.withdrawal;
    const existing = await context.Withdrawal.get(root);
    context.Withdrawal.set({
      ...(existing ?? {}),
      id: root,
      withdrawalRoot: root,
      staker: low(w.staker),
      delegatedTo: low(w.delegatedTo),
      withdrawer: low(w.withdrawer),
      nonce: w.nonce,
      startBlock: w.startBlock,
      strategies: w.strategies.map((s: string) => low(s)),
      shares: w.shares.map((s: bigint) => s.toString()),
      sharesToWithdraw: existing?.sharesToWithdraw,
      isSlashing: false,
      status: existing?.status === "COMPLETED" ? "COMPLETED" : "QUEUED",
      queuedBlockNumber: BigInt(event.block.number),
      queuedTransactionHash: low(event.transaction.hash),
      queuedLogIndex: event.logIndex,
      completedBlockNumber: existing?.completedBlockNumber,
      completedTransactionHash: existing?.completedTransactionHash,
      completedLogIndex: existing?.completedLogIndex,
    });
  },
);

indexer.onEvent(
  { contract: "DelegationManager", event: "SlashingWithdrawalQueued" },
  async ({ event, context }) => {
    const root = low(event.params.withdrawalRoot);
    const w = event.params.withdrawal;
    const existing = await context.Withdrawal.get(root);
    context.Withdrawal.set({
      ...(existing ?? {}),
      id: root,
      withdrawalRoot: root,
      staker: low(w.staker),
      delegatedTo: low(w.delegatedTo),
      withdrawer: low(w.withdrawer),
      nonce: w.nonce,
      startBlock: w.startBlock,
      strategies: w.strategies.map((s: string) => low(s)),
      shares: w.scaledShares.map((s: bigint) => s.toString()),
      sharesToWithdraw: event.params.sharesToWithdraw.map((s: bigint) =>
        s.toString(),
      ),
      isSlashing: true,
      status: existing?.status === "COMPLETED" ? "COMPLETED" : "QUEUED",
      queuedBlockNumber: BigInt(event.block.number),
      queuedTransactionHash: low(event.transaction.hash),
      queuedLogIndex: event.logIndex,
      completedBlockNumber: existing?.completedBlockNumber,
      completedTransactionHash: existing?.completedTransactionHash,
      completedLogIndex: existing?.completedLogIndex,
    });
  },
);

async function completeWithdrawal(
  context: any,
  event: any,
  slashing: boolean,
): Promise<void> {
  const root = low(event.params.withdrawalRoot);
  const existing = await context.Withdrawal.get(root);
  const base: Withdrawal = existing ?? {
    id: root,
    withdrawalRoot: root,
    staker: undefined,
    delegatedTo: undefined,
    withdrawer: undefined,
    nonce: undefined,
    startBlock: undefined,
    strategies: undefined,
    shares: undefined,
    sharesToWithdraw: undefined,
    isSlashing: slashing,
    status: "COMPLETED",
    queuedBlockNumber: undefined,
    queuedTransactionHash: undefined,
    queuedLogIndex: undefined,
    completedBlockNumber: undefined,
    completedTransactionHash: undefined,
    completedLogIndex: undefined,
  };
  context.Withdrawal.set({
    ...base,
    status: "COMPLETED",
    completedBlockNumber: BigInt(event.block.number),
    completedTransactionHash: low(event.transaction.hash),
    completedLogIndex: event.logIndex,
  });
}

indexer.onEvent(
  { contract: "DelegationManager", event: "WithdrawalCompleted" },
  async ({ event, context }) => completeWithdrawal(context, event, false),
);
indexer.onEvent(
  { contract: "DelegationManager", event: "SlashingWithdrawalCompleted" },
  async ({ event, context }) => completeWithdrawal(context, event, true),
);

// ===================================================================== //
//  StrategyManager — deposits + whitelist
// ===================================================================== //

indexer.onEvent(
  { contract: "StrategyManager", event: "Deposit" },
  async ({ event, context }) => {
    const staker = low(event.params.staker);
    const strategy = low(event.params.strategy);

    context.Deposit.set({
      id: eventId(event.transaction.hash, event.logIndex),
      staker,
      token: low(event.params.token),
      strategy,
      shares: event.params.shares,
      blockNumber: BigInt(event.block.number),
      logIndex: event.logIndex,
      transactionHash: low(event.transaction.hash),
    });

    // Deposit feeds the staker_share_deltas / staker_shares cumulative state.
    context.StakerShareDelta.set({
      id: `${eventId(event.transaction.hash, event.logIndex)}-${staker}-${strategy}`,
      staker,
      strategy,
      shares: event.params.shares,
      strategyIndex: 0n,
      withdrawalRoot: undefined,
      blockNumber: BigInt(event.block.number),
      logIndex: event.logIndex,
      transactionHash: low(event.transaction.hash),
    });

    const sharesId = `${staker}-${strategy}`;
    const existing = await context.StakerShares.get(sharesId);
    context.StakerShares.set({
      id: sharesId,
      staker_id: staker,
      strategy,
      shares: (existing?.shares ?? 0n) + event.params.shares,
      lastUpdateBlockNumber: BigInt(event.block.number),
    });

    // ensure a Staker row exists
    const st = await context.Staker.get(staker);
    if (!st) {
      context.Staker.set({
        id: staker,
        delegatedTo_id: undefined,
        delegated: false,
        lastUpdateBlockNumber: BigInt(event.block.number),
        lastUpdateTransactionHash: low(event.transaction.hash),
      });
    }
  },
);

indexer.onEvent(
  { contract: "StrategyManager", event: "StrategyAddedToDepositWhitelist" },
  async ({ event, context }) => {
    const strategy = low(event.params.strategy);
    context.StrategyWhitelist.set({
      id: strategy,
      strategy,
      whitelistedAtBlock: BigInt(event.block.number),
      transactionHash: low(event.transaction.hash),
    });
  },
);

// ===================================================================== //
//  AVSDirectory — AVS metadata + operator registrations
// ===================================================================== //

indexer.onEvent(
  { contract: "AVSDirectory", event: "AVSMetadataURIUpdated" },
  async ({ event, context }) => {
    const id = low(event.params.avs);
    context.Avs.set({
      id,
      metadataURI: event.params.metadataURI,
      lastUpdateBlockNumber: BigInt(event.block.number),
    });
  },
);

indexer.onEvent(
  { contract: "AVSDirectory", event: "OperatorAVSRegistrationStatusUpdated" },
  async ({ event, context }) => {
    const operator = low(event.params.operator);
    const avs = low(event.params.avs);
    const status = Number(event.params.status);
    const registered = status === AVS_REGISTRATION_STATUS_REGISTERED;

    context.AvsOperatorStateChange.set({
      id: eventId(event.transaction.hash, event.logIndex),
      operator,
      avs,
      registered,
      status,
      blockNumber: BigInt(event.block.number),
      logIndex: event.logIndex,
      transactionHash: low(event.transaction.hash),
    });

    context.AvsOperator.set({
      id: `${operator}-${avs}`,
      operator,
      avs,
      registered,
      lastUpdateBlockNumber: BigInt(event.block.number),
      lastUpdateTransactionHash: low(event.transaction.hash),
    });

    // ensure Avs row exists
    const a = await context.Avs.get(avs);
    if (!a) {
      context.Avs.set({
        id: avs,
        metadataURI: undefined,
        lastUpdateBlockNumber: BigInt(event.block.number),
      });
    }
  },
);

// ===================================================================== //
//  RewardsCoordinator — reward submissions, roots, claims, splits
// ===================================================================== //

async function handleRewardSubmission(
  context: any,
  event: any,
  avs: string,
  rewardType: string,
  isForAll: boolean,
): Promise<void> {
  const rewardHash = low(event.params.rewardsSubmissionHash);
  const rs = event.params.rewardsSubmission;
  const token = low(rs.token);
  const start = rs.startTimestamp;
  const duration = rs.duration;
  const end = start + duration;

  rs.strategiesAndMultipliers.forEach(
    (sm: { strategy: string; multiplier: bigint }, idx: number) => {
      context.RewardSubmission.set({
        id: `${rewardHash}-${idx}`,
        avs,
        rewardHash,
        token,
        amount: rs.amount,
        strategy: low(sm.strategy),
        strategyIndex: BigInt(idx),
        multiplier: sm.multiplier,
        startTimestamp: start,
        endTimestamp: end,
        duration,
        isForAll,
        rewardType,
        blockNumber: BigInt(event.block.number),
        logIndex: event.logIndex,
        transactionHash: low(event.transaction.hash),
      });
    },
  );
}

indexer.onEvent(
  { contract: "RewardsCoordinator", event: "AVSRewardsSubmissionCreated" },
  async ({ event, context }) =>
    handleRewardSubmission(context, event, low(event.params.avs), "avs", false),
);

indexer.onEvent(
  { contract: "RewardsCoordinator", event: "RewardsSubmissionForAllCreated" },
  async ({ event, context }) =>
    handleRewardSubmission(
      context,
      event,
      low(event.params.submitter),
      "all_stakers",
      true,
    ),
);

indexer.onEvent(
  { contract: "RewardsCoordinator", event: "DistributionRootSubmitted" },
  async ({ event, context }) => {
    context.SubmittedDistributionRoot.set({
      id: event.params.rootIndex.toString(),
      root: low(event.params.root),
      rootIndex: event.params.rootIndex,
      rewardsCalculationEndTimestamp:
        event.params.rewardsCalculationEndTimestamp,
      activatedAt: event.params.activatedAt,
      createdAtBlockNumber: BigInt(event.block.number),
      blockNumber: BigInt(event.block.number),
      logIndex: event.logIndex,
      transactionHash: low(event.transaction.hash),
    });
  },
);

indexer.onEvent(
  { contract: "RewardsCoordinator", event: "RewardsClaimed" },
  async ({ event, context }) => {
    context.RewardsClaimed.set({
      id: eventId(event.transaction.hash, event.logIndex),
      root: low(event.params.root),
      earner: low(event.params.earner),
      claimer: low(event.params.claimer),
      recipient: low(event.params.recipient),
      token: low(event.params.token),
      claimedAmount: event.params.claimedAmount,
      blockNumber: BigInt(event.block.number),
      logIndex: event.logIndex,
      transactionHash: low(event.transaction.hash),
    });
  },
);

indexer.onEvent(
  { contract: "RewardsCoordinator", event: "OperatorAVSSplitBipsSet" },
  async ({ event, context }) => {
    context.OperatorAVSSplit.set({
      id: eventId(event.transaction.hash, event.logIndex),
      operator: low(event.params.operator),
      avs: low(event.params.avs),
      activatedAt: BigInt(event.params.activatedAt),
      oldOperatorAVSSplitBips: Number(event.params.oldOperatorAVSSplitBips),
      newOperatorAVSSplitBips: Number(event.params.newOperatorAVSSplitBips),
      blockNumber: BigInt(event.block.number),
      logIndex: event.logIndex,
      transactionHash: low(event.transaction.hash),
    });
  },
);

indexer.onEvent(
  { contract: "RewardsCoordinator", event: "OperatorPISplitBipsSet" },
  async ({ event, context }) => {
    context.OperatorPISplit.set({
      id: eventId(event.transaction.hash, event.logIndex),
      operator: low(event.params.operator),
      activatedAt: BigInt(event.params.activatedAt),
      oldOperatorPISplitBips: Number(event.params.oldOperatorPISplitBips),
      newOperatorPISplitBips: Number(event.params.newOperatorPISplitBips),
      blockNumber: BigInt(event.block.number),
      logIndex: event.logIndex,
      transactionHash: low(event.transaction.hash),
    });
  },
);

indexer.onEvent(
  { contract: "RewardsCoordinator", event: "DefaultOperatorSplitBipsSet" },
  async ({ event, context }) => {
    context.DefaultOperatorSplit.set({
      id: eventId(event.transaction.hash, event.logIndex),
      oldDefaultOperatorSplitBips: Number(
        event.params.oldDefaultOperatorSplitBips,
      ),
      newDefaultOperatorSplitBips: Number(
        event.params.newDefaultOperatorSplitBips,
      ),
      blockNumber: BigInt(event.block.number),
      logIndex: event.logIndex,
      transactionHash: low(event.transaction.hash),
    });
  },
);

// ===================================================================== //
//  EigenPodManager — pods + beacon-chain ETH shares
// ===================================================================== //

indexer.onEvent(
  { contract: "EigenPodManager", event: "PodDeployed" },
  async ({ event, context }) => {
    const pod = low(event.params.eigenPod);
    const existing = await context.EigenPod.get(pod);
    context.EigenPod.set({
      id: pod,
      podOwner: low(event.params.podOwner),
      deployedAtBlock: BigInt(event.block.number),
      deployedTransactionHash: low(event.transaction.hash),
      shares: existing?.shares ?? 0n,
      lastUpdateBlockNumber: BigInt(event.block.number),
    });
  },
);

indexer.onEvent(
  { contract: "EigenPodManager", event: "PodSharesUpdated" },
  async ({ event, context }) => {
    const podOwner = low(event.params.podOwner);
    const delta = event.params.sharesDelta;

    context.PodSharesUpdate.set({
      id: eventId(event.transaction.hash, event.logIndex),
      podOwner,
      sharesDelta: delta,
      blockNumber: BigInt(event.block.number),
      logIndex: event.logIndex,
      transactionHash: low(event.transaction.hash),
    });

    // Accumulate into the owner's pod (by podOwner). The manager keys pod shares
    // by owner; we look up the EigenPod registered for this owner via @index.
    const pods = await context.EigenPod.getWhere({
      podOwner: { _eq: podOwner },
    });
    if (pods.length > 0) {
      const pod = pods[0]!;
      context.EigenPod.set({
        ...pod,
        shares: pod.shares + delta,
        lastUpdateBlockNumber: BigInt(event.block.number),
      });
    }
  },
);
