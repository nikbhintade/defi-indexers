/**
 * Ported from src/utils/account/vault-position.ts and
 * src/utils/account/vault-position-update.ts.
 */
import type {
  Account,
  AccountVaultPosition,
  AccountVaultPositionUpdate,
  Transaction,
  Vault,
} from "envio";
import type { Env } from "./types";
import { BIGINT_ZERO } from "./constants";
import { buildVaultUpdateIdFromVaultAndTransaction } from "./vault-update-id";
import { vaultBalanceOf, vaultDecimals, vaultPricePerShare } from "../effects/contracts";

// ---------- ids ----------

export function buildId(account: Account, vault: Vault): string {
  return account.id + "-" + vault.id;
}

export function buildIdFromAccountVaultAndOrder(account: Account, vault: Vault, newOrder: bigint): string {
  return account.id + "-" + (vault.id + "-" + newOrder.toString());
}

function incrementOrder(order: bigint): bigint {
  return order + 1n;
}

// ---------- balance helpers ----------

export async function getBalancePosition(env: Env, account: Account, vaultAddress: string): Promise<bigint> {
  const ppsRaw = await vaultPricePerShare(env.ec, vaultAddress, env.block);
  const pricePerShare = ppsRaw === null ? BIGINT_ZERO : ppsRaw;
  const decRaw = await vaultDecimals(env.ec, vaultAddress);
  const decimals = decRaw === null ? 18n : BigInt(decRaw);
  const balRaw = await vaultBalanceOf(env.ec, vaultAddress, account.id, env.block);
  const balanceShares = balRaw === null ? BIGINT_ZERO : balRaw;
  const divisor = 10n ** decimals;
  return (balanceShares * pricePerShare) / divisor;
}

async function balanceOf(env: Env, account: Account, vaultAddress: string): Promise<bigint> {
  const balRaw = await vaultBalanceOf(env.ec, vaultAddress, account.id, env.block);
  return balRaw === null ? BIGINT_ZERO : balRaw;
}

function getBalanceTokens(current: bigint, withdraw: bigint): bigint {
  return withdraw > current ? BIGINT_ZERO : current - withdraw;
}

function getBalanceProfit(
  currentSharesBalance: bigint,
  currentProfit: bigint,
  currentAmount: bigint,
  withdrawAmount: bigint,
): bigint {
  if (currentSharesBalance === BIGINT_ZERO) {
    if (withdrawAmount > currentAmount) {
      return currentProfit + (withdrawAmount - currentAmount);
    } else {
      return currentProfit - (currentAmount - withdrawAmount);
    }
  }
  return currentProfit;
}

// ---------- update creation ----------

async function createAccountVaultPositionUpdate(
  env: Env,
  id: string,
  newOrder: bigint,
  account: Account,
  vault: Vault,
  accountVaultPositionId: string,
  transaction: Transaction,
  deposits: bigint,
  withdrawals: bigint,
  sharesMinted: bigint,
  sharesBurnt: bigint,
  sharesSent: bigint,
  sharesReceived: bigint,
  tokensSent: bigint,
  tokensReceived: bigint,
  balanceShares: bigint,
  balancePosition: bigint,
): Promise<AccountVaultPositionUpdate> {
  const update: AccountVaultPositionUpdate = {
    id,
    order: newOrder,
    account_id: account.id,
    accountVaultPosition_id: accountVaultPositionId,
    timestamp: transaction.timestamp,
    blockNumber: transaction.blockNumber,
    transaction_id: transaction.id,
    deposits,
    withdrawals,
    sharesMinted,
    sharesBurnt,
    sharesSent,
    sharesReceived,
    tokensSent,
    tokensReceived,
    balanceShares,
    balancePosition,
    vaultUpdate_id: buildVaultUpdateIdFromVaultAndTransaction(vault, transaction),
  };
  env.context.AccountVaultPositionUpdate.set(update);
  return update;
}

async function createFirst(
  env: Env,
  account: Account,
  vault: Vault,
  vaultPositionId: string,
  newOrder: bigint,
  transaction: Transaction,
  depositedTokens: bigint,
  receivedShares: bigint,
  balanceShares: bigint,
  balancePosition: bigint,
): Promise<AccountVaultPositionUpdate> {
  const id = buildIdFromAccountVaultAndOrder(account, vault, newOrder);
  const existing = await env.context.AccountVaultPositionUpdate.get(id);
  if (existing) return existing;
  return createAccountVaultPositionUpdate(
    env, id, newOrder, account, vault, vaultPositionId, transaction,
    depositedTokens, BIGINT_ZERO, receivedShares, BIGINT_ZERO,
    BIGINT_ZERO, BIGINT_ZERO, BIGINT_ZERO, BIGINT_ZERO, balanceShares, balancePosition,
  );
}

