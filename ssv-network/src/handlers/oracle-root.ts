/** Ported from ssv-subgraph src/handlers/oracle-root.ts (commit e2f1aa0). */
import { indexer } from "envio";
import { buildEventEntityId, low, stamp } from "../helpers";

indexer.onEvent(
  { contract: "SSVNetwork", event: "RootCommitted" },
  async ({ event, context }) => {
    context.RootCommitted.set({
      id: buildEventEntityId(event.transaction.hash, event.logIndex),
      merkleRoot: low(event.params.merkleRoot),
      // subgraph sets sender = event.transaction.from
      sender: low(event.transaction.from ?? ""),
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
    });

    const dao = await context.DAOValues.get(low(event.srcAddress));
    if (!dao) return;
    context.DAOValues.set({
      ...dao,
      updateType: "ROOT_COMMITTED",
      latestMerkleRoot: low(event.params.merkleRoot),
      ...stamp(event.block.number, event.block.timestamp, event.transaction.hash),
    });
  },
);

indexer.onEvent(
  { contract: "SSVNetwork", event: "OracleReplaced" },
  async ({ event, context }) => {
    context.OracleReplaced.set({
      id: buildEventEntityId(event.transaction.hash, event.logIndex),
      oracleId: BigInt(event.params.oracleId),
      oldOracle: low(event.params.oldOracle),
      newOracle: low(event.params.newOracle),
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
    });

    const oracleId = event.params.oracleId.toString();
    let oracle = await context.Oracle.get(oracleId);
    if (!oracle) {
      oracle = {
        id: oracleId,
        oracleId: BigInt(event.params.oracleId),
        oracleAddress: "0x",
        ...stamp(event.block.number, event.block.timestamp, event.transaction.hash),
      };
    }
    context.Oracle.set({
      ...oracle,
      oracleAddress: low(event.params.newOracle),
    });
  },
);

indexer.onEvent(
  { contract: "SSVNetwork", event: "WeightedRootProposed" },
  async ({ event, context }) => {
    context.WeightedRootProposed.set({
      id: buildEventEntityId(event.transaction.hash, event.logIndex),
      merkleRoot: low(event.params.merkleRoot),
      accumulatedWeight: event.params.accumulatedWeight,
      quorum: event.params.quorum,
      oracleId: BigInt(event.params.oracleId),
      oracle: low(event.params.oracle),
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
    });
  },
);
