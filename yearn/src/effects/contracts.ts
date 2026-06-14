/**
 * Typed wrappers around `tryContractCall` for every eth_call the original
 * Yearn V2 subgraph performed. Each wrapper documents the corresponding
 * subgraph call and whether it was a try_ call (nullable) or a hard call.
 *
 * Pinning policy (per CONVENTIONS.md):
 *   - immutable metadata (token, decimals, name, symbol, apiVersion,
 *     activation, vault) -> unpinned;
 *   - state-dependent reads (totalAssets, pricePerShare, totalSupply,
 *     balanceOf, availableDepositLimit, delegatedAssets, oracle prices,
 *     management/guardian/governance/rewards/emergencyShutdown/depositLimit
 *     read at vault creation) -> pinned to the event block.
 *
 * Hard (non-try_) subgraph calls are still wrapped as nullable here; callers
 * substitute the documented fallback (mirrors graph-node, which would have
 * aborted the handler — for valid vaults these never revert).
 */
import type { EffectCaller } from "envio";
import { tryContractCall } from "./calls";

type EC = EffectCaller | null;
const lower = async (p: Promise<string | null>): Promise<string | null> => {
  const a = await p;
  return a === null ? null : a.toLowerCase();
};

// ---------------- Vault (abis/Vault.json) ----------------

/** Vault.token() — immutable, unpinned. (hard call) */
export const vaultToken = (ec: EC, vault: string) =>
  lower(tryContractCall<string>(ec, vault, "function token() view returns (address)", "token", []));

/** Vault.decimals() — unpinned. (hard call) */
export const vaultDecimals = (ec: EC, vault: string) =>
  tryContractCall<bigint>(ec, vault, "function decimals() view returns (uint256)", "decimals", []);

/** Vault.apiVersion() — unpinned. (hard call) */
export const vaultApiVersion = (ec: EC, vault: string) =>
  tryContractCall<string>(ec, vault, "function apiVersion() view returns (string)", "apiVersion", []);

/** Vault.activation() — unpinned. (hard call) */
export const vaultActivation = (ec: EC, vault: string) =>
  tryContractCall<bigint>(ec, vault, "function activation() view returns (uint256)", "activation", []);

/** Vault.managementFee() — pinned. (hard call) */
export const vaultManagementFee = (ec: EC, vault: string, block: number) =>
  tryContractCall<bigint>(ec, vault, "function managementFee() view returns (uint256)", "managementFee", [], block);

/** Vault.performanceFee() — pinned. (hard call) */
export const vaultPerformanceFee = (ec: EC, vault: string, block: number) =>
  tryContractCall<bigint>(ec, vault, "function performanceFee() view returns (uint256)", "performanceFee", [], block);

/** Vault.try_rewards() — pinned. */
export const vaultRewards = (ec: EC, vault: string, block: number) =>
  lower(tryContractCall<string>(ec, vault, "function rewards() view returns (address)", "rewards", [], block));

/** Vault.try_management() — pinned. */
export const vaultManagement = (ec: EC, vault: string, block: number) =>
  lower(tryContractCall<string>(ec, vault, "function management() view returns (address)", "management", [], block));

/** Vault.try_guardian() — pinned. */
export const vaultGuardian = (ec: EC, vault: string, block: number) =>
  lower(tryContractCall<string>(ec, vault, "function guardian() view returns (address)", "guardian", [], block));

/** Vault.try_governance() — pinned. */
export const vaultGovernance = (ec: EC, vault: string, block: number) =>
  lower(tryContractCall<string>(ec, vault, "function governance() view returns (address)", "governance", [], block));

/** Vault.try_depositLimit() — pinned. */
export const vaultDepositLimit = (ec: EC, vault: string, block: number) =>
  tryContractCall<bigint>(ec, vault, "function depositLimit() view returns (uint256)", "depositLimit", [], block);

/** Vault.try_emergencyShutdown() — pinned. */
export const vaultEmergencyShutdown = (ec: EC, vault: string, block: number) =>
  tryContractCall<boolean>(ec, vault, "function emergencyShutdown() view returns (bool)", "emergencyShutdown", [], block);

/** Vault.try_totalAssets() — pinned. */
export const vaultTotalAssets = (ec: EC, vault: string, block: number) =>
  tryContractCall<bigint>(ec, vault, "function totalAssets() view returns (uint256)", "totalAssets", [], block);

/** Vault.try_pricePerShare() / pricePerShare() — pinned. */
export const vaultPricePerShare = (ec: EC, vault: string, block: number) =>
  tryContractCall<bigint>(ec, vault, "function pricePerShare() view returns (uint256)", "pricePerShare", [], block);

/** Vault.totalSupply() — pinned. (hard call) */
export const vaultTotalSupply = (ec: EC, vault: string, block: number) =>
  tryContractCall<bigint>(ec, vault, "function totalSupply() view returns (uint256)", "totalSupply", [], block);

