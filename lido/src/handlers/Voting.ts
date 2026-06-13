/** Ported from src/Voting.ts. */
import { indexer } from "envio";
import type { VotingConfig } from "envio";
import { ZERO, low } from "../constants";
import { loadShares, loadTotals, type HandlerContext } from "../helpers";

const CONFIG_ID = "";

async function loadVotingConfig(context: HandlerContext): Promise<VotingConfig> {
  const existing = await context.VotingConfig.get(CONFIG_ID);
  if (existing) return existing;
  return {
    id: CONFIG_ID,
    supportRequiredPct: ZERO,
    minAcceptQuorumPct: ZERO,
    voteTime: ZERO,
    objectionPhaseTime: ZERO,
  };
}

indexer.onEvent(
  { contract: "Voting", event: "StartVote" },
  async ({ event, context }) => {
    context.Voting.set({
      id: event.params.voteId.toString(),
      index: Number(event.params.voteId),
      creator: low(event.params.creator),
      metadata: event.params.metadata,
      executed: false,
      block: BigInt(event.block.number),
      blockTime: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
      logIndex: BigInt(event.logIndex),
    });
  }
);

indexer.onEvent(
  { contract: "Voting", event: "CastVote" },
  async ({ event, context }) => {
    context.Vote.set({
      id: `${low(event.transaction.hash)}-${event.logIndex}`,
      voting_id: event.params.voteId.toString(),
      voter: low(event.params.voter),
      supports: event.params.supports,
      stake: event.params.stake,
    });
  }
);

indexer.onEvent(
  { contract: "Voting", event: "CastObjection" },
  async ({ event, context }) => {
    context.VotingObjection.set({
      id: `${low(event.transaction.hash)}-${event.logIndex}`,
      voting_id: event.params.voteId.toString(),
      voter: low(event.params.voter),
      stake: event.params.stake,
    });
  }
);

indexer.onEvent(
  { contract: "Voting", event: "ExecuteVote" },
  async ({ event, context }) => {
    const v = await context.Voting.getOrThrow(event.params.voteId.toString());
    context.Voting.set({ ...v, executed: true });

    // One-off mainnet burnShares() accounting (see source comment).
    if (
      low(event.transaction.hash) ===
      "0x55eb29bda8d96a9a92295c358edbcef087d09f24bd684e6b4e88b166c99ea6a7"
    ) {
      const accToBurn = "0x3e40d73eb977dc6a537af587d48316fee66e9c8c";
      const sharesToSubtract = 32145684728326685744n;
      const shares = await loadShares(context, accToBurn);
      const newShares = shares.shares - sharesToSubtract;
      if (!(newShares >= ZERO)) throw new Error("Negative shares.hares!");
      context.Shares.set({ ...shares, shares: newShares });
      const totals = await loadTotals(context);
      const newTotalShares = totals.totalShares - sharesToSubtract;
      if (!(newTotalShares >= ZERO))
        throw new Error("Negative totals.totalShares!");
      context.Totals.set({ ...totals, totalShares: newTotalShares });
    }
  }
);

indexer.onEvent(
  { contract: "Voting", event: "ChangeSupportRequired" },
  async ({ event, context }) => {
    const c = await loadVotingConfig(context);
    context.VotingConfig.set({
      ...c,
      supportRequiredPct: event.params.supportRequiredPct,
    });
  }
);

indexer.onEvent(
  { contract: "Voting", event: "ChangeMinQuorum" },
  async ({ event, context }) => {
    const c = await loadVotingConfig(context);
    context.VotingConfig.set({
      ...c,
      minAcceptQuorumPct: event.params.minAcceptQuorumPct,
    });
  }
);

indexer.onEvent(
  { contract: "Voting", event: "ChangeVoteTime" },
  async ({ event, context }) => {
    const c = await loadVotingConfig(context);
    context.VotingConfig.set({ ...c, voteTime: event.params.voteTime });
  }
);

indexer.onEvent(
  { contract: "Voting", event: "ChangeObjectionPhaseTime" },
  async ({ event, context }) => {
    const c = await loadVotingConfig(context);
    context.VotingConfig.set({
      ...c,
      objectionPhaseTime: event.params.objectionPhaseTime,
    });
  }
);
