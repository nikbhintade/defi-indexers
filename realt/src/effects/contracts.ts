/**
 * Typed wrappers over the generic eth_call layer, mirroring the
 * `Contract.bind(addr).foo()` / `.try_foo()` calls in the original V2 mappings.
 * Each returns `null` on revert / undecodable output so handlers can replicate
 * the subgraph's `.reverted` branches (and best-effort the non-`try_` binds).
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
// bytes32 fallback (IERC20DetailedBytes) for name()
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

// ---- DefaultReserveInterestRateStrategy (V2: no-arg view fns) ----

const big = (call: EffectCaller | null, to: string, sig: string, fn: string) =>
  tryContractCall<bigint>(call, to, sig, fn, []);

export const ratesStrategy = {
  baseVariableBorrowRate: (c: EffectCaller | null, s: string) =>
    big(c, s, "function baseVariableBorrowRate() view returns (uint256)", "baseVariableBorrowRate"),
  optimalUtilizationRate: (c: EffectCaller | null, s: string) =>
    big(
      c,
      s,
      "function OPTIMAL_UTILIZATION_RATE() view returns (uint256)",
      "OPTIMAL_UTILIZATION_RATE",
    ),
  variableRateSlope1: (c: EffectCaller | null, s: string) =>
    big(c, s, "function variableRateSlope1() view returns (uint256)", "variableRateSlope1"),
  variableRateSlope2: (c: EffectCaller | null, s: string) =>
    big(c, s, "function variableRateSlope2() view returns (uint256)", "variableRateSlope2"),
  stableRateSlope1: (c: EffectCaller | null, s: string) =>
    big(c, s, "function stableRateSlope1() view returns (uint256)", "stableRateSlope1"),
  stableRateSlope2: (c: EffectCaller | null, s: string) =>
    big(c, s, "function stableRateSlope2() view returns (uint256)", "stableRateSlope2"),
};