/** Vault.balanceOf(account) — pinned. (hard call) */
export const vaultBalanceOf = (ec: EC, vault: string, account: string, block: number) =>
  tryContractCall<bigint>(ec, vault, "function balanceOf(address) view returns (uint256)", "balanceOf", [account], block);

/** Vault.try_availableDepositLimit() — pinned. */
export const vaultAvailableDepositLimit = (ec: EC, vault: string, block: number) =>
  tryContractCall<bigint>(
    ec,
    vault,
    "function availableDepositLimit() view returns (uint256)",
    "availableDepositLimit",
    [],
    block,
  );

// ---------------- ERC20 (abis/ERC20Detailed.json) ----------------

/** ERC20.try_decimals() — unpinned. */
export const erc20Decimals = (ec: EC, token: string) =>
  tryContractCall<number>(ec, token, "function decimals() view returns (uint8)", "decimals", []);

/** ERC20.try_name() — unpinned. */
export const erc20Name = (ec: EC, token: string) =>
  tryContractCall<string>(ec, token, "function name() view returns (string)", "name", []);

/** ERC20.try_symbol() — unpinned. */
export const erc20Symbol = (ec: EC, token: string) =>
  tryContractCall<string>(ec, token, "function symbol() view returns (string)", "symbol", []);

// ---------------- Strategy (abis/StrategyAPI.json) ----------------

/** Strategy.try_name() — unpinned. */
export const strategyName = (ec: EC, strategy: string) =>
  tryContractCall<string>(ec, strategy, "function name() view returns (string)", "name", []);

/** Strategy.try_apiVersion() — unpinned. */
export const strategyApiVersion = (ec: EC, strategy: string) =>
  tryContractCall<string>(ec, strategy, "function apiVersion() view returns (string)", "apiVersion", []);

/** Strategy.try_keeper() — pinned. */
export const strategyKeeper = (ec: EC, strategy: string, block: number) =>
  lower(tryContractCall<string>(ec, strategy, "function keeper() view returns (address)", "keeper", [], block));

/** Strategy.try_strategist() — pinned. */
export const strategyStrategist = (ec: EC, strategy: string, block: number) =>
  lower(tryContractCall<string>(ec, strategy, "function strategist() view returns (address)", "strategist", [], block));

/** Strategy.try_rewards() — pinned. */
export const strategyRewards = (ec: EC, strategy: string, block: number) =>
  lower(tryContractCall<string>(ec, strategy, "function rewards() view returns (address)", "rewards", [], block));

/** Strategy.try_emergencyExit() — pinned. */
export const strategyEmergencyExit = (ec: EC, strategy: string, block: number) =>
  tryContractCall<boolean>(ec, strategy, "function emergencyExit() view returns (bool)", "emergencyExit", [], block);

/** Strategy.try_healthCheck() — pinned. */
export const strategyHealthCheck = (ec: EC, strategy: string, block: number) =>
  lower(tryContractCall<string>(ec, strategy, "function healthCheck() view returns (address)", "healthCheck", [], block));

/** Strategy.try_doHealthCheck() — pinned. */
export const strategyDoHealthCheck = (ec: EC, strategy: string, block: number) =>
  tryContractCall<boolean>(ec, strategy, "function doHealthCheck() view returns (bool)", "doHealthCheck", [], block);

/** Strategy.delegatedAssets() — pinned. (hard call) */
export const strategyDelegatedAssets = (ec: EC, strategy: string, block: number) =>
  tryContractCall<bigint>(ec, strategy, "function delegatedAssets() view returns (uint256)", "delegatedAssets", [], block);

/** Strategy.vault() — unpinned. (hard call) */
export const strategyVault = (ec: EC, strategy: string) =>
  lower(tryContractCall<string>(ec, strategy, "function vault() view returns (address)", "vault", []));

// ---------------- Oracle (abis/Oracle.json) — yearn-lens USDC oracle ----------------

/** Oracle.try_getPriceUsdcRecommended(token) — pinned. */
export const oracleGetPriceUsdcRecommended = (ec: EC, oracle: string, token: string, block: number) =>
  tryContractCall<bigint>(
    ec,
    oracle,
    "function getPriceUsdcRecommended(address) view returns (uint256)",
    "getPriceUsdcRecommended",
    [token],
    block,
  );

/** Oracle.try_getNormalizedValueUsdc(token, amount) — pinned. */
export const oracleGetNormalizedValueUsdc = (ec: EC, oracle: string, token: string, amount: bigint, block: number) =>
  tryContractCall<bigint>(
    ec,
    oracle,
    "function getNormalizedValueUsdc(address,uint256) view returns (uint256)",
    "getNormalizedValueUsdc",
    [token, amount],
    block,
  );
