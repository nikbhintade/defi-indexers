/**
 * Ported from src/mappings/registryMappings.ts.
 *
 * NewRelease / NewVault / NewVault(v2) / NewExperimentalVault / VaultTagged
 * (Registry + RegistryV2 share the same contract entry "Registry"), plus
 * RegistryV3 NewVault.
 *
 * Vault template registration (VaultTemplate.create) happens in
 * src/handlers/registration.ts contractRegister handlers.
 */
import { indexer } from "envio";
import type { Env } from "../utils/types";
import { low } from "../utils/commons";
import { DO_CREATE_VAULT_TEMPLATE, REGISTRY_V3_VAULT_TYPE_LEGACY } from "../utils/constants";
import { getOrCreateRegistry } from "../utils/account";
import { getOrCreateTransactionFromEvent } from "../utils/transaction";
import * as vaultLibrary from "../utils/vault";

const mkEnv = (event: { block: { number: number } }, context: Env["context"], ec: Env["ec"]): Env => ({
  context,
  ec,
  block: event.block.number,
});

indexer.onEvent({ contract: "Registry", event: "NewRelease" }, async ({ event, context }) => {
  const env = mkEnv(event, context, context.effect);
  const registryAddress = low(event.srcAddress);
  const transaction = await getOrCreateTransactionFromEvent(context, event, "Registry-FirstNewReleaseEvent");
  await getOrCreateRegistry(context, registryAddress, transaction);
  await vaultLibrary.release(env, low(event.params.template), event.params.api_version, registryAddress, transaction);
});

indexer.onEvent({ contract: "Registry", event: "NewVault" }, async ({ event, context }) => {
  const env = mkEnv(event, context, context.effect);
  const registryAddress = low(event.srcAddress);
  const transaction = await getOrCreateTransactionFromEvent(context, event, "NewVaultEvent");
  const registry = await getOrCreateRegistry(context, registryAddress, transaction);
  await vaultLibrary.create(
    env, registry, transaction, low(event.params.vault), "Endorsed",
    event.params.api_version, DO_CREATE_VAULT_TEMPLATE, REGISTRY_V3_VAULT_TYPE_LEGACY,
  );
});

indexer.onEvent({ contract: "Registry", event: "NewVaultV2" }, async ({ event, context }) => {
  const env = mkEnv(event, context, context.effect);
  const registryAddress = low(event.srcAddress);
  const transaction = await getOrCreateTransactionFromEvent(context, event, "NewVaultEvent");
  const registry = await getOrCreateRegistry(context, registryAddress, transaction);
  await vaultLibrary.create(
    env, registry, transaction, low(event.params.vault), "Endorsed",
    event.params.apiVersion, DO_CREATE_VAULT_TEMPLATE, REGISTRY_V3_VAULT_TYPE_LEGACY,
  );
});

indexer.onEvent({ contract: "Registry", event: "NewExperimentalVault" }, async ({ event, context }) => {
  const env = mkEnv(event, context, context.effect);
  const registryAddress = low(event.srcAddress);
  const transaction = await getOrCreateTransactionFromEvent(context, event, "NewExperimentalVault");
  const registry = await getOrCreateRegistry(context, registryAddress, transaction);
  await vaultLibrary.create(
    env, registry, transaction, low(event.params.vault), "Experimental",
    event.params.api_version, DO_CREATE_VAULT_TEMPLATE, REGISTRY_V3_VAULT_TYPE_LEGACY,
  );
});

indexer.onEvent({ contract: "Registry", event: "VaultTagged" }, async ({ event, context }) => {
  const env = mkEnv(event, context, context.effect);
  await vaultLibrary.tag(env, low(event.params.vault), event.params.tag);
});

indexer.onEvent({ contract: "RegistryV3", event: "NewVaultV3" }, async ({ event, context }) => {
  const env = mkEnv(event, context, context.effect);
  const registryAddress = low(event.srcAddress);
  const transaction = await getOrCreateTransactionFromEvent(context, event, "NewVaultEvent");
  const registry = await getOrCreateRegistry(context, registryAddress, transaction);
  await vaultLibrary.create(
    env, registry, transaction, low(event.params.vault), "Endorsed",
    event.params.apiVersion, DO_CREATE_VAULT_TEMPLATE, event.params.vaultType,
  );
});
