/**
 * Port of src/utils/tracking.ts (the 117-line core of the subgraph).
 *
 * Maintains:
 *   - TrackingActiveAccount, keyed by addressPrefix = first 19 bytes of the
 *     account. The EVC sub-account scheme shares the first 19 bytes across a
 *     main address and all its 256 sub-accounts, so one TrackingActiveAccount
 *     links every sub-account of an owner.
 *   - TrackingVaultBalance, keyed by account ++ vault, holding the live share
 *     balance and outstanding debt of that (account, vault) pair.
 *
 * Byte semantics (graph-ts parity):
 *   getAddressPrefix(account)      = Bytes.fromUint8Array(account.slice(0,19))
 *     -> "0x" + first 38 hex chars of the 20-byte (40-hex) lowercased address.
 *   trackingId = account.concat(vault)
 *     -> Bytes concat: lowercased account hex (with 0x) ++ vault hex (no 0x).
 *
 * eth_calls (balanceOf / try_debtOf on the vault, bound at the event address)
 * are ported to block-pinned Effects (src/effects/vault-calls.ts).
 */
import type { EvmOnEventContext, EffectCaller } from "envio";
import { vaultBalanceOf, vaultDebtOf } from "../effects/vault-calls";

const ADDRESS_PREFIX_HEX_LENGTH = 19 * 2; // 38 hex chars
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const low = (x: string) => x.toLowerCase();

/** first 19 bytes of the (20-byte) account address, lowercase 0x-hex. */
function getAddressPrefix(account: string): string {
  return "0x" + low(account).slice(2, 2 + ADDRESS_PREFIX_HEX_LENGTH);
}

/** Bytes.concat parity: account (with 0x) ++ vault (without 0x). */
function concatBytes(account: string, vault: string): string {
  return low(account) + low(vault).slice(2);
}

type Tracking = {
  context: EvmOnEventContext;
  effect: EffectCaller;
  account: string;
  vault: string;
  blockNumber: bigint;
  blockTimestamp: bigint;
  transactionHash: string;
  block: number;
};

/**
 * Tracks account activity in any Euler vault.
 * Uses try_debtOf() to handle vaults which don't have debt.
 */
export async function trackActions(t: Tracking): Promise<void> {
  const account = low(t.account);
  const vault = low(t.vault);

  // Skip zero address (mints/burns)
  if (account === ZERO_ADDRESS) {
    return;
  }

  const addressPrefix = getAddressPrefix(account);

  // Load or create the active-account entity (linked by addressPrefix).
  let entity = await t.context.TrackingActiveAccount.get(addressPrefix);
  if (entity == null) {
    entity = {
      id: addressPrefix,
      addressPrefix: addressPrefix,
      borrows: [],
      deposits: [],
      blockNumber: 0n,
      blockTimestamp: 0n,
      transactionHash: "0x",
    };
    t.context.TrackingActiveAccount.set(entity);
  }

  // Get balance (non-try in the source: a revert here would throw the handler).
  const balanceRes = await vaultBalanceOf(t.effect, vault, account, t.block);
  const balance = balanceRes ?? 0n;

  // Try to get debt; reverted => 0.
  const debtRes = await vaultDebtOf(t.effect, vault, account, t.block);
  const debt = debtRes ?? 0n;

  const hasDeposits = balance > 0n;
  const hasBorrows = debt > 0n;
  const trackingId = concatBytes(account, vault);

  // Load or create balance entity.
  let balanceEntity = await t.context.TrackingVaultBalance.get(trackingId);
  if (!balanceEntity) {
    balanceEntity = {
      id: trackingId,
      vault: "0x",
      addressPrefix: "0x",
      account: "0x",
      balance: 0n,
      debt: 0n,
      blockNumber: 0n,
      blockTimestamp: 0n,
      transactionHash: "0x",
    };
  }

  let deposits: string[] = entity.deposits.slice();
  let borrows: string[] = entity.borrows.slice();

  // Handle deposits list
  if (hasDeposits) {
    if (!deposits.includes(trackingId)) {
      deposits = deposits.concat([trackingId]);
    }
  } else if (balanceEntity.balance > 0n) {
    // Only remove if there was a previous deposit
    if (deposits.includes(trackingId)) {
      const index = deposits.indexOf(trackingId);
      deposits.splice(index, 1);
    }
  }

  // Handle borrows list
  if (hasBorrows) {
    if (!borrows.includes(trackingId)) {
      borrows = borrows.concat([trackingId]);
    }
  } else if (balanceEntity.debt > 0n) {
    // Only remove if there was previous debt
    if (borrows.includes(trackingId)) {
      const index = borrows.indexOf(trackingId);
      borrows.splice(index, 1);
    }
  }

  // Update tracking entity
  t.context.TrackingActiveAccount.set({
    ...entity,
    deposits,
    borrows,
    blockTimestamp: t.blockTimestamp,
    blockNumber: t.blockNumber,
    transactionHash: t.transactionHash,
  });

  // Update balance entity
  t.context.TrackingVaultBalance.set({
    ...balanceEntity,
    addressPrefix: addressPrefix,
    account: account,
    balance: balance,
    debt: debt,
    vault: vault,
    blockTimestamp: t.blockTimestamp,
    blockNumber: t.blockNumber,
    transactionHash: t.transactionHash,
  });
}
