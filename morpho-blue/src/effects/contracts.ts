/**
 * Typed wrappers around `tryContractCall` for every eth_call the original
 * subgraph performed (token.ts metadata, manager.ts IRM.borrowRateView,
 * fetchUsdTokenPrice.ts chainlink/WstEth/REth/ERC4626 calls).
 *
 * Pinning policy (CONVENTIONS.md): immutable metadata (name/symbol/decimals)
 * is unpinned; state-dependent reads (oracle prices, rates, exchange rates)
 * are pinned to the event block.
 */
import type { EffectCaller } from "envio";
import { tryContractCall } from "./calls";

type EC = EffectCaller | null;

// ---- ERC20 metadata (token.ts), with bytes32 fallbacks ----

/** ERC20.try_symbol() (string) — immutable, unpinned. */
export const erc20Symbol = (ec: EC, token: string) =>
  tryContractCall<string>(
    ec,
    token,
    "function symbol() view returns (string)",
    "symbol",
    [],
  );

/** ERC20SymbolBytes.try_symbol() (bytes32) fallback — immutable, unpinned. */
export const erc20SymbolBytes = (ec: EC, token: string) =>
  tryContractCall<string>(
    ec,
    token,
    "function symbol() view returns (bytes32)",
    "symbol",
    [],
  );

/** ERC20.try_name() (string) — immutable, unpinned. */
export const erc20Name = (ec: EC, token: string) =>
  tryContractCall<string>(
    ec,
    token,
    "function name() view returns (string)",
    "name",
    [],
  );

/** ERC20NameBytes.try_name() (bytes32) fallback — immutable, unpinned. */
export const erc20NameBytes = (ec: EC, token: string) =>
  tryContractCall<string>(
    ec,
    token,
    "function name() view returns (bytes32)",
    "name",
    [],
  );

/** ERC20.try_decimals() (uint8) — immutable, unpinned. */
export const erc20Decimals = (ec: EC, token: string) =>
  tryContractCall<number>(
    ec,
    token,
    "function decimals() view returns (uint8)",
    "decimals",
    [],
  );

// ---- IRM.borrowRateView (manager.ts) — state-dependent, pinned ----

export type IrmMarketParams = {
  loanToken: string;
  collateralToken: string;
  oracle: string;
  irm: string;
  lltv: bigint;
};
export type IrmMarketState = {
  totalSupplyAssets: bigint;
  totalSupplyShares: bigint;
  totalBorrowAssets: bigint;
  totalBorrowShares: bigint;
  lastUpdate: bigint;
  fee: bigint;
};

const IRM_BORROW_RATE_VIEW_SIG =
  "function borrowRateView((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee) market) view returns (uint256)";

export const irmBorrowRateView = (
  ec: EC,
  irm: string,
  marketParams: IrmMarketParams,
  market: IrmMarketState,
  block: number,
) =>
  tryContractCall<bigint>(
    ec,
    irm,
    IRM_BORROW_RATE_VIEW_SIG,
    "borrowRateView",
    [marketParams, market],
    block,
  );

// ---- Chainlink price feed (fetchUsdTokenPrice.ts) — pinned ----

/** ChainlinkPriceFeed.latestRoundData() -> returns [roundId, answer, ...]. */
export const chainlinkLatestRoundData = (ec: EC, feed: string, block: number) =>
  tryContractCall<
    readonly [bigint, bigint, bigint, bigint, bigint]
  >(
    ec,
    feed,
    "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
    "latestRoundData",
    [],
    block,
  );

/** ChainlinkPriceFeed.decimals() — pinned (read alongside price). */
export const chainlinkDecimals = (ec: EC, feed: string, block: number) =>
  tryContractCall<number>(
    ec,
    feed,
    "function decimals() view returns (uint8)",
    "decimals",
    [],
    block,
  );

// ---- WstEth / REth / ERC4626 special cases (fetchUsdTokenPrice.ts) — pinned ----

/** WstEth.getStETHByWstETH(uint256) — pinned. */
export const wstEthGetStETHByWstETH = (
  ec: EC,
  wstEth: string,
  wad: bigint,
  block: number,
) =>
  tryContractCall<bigint>(
    ec,
    wstEth,
    "function getStETHByWstETH(uint256 _wstETHAmount) view returns (uint256)",
    "getStETHByWstETH",
    [wad],
    block,
  );

/** REth.getExchangeRate() — pinned. */
export const rEthGetExchangeRate = (ec: EC, rEth: string, block: number) =>
  tryContractCall<bigint>(
    ec,
    rEth,
    "function getExchangeRate() view returns (uint256)",
    "getExchangeRate",
    [],
    block,
  );

/** ERC4626.convertToAssets(uint256) — pinned. */
export const erc4626ConvertToAssets = (
  ec: EC,
  vault: string,
  shares: bigint,
  block: number,
) =>
  tryContractCall<bigint>(
    ec,
    vault,
    "function convertToAssets(uint256 shares) view returns (uint256)",
    "convertToAssets",
    [shares],
    block,
  );
