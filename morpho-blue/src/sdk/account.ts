/**
 * Ported from src/sdk/account.ts (AccountManager). getOrCreateAccount creates
 * the Account on first sight and bumps protocol.cumulativeUniqueUsers.
 */
import type { Account } from "envio";
import type { Context } from "../context";
import { INT_ONE, INT_ZERO } from "./constants";
import { getProtocol } from "../initializers/protocol";

export async function getOrCreateAccount(
  context: Context,
  address: string,
): Promise<Account> {
  const id = address.toLowerCase();
  const existing = await context.Account.get(id);
  if (existing) return existing;

  const account: Account = {
    id,
    positionCount: INT_ZERO,
    openPositionCount: INT_ZERO,
    closedPositionCount: INT_ZERO,
    depositCount: INT_ZERO,
    withdrawCount: INT_ZERO,
    borrowCount: INT_ZERO,
    repayCount: INT_ZERO,
    liquidateCount: INT_ZERO,
    liquidationCount: INT_ZERO,
    transferredCount: INT_ZERO,
    receivedCount: INT_ZERO,
    flashloanCount: INT_ZERO,
  };
  context.Account.set(account);

  const protocol = await getProtocol(context);
  context.LendingProtocol.set({
    ...protocol,
    cumulativeUniqueUsers: protocol.cumulativeUniqueUsers + INT_ONE,
  });
  return account;
}
