/** Ported from ssv-subgraph src/handlers/cluster-validator.ts (commit e2f1aa0). */
import { indexer } from "envio";
import type { Account, Cluster, DAOValues } from "envio";
import {
  buildClusterId,
  buildEventEntityId,
  clusterUsesEthFees,
  ETH_FEE_ASSET,
  getInitialClusterFeeAsset,
  loadLoopOperatorOrLog,
  newAccount,
  low,
  SSV_FEE_ASSET,
  stamp,
  type HandlerContext,
} from "../helpers";

const VUNITS_PRECISION = 100000n;
const DEFAULT_BALANCE = 32n;

/** Mirrors assignClusterMembership: sets owner/operatorIds/validatorCount. */
function withMembership(
  cluster: Cluster,
  owner: Account,
  operatorIds: readonly bigint[],
  validatorCount: bigint,
): Cluster {
  return {
    ...cluster,
    owner_id: owner.id,
    operatorIds: [...operatorIds],
    validatorCount,
  };
}

/** Mirrors assignClusterSnapshot. */
function withSnapshot(
  cluster: Cluster,
  networkFeeIndex: bigint,
  index: bigint,
  active: boolean,
  balance: bigint,
): Cluster {
  return { ...cluster, networkFeeIndex, index, active, balance };
}

async function requireClusterOwner(
  context: HandlerContext,
  owner: string,
): Promise<Account | undefined> {
  return context.Account.get(low(owner));
}

indexer.onEvent(
  { contract: "SSVNetwork", event: "ClusterBalanceUpdated" },
  async ({ event, context }) => {
    context.ClusterBalanceUpdated.set({
      id: buildEventEntityId(event.transaction.hash, event.logIndex),
      owner: low(event.params.owner),
      operatorIds: [...event.params.operatorIds],
      effectiveBalance: BigInt(event.params.effectiveBalance),
      cluster_validatorCount: BigInt(event.params.cluster.validatorCount),
      cluster_networkFeeIndex: event.params.cluster.networkFeeIndex,
      cluster_index: event.params.cluster.index,
      cluster_active: event.params.cluster.active,
      cluster_balance: event.params.cluster.balance,
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
    });

    const clusterId = buildClusterId(event.params.owner, [
      ...event.params.operatorIds,
    ]);
    let cluster = await context.Cluster.get(clusterId);
    if (!cluster) {
      // subgraph: creates a partial cluster with only effectiveBalance+feeAsset
      cluster = {
        id: clusterId,
        owner_id: low(event.params.owner),
        operatorIds: [],
        validatorCount: 0n,
        effectiveBalance: DEFAULT_BALANCE,
        vUnits: 0n,
        feeAsset: SSV_FEE_ASSET,
        networkFeeIndex: 0n,
        index: 0n,
        active: false,
        balance: 0n,
        lastUpdateBlockNumber: 0n,
        lastUpdateBlockTimestamp: 0n,
        lastUpdateTransactionHash: "0x",
      };
    }

    const owner = await requireClusterOwner(context, event.params.owner);
    if (!owner) return;
    context.Account.set({
      ...owner,
      effectiveBalance:
        owner.effectiveBalance -
        cluster.effectiveBalance +
        BigInt(event.params.effectiveBalance),
    });

    cluster = withMembership(
      cluster,
      owner,
      event.params.operatorIds,
      BigInt(event.params.cluster.validatorCount),
    );
    const clusterPreviousBalance = cluster.effectiveBalance;
    cluster = {
      ...cluster,
      effectiveBalance: BigInt(event.params.effectiveBalance),
    };
    cluster = {
      ...cluster,
      vUnits: (cluster.effectiveBalance * VUNITS_PRECISION) / DEFAULT_BALANCE,
    };
    cluster = withSnapshot(
      cluster,
      event.params.cluster.networkFeeIndex,
      event.params.cluster.index,
      event.params.cluster.active,
      event.params.cluster.balance,
    );
    cluster = {
      ...cluster,
      ...stamp(event.block.number, event.block.timestamp, event.transaction.hash),
    };
    context.Cluster.set(cluster);

    const dao = await context.DAOValues.get(low(event.srcAddress));
    if (!dao) return;
    let nextDao: DAOValues = {
      ...dao,
      updateType: "CLUSTER_BALANCE_UPDATED",
      totalEffectiveBalance:
        dao.totalEffectiveBalance -
        clusterPreviousBalance +
        cluster.effectiveBalance,
    };
    if (clusterUsesEthFees(cluster)) {
      nextDao = {
        ...nextDao,
        effectiveBalanceETH:
          dao.effectiveBalanceETH -
          clusterPreviousBalance +
          cluster.effectiveBalance,
      };
    }
    context.DAOValues.set(nextDao);
  },
);

