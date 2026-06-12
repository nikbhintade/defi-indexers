/**
 * Port of src/mappings/helpers.ts (entity helpers).
 *
 * Note on ids: the subgraph built AccountCTokenTransaction ids with
 * `event.logIndex`; envio's `event.logIndex` is the same absolute
 * (block-level) log index, so these ids match byte-for-byte.
 */
import type { Account, AccountCToken, EvmOnEventContext } from "envio";
import { zeroBD } from "../utils";

export function createAccountCToken(
  cTokenStatsID: string,
  symbol: string,
  account: string,
  marketID: string,
): AccountCToken {
  return {
    id: cTokenStatsID,
    symbol: symbol,
    market_id: marketID,
    account_id: account,
    accrualBlockNumber: 0n,
    cTokenBalance: zeroBD,
    totalUnderlyingSupplied: zeroBD,
    totalUnderlyingRedeemed: zeroBD,
    accountBorrowIndex: zeroBD,
    totalUnderlyingBorrowed: zeroBD,
    totalUnderlyingRepaid: zeroBD,
    storedBorrowBalance: zeroBD,
    enteredMarket: false,
  };
}

export function createAccount(context: EvmOnEventContext, accountID: string): Account {
  const account: Account = {
    id: accountID,
    countLiquidated: 0,
    countLiquidator: 0,
    hasBorrowed: false,
  };
  context.Account.set(account);
  return account;
}

/**
 * Returns the (unsaved) AccountCToken with accrualBlockNumber bumped; the
 * caller updates event-specific fields and calls context.AccountCToken.set.
 */
export async function updateCommonCTokenStats(
  context: EvmOnEventContext,
  marketID: string,
  marketSymbol: string,
  accountID: string,
  txHash: string,
  timestamp: bigint,
  blockNumber: bigint,
  logIndex: bigint,
): Promise<AccountCToken> {
  const cTokenStatsID = marketID.concat("-").concat(accountID);
  let cTokenStats = await context.AccountCToken.get(cTokenStatsID);
  if (cTokenStats == undefined) {
    cTokenStats = createAccountCToken(cTokenStatsID, marketSymbol, accountID, marketID);
  }
  await getOrCreateAccountCTokenTransaction(context, cTokenStatsID, txHash, timestamp, blockNumber, logIndex);
  return { ...cTokenStats, accrualBlockNumber: blockNumber };
}

export async function getOrCreateAccountCTokenTransaction(
  context: EvmOnEventContext,
  accountID: string,
  txHash: string,
  timestamp: bigint,
  block: bigint,
  logIndex: bigint,
): Promise<void> {
  const id = accountID
    .concat("-")
    .concat(txHash)
    .concat("-")
    .concat(logIndex.toString());
  const transaction = await context.AccountCTokenTransaction.get(id);
  if (transaction == undefined) {
    context.AccountCTokenTransaction.set({
      id: id,
      account_id: accountID,
      tx_hash: txHash,
      timestamp: timestamp,
      block: block,
      logIndex: logIndex,
    });
  }
}