async function getNewOrder(env: Env, id: string | undefined): Promise<bigint> {
  if (id === undefined) return BIGINT_ZERO;
  const latest = await env.context.AccountVaultPositionUpdate.get(id);
  if (latest) return incrementOrder(latest.order);
  return BIGINT_ZERO;
}

async function depositUpdate(
  env: Env,
  account: Account,
  vault: Vault,
  vaultPositionId: string,
  latestUpdateId: string | undefined,
  transaction: Transaction,
  depositedTokens: bigint,
  receivedShares: bigint,
  balanceShares: bigint,
  balancePosition: bigint,
): Promise<AccountVaultPositionUpdate> {
  const newOrder = await getNewOrder(env, latestUpdateId);
  const id = buildIdFromAccountVaultAndOrder(account, vault, newOrder);
  const existing = await env.context.AccountVaultPositionUpdate.get(id);
  if (existing) return existing;
  return createAccountVaultPositionUpdate(
    env, id, newOrder, account, vault, vaultPositionId, transaction,
    depositedTokens, BIGINT_ZERO, receivedShares, BIGINT_ZERO,
    BIGINT_ZERO, BIGINT_ZERO, BIGINT_ZERO, BIGINT_ZERO, balanceShares, balancePosition,
  );
}

// ---------- position getOrCreate ----------

export async function getOrCreatePosition(
  env: Env,
  account: Account,
  vault: Vault,
  balanceShares: bigint,
  balanceTokens: bigint,
  balancePosition: bigint,
  balanceProfit: bigint,
  latestUpdateId: string,
  transaction: Transaction,
): Promise<AccountVaultPosition> {
  const id = buildId(account, vault);
  const existing = await env.context.AccountVaultPosition.get(id);
  if (existing) return existing;
  const position: AccountVaultPosition = {
    id,
    vault_id: vault.id,
    account_id: account.id,
    token_id: vault.token_id,
    shareToken_id: vault.shareToken_id,
    transaction_id: transaction.id,
    balanceTokens,
    balanceShares,
    balancePosition,
    balanceProfit,
    latestUpdate_id: latestUpdateId,
  };
  env.context.AccountVaultPosition.set(position);
  return position;
}

// ---------- deposit / withdraw / transfer ----------

export async function deposit(
  env: Env,
  account: Account,
  vault: Vault,
  transaction: Transaction,
  depositedTokens: bigint,
  receivedShares: bigint,
): Promise<void> {
  const { context } = env;
  const vaultPositionId = buildId(account, vault);
  let position = await context.AccountVaultPosition.get(vaultPositionId);
  const balanceShares = await balanceOf(env, account, vault.id);
  const balancePosition = await getBalancePosition(env, account, vault.id);

  if (!position) {
    const update = await createFirst(
      env, account, vault, vaultPositionId, BIGINT_ZERO, transaction,
      depositedTokens, receivedShares, balanceShares, balancePosition,
    );
    const newPosition: AccountVaultPosition = {
      id: vaultPositionId,
      vault_id: vault.id,
      account_id: account.id,
      token_id: vault.token_id,
      shareToken_id: vault.shareToken_id,
      transaction_id: transaction.id,
      balanceTokens: depositedTokens,
      balanceShares,
      balanceProfit: BIGINT_ZERO,
      balancePosition,
      latestUpdate_id: update.id,
    };
    context.AccountVaultPosition.set(newPosition);
  } else {
    const update = await depositUpdate(
      env, account, vault, vaultPositionId, position.latestUpdate_id, transaction,
      depositedTokens, receivedShares, balanceShares, balancePosition,
    );
    context.AccountVaultPosition.set({
      ...position,
      balanceTokens: position.balanceTokens + depositedTokens,
      balanceShares,
      balancePosition,
      latestUpdate_id: update.id,
    });
  }
}