indexer.onEvent(
  { contract: "SSVNetwork", event: "ClusterMigratedToETH" },
  async ({ event, context }) => {
    const owner = await requireClusterOwner(context, event.params.owner);
    if (!owner) return;

    const clusterId = buildClusterId(event.params.owner, [
      ...event.params.operatorIds,
    ]);
    let cluster = await context.Cluster.get(clusterId);
    if (!cluster) {
      cluster = {
        id: clusterId,
        owner_id: low(event.params.owner),
        operatorIds: [],
        validatorCount: 0n,
        effectiveBalance: 0n,
        vUnits: 0n,
        feeAsset: SSV_FEE_ASSET,
        networkFeeIndex: 0n,
        index: 0n,
        active: false,
        balance: 0n,
        lastUpdateBlockNumber: 0n,
        lastUpdateBlockTimestamp: 0n,
        lastUpdateTransactionHash: "0x",
      };
    }

    context.ClusterMigratedToETH.set({
      id: buildEventEntityId(event.transaction.hash, event.logIndex),
      owner: low(event.params.owner),
      operatorIds: [...event.params.operatorIds],
      ethDeposited: event.params.ethDeposited,
      ssvRefunded: event.params.ssvRefunded,
      effectiveBalance: BigInt(event.params.effectiveBalance),
      cluster_id: cluster.id,
      cluster_validatorCount: BigInt(event.params.cluster.validatorCount),
      cluster_networkFeeIndex: event.params.cluster.networkFeeIndex,
      cluster_index: event.params.cluster.index,
      cluster_active: event.params.cluster.active,
      cluster_balance: event.params.cluster.balance,
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
    });

    cluster = withMembership(
      cluster,
      owner,
      event.params.operatorIds,
      BigInt(event.params.cluster.validatorCount),
    );
    cluster = {
      ...cluster,
      feeAsset: ETH_FEE_ASSET,
      effectiveBalance: BigInt(event.params.effectiveBalance),
    };
    cluster = {
      ...cluster,
      vUnits: (cluster.effectiveBalance * VUNITS_PRECISION) / DEFAULT_BALANCE,
    };
    cluster = withSnapshot(
      cluster,
      event.params.cluster.networkFeeIndex,
      event.params.cluster.index,
      event.params.cluster.active,
      event.params.cluster.balance,
    );
    cluster = {
      ...cluster,
      ...stamp(event.block.number, event.block.timestamp, event.transaction.hash),
    };
    context.Cluster.set(cluster);

    for (const opId of event.params.operatorIds) {
      const operator = await loadLoopOperatorOrLog(context, opId);
      if (!operator) continue;
      context.Operator.set({
        ...operator,
        ...stamp(event.block.number, event.block.timestamp, event.transaction.hash),
      });
    }
  },
);

