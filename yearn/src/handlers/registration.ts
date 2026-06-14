/**
 * Dynamic contract registration — the envio equivalent of the subgraph's
 * `templates` + `VaultTemplate.create()` / `StrategyTemplate.create()`.
 *
 *  - Registry/RegistryV3 NewVault / NewExperimentalVault / NewRelease ->
 *    register a Vault template instance (the vault address from the event).
 *  - Vault StrategyAdded(V1/V2) / StrategyMigrated -> register a Strategy
 *    template instance (so Harvested/Cloned/etc. are indexed).
 *  - Strategy Cloned -> register the cloned strategy.
 *
 * Registrations are deduplicated by envio, so re-running is safe.
 */
import { indexer } from "envio";

const asAddr = (a: string): `0x${string}` => a.toLowerCase() as `0x${string}`;

// ---- Vault template registration (from registries) ----

indexer.contractRegister({ contract: "Registry", event: "NewVault" }, async ({ event, context }) => {
  context.chain.Vault.add(asAddr(event.params.vault));
});

indexer.contractRegister({ contract: "Registry", event: "NewVaultV2" }, async ({ event, context }) => {
  context.chain.Vault.add(asAddr(event.params.vault));
});

indexer.contractRegister({ contract: "Registry", event: "NewExperimentalVault" }, async ({ event, context }) => {
  context.chain.Vault.add(asAddr(event.params.vault));
});

indexer.contractRegister({ contract: "Registry", event: "NewRelease" }, async ({ event, context }) => {
  // NewRelease registers the release template vault (vaultLibrary.release).
  context.chain.Vault.add(asAddr(event.params.template));
});

indexer.contractRegister({ contract: "RegistryV3", event: "NewVaultV3" }, async ({ event, context }) => {
  context.chain.Vault.add(asAddr(event.params.vault));
});

// ---- Strategy template registration (from vaults) ----

indexer.contractRegister({ contract: "Vault", event: "StrategyAddedV1" }, async ({ event, context }) => {
  context.chain.Strategy.add(asAddr(event.params.strategy));
});

indexer.contractRegister({ contract: "Vault", event: "StrategyAddedV2" }, async ({ event, context }) => {
  context.chain.Strategy.add(asAddr(event.params.strategy));
});

indexer.contractRegister({ contract: "Vault", event: "StrategyMigrated" }, async ({ event, context }) => {
  context.chain.Strategy.add(asAddr(event.params.newVersion));
});

indexer.contractRegister({ contract: "Strategy", event: "Cloned" }, async ({ event, context }) => {
  context.chain.Strategy.add(asAddr(event.params.clone));
});
