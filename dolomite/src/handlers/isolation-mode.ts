import { indexer } from "envio";

/**
 * IsolationModeVault.VaultCreated. The full subgraph re-points a vault User's
 * effectiveUser to the owner and maintains IsolationModeVaultReverseLookup so
 * that getEffectiveUserForAddress resolves vault->owner. That logic is DEFERRED
 * (see MIGRATION.md): on Arbitrum within the validation window the core flows
 * are exercised by EOAs, and the vault factory template is registered from
 * initializeToken (also deferred). This no-op keeps the declared template's
 * event handled so codegen/build succeed.
 */
indexer.onEvent({ contract: "IsolationModeVault", event: "VaultCreated" }, async ({ event, context }) => {
  void event;
  void context;
});
