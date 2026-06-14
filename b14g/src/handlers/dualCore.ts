/**
 * Port of src/mappings/dualCore.ts — DualCoreToken (ERC20) Transfer handler.
 * Tracks per-user dualCORE balance and the DualCore Vault.totalStaked.
 */
import { indexer } from "envio";
import { ADDRESS_ZERO, DUAL_CORE_VAULT } from "../constants";
import { concatI32, low } from "../utils";
import { createUser, createUserActionCount, createVault } from "../services/helpers";

indexer.onEvent(
  { contract: "DualCoreToken", event: "Transfer" },
  async ({ event, context }) => {
    const id = concatI32(event.transaction.hash, event.logIndex);
    const from = low(event.params.from);
    const to = low(event.params.to);

    context.DualCoreTransfer.set({
      id,
      transaction: low(event.transaction.hash),
      timestamp: BigInt(event.block.timestamp),
      amount: event.params.value,
      from,
      to,
      logIndex: undefined,
    });

    let vault = await context.Vault.get(low(DUAL_CORE_VAULT));
    if (!vault) {
      vault = createVault(context, DUAL_CORE_VAULT);
    }
    let totalStaked = vault.totalStaked;

    if (from !== ADDRESS_ZERO) {
      let user = await context.User.get(from);
      if (!user) {
        user = await createUser(context, from, event.block.timestamp);
        createUserActionCount(context, from, low(DUAL_CORE_VAULT));
      }
      context.User.set({
        ...user,
        dualCoreBalance: user.dualCoreBalance - event.params.value,
      });
      totalStaked = totalStaked - event.params.value;
    }
    if (to !== ADDRESS_ZERO) {
      let user = await context.User.get(to);
      if (!user) {
        user = await createUser(context, to, event.block.timestamp);
        createUserActionCount(context, to, low(DUAL_CORE_VAULT));
      }
      context.User.set({
        ...user,
        dualCoreBalance: user.dualCoreBalance + event.params.value,
      });
      totalStaked = totalStaked + event.params.value;
    }
    context.Vault.set({ ...vault, totalStaked });
  },
);
