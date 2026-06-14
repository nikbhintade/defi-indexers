/**
 * Port of src/utils/vault.ts.
 * Writes the immutable Vault entity (id = vault address, factory = creator).
 */
import type { EvmOnEventContext } from "envio";

const low = (x: string) => x.toLowerCase();

export function registerVault(
  context: EvmOnEventContext,
  vaultAddress: string,
  factoryAddress: string,
): void {
  context.Vault.set({
    id: low(vaultAddress),
    factory: low(factoryAddress),
  });
}
