/**
 * Ported from src/LegacyOracle.ts. V1 oracle report path (the one exercised in
 * the validation range) is reproduced fully: it derives rewards from the
 * previous OracleCompleted, looks up the MEV fee buffered from the same-tx
 * Lido EL/MEV reward events, computes shares-to-mint, fee distribution, the
 * node-operator share split via getRewardsDistribution (eth_call -> Effect),
 * and the v1 APR. The V2+ branch is delegated to ETHDistributed (a no-op in V1).
 */
import { indexer } from "envio";
import type { OracleConfig } from "envio";
import {
  CALCULATION_UNIT,
  DEPOSIT_AMOUNT,
  ONE,
  ZERO,
  ZERO_ADDRESS,
  getAddress,
  low,
} from "../constants";
import {
  calcAPR_v1,
  isLidoV2,
  loadStats,
  loadTotals,
  newTotalReward,
  type HandlerContext,
} from "../helpers";
import { getRewardsDistribution } from "../effects";

const ORACLE_CONFIG_ID = "";

export async function loadOracleConfig(
  context: HandlerContext
): Promise<OracleConfig> {
  const existing = await context.OracleConfig.get(ORACLE_CONFIG_ID);
  if (existing) return existing;
  return {
    id: ORACLE_CONFIG_ID,
    quorum: ZERO,
    contractVersion: ZERO,
    allowedBeaconBalanceAnnualRelativeIncrease: ZERO,
    allowedBeaconBalanceRelativeDecrease: ZERO,
    epochsPerFrame: ZERO,
    slotsPerEpoch: ZERO,
    secondsPerSlot: ZERO,
    genesisTime: ZERO,
    beaconReportReceiver: ZERO_ADDRESS,
  };
}

// ---- EL/MEV reward buffers (read by handleCompleted) ----

indexer.onEvent(
  { contract: "Lido", event: "ELRewardsReceived" },
  async ({ event, context }) => {
    context.TxMevFee.set({
      id: low(event.transaction.hash),
      amount: event.params.amount,
      source: "ELRewardsReceived",
    });
  }
);

indexer.onEvent(
  { contract: "Lido", event: "MevTxFeeReceived" },
  async ({ event, context }) => {
    const id = low(event.transaction.hash);
    const existing = await context.TxMevFee.get(id);
    // ELRewardsReceived takes precedence (subgraph checks it first).
    if (existing && existing.source === "ELRewardsReceived") return;
    context.TxMevFee.set({ id, amount: event.params.amount, source: "MevTxFeeReceived" });
  }
);

// ---- Completed ----

