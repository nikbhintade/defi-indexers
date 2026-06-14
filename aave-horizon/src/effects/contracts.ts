/**
 * Typed `try_`-style wrappers over the generic eth_call layer, mirroring the
 * `Contract.bind(addr).try_foo()` calls in the original mappings. Each returns
 * `null` on revert / undecodable output so handlers can replicate the
 * subgraph's `.reverted` branches.
 */
import type { EffectCaller } from "envio";
import { tryContractCall } from "./calls";

// ---- ERC20 metadata (immutable; unpinned) ----

export function tryName(call: EffectCaller | null, token: string): Promise<string | null> {
  return tryContractCall(call, token, "function name() view returns (string)", "name", []);
}
export function trySymbol(call: EffectCaller | null, token: string): Promise<string | null> {
  return tryContractCall(call, token, "function symbol() view returns (string)", "symbol", []);
}
export function tryDecimals(call: EffectCaller | null, token: string): Promise<number | null> {
  return tryContractCall<number>(
    call,
    token,
    "function decimals() view returns (uint8)",
    "decimals",
    [],
  );
}
// bytes32 fallbacks (IERC20DetailedBytes)
export function tryNameBytes(call: EffectCaller | null, token: string): Promise<string | null> {
  return tryContractCall<string>(
    call,
    token,
    "function name() view returns (bytes32)",
    "name",
    [],
    undefined,
    "nameBytes",
  );
}
export function trySymbolBytes(call: EffectCaller | null, token: string): Promise<string | null> {
  return tryContractCall<string>(
    call,
    token,
    "function symbol() view returns (bytes32)",
    "symbol",
    [],
    undefined,
    "symbolBytes",
  );
}

// ---- Interest rate strategy (V1 no-arg; V2 takes underlying asset) ----

const V1_RD = "function getBaseVariableBorrowRate() view returns (uint256)";
const V1_OUR = "function OPTIMAL_USAGE_RATIO() view returns (uint256)";
const V1_VS1 = "function getVariableRateSlope1() view returns (uint256)";
const V1_VS2 = "function getVariableRateSlope2() view returns (uint256)";
const V1_SS1 = "function getStableRateSlope1() view returns (uint256)";
const V1_SS2 = "function getStableRateSlope2() view returns (uint256)";

const V2_RD = "function getBaseVariableBorrowRate(address) view returns (uint256)";
const V2_OUR = "function getOptimalUsageRatio(address) view returns (uint256)";
const V2_VS1 = "function getVariableRateSlope1(address) view returns (uint256)";
const V2_VS2 = "function getVariableRateSlope2(address) view returns (uint256)";

const big = (call: EffectCaller | null, to: string, sig: string, fn: string, mockFn: string) =>
  tryContractCall<bigint>(call, to, sig, fn, [], undefined, mockFn);

const bigV2 = (
  call: EffectCaller | null,
  to: string,
  sig: string,
  fn: string,
  asset: string,
  mockFn: string,
) => tryContractCall<bigint>(call, to, sig, fn, [asset], undefined, mockFn);

