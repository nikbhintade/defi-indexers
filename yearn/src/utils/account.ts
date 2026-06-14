/** Ported from src/utils/account/account.ts and src/utils/healthCheck.ts. */
import type { Account, HealthCheck, Registry, Transaction } from "envio";
import type { Ctx } from "./types";
import { low } from "./commons";

export async function getOrCreateAccount(context: Ctx, address: string): Promise<Account> {
  const id = low(address);
  const existing = await context.Account.get(id);
  if (existing) return existing;
  const account: Account = { id };
  context.Account.set(account);
  return account;
}

export async function getOrCreateHealthCheck(context: Ctx, address: string): Promise<HealthCheck> {
  const id = low(address);
  const existing = await context.HealthCheck.get(id);
  if (existing) return existing;
  const healthCheck: HealthCheck = { id };
  context.HealthCheck.set(healthCheck);
  return healthCheck;
}

export async function getOrCreateRegistry(
  context: Ctx,
  address: string,
  transaction: Transaction,
): Promise<Registry> {
  const id = low(address);
  const existing = await context.Registry.get(id);
  if (existing) return existing;
  const registry: Registry = {
    id,
    timestamp: transaction.timestamp,
    blockNumber: transaction.blockNumber,
    transaction_id: transaction.id,
  };
  context.Registry.set(registry);
  return registry;
}