indexer.onEvent(
  { contract: "LegacyOracle", event: "Completed" },
  async ({ event, context }) => {
    const stats = await loadStats(context);
    const previousCompleted = await context.OracleCompleted.get(
      stats.lastOracleCompletedId.toString()
    );
    const newId = stats.lastOracleCompletedId + ONE;

    const blockTime = BigInt(event.block.timestamp);
    context.OracleCompleted.set({
      id: newId.toString(),
      epochId: event.params.epochId,
      beaconBalance: event.params.beaconBalance,
      beaconValidators: event.params.beaconValidators,
      block: BigInt(event.block.number),
      blockTime,
      transactionHash: low(event.transaction.hash),
      logIndex: BigInt(event.logIndex),
    });
    context.Stats.set({ ...stats, lastOracleCompletedId: newId });

    const config = await loadOracleConfig(context);

    const beaconReportId = `${low(event.transaction.hash)}-${event.logIndex}`;
    context.BeaconReport.set({
      id: beaconReportId,
      epochId: event.params.epochId,
      beaconBalance: event.params.beaconBalance,
      beaconValidators: event.params.beaconValidators,
      caller: low(event.transaction.from ?? ZERO_ADDRESS),
    });

    context.OracleExpectedEpoch.set({
      id: beaconReportId,
      epochId: event.params.epochId + config.epochsPerFrame,
    });

    if (await isLidoV2(context, BigInt(event.block.number))) {
      // skip in favor of ETHDistributed
      return;
    }

    const oldBeaconValidators = previousCompleted
      ? previousCompleted.beaconValidators
      : ZERO;
    const oldBeaconBalance = previousCompleted
      ? previousCompleted.beaconBalance
      : ZERO;
    const newBeaconValidators = event.params.beaconValidators;
    const newBeaconBalance = event.params.beaconBalance;

    const appearedValidators = newBeaconValidators - oldBeaconValidators;
    const appearedValidatorsDeposits =
      appearedValidators > ZERO ? appearedValidators * DEPOSIT_AMOUNT : ZERO;
    const rewardBase = appearedValidatorsDeposits + oldBeaconBalance;

    // MEV fee from the same-tx Lido EL/MEV reward events (buffered).
    const mevBuf = await context.TxMevFee.get(low(event.transaction.hash));
    const mevFee = mevBuf ? mevBuf.amount : ZERO;

    const rewards = newBeaconBalance - rewardBase + mevFee;

    const totals = await loadTotals(context);
    const totalPooledEtherBefore = totals.totalPooledEther;
    const totalPooledEtherAfter = totalPooledEtherBefore + rewards;

    // (Goerli-only corrections from the source are omitted on mainnet.)

    let totalShares = totals.totalShares;
    if (newBeaconBalance <= rewardBase) {
      context.Totals.set({ ...totals, totalPooledEther: totalPooledEtherAfter });
      return;
    }

    const curFee = await context.CurrentFees.get("");
    if (!curFee) {
      // CurrentFees must exist by the first report; mirror the subgraph's
      // non-null assertion by bailing if it does not.
      context.Totals.set({ ...totals, totalPooledEther: totalPooledEtherAfter });
      return;
    }

    const shares2mint =
      (rewards * curFee.feeBasisPoints * totals.totalShares) /
      (totalPooledEtherAfter * CALCULATION_UNIT -
        curFee.feeBasisPoints * rewards);

    totalShares = totals.totalShares + shares2mint;
    context.Totals.set({
      ...totals,
      totalPooledEther: totalPooledEtherAfter,
      totalShares,
    });

    const insuranceFeeBasisPoints = curFee.insuranceFeeBasisPoints;
    const operatorsFeeBasisPoints = curFee.operatorsFeeBasisPoints;
    const treasuryFeeBasisPoints = curFee.treasuryFeeBasisPoints;

    const sharesToInsuranceFund =
      (shares2mint * insuranceFeeBasisPoints) / CALCULATION_UNIT;
    const sharesToOperators =
      (shares2mint * operatorsFeeBasisPoints) / CALCULATION_UNIT;

    // getRewardsDistribution(sharesToOperators) -> per-NO shares (eth_call)
    const distr = await getRewardsDistribution(
      context.effect,
      sharesToOperators,
      event.block.number
    );

    let sharesToOperatorsActual = ZERO;
    if (distr) {
      for (let i = 0; i < distr.recipients.length; i++) {
        const addr = distr.recipients[i]!;
        const shares = distr.shares[i]!;
        sharesToOperatorsActual = sharesToOperatorsActual + shares;
        context.NodeOperatorsShares.set({
          id: `${low(event.transaction.hash)}-${addr}`,
          totalReward_id: low(event.transaction.hash),
          address: addr,
          shares,
        });
      }
    }

    const treasuryShares =
      shares2mint - sharesToInsuranceFund - sharesToOperatorsActual;
    const sharesToTreasury =
      treasuryFeeBasisPoints === ZERO ? ZERO : treasuryShares;
    const dustSharesToTreasury =
      treasuryFeeBasisPoints === ZERO ? treasuryShares : ZERO;

    const timeElapsed = previousCompleted
      ? blockTime - previousCompleted.blockTime
      : ZERO;

    let tr = {
      ...newTotalReward(
        low(event.transaction.hash),
        BigInt(event.block.number),
        blockTime,
        BigInt(event.transaction.transactionIndex),
        BigInt(event.logIndex)
      ),
      totalSharesBefore: totals.totalShares,
      totalPooledEtherBefore,
      totalPooledEtherAfter,
      mevFee,
      totalRewardsWithFees: rewards,
      totalRewards: rewards,
      totalSharesAfter: totalShares,
      feeBasis: curFee.feeBasisPoints,
      treasuryFeeBasisPoints,
      insuranceFeeBasisPoints,
      operatorsFeeBasisPoints,
      shares2mint,
      sharesToInsuranceFund,
      sharesToOperators,
      sharesToTreasury,
      dustSharesToTreasury,
      timeElapsed,
    };

    tr = calcAPR_v1(
      tr,
      tr.totalPooledEtherBefore,
      tr.totalPooledEtherAfter,
      timeElapsed,
      tr.feeBasis
    );

    context.TotalReward.set(tr);
  }
);

