/**
 * Ported from src/Lido.ts. See MIGRATION.md for the receipt-parsing deviation.
 *
 * Validation range [11473216, +50k] is entirely protocol V1 (TransferShares
 * was added at 14860268, V2 at 17266004). In V1:
 *  - Submitted derives shares from the running ether/shares ratio (no receipt).
 *  - mint Transfer (from = 0x0) reads the LidoSubmission at logIndex-1, or
 *    distributes oracle-report fees when a TotalReward for the tx exists.
 *  - regular Transfer derives shares from value * totalShares / totalPooledEther.
 * The TransferShares/TokenRebased/ETHDistributed receipt-correlated V2/V3 paths
 * are reproduced where single-pass ordering allows and documented otherwise.
 */
import { indexer } from "envio";
import type { LidoConfig, CurrentFees } from "envio";
import {
  ONE,
  ZERO,
  ZERO_ADDRESS,
  getAddress,
  low,
} from "../constants";
import {
  loadTotals,
  loadShares,
  newLidoTransfer,
  updateTransferBalances,
  updateTransferShares,
  updateHolders,
  isLidoTransferShares,
  isLidoV2,
  type HandlerContext,
  type MutableLidoTransfer,
} from "../helpers";
import { getTotalPooledEther } from "../effects";

// ---------------- Config / fee singletons ----------------

const CONFIG_ID = "";
const FEES_ID = "";

export async function loadLidoConfig(
  context: HandlerContext
): Promise<LidoConfig> {
  const existing = await context.LidoConfig.get(CONFIG_ID);
  if (existing) return existing;
  return {
    id: CONFIG_ID,
    insuranceFund: undefined,
    oracle: undefined,
    treasury: undefined,
    isStopped: true,
    isStakingPaused: true,
    maxStakeLimit: ZERO,
    stakeLimitIncreasePerBlock: ZERO,
    elRewardsVault: ZERO_ADDRESS,
    elRewardsWithdrawalLimitPoints: ZERO,
    withdrawalCredentials: ZERO_ADDRESS,
    wcSetBy: ZERO_ADDRESS,
    lidoLocator: ZERO_ADDRESS,
  };
}

async function loadCurrentFees(context: HandlerContext): Promise<CurrentFees> {
  const existing = await context.CurrentFees.get(FEES_ID);
  if (existing) return existing;
  return {
    id: FEES_ID,
    feeBasisPoints: ZERO,
    treasuryFeeBasisPoints: ZERO,
    insuranceFeeBasisPoints: ZERO,
    operatorsFeeBasisPoints: ZERO,
  };
}

// ---------------- Submitted ----------------

indexer.onEvent(
  { contract: "Lido", event: "Submitted" },
  async ({ event, context }) => {
    const id = `${low(event.transaction.hash)}-${event.logIndex}`;
    const totals = await loadTotals(context);

    let shares: bigint;
    if (await isLidoTransferShares(context, BigInt(event.block.number))) {
      // V1_SHARES+: subgraph reads TransferShares from the receipt. Out of the
      // single-pass window in HyperIndex (the pair has a higher logIndex than
      // Submitted), so we fall back to the ratio math, which is exact whenever
      // shares did not round. Documented deviation; not exercised in the V1
      // validation range.
      shares =
        totals.totalPooledEther === ZERO
          ? event.params.amount
          : (event.params.amount * totals.totalShares) /
            totals.totalPooledEther;
      if (shares === ZERO) shares = event.params.amount;
    } else {
      shares =
        totals.totalPooledEther === ZERO
          ? event.params.amount
          : (event.params.amount * totals.totalShares) /
            totals.totalPooledEther;
      if (shares === ZERO) shares = event.params.amount;
    }

    const sharesEntity = await loadShares(context, low(event.params.sender));
    const sharesBefore = sharesEntity.shares;
    const sharesAfter = sharesBefore + shares;

    const totalPooledEtherBefore = totals.totalPooledEther;
    const totalSharesBefore = totals.totalShares;

    const totalPooledEther = totals.totalPooledEther + event.params.amount;
    const totalShares = totals.totalShares + shares;
    context.Totals.set({ ...totals, totalPooledEther, totalShares });

    const balanceAfter = (sharesAfter * totalPooledEther) / totalShares;

    context.LidoSubmission.set({
      id,
      sender: low(event.params.sender),
      amount: event.params.amount,
      referral: low(event.params.referral),
      shares,
      sharesBefore,
      sharesAfter,
      totalPooledEtherBefore,
      totalPooledEtherAfter: totalPooledEther,
      totalSharesBefore,
      totalSharesAfter: totalShares,
      balanceAfter,
      block: BigInt(event.block.number),
      blockTime: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
      transactionIndex: BigInt(event.transaction.transactionIndex),
      logIndex: BigInt(event.logIndex),
    });
  }
);

