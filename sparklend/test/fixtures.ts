/**
 * Shared addresses + mock-rule builders for the offline tests (all eth_calls
 * mocked via SPARKLEND_CALL_MOCK; no RPC).
 *
 * Scenario: a single SparkLend pool (addresses provider), one reserve (USDC)
 * with aToken/sToken/vToken, driven through registration + supply/borrow.
 *
 * Addresses are the real SparkLend Ethereum-mainnet deployment (lowercased),
 * sourced from sparkdotfi/sparklend-deployments script/output/1/primary-latest.json.
 */
import type { CallMockRule, MockResult } from "../src/effects/calls";

// addresses provider == Pool entity id (SparkLend PoolAddressesProvider)
export const PROVIDER = "0x02c3ea4e34c0cbd694d2adfa2c690eecbc1793ee";
export const POOL_PROXY = "0xc13e21b648a5ee794902342038ff3adab66be987";
export const CONFIGURATOR = "0x542dba469bde58faee189ffb60c6b49ce60e0738";
export const ORACLE = "0x8105f69d9c41644c6a0803fda7d03aa70996cfd9";

export const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
export const ATOKEN = "0x377c3bd93f2a2984e1e7be6a5c22c525ed4a4815"; // spUSDC (USDC_aToken)
export const STOKEN = "0x887ac022983ff083aeb623923789052a955c6798"; // USDC_stableDebtToken
export const VTOKEN = "0x7b70d04099cb9cfb1db7b6820badafb4c5c70a67"; // USDC_variableDebtToken
export const STRATEGY = "0x4d988568b5f0462b08d1f40ba1f5f17ad2d24f76"; // USDC_interestRateStrategy

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
