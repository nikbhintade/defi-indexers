/**
 * Shared addresses + mock-rule builders for the offline tests (all eth_calls
 * mocked via AAVE_V3_CALL_MOCK; no RPC).
 *
 * Scenario: a single Aave V3 pool (addresses provider), one reserve (USDC)
 * with aToken/sToken/vToken, driven through registration + supply/borrow.
 */
import type { CallMockRule, MockResult } from "../src/effects/calls";

// addresses provider == Pool entity id
export const PROVIDER = "0x2f39d218133afab8f2b819b1066c7e434ad94e9e";
export const POOL_PROXY = "0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2";
export const CONFIGURATOR = "0x64b761d848206f447fe2dd461b0c635ec39ebb27";
export const ORACLE = "0x54586be62e3c3580375ae3723c145253060ca0c2";

export const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
export const ATOKEN = "0x98c23e9d8f34fefb1b7bd6a91b7ff122f4e16f5c"; // aEthUSDC
export const STOKEN = "0x307ffe186f84a3bc2613d1ea417a5737d69a7007"; // stableDebtUSDC
export const VTOKEN = "0x72e95b8931767c79ba4eee721354d6e99a61d004"; // variableDebtUSDC
export const STRATEGY = "0x76884cafef8d3a7f6a9c8a4c1c0c9c0d2c3e4f5a";

export const USER = "0x1111111111111111111111111111111111111111";

// bytes32 ids used by PoolAddressesProvider.ProxyCreated, ascii-encoded.
const ascii32 = (s: string): string => {
  let hex = "";
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(2, "0");
  return "0x" + hex.padEnd(64, "0");
};
export const ID_POOL = ascii32("POOL");
export const ID_POOL_CONFIGURATOR = ascii32("POOL_CONFIGURATOR");

export const big = (value: bigint): MockResult => ({ kind: "bigint", value: value.toString() });
export const num = (value: number): MockResult => ({ kind: "number", value });
export const str = (value: string): MockResult => ({ kind: "string", value });
export const revert: MockResult = { kind: "revert" };

/**
 * Mock rules for ReserveInitialized: ERC20 metadata (V1 string path) +
 * interest-rate strategy V1 reads (V2 fallbacks revert).
 */
export function reserveInitRules(): CallMockRule[] {
  return [
    { fn: "name", to: USDC, result: str("USD Coin") },
    { fn: "symbol", to: USDC, result: str("USDC") },
    { fn: "decimals", to: USDC, result: num(6) },
    // strategy V1 reads
    { fn: "getBaseVariableBorrowRate", to: STRATEGY, result: big(0n) },
    { fn: "OPTIMAL_USAGE_RATIO", to: STRATEGY, result: big(900000000000000000000000000n) },
    { fn: "getVariableRateSlope1", to: STRATEGY, result: big(40000000000000000000000000n) },
    { fn: "getVariableRateSlope2", to: STRATEGY, result: big(600000000000000000000000000n) },
    { fn: "getStableRateSlope1", to: STRATEGY, result: big(5000000000000000000000000n) },
    { fn: "getStableRateSlope2", to: STRATEGY, result: big(600000000000000000000000000n) },
  ];
}