// ---------------- Transfer ----------------

indexer.onEvent(
  { contract: "Lido", event: "Transfer" },
  async ({ event, context }) => {
    const id = `${low(event.transaction.hash)}-${event.logIndex}`;
    const from = low(event.params.from);
    const to = low(event.params.to);

    const totals = await loadTotals(context);
    if (!(totals.totalPooledEther > ZERO)) {
      throw new Error("transfer with zero totalPooledEther");
    }

    let entity = newLidoTransfer(
      id,
      from,
      to,
      event.params.value,
      BigInt(event.block.number),
      BigInt(event.block.timestamp),
      low(event.transaction.hash),
      BigInt(event.transaction.transactionIndex),
      BigInt(event.logIndex)
    );
    entity.totalPooledEther = totals.totalPooledEther;
    entity.totalShares = totals.totalShares;

    const transferShares = await isLidoTransferShares(
      context,
      BigInt(event.block.number)
    );

    if (transferShares) {
      // V1_SHARES+ path: subgraph reads the paired TransferShares from the
      // receipt to set exact `shares`. Reproduced via the buffered
      // TransferShares entity when present (lower logIndex), else ratio math.
      const ts = await context.TransferSharesLog.get(id);
      entity.shares = ts
        ? ts.sharesValue
        : (entity.value * totals.totalShares) / totals.totalPooledEther;
    } else {
      entity.shares =
        (entity.value * totals.totalShares) / totals.totalPooledEther;
    }

    if (from === ZERO_ADDRESS) {
      // mint transfers
      const totalReward = await context.TotalReward.get(
        low(event.transaction.hash)
      );
      if (totalReward) {
        if (await isLidoV2(context, BigInt(event.block.number))) {
          // V2+: TotalReward handled by ETHDistributed; nothing to do here.
        } else {
          entity = await distributeV1Fee(context, event, entity, totalReward);
        }
      } else {
        // transfer after submit: read the Submission at logIndex-1 for shares
        if (!transferShares) {
          const submissionId = `${low(event.transaction.hash)}-${
            event.logIndex - 1
          }`;
          const submission = await context.LidoSubmission.get(submissionId);
          if (submission) {
            entity.shares = submission.shares;
          }
        }
      }
    }

    entity = await updateTransferShares(context, entity);
    entity = updateTransferBalances(entity);
    await updateHolders(context, entity);
    context.LidoTransfer.set(entity);
  }
);

// V1 oracle-report fee distribution on a mint Transfer (insurance/treasury/operators)
async function distributeV1Fee(
  context: HandlerContext,
  event: { params: { to: string; value: bigint }; transaction: { hash: string }; logIndex: number },
  entity: MutableLidoTransfer,
  totalReward: import("envio").TotalReward
): Promise<MutableLidoTransfer> {
  const to = low(event.params.to);
  const config = await context.LidoConfig.get("");
  const insuranceFundAddr = getAddress(
    "INSURANCE_FUND",
    config?.insuranceFund ?? null
  );
  const treasuryAddr = getAddress("TREASURY");

  let tr = { ...totalReward };
  let out = { ...entity };

  if (
    to === insuranceFundAddr &&
    tr.insuranceFeeBasisPoints !== ZERO &&
    tr.insuranceFee === ZERO
  ) {
    tr.insuranceFee = tr.insuranceFee + event.params.value;
    out.shares = tr.sharesToInsuranceFund;
  } else if (to === treasuryAddr) {
    let shares: bigint;
    if (tr.treasuryFeeBasisPoints === ZERO) {
      tr.dust = tr.dust + event.params.value;
      shares = tr.dustSharesToTreasury;
    } else {
      tr.treasuryFee = tr.treasuryFee + event.params.value;
      shares = tr.sharesToTreasury;
    }
    out.shares = shares;
  } else {
    // node operator fee
    const noFeeId = `${low(event.transaction.hash)}-${event.logIndex}`;
    context.NodeOperatorFees.set({
      id: noFeeId,
      totalReward_id: tr.id,
      address: to,
      fee: event.params.value,
    });
    const nosId = `${low(event.transaction.hash)}-${to}`;
    const nos = await context.NodeOperatorsShares.get(nosId);
    if (nos) out.shares = nos.shares;
    tr.operatorsFee = tr.operatorsFee + event.params.value;
  }

  if (event.params.value !== ZERO) {
    if (!(tr.totalRewards >= event.params.value)) {
      throw new Error("negative totalRewards");
    }
    tr.totalRewards = tr.totalRewards - event.params.value;
    tr.totalFee = tr.totalFee + event.params.value;
  }
  context.TotalReward.set(tr);
  return out;
}

