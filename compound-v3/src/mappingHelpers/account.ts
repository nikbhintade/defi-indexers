/**
 * Port of src/mappingHelpers/account.ts.
 */
import type { Account } from "envio";
import type { Ctx, Ev } from "../common/types";

export async function getOrCreateAccount(ctx: Ctx, address: string, event: Ev): Promise<Account> {
  let account = await ctx.Account.get(address);

  if (!account) {
    account = {
      id: address,
      creationBlockNumber: BigInt(event.block.number),
      address: address,
    };

    ctx.Account.set(account);
  }

  return account;
}