indexer.onEvent(
  { contract: "SSVNetwork", event: "ClusterDeposited" },
  async ({ event, context }) => {
    context.ClusterDeposited.set({
      id: buildEventEntityId(event.transaction.hash, event.logIndex),
      owner: low(event.params.owner),
      operatorIds: [...event.params.operatorIds],
      value: event.params.value,
      cluster_validatorCount: BigInt(event.params.cluster.validatorCount),
      cluster_networkFeeIndex: event.params.cluster.networkFeeIndex,
      cluster_index: event.params.cluster.index,
      cluster_active: event.params.cluster.active,
      cluster_balance: event.params.cluster.balance,
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
    });

    const owner = await requireClusterOwner(context, event.params.owner);
    if (!owner) return;

    const clusterId = buildClusterId(event.params.owner, [
      ...event.params.operatorIds,
    ]);
    const cluster = await context.Cluster.get(clusterId);
    if (!cluster) return; // loadRequiredLifecycleCluster bails

    let next = withMembership(
      cluster,
      owner,
      event.params.operatorIds,
      BigInt(event.params.cluster.validatorCount),
    );
    next = withSnapshot(
      next,
      event.params.cluster.networkFeeIndex,
      event.params.cluster.index,
      event.params.cluster.active,
      event.params.cluster.balance,
    );
    context.Cluster.set({
      ...next,
      ...stamp(event.block.number, event.block.timestamp, event.transaction.hash),
    });
  },
);

indexer.onEvent(
  { contract: "SSVNetwork", event: "ClusterLiquidated" },
  async ({ event, context }) => {
    const clusterId = buildClusterId(event.params.owner, [
      ...event.params.operatorIds,
    ]);
    const cluster = await context.Cluster.get(clusterId);
    if (!cluster) return;

    const owner = await requireClusterOwner(context, event.params.owner);
    if (!owner) return;
    context.Account.set({
      ...owner,
      validatorCount: owner.validatorCount - BigInt(event.params.cluster.validatorCount),
      effectiveBalance: owner.effectiveBalance - cluster.effectiveBalance,
    });

    const dao = await context.DAOValues.get(low(event.srcAddress));
    if (!dao) return;
    let nextDao: DAOValues = {
      ...dao,
      totalValidators: dao.totalValidators - BigInt(event.params.cluster.validatorCount),
      totalEffectiveBalance: dao.totalEffectiveBalance - cluster.effectiveBalance,
    };
    if (clusterUsesEthFees(cluster)) {
      nextDao = {
        ...nextDao,
        effectiveBalanceETH: dao.effectiveBalanceETH - cluster.effectiveBalance,
      };
    }
    context.DAOValues.set(nextDao);

    let next = withMembership(
      cluster,
      owner,
      event.params.operatorIds,
      BigInt(event.params.cluster.validatorCount),
    );
    next = withSnapshot(
      next,
      event.params.cluster.networkFeeIndex,
      event.params.cluster.index,
      event.params.cluster.active,
      event.params.cluster.balance,
    );
    next = {
      ...next,
      ...stamp(event.block.number, event.block.timestamp, event.transaction.hash),
    };
    context.Cluster.set(next);

    context.ClusterLiquidated.set({
      id: buildEventEntityId(event.transaction.hash, event.logIndex),
      owner: low(event.params.owner),
      operatorIds: [...event.params.operatorIds],
      cluster_id: next.id,
      cluster_validatorCount: BigInt(event.params.cluster.validatorCount),
      cluster_networkFeeIndex: event.params.cluster.networkFeeIndex,
      cluster_index: event.params.cluster.index,
      cluster_active: event.params.cluster.active,
      cluster_balance: event.params.cluster.balance,
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
    });

    for (const opId of event.params.operatorIds) {
      const operator = await loadLoopOperatorOrLog(context, opId);
      if (!operator) continue;
      if (!operator.removed) {
        context.Operator.set({
          ...operator,
          validatorCount:
            operator.validatorCount - BigInt(event.params.cluster.validatorCount),
          ...stamp(event.block.number, event.block.timestamp, event.transaction.hash),
        });
      }
    }
  },
);

