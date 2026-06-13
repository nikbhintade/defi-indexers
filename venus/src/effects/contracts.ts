/**
 * Typed wrappers around `tryContractCall` for every eth_call the original
 * subgraph performed (operations/*.ts, utilities/*.ts, mappings/*.ts). Each
 * wrapper documents the corresponding subgraph call. Address-returning
 * wrappers lowercase the result.
 *
 * Pinning policy (per CONVENTIONS.md): immutable metadata (comptroller,
 * underlying, name, symbol, decimals) is unpinned; state-dependent reads
 * (rates, balances, indices, reserves, oracle prices, XVS speeds/state) are
 * pinned to the event block.
 */
import type { EffectCaller } from "envio";
import { tryContractCall } from "./calls";

type EC = EffectCaller | null;

const lower = (a: string | null): string | null => (a === null ? null : a.toLowerCase());

// ---- VToken / vBep20 (abis/VBep20.json) ----

/** VToken.comptroller() — immutable, unpinned. */
export const vTokenComptroller = async (ec: EC, vToken: string) =>
  lower(
    await tryContractCall<string>(
      ec,
      vToken,
      "function comptroller() view returns (address)",
      "comptroller",
      [],
    ),
  );

/** VToken.underlying() — immutable, unpinned. */
export const vTokenUnderlying = async (ec: EC, vToken: string) =>
  lower(
    await tryContractCall<string>(
      ec,
      vToken,
      "function underlying() view returns (address)",
      "underlying",
      [],
    ),
  );

/** VToken.name() — immutable, unpinned. */
export const vTokenName = (ec: EC, vToken: string) =>
  tryContractCall<string>(ec, vToken, "function name() view returns (string)", "name", []);

/** VToken.symbol() — immutable, unpinned. */
export const vTokenSymbol = (ec: EC, vToken: string) =>
  tryContractCall<string>(ec, vToken, "function symbol() view returns (string)", "symbol", []);

/** VToken.decimals() — immutable, unpinned. */
export const vTokenDecimals = (ec: EC, vToken: string) =>
  tryContractCall<number>(ec, vToken, "function decimals() view returns (uint8)", "decimals", []);

/** VToken.try_interestRateModel() — pinned. */
export const vTokenInterestRateModel = async (ec: EC, vToken: string, block: number) =>
  lower(
    await tryContractCall<string>(
      ec,
      vToken,
      "function interestRateModel() view returns (address)",
      "interestRateModel",
      [],
      block,
    ),
  );

/** VToken.try_reserveFactorMantissa() — pinned. */
export const vTokenReserveFactorMantissa = (ec: EC, vToken: string, block: number) =>
  tryContractCall<bigint>(
    ec,
    vToken,
    "function reserveFactorMantissa() view returns (uint256)",
    "reserveFactorMantissa",
    [],
    block,
  );

/** VToken.accrualBlockNumber() — pinned. */
export const vTokenAccrualBlockNumber = (ec: EC, vToken: string, block: number) =>
  tryContractCall<bigint>(
    ec,
    vToken,
    "function accrualBlockNumber() view returns (uint256)",
    "accrualBlockNumber",
    [],
    block,
  );

/** VToken.try_borrowIndex() — pinned. */
export const vTokenBorrowIndex = (ec: EC, vToken: string, block: number) =>
  tryContractCall<bigint>(
    ec,
    vToken,
    "function borrowIndex() view returns (uint256)",
    "borrowIndex",
    [],
    block,
  );

/** VToken.getCash() — pinned. */
export const vTokenGetCash = (ec: EC, vToken: string, block: number) =>
  tryContractCall<bigint>(ec, vToken, "function getCash() view returns (uint256)", "getCash", [], block);

/** VToken.try_borrowRatePerBlock() — pinned. */
export const vTokenBorrowRatePerBlock = (ec: EC, vToken: string, block: number) =>
  tryContractCall<bigint>(
    ec,
    vToken,
    "function borrowRatePerBlock() view returns (uint256)",
    "borrowRatePerBlock",
    [],
    block,
  );

