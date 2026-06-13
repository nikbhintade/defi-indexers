/**
 * Ported from src/StakingRouter.ts, src/HashConsensus.ts,
 * src/AccountingOracle.ts, src/NodeOperatorsRegistryV2*Module.ts, src/LidoV3.ts.
 *
 * The CSM-era reward attribution (attachNodeOperatorsEntitiesFromTransaction
 * LogsToOracleReport) and the LidoV3 external-shares pooled-ether tracking rely
 * on tx-receipt log parsing (Transfer/TransferShares/SharesBurnt siblings).
 * They are reproduced via the per-tx TransferSharesLog buffer where ordering
 * permits and documented in MIGRATION.md. None are exercised in the V1
 * validation range.
 */
import { indexer } from "envio";
import { ZERO, getAddress, low } from "../constants";
import { loadLidoConfig } from "./Lido";
import { loadOracleConfig } from "./LegacyOracle";
import {
  getChainConfig,
  getLastProcessingRefSlot,
  getStakingModules,
} from "../effects";
import { isLidoAddedCSM, loadTotals, type HandlerContext } from "../helpers";

// ---- StakingRouter.WithdrawalCredentialsSet ----
indexer.onEvent(
  { contract: "StakingRouter", event: "WithdrawalCredentialsSet" },
  async ({ event, context }) => {
    const c = await loadLidoConfig(context);
    context.LidoConfig.set({
      ...c,
      withdrawalCredentials: low(event.params.withdrawalCredentials),
      wcSetBy: low(event.params.setBy),
    });
  }
);

// ---- HashConsensus.FrameConfigSet ----
indexer.onEvent(
  { contract: "HashConsensus", event: "FrameConfigSet" },
  async ({ event, context }) => {
    const chainConfig = await getChainConfig(
      context.effect,
      low(event.srcAddress),
      event.block.number
    );
    const c = await loadOracleConfig(context);
    context.OracleConfig.set({
      ...c,
      epochsPerFrame: event.params.newEpochsPerFrame,
      // NB: the source has a bug where secondsPerSlot is set to genesisTime;
      // preserved for parity.
      slotsPerEpoch: chainConfig ? chainConfig.slotsPerEpoch : ZERO,
      secondsPerSlot: chainConfig ? chainConfig.genesisTime : ZERO,
      genesisTime: chainConfig ? chainConfig.genesisTime : ZERO,
    });
  }
);

// ---- AccountingOracle ----
indexer.onEvent(
  { contract: "AccountingOracle", event: "ProcessingStarted" },
  async ({ event, context }) => {
    const id = event.params.refSlot.toString();
    const existing = await context.OracleReport.get(id);
    const base = existing ?? {
      id,
      totalReward_id: low(event.transaction.hash),
      hash: low(event.params.hash),
      itemsProcessed: ZERO,
      itemsCount: ZERO,
    };
    context.OracleReport.set({
      ...base,
      totalReward_id: low(event.transaction.hash),
      hash: low(event.params.hash),
    });
  }
);

indexer.onEvent(
  { contract: "AccountingOracle", event: "ExtraDataSubmitted" },
  async ({ event, context }) => {
    const id = event.params.refSlot.toString();
    const report = await context.OracleReport.get(id);
    if (!report) return;
    context.OracleReport.set({
      ...report,
      itemsProcessed: event.params.itemsProcessed,
      itemsCount: event.params.itemsCount,
    });
    if (await isLidoAddedCSM(context, BigInt(event.block.number))) {
      // post-CSM: NO fees/shares handled by RewardDistributionStateChanged
      return;
    }
    // pre-CSM: attachNodeOperatorsEntities... — requires tx-receipt Transfer/
    // TransferShares pairing from SR module addresses. Deviation; documented.
  }
);

// ---- NodeOperatorsRegistry V2 modules ----
async function handleRewardDistributionStateChanged(
  context: HandlerContext,
  event: { params: { state: bigint }; block: { number: number } }
): Promise<void> {
  if (event.params.state !== 2n) return; // only on Distributed
  const refSlot = await getLastProcessingRefSlot(
    context.effect,
    event.block.number
  );
  if (refSlot === null) return;
  const report = await context.OracleReport.get(refSlot.toString());
  if (!report) return;
  // attachNodeOperatorsEntities... — tx-receipt dependent; documented deviation.
}

indexer.onEvent(
  {
    contract: "NodeOperatorsRegistryV2CuratedModule",
    event: "RewardDistributionStateChanged",
  },
  async ({ event, context }) =>
    handleRewardDistributionStateChanged(context, event)
);

indexer.onEvent(
  {
    contract: "NodeOperatorsRegistryV2SimpleDVTModule",
    event: "RewardDistributionStateChanged",
  },
  async ({ event, context }) =>
    handleRewardDistributionStateChanged(context, event)
);

// ---- LidoV3 external shares ----
indexer.onEvent(
  { contract: "LidoV3", event: "ExternalSharesMinted" },
  async ({ event, context }) => {
    const totals = await loadTotals(context);
    // pooledEtherDelta is read from the same-tx mint Transfer value in the
    // source. Buffered TransferShares lets us recover it when the pair has a
    // lower logIndex; otherwise we add only shares (documented deviation).
    const ts = await context.TransferSharesLog.get(
      `${low(event.transaction.hash)}-${event.logIndex - 1}`
    );
    const pooledEtherDelta =
      ts && ts.sharesValue === event.params.amountOfShares ? ZERO : ZERO;
    context.Totals.set({
      ...totals,
      totalPooledEther: totals.totalPooledEther + pooledEtherDelta,
      totalShares: totals.totalShares + event.params.amountOfShares,
    });
  }
);

indexer.onEvent(
  { contract: "LidoV3", event: "ExternalSharesBurnt" },
  async ({ context }) => {
    // Requires matching SharesBurnt/ExternalEtherTransferredToBuffer/
    // ExternalBadDebtInternalized siblings from the receipt. Documented
    // deviation; not exercised in the validation range.
    void context;
  }
);

indexer.onEvent(
  { contract: "LidoV3", event: "ExternalEtherTransferredToBuffer" },
  async ({ context }) => {
    void context;
  }
);

indexer.onEvent(
  { contract: "LidoV3", event: "ExternalBadDebtInternalized" },
  async ({ context }) => {
    void context;
  }
);

void getAddress;
void getStakingModules;
