/**
 * Typed wrappers around `tryContractCall` for every eth_call the original
 * subgraph performed (markets.ts). Each wrapper documents the corresponding
 * subgraph call. Address-returning wrappers lowercase the result.
 *
 * Pinning policy (per CONVENTIONS.md): immutable metadata (underlying, name,
 * symbol, decimals) is unpinned; state-dependent reads (rates, balances,
 * indices, oracle prices) are pinned to the event block.
 */
import type { EffectCaller } from "envio";
import { tryContractCall } from "./calls";

type EC = EffectCaller | null;

const lower = (a: string | null): string | null => (a === null ? null : a.toLowerCase());

// ---- CToken (abis/ctoken.json) ----

/** CToken.underlying() — immutable, unpinned. */
export const cTokenUnderlying = async (ec: EC, cToken: string) =>
  lower(await tryContractCall<string>(ec, cToken, "function underlying() view returns (address)", "underlying", []));

/** CToken.name() — immutable, unpinned. */
export const cTokenName = (ec: EC, cToken: string) =>
  tryContractCall<string>(ec, cToken, "function name() view returns (string)", "name", []);

/** CToken.symbol() — immutable, unpinned. */
export const cTokenSymbol = (ec: EC, cToken: string) =>
  tryContractCall<string>(ec, cToken, "function symbol() view returns (string)", "symbol", []);

/** CToken.try_interestRateModel() — state-dependent, pinned. */
export const cTokenInterestRateModel = async (ec: EC, cToken: string, block: number) =>
  lower(
    await tryContractCall<string>(
      ec,
      cToken,
      "function interestRateModel() view returns (address)",
      "interestRateModel",
      [],
      block,
    ),
  );

/** CToken.try_reserveFactorMantissa() — state-dependent, pinned. */
export const cTokenReserveFactorMantissa = (ec: EC, cToken: string, block: number) =>
  tryContractCall<bigint>(
    ec,
    cToken,
    "function reserveFactorMantissa() view returns (uint256)",
    "reserveFactorMantissa",
    [],
    block,
  );

/** CToken.accrualBlockNumber() — pinned. */
export const cTokenAccrualBlockNumber = (ec: EC, cToken: string, block: number) =>
  tryContractCall<bigint>(
    ec,
    cToken,
    "function accrualBlockNumber() view returns (uint256)",
    "accrualBlockNumber",
    [],
    block,
  );

/** CToken.totalSupply() — pinned. */
export const cTokenTotalSupply = (ec: EC, cToken: string, block: number) =>
  tryContractCall<bigint>(ec, cToken, "function totalSupply() view returns (uint256)", "totalSupply", [], block);

/** CToken.exchangeRateStored() — pinned. */
export const cTokenExchangeRateStored = (ec: EC, cToken: string, block: number) =>
  tryContractCall<bigint>(
    ec,
    cToken,
    "function exchangeRateStored() view returns (uint256)",
    "exchangeRateStored",
    [],
    block,
  );

/** CToken.borrowIndex() — pinned. */
export const cTokenBorrowIndex = (ec: EC, cToken: string, block: number) =>
  tryContractCall<bigint>(ec, cToken, "function borrowIndex() view returns (uint256)", "borrowIndex", [], block);

/** CToken.totalReserves() — pinned. */
export const cTokenTotalReserves = (ec: EC, cToken: string, block: number) =>
  tryContractCall<bigint>(ec, cToken, "function totalReserves() view returns (uint256)", "totalReserves", [], block);

/** CToken.totalBorrows() — pinned. */
export const cTokenTotalBorrows = (ec: EC, cToken: string, block: number) =>
  tryContractCall<bigint>(ec, cToken, "function totalBorrows() view returns (uint256)", "totalBorrows", [], block);

/** CToken.getCash() — pinned. */
export const cTokenGetCash = (ec: EC, cToken: string, block: number) =>
  tryContractCall<bigint>(ec, cToken, "function getCash() view returns (uint256)", "getCash", [], block);

/** CToken.borrowRatePerBlock() — pinned. */
export const cTokenBorrowRatePerBlock = (ec: EC, cToken: string, block: number) =>
  tryContractCall<bigint>(
    ec,
    cToken,
    "function borrowRatePerBlock() view returns (uint256)",
    "borrowRatePerBlock",
    [],
    block,
  );

/** CToken.try_supplyRatePerBlock() — pinned. */
export const cTokenSupplyRatePerBlock = (ec: EC, cToken: string, block: number) =>
  tryContractCall<bigint>(
    ec,
    cToken,
    "function supplyRatePerBlock() view returns (uint256)",
    "supplyRatePerBlock",
    [],
    block,
  );

// ---- Underlying ERC20 (abis/erc20.json) ----

/** ERC20.decimals() — immutable, unpinned. */
export const erc20Decimals = (ec: EC, token: string) =>
  tryContractCall<number>(ec, token, "function decimals() view returns (uint8)", "decimals", []);

/** ERC20.name() — immutable, unpinned. */
export const erc20Name = (ec: EC, token: string) =>
  tryContractCall<string>(ec, token, "function name() view returns (string)", "name", []);

/** ERC20.symbol() — immutable, unpinned. */
export const erc20Symbol = (ec: EC, token: string) =>
  tryContractCall<string>(ec, token, "function symbol() view returns (string)", "symbol", []);

// ---- Price oracles ----

/** PriceOracle.getPrice(token) — used before/at block 7715908, pinned. */
export const oracle1GetPrice = (ec: EC, oracle: string, token: string, block: number) =>
  tryContractCall<bigint>(ec, oracle, "function getPrice(address asset) view returns (uint256)", "getPrice", [token], block);

/** PriceOracle2.try_getUnderlyingPrice(cToken) — used after block 7715908, pinned. */
export const oracle2GetUnderlyingPrice = (ec: EC, oracle: string, cToken: string, block: number) =>
  tryContractCall<bigint>(
    ec,
    oracle,
    "function getUnderlyingPrice(address cToken) view returns (uint256)",
    "getUnderlyingPrice",
    [cToken],
    block,
  );
