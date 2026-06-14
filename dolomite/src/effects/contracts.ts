/**
 * Typed wrappers over tryContractCall mirroring the subgraph's
 * Contract.bind(addr).try_X() usages. See the eth_call->effect table in
 * MIGRATION.md.
 */
import { type EffectCaller } from "envio";
import { tryContractCall } from "./calls.js";

type EC = EffectCaller | null;

// ---- ERC20 metadata (unpinned; immutable) ----
export const erc20Symbol = (ec: EC, token: string) =>
  tryContractCall<string>(ec, token, "function symbol() view returns (string)", "symbol", []);

export const erc20Name = (ec: EC, token: string) =>
  tryContractCall<string>(ec, token, "function name() view returns (string)", "name", []);

export const erc20Decimals = (ec: EC, token: string) =>
  tryContractCall<number>(ec, token, "function decimals() view returns (uint8)", "decimals", []);

// ---- DolomiteMargin reads ----
// getMarketPrice(marketId) -> Monetary.Price { value }. Block-pinned: oracle
// price is state-dependent. Returns null on revert (caller keeps old price).
export const getMarketPrice = (ec: EC, margin: string, marketId: bigint, block?: number) =>
  tryContractCall<{ value: bigint }>(
    ec,
    margin,
    "function getMarketPrice(uint256 marketId) view returns ((uint256 value))",
    "getMarketPrice",
    [marketId],
    block,
    "getMarketPrice",
  );

export const getNumMarkets = (ec: EC, margin: string, block?: number) =>
  tryContractCall<bigint>(ec, margin, "function getNumMarkets() view returns (uint256)", "getNumMarkets", [], block);

export const getMarginRatio = (ec: EC, margin: string, block?: number) =>
  tryContractCall<{ value: bigint }>(
    ec,
    margin,
    "function getMarginRatio() view returns ((uint256 value))",
    "getMarginRatio",
    [],
    block,
    "getMarginRatio",
  );

export const getLiquidationSpread = (ec: EC, margin: string, block?: number) =>
  tryContractCall<{ value: bigint }>(
    ec,
    margin,
    "function getLiquidationSpread() view returns ((uint256 value))",
    "getLiquidationSpread",
    [],
    block,
    "getLiquidationSpread",
  );

export const getEarningsRate = (ec: EC, margin: string, block?: number) =>
  tryContractCall<{ value: bigint }>(
    ec,
    margin,
    "function getEarningsRate() view returns ((uint256 value))",
    "getEarningsRate",
    [],
    block,
    "getEarningsRate",
  );

export const getMinBorrowedValue = (ec: EC, margin: string, block?: number) =>
  tryContractCall<{ value: bigint }>(
    ec,
    margin,
    "function getMinBorrowedValue() view returns ((uint256 value))",
    "getMinBorrowedValue",
    [],
    block,
    "getMinBorrowedValue",
  );

export const getAccountMaxNumberOfMarketsWithBalances = (ec: EC, margin: string, block?: number) =>
  tryContractCall<bigint>(
    ec,
    margin,
    "function getAccountMaxNumberOfMarketsWithBalances() view returns (uint256)",
    "getAccountMaxNumberOfMarketsWithBalances",
    [],
    block,
  );

// ---- Expiry ----
export const gExpiryRampTime = (ec: EC, expiry: string, block?: number) =>
  tryContractCall<bigint>(
    ec,
    expiry,
    "function g_expiryRampTime() view returns (uint256)",
    "g_expiryRampTime",
    [],
    block,
    "g_expiryRampTime",
  );

// ---- AMM pair ----
// balanceOf is block-pinned (LP balance changes over time).
export const pairBalanceOf = (ec: EC, pair: string, owner: string, block?: number) =>
  tryContractCall<bigint>(
    ec,
    pair,
    "function balanceOf(address owner) view returns (uint256)",
    "balanceOf",
    [owner],
    block,
    "balanceOf",
  );
