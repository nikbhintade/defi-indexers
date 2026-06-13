/** Ported from ssv-subgraph src/handlers/operator.ts (commit e2f1aa0). */
import { indexer } from "envio";
import type { Account, DAOValues, Operator } from "envio";
import {
  buildEventEntityId,
  createDefaultDAOValues,
  loadLoopOperatorOrLog,
  newAccount,
  low,
  stamp,
  usesEthFeeRegime,
  ZERO_ADDRESS,
  type HandlerContext,
} from "../helpers";

const DEFAULT_OPERATOR_ETH_FEE = 1_778_800_000n;

indexer.onEvent(
  { contract: "SSVNetwork", event: "OperatorAdded" },
  async ({ event, context }) => {
    context.OperatorAdded.set({
      id: buildEventEntityId(event.transaction.hash, event.logIndex),
      operatorId: event.params.operatorId,
      owner: low(event.params.owner),
      publicKey: low(event.params.publicKey),
      fee: event.params.fee,
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
    });

    let dao = await context.DAOValues.get(low(event.srcAddress));
    if (!dao) {
      dao = createDefaultDAOValues(
        event.srcAddress,
        event.block.number,
        event.block.timestamp,
        event.transaction.hash,
      );
    }
    let nextDao: DAOValues = {
      ...dao,
      updateType: "OPERATOR_ADDED",
      operatorsAdded: dao.operatorsAdded + 1n,
    };

    let owner = await context.Account.get(low(event.params.owner));
    if (!owner) {
      owner = newAccount(event.params.owner);
      context.Account.set(owner);
      nextDao = { ...nextDao, totalAccounts: nextDao.totalAccounts + 1n };
    }

    const operatorId = event.params.operatorId.toString();
    let operator = await context.Operator.get(operatorId);
    if (!operator) {
      const eth = usesEthFeeRegime(dao);
      operator = {
        id: operatorId,
        operatorId: event.params.operatorId,
        owner_id: owner.id,
        publicKey: low(event.params.publicKey),
        removed: false,
        feeIndex: 0n,
        declaredFee: 0n,
        feeIndexSSV: 0n,
        totalEffectiveBalance: 0n,
        declaredSSVFee: 0n,
        whitelisted: [],
        isPrivate: false,
        whitelistedContract: ZERO_ADDRESS,
        totalWithdrawn: 0n,
        totalWithdrawnSSV: 0n,
        validatorCount: 0n,
        fee: eth
          ? event.params.fee
          : event.params.fee === 0n
            ? 0n
            : DEFAULT_OPERATOR_ETH_FEE,
        feeIndexBlockNumber: eth ? BigInt(event.block.number) : 0n,
        feeSSV: eth ? 0n : event.params.fee,
        feeIndexBlockNumberSSV: eth ? 0n : BigInt(event.block.number),
        ...stamp(event.block.number, event.block.timestamp, event.transaction.hash),
      };
      nextDao = { ...nextDao, totalOperators: nextDao.totalOperators + 1n };
    }

    context.Operator.set({
      ...operator,
      ...stamp(event.block.number, event.block.timestamp, event.transaction.hash),
    });
    context.DAOValues.set(nextDao);
  },
);

/** Loads the operator owner account; returns undefined if absent (subgraph bails). */
async function requireOwner(
  context: HandlerContext,
  owner: string,
): Promise<Account | undefined> {
  return context.Account.get(low(owner));
}

indexer.onEvent(
  { contract: "SSVNetwork", event: "OperatorFeeDeclarationCancelled" },
  async ({ event, context }) => {
    context.OperatorFeeDeclarationCancelled.set({
      id: buildEventEntityId(event.transaction.hash, event.logIndex),
      owner: low(event.params.owner),
      operatorId: event.params.operatorId,
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
    });

    const owner = await requireOwner(context, event.params.owner);
    if (!owner) return;

    const operator = await context.Operator.get(event.params.operatorId.toString());
    if (!operator) return;

    const dao = await context.DAOValues.get(low(event.srcAddress));
    if (!dao) return;

    const next: Operator = usesEthFeeRegime(dao)
      ? { ...operator, owner_id: owner.id, declaredFee: 0n }
      : { ...operator, owner_id: owner.id, declaredSSVFee: 0n };
    context.Operator.set({
      ...next,
      operatorId: event.params.operatorId,
      ...stamp(event.block.number, event.block.timestamp, event.transaction.hash),
    });
  },
);