indexer.onEvent(
  { contract: "SSVNetwork", event: "ClusterReactivated" },
  async ({ event, context }) => {
    const clusterId = buildClusterId(event.params.owner, [
      ...event.params.operatorIds,
    ]);
    const cluster = await context.Cluster.get(clusterId);
    if (!cluster) return;

    const owner = await requireClusterOwner(context, event.params.owner);
    if (!owner) return;
    context.Account.set({
      ...owner,
      validatorCount: owner.validatorCount + BigInt(event.params.cluster.validatorCount),
      effectiveBalance: owner.effectiveBalance + cluster.effectiveBalance,
    });

    const dao = await context.DAOValues.get(low(event.srcAddress));
    if (!dao) return;
    let nextDao: DAOValues = {
      ...dao,
      totalValidators: dao.totalValidators + BigInt(event.params.cluster.validatorCount),
      totalEffectiveBalance: dao.totalEffectiveBalance + cluster.effectiveBalance,
    };
    if (clusterUsesEthFees(cluster)) {
      nextDao = {
        ...nextDao,
        effectiveBalanceETH: dao.effectiveBalanceETH + cluster.effectiveBalance,
      };
    }
    context.DAOValues.set(nextDao);

    let next = withMembership(
      cluster,
      owner,
      event.params.operatorIds,
      BigInt(event.params.cluster.validatorCount),
    );
    next = withSnapshot(
      next,
      event.params.cluster.networkFeeIndex,
      event.params.cluster.index,
      event.params.cluster.active,
      event.params.cluster.balance,
    );
    next = {
      ...next,
      ...stamp(event.block.number, event.block.timestamp, event.transaction.hash),
    };
    context.Cluster.set(next);

    context.ClusterReactivated.set({
      id: buildEventEntityId(event.transaction.hash, event.logIndex),
      owner: low(event.params.owner),
      operatorIds: [...event.params.operatorIds],
      cluster_id: next.id,
      cluster_validatorCount: BigInt(event.params.cluster.validatorCount),
      cluster_networkFeeIndex: event.params.cluster.networkFeeIndex,
      cluster_index: event.params.cluster.index,
      cluster_active: event.params.cluster.active,
      cluster_balance: event.params.cluster.balance,
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
    });

    for (const opId of event.params.operatorIds) {
      const operator = await loadLoopOperatorOrLog(context, opId);
      if (!operator) continue;
      if (!operator.removed) {
        context.Operator.set({
          ...operator,
          validatorCount:
            operator.validatorCount + BigInt(event.params.cluster.validatorCount),
          ...stamp(event.block.number, event.block.timestamp, event.transaction.hash),
        });
      }
    }
  },
);

indexer.onEvent(
  { contract: "SSVNetwork", event: "ClusterWithdrawn" },
  async ({ event, context }) => {
    context.ClusterWithdrawn.set({
      id: buildEventEntityId(event.transaction.hash, event.logIndex),
      owner: low(event.params.owner),
      operatorIds: [...event.params.operatorIds],
      value: event.params.value,
      cluster_validatorCount: BigInt(event.params.cluster.validatorCount),
      cluster_networkFeeIndex: event.params.cluster.networkFeeIndex,
      cluster_index: event.params.cluster.index,
      cluster_active: event.params.cluster.active,
      cluster_balance: event.params.cluster.balance,
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
    });

    const owner = await requireClusterOwner(context, event.params.owner);
    if (!owner) return;

    const clusterId = buildClusterId(event.params.owner, [
      ...event.params.operatorIds,
    ]);
    const cluster = await context.Cluster.get(clusterId);
    if (!cluster) return;

    let next = withMembership(
      cluster,
      owner,
      event.params.operatorIds,
      BigInt(event.params.cluster.validatorCount),
    );
    next = withSnapshot(
      next,
      event.params.cluster.networkFeeIndex,
      event.params.cluster.index,
      event.params.cluster.active,
      event.params.cluster.balance,
    );
    context.Cluster.set({
      ...next,
      ...stamp(event.block.number, event.block.timestamp, event.transaction.hash),
    });
  },
);

