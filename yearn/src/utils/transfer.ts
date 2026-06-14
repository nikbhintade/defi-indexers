/** Ported from src/utils/transfer.ts. */
import type { Account, Token, Transaction, Transfer, Vault } from "envio";
import type { Env } from "./types";
import { usdcPrice } from "./oracle";
import * as tokenFeeLibrary from "./token-fees";

export function buildTransferId(fromAccount: Account, toAccount: Account, transaction: Transaction): string {
  return fromAccount.id + "-" + toAccount.id + "-" + transaction.id;
}

export async function getOrCreateTransfer(
  env: Env,
  fromAccount: Account,
  toAccount: Account,
  vault: Vault,
  wantToken: Token,
  equivalentWantTokenAmount: bigint,
  shareToken: Token,
  shareAmount: bigint,
  transaction: Transaction,
): Promise<Transfer> {
  const { context } = env;
  const id = buildTransferId(fromAccount, toAccount, transaction);

  const tokenAmountUsdc = await usdcPrice(env, shareToken, shareAmount);
  const isFeeToStrategy = await tokenFeeLibrary.isFeeToStrategy(context, vault, toAccount, shareAmount);
  const isFeeToTreasury = await tokenFeeLibrary.isFeeToTreasury(context, vault, toAccount, shareAmount);

  const existing = await context.Transfer.get(id);
  if (existing) return existing;

  const transfer: Transfer = {
    id,
    timestamp: transaction.timestamp,
    blockNumber: transaction.blockNumber,
    from_id: fromAccount.id,
    to_id: toAccount.id,
    vault_id: vault.id,
    tokenAmount: equivalentWantTokenAmount,
    tokenAmountUsdc,
    token_id: wantToken.id,
    shareToken_id: shareToken.id,
    shareAmount,
    transaction_id: transaction.id,
    isFeeToTreasury,
    isFeeToStrategy,
  };
  context.Transfer.set(transfer);
  return transfer;
}