indexer.onEvent(
  { contract: "SSVNetwork", event: "OperatorFeeDeclared" },
  async ({ event, context }) => {
    context.OperatorFeeDeclared.set({
      id: buildEventEntityId(event.transaction.hash, event.logIndex),
      owner: low(event.params.owner),
      operatorId: event.params.operatorId,
      // subgraph sets blockNumber from params then overwrites with event.block.number
      blockNumber: BigInt(event.block.number),
      fee: event.params.fee,
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
    });

    const owner = await requireOwner(context, event.params.owner);
    if (!owner) return;

    const operator = await context.Operator.get(event.params.operatorId.toString());
    if (!operator) return;

    const dao = await context.DAOValues.get(low(event.srcAddress));
    if (!dao) return;

    const next: Operator = usesEthFeeRegime(dao)
      ? { ...operator, owner_id: owner.id, declaredFee: event.params.fee }
      : { ...operator, owner_id: owner.id, declaredSSVFee: event.params.fee };
    context.Operator.set({
      ...next,
      operatorId: event.params.operatorId,
      ...stamp(event.block.number, event.block.timestamp, event.transaction.hash),
    });
  },
);

indexer.onEvent(
  { contract: "SSVNetwork", event: "OperatorFeeExecuted" },
  async ({ event, context }) => {
    context.OperatorFeeExecuted.set({
      id: buildEventEntityId(event.transaction.hash, event.logIndex),
      owner: low(event.params.owner),
      operatorId: event.params.operatorId,
      blockNumber: BigInt(event.block.number),
      fee: event.params.fee,
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
    });

    const owner = await requireOwner(context, event.params.owner);
    if (!owner) return;

    const operator = await context.Operator.get(event.params.operatorId.toString());
    if (!operator) return;

    const dao = await context.DAOValues.get(low(event.srcAddress));
    if (!dao) return;

    const bn = BigInt(event.block.number);
    let next: Operator = {
      ...operator,
      operatorId: event.params.operatorId,
      owner_id: owner.id,
    };
    if (usesEthFeeRegime(dao)) {
      if (operator.feeIndexBlockNumber !== 0n) {
        next = {
          ...next,
          feeIndex:
            operator.feeIndex +
            (bn - operator.feeIndexBlockNumber) * operator.fee,
        };
      }
      next = {
        ...next,
        feeIndexBlockNumber: bn,
        fee: event.params.fee,
        declaredFee: 0n,
      };
    } else {
      next = {
        ...next,
        feeIndexSSV:
          operator.feeIndexSSV +
          (bn - operator.feeIndexBlockNumberSSV) * operator.feeSSV,
        feeIndexBlockNumberSSV: bn,
        feeSSV: event.params.fee,
        declaredSSVFee: 0n,
      };
      if (event.params.fee === 0n) {
        next = { ...next, fee: event.params.fee };
      }
    }
    context.Operator.set({
      ...next,
      ...stamp(event.block.number, event.block.timestamp, event.transaction.hash),
    });
  },
);