indexer.onEvent(
  { contract: "SSVNetwork", event: "ValidatorAdded" },
  async ({ event, context }) => {
    const dao = await context.DAOValues.get(low(event.srcAddress));
    if (!dao) return;
    let nextDao: DAOValues = {
      ...dao,
      updateType: "VALIDATOR_ADDED",
      totalEffectiveBalance: dao.totalEffectiveBalance + DEFAULT_BALANCE,
      validatorsAdded: dao.validatorsAdded + 1n,
      totalValidators: dao.totalValidators + 1n,
    };

    // loadOrCreateValidatorOwnerAccount: increments totalAccounts on create
    let owner = await context.Account.get(low(event.params.owner));
    if (!owner) {
      owner = newAccount(event.params.owner);
      nextDao = { ...nextDao, totalAccounts: nextDao.totalAccounts + 1n };
    }
    // applyOwnerValidatorAdded
    owner = {
      ...owner,
      nonce: owner.nonce + 1n,
      validatorCount: owner.validatorCount + 1n,
      effectiveBalance: owner.effectiveBalance + DEFAULT_BALANCE,
    };
    context.Account.set(owner);

    const clusterId = buildClusterId(event.params.owner, [
      ...event.params.operatorIds,
    ]);
    let cluster = await context.Cluster.get(clusterId);
    if (!cluster) {
      cluster = {
        id: clusterId,
        owner_id: owner.id,
        operatorIds: [],
        validatorCount: 0n,
        effectiveBalance: 0n,
        vUnits: 0n,
        feeAsset: getInitialClusterFeeAsset(dao),
        networkFeeIndex: 0n,
        index: 0n,
        active: false,
        balance: 0n,
        lastUpdateBlockNumber: 0n,
        lastUpdateBlockTimestamp: 0n,
        lastUpdateTransactionHash: "0x",
      };
    }

    cluster = withMembership(
      cluster,
      owner,
      event.params.operatorIds,
      BigInt(event.params.cluster.validatorCount),
    );
    cluster = {
      ...cluster,
      effectiveBalance: cluster.effectiveBalance + DEFAULT_BALANCE,
    };
    cluster = {
      ...cluster,
      vUnits: (cluster.effectiveBalance * VUNITS_PRECISION) / DEFAULT_BALANCE,
    };
    cluster = withSnapshot(
      cluster,
      event.params.cluster.networkFeeIndex,
      event.params.cluster.index,
      event.params.cluster.active,
      event.params.cluster.balance,
    );
    cluster = {
      ...cluster,
      ...stamp(event.block.number, event.block.timestamp, event.transaction.hash),
    };
    context.Cluster.set(cluster);

    context.ValidatorAdded.set({
      id: buildEventEntityId(event.transaction.hash, event.logIndex),
      owner: low(event.params.owner),
      operatorIds: [...event.params.operatorIds],
      publicKey: low(event.params.publicKey),
      shares: low(event.params.shares),
      cluster_id: cluster.id,
      cluster_validatorCount: BigInt(event.params.cluster.validatorCount),
      cluster_networkFeeIndex: event.params.cluster.networkFeeIndex,
      cluster_index: event.params.cluster.index,
      cluster_active: event.params.cluster.active,
      cluster_balance: event.params.cluster.balance,
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
    });

    const validatorId = low(event.params.publicKey);
    context.Validator.set({
      id: validatorId,
      owner_id: owner.id,
      operators: event.params.operatorIds.map((id) => id.toString()),
      cluster_id: cluster.id,
      removed: false,
      shares: low(event.params.shares),
      ...stamp(event.block.number, event.block.timestamp, event.transaction.hash),
    });

    for (const opId of event.params.operatorIds) {
      const operator = await context.Operator.get(opId.toString());
      if (!operator) {
        // subgraph `return`s out of the whole handler before saving dao
        return;
      }
      context.Operator.set({
        ...operator,
        operatorId: opId,
        validatorCount: operator.validatorCount + 1n,
        ...stamp(event.block.number, event.block.timestamp, event.transaction.hash),
      });
    }

    if (clusterUsesEthFees(cluster)) {
      nextDao = {
        ...nextDao,
        effectiveBalanceETH: nextDao.effectiveBalanceETH + cluster.effectiveBalance,
      };
    }
    context.DAOValues.set(nextDao);
  },
);

