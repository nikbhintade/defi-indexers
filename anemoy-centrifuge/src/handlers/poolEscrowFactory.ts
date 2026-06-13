/**
 * Port of src/handlers/poolEscrowFactoryHandlers.ts. Escrow.upsert on
 * DeployPoolEscrow. (The escrow instance contract itself emits no in-scope
 * events, so no contract template is registered.)
 */
import { indexer } from "envio";
import { getCentrifugeId, createdFields, updatedFields } from "../helpers/common";
import * as id from "../helpers/ids";

indexer.onEvent(
  { contract: "PoolEscrowFactory", event: "DeployPoolEscrow" },
  async ({ event, context }) => {
    const centrifugeId = getCentrifugeId(event.chainId);
    const { poolId, escrow } = event.params;
    const eId = id.escrowId(escrow, centrifugeId);
    const existing = await context.Escrow.get(eId);
    context.Escrow.set({
      id: eId,
      address: id.lc(escrow),
      poolId,
      centrifugeId,
      ...(existing
        ? {
            createdAt: existing.createdAt,
            createdAtBlock: existing.createdAtBlock,
            createdAtTxHash: existing.createdAtTxHash,
            ...updatedFields(event),
          }
        : createdFields(event)),
    });
  },
);