indexer.onEvent(
  { contract: "SSVNetwork", event: "OperatorRemoved" },
  async ({ event, context }) => {
    context.OperatorRemoved.set({
      id: buildEventEntityId(event.transaction.hash, event.logIndex),
      operatorId: event.params.operatorId,
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
    });

    const dao = await context.DAOValues.get(low(event.srcAddress));
    if (!dao) return;
    const nextDao: DAOValues = {
      ...dao,
      updateType: "OPERATOR_REMOVED",
      operatorsRemoved: dao.operatorsRemoved + 1n,
      totalOperators: dao.totalOperators - 1n,
    };

    const operator = await context.Operator.get(event.params.operatorId.toString());
    if (operator) {
      const bn = BigInt(event.block.number);
      let next: Operator = {
        ...operator,
        operatorId: event.params.operatorId,
        removed: true,
      };
      if (usesEthFeeRegime(dao)) {
        next = {
          ...next,
          feeIndex:
            operator.feeIndex +
            (bn - operator.feeIndexBlockNumber) * operator.fee,
          feeIndexBlockNumber: bn,
        };
      }
      next = {
        ...next,
        fee: 0n,
        declaredFee: 0n,
        feeIndexSSV:
          next.feeIndexSSV +
          (bn - operator.feeIndexBlockNumberSSV) * operator.feeSSV,
        feeIndexBlockNumberSSV: bn,
        feeSSV: 0n,
        declaredSSVFee: 0n,
        validatorCount: 0n,
      };
      context.Operator.set({
        ...next,
        ...stamp(event.block.number, event.block.timestamp, event.transaction.hash),
      });
    }
    context.DAOValues.set(nextDao);
  },
);

indexer.onEvent(
  { contract: "SSVNetwork", event: "OperatorWhitelistUpdated" },
  async ({ event, context }) => {
    context.OperatorWhitelistUpdated.set({
      id: buildEventEntityId(event.transaction.hash, event.logIndex),
      operatorId: event.params.operatorId,
      whitelisted: low(event.params.whitelisted),
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
    });

    const wlAddr = low(event.params.whitelisted);
    let whitelisted = await context.Account.get(wlAddr);
    if (!whitelisted && wlAddr !== ZERO_ADDRESS) {
      whitelisted = newAccount(wlAddr);
      context.Account.set(whitelisted);
    }

    const operator = await context.Operator.get(event.params.operatorId.toString());
    if (!operator) return;

    let next: Operator = { ...operator, operatorId: event.params.operatorId };
    if (wlAddr === ZERO_ADDRESS) {
      next = { ...next, isPrivate: false, whitelisted: [] };
    } else if (whitelisted) {
      next = { ...next, isPrivate: true, whitelisted: [whitelisted.id] };
    }
    context.Operator.set({
      ...next,
      ...stamp(event.block.number, event.block.timestamp, event.transaction.hash),
    });
  },
);

indexer.onEvent(
  { contract: "SSVNetwork", event: "OperatorMultipleWhitelistUpdated" },
  async ({ event, context }) => {
    context.OperatorMultipleWhitelistUpdated.set({
      id: buildEventEntityId(event.transaction.hash, event.logIndex),
      operatorIds: [...event.params.operatorIds],
      whitelistAddresses: event.params.whitelistAddresses.map(low),
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
    });

    const whitelistIdList: string[] = [];
    for (const addr of event.params.whitelistAddresses) {
      const id = low(addr);
      let whitelisted = await context.Account.get(id);
      if (!whitelisted) {
        whitelisted = newAccount(id);
        context.Account.set(whitelisted);
      }
      whitelistIdList.push(whitelisted.id);
    }

    for (const opId of event.params.operatorIds) {
      const operator = await loadLoopOperatorOrLog(context, opId);
      if (!operator) continue;
      context.Operator.set({
        ...operator,
        operatorId: opId,
        whitelisted: (operator.whitelisted ?? []).concat(whitelistIdList),
        ...stamp(event.block.number, event.block.timestamp, event.transaction.hash),
      });
    }
  },
);

indexer.onEvent(
  { contract: "SSVNetwork", event: "OperatorMultipleWhitelistRemoved" },
  async ({ event, context }) => {
    context.OperatorMultipleWhitelistRemoved.set({
      id: buildEventEntityId(event.transaction.hash, event.logIndex),
      operatorIds: [...event.params.operatorIds],
      whitelistAddresses: event.params.whitelistAddresses.map(low),
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
    });

    const whitelistAddressSet: string[] = [];
    for (const addr of event.params.whitelistAddresses) {
      const id = low(addr);
      let whitelisted = await context.Account.get(id);
      if (!whitelisted) {
        whitelisted = newAccount(id);
        context.Account.set(whitelisted);
      }
      whitelistAddressSet.push(whitelisted.id);
    }

    for (const opId of event.params.operatorIds) {
      const operator = await loadLoopOperatorOrLog(context, opId);
      if (!operator) continue;
      const whitelistArray = [...(operator.whitelisted ?? [])];
      const indexesToRemove: number[] = [];
      for (let k = whitelistArray.length - 1; k >= 0; k--) {
        for (const wl of whitelistAddressSet) {
          if (wl === whitelistArray[k]) indexesToRemove.push(k);
        }
      }
      for (const idx of indexesToRemove) whitelistArray.splice(idx, 1);
      context.Operator.set({
        ...operator,
        operatorId: opId,
        whitelisted: whitelistArray,
        ...stamp(event.block.number, event.block.timestamp, event.transaction.hash),
      });
    }
  },
);