indexer.onEvent(
  { contract: "SSVNetwork", event: "ValidatorRemoved" },
  async ({ event, context }) => {
    const dao = await context.DAOValues.get(low(event.srcAddress));
    if (!dao) return;
    let nextDao: DAOValues = {
      ...dao,
      updateType: "VALIDATOR_REMOVED",
      totalEffectiveBalance: dao.totalEffectiveBalance - DEFAULT_BALANCE,
      validatorsRemoved: dao.validatorsRemoved + 1n,
      totalValidators: dao.totalValidators - 1n,
    };

    const owner = await requireClusterOwner(context, event.params.owner);
    if (!owner) return;
    let nextOwner = owner;
    if (event.params.cluster.active) {
      // applyOwnerValidatorRemoved (only when cluster.active)
      nextOwner = {
        ...owner,
        validatorCount: owner.validatorCount - 1n,
        effectiveBalance: owner.effectiveBalance - DEFAULT_BALANCE,
      };
    }
    context.Account.set(nextOwner);

    const clusterId = buildClusterId(event.params.owner, [
      ...event.params.operatorIds,
    ]);
    const cluster = await context.Cluster.get(clusterId);
    if (!cluster) return;

    let next = withMembership(
      cluster,
      nextOwner,
      event.params.operatorIds,
      BigInt(event.params.cluster.validatorCount),
    );
    next = {
      ...next,
      effectiveBalance: next.effectiveBalance - DEFAULT_BALANCE,
    };
    next = {
      ...next,
      vUnits: (next.effectiveBalance * VUNITS_PRECISION) / DEFAULT_BALANCE,
    };
    next = withSnapshot(
      next,
      event.params.cluster.networkFeeIndex,
      event.params.cluster.index,
      event.params.cluster.active,
      event.params.cluster.balance,
    );
    next = {
      ...next,
      ...stamp(event.block.number, event.block.timestamp, event.transaction.hash),
    };
    context.Cluster.set(next);

    context.ValidatorRemoved.set({
      id: buildEventEntityId(event.transaction.hash, event.logIndex),
      owner: low(event.params.owner),
      operatorIds: [...event.params.operatorIds],
      publicKey: low(event.params.publicKey),
      cluster_id: next.id,
      cluster_validatorCount: BigInt(event.params.cluster.validatorCount),
      cluster_networkFeeIndex: event.params.cluster.networkFeeIndex,
      cluster_index: event.params.cluster.index,
      cluster_active: event.params.cluster.active,
      cluster_balance: event.params.cluster.balance,
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
    });

    const validatorId = low(event.params.publicKey);
    const validator = await context.Validator.get(validatorId);
    if (validator) {
      context.Validator.set({
        ...validator,
        operators: event.params.operatorIds.map((id) => id.toString()),
        owner_id: nextOwner.id,
        removed: true,
        ...stamp(event.block.number, event.block.timestamp, event.transaction.hash),
      });
    }

    for (const opId of event.params.operatorIds) {
      const operator = await loadLoopOperatorOrLog(context, opId);
      if (!operator) continue;
      if (!operator.removed && next.active) {
        context.Operator.set({
          ...operator,
          operatorId: opId,
          validatorCount: operator.validatorCount - 1n,
          ...stamp(event.block.number, event.block.timestamp, event.transaction.hash),
        });
      }
    }

    if (clusterUsesEthFees(next)) {
      nextDao = {
        ...nextDao,
        effectiveBalanceETH: nextDao.effectiveBalanceETH - next.effectiveBalance,
      };
    }
    context.DAOValues.set(nextDao);
  },
);
