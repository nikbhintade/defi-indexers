/** Ported from ssv-subgraph src/handlers/dao-governance.ts (commit e2f1aa0). */
import { indexer } from "envio";
import type { DAOValues } from "envio";
import {
  buildEventEntityId,
  createDefaultDAOValues,
  legacyDaoFeeEventTargetsPrimaryFields,
  low,
  stamp,
  usesEthFeeRegime,
  type HandlerContext,
} from "../helpers";

async function loadOrCreateDAOValuesWithWarning(
  context: HandlerContext,
  address: string,
  blockNumber: number,
  blockTimestamp: number,
  transactionHash: string,
): Promise<DAOValues> {
  const existing = await context.DAOValues.get(low(address));
  if (existing) return existing;
  return createDefaultDAOValues(
    address,
    blockNumber,
    blockTimestamp,
    transactionHash,
  );
}

indexer.onEvent(
  { contract: "SSVNetwork", event: "DeclareOperatorFeePeriodUpdated" },
  async ({ event, context }) => {
    context.DeclareOperatorFeePeriodUpdated.set({
      id: buildEventEntityId(event.transaction.hash, event.logIndex),
      value: event.params.value,
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
    });

    const dao = await loadOrCreateDAOValuesWithWarning(
      context,
      event.srcAddress,
      event.block.number,
      event.block.timestamp,
      event.transaction.hash,
    );
    context.DAOValues.set({
      ...dao,
      updateType: "DECLARE_OPERATOR_FEE_PERIOD",
      declareOperatorFeePeriod: event.params.value,
      ...stamp(event.block.number, event.block.timestamp, event.transaction.hash),
    });
  },
);

indexer.onEvent(
  { contract: "SSVNetwork", event: "ExecuteOperatorFeePeriodUpdated" },
  async ({ event, context }) => {
    context.ExecuteOperatorFeePeriodUpdated.set({
      id: buildEventEntityId(event.transaction.hash, event.logIndex),
      value: event.params.value,
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
    });

    const dao = await loadOrCreateDAOValuesWithWarning(
      context,
      event.srcAddress,
      event.block.number,
      event.block.timestamp,
      event.transaction.hash,
    );
    context.DAOValues.set({
      ...dao,
      updateType: "EXECUTE_OPERATOR_FEE_PERIOD",
      executeOperatorFeePeriod: event.params.value,
      ...stamp(event.block.number, event.block.timestamp, event.transaction.hash),
    });
  },
);

indexer.onEvent(
  { contract: "SSVNetwork", event: "LiquidationThresholdPeriodUpdated" },
  async ({ event, context }) => {
    context.LiquidationThresholdPeriodUpdated.set({
      id: buildEventEntityId(event.transaction.hash, event.logIndex),
      value: event.params.value,
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
    });

    const dao = await loadOrCreateDAOValuesWithWarning(
      context,
      event.srcAddress,
      event.block.number,
      event.block.timestamp,
      event.transaction.hash,
    );
    // NB: the subgraph swaps which field/updateType each branch writes
    // (legacy quirk preserved): when on the ETH-fee regime, the legacy event
    // writes `liquidationThreshold` with updateType LIQUIDATION_THRESHOLD_SSV,
    // otherwise it writes `liquidationThresholdSSV` with LIQUIDATION_THRESHOLD.
    let next: DAOValues;
    if (legacyDaoFeeEventTargetsPrimaryFields(dao)) {
      next = {
        ...dao,
        updateType: "LIQUIDATION_THRESHOLD_SSV",
        liquidationThreshold: event.params.value,
      };
    } else {
      next = {
        ...dao,
        updateType: "LIQUIDATION_THRESHOLD",
        liquidationThresholdSSV: event.params.value,
      };
    }
    context.DAOValues.set({
      ...next,
      ...stamp(event.block.number, event.block.timestamp, event.transaction.hash),
    });
  },
);