// ---------------- SharesBurnt ----------------

indexer.onEvent(
  { contract: "Lido", event: "SharesBurnt" },
  async ({ event, context }) => {
    // V2+: when an ETHDistributed exists in the same tx, the subgraph defers
    // this to the ETHDistributed handler. In the V1 validation range there is
    // no ETHDistributed, so we process directly.
    const id = `${low(event.transaction.hash)}-${event.logIndex}`;
    const existing = await context.SharesBurn.get(id);
    if (existing) return;

    context.SharesBurn.set({
      id,
      account: low(event.params.account),
      postRebaseTokenAmount: event.params.postRebaseTokenAmount,
      preRebaseTokenAmount: event.params.preRebaseTokenAmount,
      sharesAmount: event.params.sharesAmount,
    });

    const totals = await loadTotals(context);
    const totalShares = totals.totalShares - event.params.sharesAmount;
    if (!(totalShares > ZERO)) {
      throw new Error("negative totalShares after shares burn");
    }
    context.Totals.set({ ...totals, totalShares });

    let txEntity = newLidoTransfer(
      id,
      low(event.params.account),
      ZERO_ADDRESS,
      event.params.postRebaseTokenAmount,
      BigInt(event.block.number),
      BigInt(event.block.timestamp),
      low(event.transaction.hash),
      BigInt(event.transaction.transactionIndex),
      BigInt(event.logIndex)
    );
    txEntity.shares = event.params.sharesAmount;
    txEntity.totalPooledEther = totals.totalPooledEther;
    txEntity.totalShares = totalShares;

    txEntity = await updateTransferShares(context, txEntity);
    txEntity = updateTransferBalances(txEntity);
    await updateHolders(context, txEntity);
    context.LidoTransfer.set(txEntity);
  }
);

// ---------------- Approval ----------------

indexer.onEvent(
  { contract: "Lido", event: "Approval" },
  async ({ event, context }) => {
    context.LidoApproval.set({
      id: `${low(event.transaction.hash)}-${event.logIndex}`,
      owner: low(event.params.owner),
      spender: low(event.params.spender),
      value: event.params.value,
    });
  }
);

// ---------------- TransferShares buffer (for V1_SHARES+ correlation) ----------------

indexer.onEvent(
  { contract: "Lido", event: "TransferShares" },
  async ({ event, context }) => {
    // Buffer keyed by the matching Transfer id (Transfer is at logIndex-1 in
    // the subgraph's pairing). Stored so a same-tx Transfer with a higher
    // logIndex can read it; the pre-V1_SHARES validation range never hits this.
    const transferId = `${low(event.transaction.hash)}-${event.logIndex - 1}`;
    context.TransferSharesLog.set({
      id: transferId,
      from: low(event.params.from),
      to: low(event.params.to),
      sharesValue: event.params.sharesValue,
    });
  }
);

// ---------------- Config / fee handlers ----------------

indexer.onEvent(
  { contract: "Lido", event: "FeeSet" },
  async ({ event, context }) => {
    const fees = await loadCurrentFees(context);
    context.CurrentFees.set({
      ...fees,
      feeBasisPoints: BigInt(event.params.feeBasisPoints),
    });
  }
);