export const ratesStrategy = {
  baseVariableBorrowRate: (c: EffectCaller | null, s: string) =>
    big(c, s, V1_RD, "getBaseVariableBorrowRate", "getBaseVariableBorrowRate"),
  baseVariableBorrowRateV2: (c: EffectCaller | null, s: string, a: string) =>
    bigV2(c, s, V2_RD, "getBaseVariableBorrowRate", a, "getBaseVariableBorrowRateV2"),
  optimalUsageRatio: (c: EffectCaller | null, s: string) =>
    big(c, s, V1_OUR, "OPTIMAL_USAGE_RATIO", "OPTIMAL_USAGE_RATIO"),
  optimalUsageRatioV2: (c: EffectCaller | null, s: string, a: string) =>
    bigV2(c, s, V2_OUR, "getOptimalUsageRatio", a, "getOptimalUsageRatioV2"),
  variableRateSlope1: (c: EffectCaller | null, s: string) =>
    big(c, s, V1_VS1, "getVariableRateSlope1", "getVariableRateSlope1"),
  variableRateSlope1V2: (c: EffectCaller | null, s: string, a: string) =>
    bigV2(c, s, V2_VS1, "getVariableRateSlope1", a, "getVariableRateSlope1V2"),
  variableRateSlope2: (c: EffectCaller | null, s: string) =>
    big(c, s, V1_VS2, "getVariableRateSlope2", "getVariableRateSlope2"),
  variableRateSlope2V2: (c: EffectCaller | null, s: string, a: string) =>
    bigV2(c, s, V2_VS2, "getVariableRateSlope2", a, "getVariableRateSlope2V2"),
  stableRateSlope1: (c: EffectCaller | null, s: string) =>
    big(c, s, V1_SS1, "getStableRateSlope1", "getStableRateSlope1"),
  stableRateSlope2: (c: EffectCaller | null, s: string) =>
    big(c, s, V1_SS2, "getStableRateSlope2", "getStableRateSlope2"),
};

// ---- Pool.getReserveData(asset).accruedToTreasury (state; block-pinned) ----

const GET_RESERVE_DATA =
  "function getReserveData(address) view returns ((uint256 data) configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt)";

export async function tryReserveDataAccruedToTreasury(
  call: EffectCaller | null,
  pool: string,
  asset: string,
  block: number,
): Promise<bigint | null> {
  const res = await tryContractCall<{ accruedToTreasury: bigint } | bigint | string>(
    call,
    pool,
    GET_RESERVE_DATA,
    "getReserveData",
    [asset],
    block,
    "getReserveData",
  );
  if (res === null) return null;
  // Tests may mock `getReserveData` directly with the accruedToTreasury value.
  if (typeof res === "bigint") return res;
  if (typeof res === "string") return BigInt(res);
  return res.accruedToTreasury;
}

// ---- AaveOracle.getAssetPrice(asset) (state; block-pinned) ----

export function tryGetAssetPrice(
  call: EffectCaller | null,
  oracle: string,
  asset: string,
  block: number,
): Promise<bigint | null> {
  return tryContractCall<bigint>(
    call,
    oracle,
    "function getAssetPrice(address) view returns (uint256)",
    "getAssetPrice",
    [asset],
    block,
    "getAssetPrice",
  );
}

// ---- Chainlink / IExtendedPriceAggregator ----

export function tryGetTokenType(
  call: EffectCaller | null,
  source: string,
): Promise<bigint | null> {
  return tryContractCall<bigint>(
    call,
    source,
    "function getTokenType() view returns (uint256)",
    "getTokenType",
    [],
  );
}
export function tryAggregator(call: EffectCaller | null, proxy: string): Promise<string | null> {
  return tryContractCall<string>(
    call,
    proxy,
    "function aggregator() view returns (address)",
    "aggregator",
    [],
  );
}
export function tryLatestAnswer(call: EffectCaller | null, source: string): Promise<bigint | null> {
  return tryContractCall<bigint>(
    call,
    source,
    "function latestAnswer() view returns (int256)",
    "latestAnswer",
    [],
  );
}
export function trySubTokens(call: EffectCaller | null, source: string): Promise<string[] | null> {
  return tryContractCall<string[]>(
    call,
    source,
    "function getSubTokens() view returns (address[])",
    "getSubTokens",
    [],
  );
}

// ---- RewardsController ----

export function tryRewardAssetDecimals(
  call: EffectCaller | null,
  controller: string,
  asset: string,
): Promise<number | null> {
  return tryContractCall<number>(
    call,
    controller,
    "function getAssetDecimals(address) view returns (uint8)",
    "getAssetDecimals",
    [asset],
  );
}
export function tryGetRewardOracle(
  call: EffectCaller | null,
  controller: string,
  reward: string,
): Promise<string | null> {
  return tryContractCall<string>(
    call,
    controller,
    "function getRewardOracle(address) view returns (address)",
    "getRewardOracle",
    [reward],
  );
}