indexer.onEvent(
  { contract: "SSVNetwork", event: "LiquidationThresholdPeriodSSVUpdated" },
  async ({ event, context }) => {
    context.LiquidationThresholdPeriodSSVUpdated.set({
      id: buildEventEntityId(event.transaction.hash, event.logIndex),
      value: event.params.value,
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
    });

    const dao = await loadOrCreateDAOValuesWithWarning(
      context,
      event.srcAddress,
      event.block.number,
      event.block.timestamp,
      event.transaction.hash,
    );
    context.DAOValues.set({
      ...dao,
      updateType: "LIQUIDATION_THRESHOLD_SSV",
      liquidationThresholdSSV: event.params.value,
      ...stamp(event.block.number, event.block.timestamp, event.transaction.hash),
    });
  },
);

indexer.onEvent(
  { contract: "SSVNetwork", event: "MinimumLiquidationCollateralUpdated" },
  async ({ event, context }) => {
    context.MinimumLiquidationCollateralUpdated.set({
      id: buildEventEntityId(event.transaction.hash, event.logIndex),
      value: event.params.value,
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
    });

    const dao = await loadOrCreateDAOValuesWithWarning(
      context,
      event.srcAddress,
      event.block.number,
      event.block.timestamp,
      event.transaction.hash,
    );
    // legacy quirk preserved (mirrors the LiquidationThreshold swap above)
    let next: DAOValues;
    if (legacyDaoFeeEventTargetsPrimaryFields(dao)) {
      next = {
        ...dao,
        updateType: "MIN_LIQUIDATION_COLLATERAL",
        minimumLiquidationCollateral: event.params.value,
      };
    } else {
      next = {
        ...dao,
        updateType: "MIN_LIQUIDATION_COLLATERAL_SSV",
        minimumLiquidationCollateralSSV: event.params.value,
      };
    }
    context.DAOValues.set({
      ...next,
      ...stamp(event.block.number, event.block.timestamp, event.transaction.hash),
    });
  },
);

indexer.onEvent(
  { contract: "SSVNetwork", event: "MinimumLiquidationCollateralSSVUpdated" },
  async ({ event, context }) => {
    context.MinimumLiquidationCollateralSSVUpdated.set({
      id: buildEventEntityId(event.transaction.hash, event.logIndex),
      value: event.params.value,
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
    });

    const dao = await loadOrCreateDAOValuesWithWarning(
      context,
      event.srcAddress,
      event.block.number,
      event.block.timestamp,
      event.transaction.hash,
    );
    context.DAOValues.set({
      ...dao,
      updateType: "MIN_LIQUIDATION_COLLATERAL_SSV",
      minimumLiquidationCollateralSSV: event.params.value,
      ...stamp(event.block.number, event.block.timestamp, event.transaction.hash),
    });
  },
);

indexer.onEvent(
  { contract: "SSVNetwork", event: "NetworkFeeUpdated" },
  async ({ event, context }) => {
    context.NetworkFeeUpdated.set({
      id: buildEventEntityId(event.transaction.hash, event.logIndex),
      oldFee: event.params.oldFee,
      newFee: event.params.newFee,
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
    });

    const dao = await loadOrCreateDAOValuesWithWarning(
      context,
      event.srcAddress,
      event.block.number,
      event.block.timestamp,
      event.transaction.hash,
    );
    const bn = BigInt(event.block.number);
    let next: DAOValues = { ...dao, updateType: "NETWORK_FEE" };
    if (usesEthFeeRegime(dao)) {
      next = {
        ...next,
        networkFeeIndex:
          dao.networkFeeIndex +
          (bn - dao.networkFeeIndexBlockNumber) * dao.networkFee,
        networkFeeIndexBlockNumber: bn,
        networkFee: event.params.newFee,
      };
    } else {
      next = {
        ...next,
        networkFeeIndexSSV:
          dao.networkFeeIndexSSV +
          (bn - dao.networkFeeIndexBlockNumberSSV) * dao.networkFeeSSV,
        networkFeeIndexBlockNumberSSV: bn,
        networkFeeSSV: event.params.newFee,
      };
    }
    context.DAOValues.set({
      ...next,
      ...stamp(event.block.number, event.block.timestamp, event.transaction.hash),
    });
  },
);