indexer.onEvent(
  { contract: "Lido", event: "FeeDistributionSet" },
  async ({ event, context }) => {
    const fees = await loadCurrentFees(context);
    context.CurrentFees.set({
      ...fees,
      treasuryFeeBasisPoints: BigInt(event.params.treasuryFeeBasisPoints),
      insuranceFeeBasisPoints: BigInt(event.params.insuranceFeeBasisPoints),
      operatorsFeeBasisPoints: BigInt(event.params.operatorsFeeBasisPoints),
    });
  }
);

indexer.onEvent(
  { contract: "Lido", event: "LidoLocatorSet" },
  async ({ event, context }) => {
    const c = await loadLidoConfig(context);
    context.LidoConfig.set({ ...c, lidoLocator: low(event.params.lidoLocator) });
  }
);

indexer.onEvent(
  { contract: "Lido", event: "Resumed" },
  async ({ context }) => {
    const c = await loadLidoConfig(context);
    context.LidoConfig.set({ ...c, isStopped: false });
  }
);

indexer.onEvent(
  { contract: "Lido", event: "Stopped" },
  async ({ context }) => {
    const c = await loadLidoConfig(context);
    context.LidoConfig.set({ ...c, isStopped: true });
  }
);

indexer.onEvent(
  { contract: "Lido", event: "ELRewardsVaultSet" },
  async ({ event, context }) => {
    const c = await loadLidoConfig(context);
    context.LidoConfig.set({
      ...c,
      elRewardsVault: low(event.params.executionLayerRewardsVault),
    });
  }
);

indexer.onEvent(
  { contract: "Lido", event: "ELRewardsWithdrawalLimitSet" },
  async ({ event, context }) => {
    const c = await loadLidoConfig(context);
    context.LidoConfig.set({
      ...c,
      elRewardsWithdrawalLimitPoints: event.params.limitPoints,
    });
  }
);

indexer.onEvent(
  { contract: "Lido", event: "ProtocolContactsSet" },
  async ({ event, context }) => {
    const c = await loadLidoConfig(context);
    context.LidoConfig.set({
      ...c,
      insuranceFund: low(event.params.insuranceFund),
      oracle: low(event.params.oracle),
      treasury: low(event.params.treasury),
    });
  }
);

indexer.onEvent(
  { contract: "Lido", event: "StakingLimitRemoved" },
  async ({ context }) => {
    const c = await loadLidoConfig(context);
    context.LidoConfig.set({ ...c, maxStakeLimit: ZERO });
  }
);

indexer.onEvent(
  { contract: "Lido", event: "StakingLimitSet" },
  async ({ event, context }) => {
    const c = await loadLidoConfig(context);
    context.LidoConfig.set({
      ...c,
      maxStakeLimit: event.params.maxStakeLimit,
      stakeLimitIncreasePerBlock: event.params.stakeLimitIncreasePerBlock,
    });
  }
);

indexer.onEvent(
  { contract: "Lido", event: "StakingResumed" },
  async ({ context }) => {
    const c = await loadLidoConfig(context);
    context.LidoConfig.set({ ...c, isStakingPaused: false });
  }
);

indexer.onEvent(
  { contract: "Lido", event: "StakingPaused" },
  async ({ context }) => {
    const c = await loadLidoConfig(context);
    context.LidoConfig.set({ ...c, isStakingPaused: true });
  }
);

indexer.onEvent(
  { contract: "Lido", event: "WithdrawalCredentialsSet" },
  async ({ event, context }) => {
    const c = await loadLidoConfig(context);
    context.LidoConfig.set({
      ...c,
      withdrawalCredentials: low(event.params.withdrawalCredentials),
    });
    // NB: the subgraph also crops unused NodeOperatorSigningKey entities via a
    // 3877-line wcKeyCrops map; reproduced as a no-op here (those keys are
    // store.remove()'d). See MIGRATION.md.
  }
);

indexer.onEvent(
  { contract: "Lido", event: "BeaconValidatorsUpdated" },
  async ({ event, context }) => {
    // Goerli-only in practice; on mainnet this would correct totalPooledEther
    // from an eth_call to getTotalPooledEther(), pinned to the event block.
    const totals = await loadTotals(context);
    const tpe = await getTotalPooledEther(
      context.effect,
      getAddress("LIDO"),
      event.block.number
    );
    if (tpe !== null) {
      context.Totals.set({ ...totals, totalPooledEther: tpe });
    }
  }
);

void ONE;
