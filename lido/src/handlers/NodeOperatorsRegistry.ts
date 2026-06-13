/** Ported from src/NodeOperatorsRegistry.ts. */
import { indexer } from "envio";
import type { NodeOperator } from "envio";
import { ZERO, ZERO_ADDRESS, low } from "../constants";
import type { HandlerContext } from "../helpers";

async function loadOperator(
  context: HandlerContext,
  id: string
): Promise<NodeOperator | undefined> {
  return context.NodeOperator.get(id);
}

function newOperator(id: string): NodeOperator {
  return {
    id,
    name: "",
    rewardAddress: ZERO_ADDRESS,
    stakingLimit: ZERO,
    active: true,
    totalStoppedValidators: ZERO,
    totalKeysTrimmed: ZERO,
    nonce: ZERO,
    block: ZERO,
    blockTime: ZERO,
    transactionHash: ZERO_ADDRESS,
    logIndex: ZERO,
  };
}

indexer.onEvent(
  { contract: "NodeOperatorsRegistry", event: "NodeOperatorAdded" },
  async ({ event, context }) => {
    const op = newOperator(event.params.id.toString());
    context.NodeOperator.set({
      ...op,
      name: event.params.name,
      rewardAddress: low(event.params.rewardAddress),
      stakingLimit: event.params.stakingLimit,
      active: true,
      block: BigInt(event.block.number),
      blockTime: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
      logIndex: BigInt(event.logIndex),
    });
  }
);

indexer.onEvent(
  { contract: "NodeOperatorsRegistry", event: "NodeOperatorActiveSet" },
  async ({ event, context }) => {
    const op = await loadOperator(context, event.params.id.toString());
    if (op) context.NodeOperator.set({ ...op, active: event.params.active });
  }
);

indexer.onEvent(
  { contract: "NodeOperatorsRegistry", event: "NodeOperatorNameSet" },
  async ({ event, context }) => {
    const op = await loadOperator(context, event.params.id.toString());
    if (op) context.NodeOperator.set({ ...op, name: event.params.name });
  }
);

indexer.onEvent(
  { contract: "NodeOperatorsRegistry", event: "NodeOperatorRewardAddressSet" },
  async ({ event, context }) => {
    const op = await loadOperator(context, event.params.id.toString());
    if (op)
      context.NodeOperator.set({
        ...op,
        rewardAddress: low(event.params.rewardAddress),
      });
  }
);

indexer.onEvent(
  { contract: "NodeOperatorsRegistry", event: "NodeOperatorTotalKeysTrimmed" },
  async ({ event, context }) => {
    const op = await loadOperator(context, event.params.id.toString());
    if (op)
      context.NodeOperator.set({
        ...op,
        totalKeysTrimmed: event.params.totalKeysTrimmed,
      });
  }
);

indexer.onEvent(
  { contract: "NodeOperatorsRegistry", event: "NodeOperatorStakingLimitSet" },
  async ({ event, context }) => {
    const op = await loadOperator(context, event.params.id.toString());
    if (op)
      context.NodeOperator.set({ ...op, stakingLimit: event.params.stakingLimit });
  }
);

indexer.onEvent(
  {
    contract: "NodeOperatorsRegistry",
    event: "NodeOperatorTotalStoppedValidatorsReported",
  },
  async ({ event, context }) => {
    const op = await loadOperator(context, event.params.id.toString());
    if (op)
      context.NodeOperator.set({
        ...op,
        totalStoppedValidators: event.params.totalStopped,
      });
  }
);

indexer.onEvent(
  { contract: "NodeOperatorsRegistry", event: "SigningKeyAdded" },
  async ({ event, context }) => {
    const op = await loadOperator(context, event.params.operatorId.toString());
    if (!op) return;
    context.NodeOperatorSigningKey.set({
      id: low(event.params.pubkey),
      operatorId: event.params.operatorId,
      operator_id: op.id,
      pubkey: low(event.params.pubkey),
      removed: false,
      block: BigInt(event.block.number),
      blockTime: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
      logIndex: BigInt(event.logIndex),
    });
  }
);

indexer.onEvent(
  { contract: "NodeOperatorsRegistry", event: "SigningKeyRemoved" },
  async ({ event, context }) => {
    const op = await loadOperator(context, event.params.operatorId.toString());
    if (!op) return;
    const id = low(event.params.pubkey);
    const existing = await context.NodeOperatorSigningKey.get(id);
    const base = existing ?? {
      id,
      operatorId: event.params.operatorId,
      operator_id: op.id,
      pubkey: low(event.params.pubkey),
      removed: false,
      block: ZERO,
      blockTime: ZERO,
      transactionHash: ZERO_ADDRESS,
      logIndex: ZERO,
    };
    context.NodeOperatorSigningKey.set({
      ...base,
      block: BigInt(event.block.number),
      blockTime: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
      logIndex: BigInt(event.logIndex),
      removed: true,
    });
  }
);

indexer.onEvent(
  { contract: "NodeOperatorsRegistry", event: "KeysOpIndexSet" },
  async ({ event, context }) => {
    context.NodeOperatorKeysOpIndex.set({
      id: `${low(event.transaction.hash)}-${event.logIndex}`,
      index: event.params.keysOpIndex,
    });
  }
);
