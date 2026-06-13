/**
 * Port of the in-scope subset of src/handlers/hubHandlers.ts.
 *
 * Most hubHandlers events drive cross-chain "in-progress" flags on entities
 * that live on the destination (spoke) chain (NotifyAssetPrice, NotifySharePrice,
 * UpdateRestriction, UpdateVault, UpdateContract, …). Those subsystems are
 * DEFERRED for this mainnet-only port (see MIGRATION.md). We keep the two events
 * that create/extend local entities: NotifyPool (PoolSpokeBlockchain) and
 * UpdateBalanceSheetManager (Account + PoolManager).
 */
import { indexer, type Account, type PoolManager } from "envio";
import { getCentrifugeId, createdFields, updatedFields, truncateToAddress } from "../helpers/common";
import * as id from "../helpers/ids";

indexer.onEvent({ contract: "Hub", event: "NotifyPool" }, async ({ event, context }) => {
  const { poolId, centrifugeId } = event.params;
  const destCentrifugeId = String(centrifugeId);
  const psbId = id.poolSpokeBlockchainId(poolId, destCentrifugeId);
  const existing = await context.PoolSpokeBlockchain.get(psbId);
  if (existing) return; // getOrInit: only created once (createdAt only, no updatedAt)
  context.PoolSpokeBlockchain.set({
    id: psbId,
    poolId,
    centrifugeId: destCentrifugeId,
    createdAt: createdFields(event).createdAt,
    createdAtBlock: createdFields(event).createdAtBlock,
    createdAtTxHash: createdFields(event).createdAtTxHash,
  });
});

indexer.onEvent(
  { contract: "Hub", event: "UpdateBalanceSheetManager" },
  async ({ event, context }) => {
    const { poolId, manager: managerRaw, canManage, centrifugeId } = event.params;
    const destCentrifugeId = String(centrifugeId);
    const manager = truncateToAddress(managerRaw);

    const aid = id.accountId(manager);
    if (!(await context.Account.get(aid))) {
      const acct: Account = { id: aid, address: aid, ...createdFields(event) };
      context.Account.set(acct);
    }

    const pmId = id.poolManagerId(manager, destCentrifugeId, poolId);
    const existing = await context.PoolManager.get(pmId);
    const base: PoolManager =
      existing ?? {
        id: pmId,
        address: manager,
        centrifugeId: destCentrifugeId,
        poolId,
        isHubManager: false,
        isBalancesheetManager: false,
        crosschainInProgress: undefined,
        ...createdFields(event),
      };
    context.PoolManager.set({
      ...base,
      crosschainInProgress: canManage ? "CanManage" : "CanNotManage",
      ...updatedFields(event),
    });
  },
);
