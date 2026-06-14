/**
 * Typed wrappers for the two eth_calls the original tracking.ts performs on the
 * EulerVault contract bound at the event address. Both are state-dependent
 * (live share balance / outstanding debt), so they are pinned to the event
 * block.
 *
 * Source (src/utils/tracking.ts):
 *   let balance = vaultContract.balanceOf(account)        // non-try
 *   let debtResult = vaultContract.try_debtOf(account)    // try, default 0
 */
import type { EffectCaller } from "envio";
import { tryContractCall } from "./calls";

type EC = EffectCaller | null;

/** EulerVault.balanceOf(account) — pinned. Returns null on revert. */
export const vaultBalanceOf = (ec: EC, vault: string, account: string, block: number) =>
  tryContractCall<bigint>(
    ec,
    vault,
    "function balanceOf(address account) view returns (uint256)",
    "balanceOf",
    [account],
    block,
  );

/** EulerVault.debtOf(account) — pinned. Returns null on revert (=> debt 0). */
export const vaultDebtOf = (ec: EC, vault: string, account: string, block: number) =>
  tryContractCall<bigint>(
    ec,
    vault,
    "function debtOf(address account) view returns (uint256)",
    "debtOf",
    [account],
    block,
  );