export async function withdraw(
  env: Env,
  position: AccountVaultPosition,
  withdrawnAmount: bigint,
  sharesBurnt: bigint,
  transaction: Transaction,
): Promise<AccountVaultPositionUpdate> {
  const { context } = env;
  const account = (await context.Account.getOrThrow(position.account_id));
  const vault = (await context.Vault.getOrThrow(position.vault_id));
  const balanceShares = await balanceOf(env, account, vault.id);
  const balancePosition = await getBalancePosition(env, account, vault.id);
  const newOrder = await getNewOrder(env, position.latestUpdate_id);
  const updateId = buildIdFromAccountVaultAndOrder(account, vault, newOrder);

  const update = await createAccountVaultPositionUpdate(
    env, updateId, newOrder, account, vault, position.id, transaction,
    BIGINT_ZERO, withdrawnAmount, BIGINT_ZERO, sharesBurnt,
    BIGINT_ZERO, BIGINT_ZERO, BIGINT_ZERO, BIGINT_ZERO, balanceShares, balancePosition,
  );

  const balanceTokens = getBalanceTokens(position.balanceTokens, withdrawnAmount);
  const balanceProfit = getBalanceProfit(balanceShares, position.balanceProfit, balanceTokens, withdrawnAmount);
  context.AccountVaultPosition.set({
    ...position,
    balanceShares,
    balanceTokens,
    balanceProfit,
    balancePosition,
    latestUpdate_id: update.id,
  });
  return update;
}

export async function withdrawZero(
  env: Env,
  account: Account,
  vault: Vault,
  transaction: Transaction,
): Promise<AccountVaultPositionUpdate> {
  const newOrder = BIGINT_ZERO;
  const updateId = buildIdFromAccountVaultAndOrder(account, vault, newOrder);
  const position = await getOrCreatePosition(
    env, account, vault, BIGINT_ZERO, BIGINT_ZERO, BIGINT_ZERO, BIGINT_ZERO, updateId, transaction,
  );
  return createAccountVaultPositionUpdate(
    env, updateId, newOrder, account, vault, position.id, transaction,
    BIGINT_ZERO, BIGINT_ZERO, BIGINT_ZERO, BIGINT_ZERO,
    BIGINT_ZERO, BIGINT_ZERO, BIGINT_ZERO, BIGINT_ZERO, BIGINT_ZERO, BIGINT_ZERO,
  );
}

async function transferForAccount(
  env: Env,
  account: Account,
  vault: Vault,
  receivingTransfer: boolean,
  tokenAmount: bigint,
  shareAmount: bigint,
  transaction: Transaction,
): Promise<void> {
  const { context } = env;
  const positionId = buildId(account, vault);
  let position = await context.AccountVaultPosition.get(positionId);
  const balanceShares = await balanceOf(env, account, vault.id);
  const balancePosition = await getBalancePosition(env, account, vault.id);

  let newOrder: bigint;
  if (!position) {
    newOrder = BIGINT_ZERO;
  } else {
    newOrder = await getNewOrder(env, position.latestUpdate_id);
  }
  const latestUpdateId = buildIdFromAccountVaultAndOrder(account, vault, newOrder);

  await createAccountVaultPositionUpdate(
    env, latestUpdateId, newOrder, account, vault, positionId, transaction,
    BIGINT_ZERO, BIGINT_ZERO, BIGINT_ZERO, BIGINT_ZERO,
    receivingTransfer ? BIGINT_ZERO : shareAmount,
    receivingTransfer ? shareAmount : BIGINT_ZERO,
    receivingTransfer ? BIGINT_ZERO : tokenAmount,
    receivingTransfer ? tokenAmount : BIGINT_ZERO,
    balanceShares, balancePosition,
  );

  if (!position) {
    await getOrCreatePosition(
      env, account, vault,
      receivingTransfer ? shareAmount : BIGINT_ZERO,
      receivingTransfer ? tokenAmount : BIGINT_ZERO,
      balancePosition, BIGINT_ZERO, latestUpdateId, transaction,
    );
  } else {
    const balanceTokens = getBalanceTokens(position.balanceTokens, tokenAmount);
    const balanceProfit = getBalanceProfit(balanceShares, position.balanceProfit, balanceTokens, tokenAmount);
    context.AccountVaultPosition.set({
      ...position,
      balanceTokens,
      balanceShares,
      balancePosition,
      balanceProfit,
      latestUpdate_id: latestUpdateId,
    });
  }
}

export async function transfer(
  env: Env,
  fromAccount: Account,
  toAccount: Account,
  vault: Vault,
  tokenAmount: bigint,
  shareAmount: bigint,
  transaction: Transaction,
): Promise<void> {
  await transferForAccount(env, fromAccount, vault, false, tokenAmount, shareAmount, transaction);
  await transferForAccount(env, toAccount, vault, true, tokenAmount, shareAmount, transaction);
}