// ---- PostTotalShares ----

indexer.onEvent(
  { contract: "LegacyOracle", event: "PostTotalShares" },
  async ({ event, context }) => {
    if (await isLidoV2(context, BigInt(event.block.number))) return;
    const tr = await context.TotalReward.get(low(event.transaction.hash));
    if (!tr) return;
    const updated = calcAPR_v1(
      { ...tr, timeElapsed: event.params.timeElapsed },
      event.params.preTotalPooledEther,
      event.params.postTotalPooledEther,
      event.params.timeElapsed,
      tr.feeBasis
    );
    context.TotalReward.set(updated);
  }
);

// ---- Members / config ----

indexer.onEvent(
  { contract: "LegacyOracle", event: "MemberAdded" },
  async ({ event, context }) => {
    context.OracleMember.set({
      id: low(event.params.member),
      member: low(event.params.member),
      removed: false,
      block: BigInt(event.block.number),
      blockTime: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
      logIndex: BigInt(event.logIndex),
    });
  }
);

indexer.onEvent(
  { contract: "LegacyOracle", event: "MemberRemoved" },
  async ({ event, context }) => {
    const m = await context.OracleMember.getOrThrow(low(event.params.member));
    context.OracleMember.set({ ...m, removed: true });
  }
);

indexer.onEvent(
  { contract: "LegacyOracle", event: "QuorumChanged" },
  async ({ event, context }) => {
    const c = await loadOracleConfig(context);
    context.OracleConfig.set({ ...c, quorum: event.params.quorum });
  }
);

indexer.onEvent(
  { contract: "LegacyOracle", event: "ContractVersionSet" },
  async ({ event, context }) => {
    const c = await loadOracleConfig(context);
    context.OracleConfig.set({ ...c, contractVersion: event.params.version });
  }
);

indexer.onEvent(
  { contract: "LegacyOracle", event: "BeaconReportReceiverSet" },
  async ({ event, context }) => {
    const c = await loadOracleConfig(context);
    context.OracleConfig.set({
      ...c,
      beaconReportReceiver: low(event.params.callback),
    });
  }
);

indexer.onEvent(
  { contract: "LegacyOracle", event: "BeaconSpecSet" },
  async ({ event, context }) => {
    const c = await loadOracleConfig(context);
    context.OracleConfig.set({
      ...c,
      epochsPerFrame: event.params.epochsPerFrame,
      slotsPerEpoch: event.params.slotsPerEpoch,
      secondsPerSlot: event.params.secondsPerSlot,
      genesisTime: event.params.genesisTime,
    });
  }
);

indexer.onEvent(
  { contract: "LegacyOracle", event: "AllowedBeaconBalanceRelativeDecreaseSet" },
  async ({ event, context }) => {
    const c = await loadOracleConfig(context);
    context.OracleConfig.set({
      ...c,
      allowedBeaconBalanceRelativeDecrease: event.params.value,
    });
  }
);

indexer.onEvent(
  {
    contract: "LegacyOracle",
    event: "AllowedBeaconBalanceAnnualRelativeIncreaseSet",
  },
  async ({ event, context }) => {
    const c = await loadOracleConfig(context);
    context.OracleConfig.set({
      ...c,
      allowedBeaconBalanceAnnualRelativeIncrease: event.params.value,
    });
  }
);

void getAddress;