indexer.onEvent(
  { contract: "SSVNetwork", event: "OperatorWhitelistingContractUpdated" },
  async ({ event, context }) => {
    context.OperatorWhitelistingContractUpdated.set({
      id: buildEventEntityId(event.transaction.hash, event.logIndex),
      operatorIds: [...event.params.operatorIds],
      whitelistingContract: low(event.params.whitelistingContract),
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
    });

    for (const opId of event.params.operatorIds) {
      const operator = await loadLoopOperatorOrLog(context, opId);
      if (!operator) continue;
      context.Operator.set({
        ...operator,
        operatorId: opId,
        whitelistedContract: low(event.params.whitelistingContract),
        ...stamp(event.block.number, event.block.timestamp, event.transaction.hash),
      });
    }
  },
);

indexer.onEvent(
  { contract: "SSVNetwork", event: "OperatorPrivacyStatusUpdated" },
  async ({ event, context }) => {
    context.OperatorPrivacyStatusUpdated.set({
      id: buildEventEntityId(event.transaction.hash, event.logIndex),
      operatorIds: [...event.params.operatorIds],
      toPrivate: event.params.toPrivate,
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
    });

    for (const opId of event.params.operatorIds) {
      const operator = await loadLoopOperatorOrLog(context, opId);
      if (!operator) continue;
      context.Operator.set({
        ...operator,
        operatorId: opId,
        isPrivate: event.params.toPrivate,
        ...stamp(event.block.number, event.block.timestamp, event.transaction.hash),
      });
    }
  },
);

indexer.onEvent(
  { contract: "SSVNetwork", event: "OperatorWithdrawn" },
  async ({ event, context }) => {
    context.OperatorWithdrawn.set({
      id: buildEventEntityId(event.transaction.hash, event.logIndex),
      owner: low(event.params.owner),
      operatorId: event.params.operatorId,
      value: event.params.value,
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
    });

    const owner = await requireOwner(context, event.params.owner);
    if (!owner) return;

    const operator = await context.Operator.get(event.params.operatorId.toString());
    if (!operator) return;

    const dao = await context.DAOValues.get(low(event.srcAddress));
    if (!dao) return;

    const next: Operator = usesEthFeeRegime(dao)
      ? {
          ...operator,
          operatorId: event.params.operatorId,
          totalWithdrawn: operator.totalWithdrawn + event.params.value,
        }
      : {
          ...operator,
          operatorId: event.params.operatorId,
          totalWithdrawnSSV: operator.totalWithdrawnSSV + event.params.value,
        };
    context.Operator.set({
      ...next,
      ...stamp(event.block.number, event.block.timestamp, event.transaction.hash),
    });
  },
);

indexer.onEvent(
  { contract: "SSVNetwork", event: "OperatorWithdrawnSSV" },
  async ({ event, context }) => {
    context.OperatorWithdrawnSSV.set({
      id: buildEventEntityId(event.transaction.hash, event.logIndex),
      owner: low(event.params.owner),
      operatorId: event.params.operatorId,
      value: event.params.value,
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
    });

    const owner = await requireOwner(context, event.params.owner);
    if (!owner) return;

    const operator = await context.Operator.get(event.params.operatorId.toString());
    if (!operator) return;

    context.Operator.set({
      ...operator,
      operatorId: event.params.operatorId,
      totalWithdrawnSSV: operator.totalWithdrawnSSV + event.params.value,
      ...stamp(event.block.number, event.block.timestamp, event.transaction.hash),
    });
  },
);