indexer.onEvent(
  { contract: "SSVNetwork", event: "NetworkFeeUpdatedSSV" },
  async ({ event, context }) => {
    context.NetworkFeeUpdatedSSV.set({
      id: buildEventEntityId(event.transaction.hash, event.logIndex),
      oldFee: event.params.oldFee,
      newFee: event.params.newFee,
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
    });

    const dao = await loadOrCreateDAOValuesWithWarning(
      context,
      event.srcAddress,
      event.block.number,
      event.block.timestamp,
      event.transaction.hash,
    );
    const bn = BigInt(event.block.number);
    context.DAOValues.set({
      ...dao,
      updateType: "NETWORK_FEE_SSV",
      networkFeeIndexSSV:
        dao.networkFeeIndexSSV +
        (bn - dao.networkFeeIndexBlockNumberSSV) * dao.networkFeeSSV,
      networkFeeIndexBlockNumberSSV: bn,
      networkFeeSSV: event.params.newFee,
      ...stamp(event.block.number, event.block.timestamp, event.transaction.hash),
    });
  },
);

indexer.onEvent(
  { contract: "SSVNetwork", event: "OperatorFeeIncreaseLimitUpdated" },
  async ({ event, context }) => {
    context.OperatorFeeIncreaseLimitUpdated.set({
      id: buildEventEntityId(event.transaction.hash, event.logIndex),
      value: event.params.value,
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
    });

    const dao = await loadOrCreateDAOValuesWithWarning(
      context,
      event.srcAddress,
      event.block.number,
      event.block.timestamp,
      event.transaction.hash,
    );
    context.DAOValues.set({
      ...dao,
      updateType: "OPERATOR_FEE_INCREASE_LIMIT",
      operatorFeeIncreaseLimit: event.params.value,
      ...stamp(event.block.number, event.block.timestamp, event.transaction.hash),
    });
  },
);

indexer.onEvent(
  { contract: "SSVNetwork", event: "OperatorMaximumFeeUpdated" },
  async ({ event, context }) => {
    context.OperatorMaximumFeeUpdated.set({
      id: buildEventEntityId(event.transaction.hash, event.logIndex),
      maxFee: event.params.maxFee,
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
    });

    const dao = await loadOrCreateDAOValuesWithWarning(
      context,
      event.srcAddress,
      event.block.number,
      event.block.timestamp,
      event.transaction.hash,
    );
    context.DAOValues.set({
      ...dao,
      updateType: "OPERATOR_MAX_FEE",
      operatorMaximumFee: event.params.maxFee,
      ...stamp(event.block.number, event.block.timestamp, event.transaction.hash),
    });
  },
);

indexer.onEvent(
  { contract: "SSVNetwork", event: "QuorumUpdated" },
  async ({ event, context }) => {
    context.QuorumUpdated.set({
      id: buildEventEntityId(event.transaction.hash, event.logIndex),
      newQuorum: Number(event.params.newQuorum),
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
    });

    // subgraph requires an existing DAOValues, bails otherwise
    const dao = await context.DAOValues.get(low(event.srcAddress));
    if (!dao) return;
    context.DAOValues.set({
      ...dao,
      updateType: "QUORUM_UPDATED",
      quorum: Number(event.params.newQuorum),
      ...stamp(event.block.number, event.block.timestamp, event.transaction.hash),
    });
  },
);

indexer.onEvent(
  { contract: "SSVNetwork", event: "SSVNetworkUpgradeBlock" },
  async ({ event, context }) => {
    context.SSVNetworkUpgradeBlock.set({
      id: buildEventEntityId(event.transaction.hash, event.logIndex),
      version: event.params.version,
      blockNumber: event.params.blockNumber,
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
    });

    const dao = await context.DAOValues.get(low(event.srcAddress));
    if (!dao) return;
    let next: DAOValues = {
      ...dao,
      updateType: "SSV_NETWORK_UPGRADE",
      version: event.params.version,
    };
    // NB: usesEthFeeRegime checks the *new* version just assigned
    if (usesEthFeeRegime(next)) {
      next = {
        ...next,
        networkFeeIndex: 0n,
        networkFeeIndexBlockNumber: event.params.blockNumber,
      };
    }
    context.DAOValues.set({
      ...next,
      ...stamp(event.block.number, event.block.timestamp, event.transaction.hash),
    });
  },
);