/** VToken.try_supplyRatePerBlock() — pinned. */
export const vTokenSupplyRatePerBlock = (ec: EC, vToken: string, block: number) =>
  tryContractCall<bigint>(
    ec,
    vToken,
    "function supplyRatePerBlock() view returns (uint256)",
    "supplyRatePerBlock",
    [],
    block,
  );

/** VToken.try_exchangeRateStored() — pinned. */
export const vTokenExchangeRateStored = (ec: EC, vToken: string, block: number) =>
  tryContractCall<bigint>(
    ec,
    vToken,
    "function exchangeRateStored() view returns (uint256)",
    "exchangeRateStored",
    [],
    block,
  );

/** VToken.totalReserves() — pinned. */
export const vTokenTotalReserves = (ec: EC, vToken: string, block: number) =>
  tryContractCall<bigint>(
    ec,
    vToken,
    "function totalReserves() view returns (uint256)",
    "totalReserves",
    [],
    block,
  );

// ---- Underlying BEP20 (abis/BEP20.json) ----

/** BEP20.name() — immutable, unpinned. */
export const bep20Name = (ec: EC, token: string) =>
  tryContractCall<string>(ec, token, "function name() view returns (string)", "name", []);

/** BEP20.symbol() — immutable, unpinned. */
export const bep20Symbol = (ec: EC, token: string) =>
  tryContractCall<string>(ec, token, "function symbol() view returns (string)", "symbol", []);

/** BEP20.decimals() — immutable, unpinned. */
export const bep20Decimals = (ec: EC, token: string) =>
  tryContractCall<number>(ec, token, "function decimals() view returns (uint8)", "decimals", []);

// ---- Comptroller (abis/Comptroller.json) ----

/** Comptroller.try_venusSupplySpeeds(vToken) — pinned. */
export const comptrollerVenusSupplySpeeds = (ec: EC, comptroller: string, vToken: string, block: number) =>
  tryContractCall<bigint>(
    ec,
    comptroller,
    "function venusSupplySpeeds(address) view returns (uint256)",
    "venusSupplySpeeds",
    [vToken],
    block,
  );

/** Comptroller.try_venusBorrowSpeeds(vToken) — pinned. */
export const comptrollerVenusBorrowSpeeds = (ec: EC, comptroller: string, vToken: string, block: number) =>
  tryContractCall<bigint>(
    ec,
    comptroller,
    "function venusBorrowSpeeds(address) view returns (uint256)",
    "venusBorrowSpeeds",
    [vToken],
    block,
  );

/** Comptroller.venusBorrowState(vToken) -> (uint224 index, uint32 block) — pinned. */
export const comptrollerVenusBorrowState = (ec: EC, comptroller: string, vToken: string, block: number) =>
  tryContractCall<readonly [bigint, bigint]>(
    ec,
    comptroller,
    "function venusBorrowState(address) view returns (uint224 index, uint32 block)",
    "venusBorrowState",
    [vToken],
    block,
  );

/** Comptroller.venusSupplyState(vToken) -> (uint224 index, uint32 block) — pinned. */
export const comptrollerVenusSupplyState = (ec: EC, comptroller: string, vToken: string, block: number) =>
  tryContractCall<readonly [bigint, bigint]>(
    ec,
    comptroller,
    "function venusSupplyState(address) view returns (uint224 index, uint32 block)",
    "venusSupplyState",
    [vToken],
    block,
  );

// ---- Price oracle (abis/ResilientOracle.json) ----

/** PriceOracle.try_getUnderlyingPrice(vToken) — pinned. */
export const oracleGetUnderlyingPrice = (ec: EC, oracle: string, vToken: string, block: number) =>
  tryContractCall<bigint>(
    ec,
    oracle,
    "function getUnderlyingPrice(address) view returns (uint256)",
    "getUnderlyingPrice",
    [vToken],
    block,
  );
