/**
 * Shared addresses + mock-rule builders for the offline tests (all eth_calls
 * mocked via AAVE_HORIZON_CALL_MOCK; no RPC).
 *
 * Scenario: a single Aave Horizon pool (addresses provider), one reserve (USDC)
 * with aToken/vToken, driven through registration + supply/borrow.
 *
 * Addresses are the real Aave Horizon Ethereum-mainnet deployment (lowercased),
 * sourced from bgd-labs/aave-address-book src/AaveV3EthereumHorizon.sol
 * (AaveV3EthereumHorizon + AaveV3EthereumHorizonAssets libraries).
 */
import type { CallMockRule, MockResult } from "../src/effects/calls";

// addresses provider == Pool entity id (Horizon PoolAddressesProvider)
export const PROVIDER = "0x5d39e06b825c1f2b80bf2756a73e28efaa128ba0";
export const POOL_PROXY = "0xae05cd22df81871bc7cc2a04becfb516bfe332c8";
export const CONFIGURATOR = "0x83cb1b4af26eef6463ac20afbac9c0e2e017202f";
export const ORACLE = "0x985bcfab7e0f4ef2606cc5b64fc1a16311880442";

export const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"; // USDC_UNDERLYING
export const ATOKEN = "0x68215b6533c47ff9f7125ac95adf00fe4a62f79e"; // USDC_A_TOKEN
// Horizon is Aave v3.3 and has no stable-rate borrowing: the configurator emits
// the zero address for stableDebtToken in ReserveInitialized, so the handler
// skips the stable SubToken and leaves reserve.sToken_id at ZERO_ADDRESS.
export const STOKEN = "0x0000000000000000000000000000000000000000";
export const VTOKEN = "0x4139ecbe83d78ef5eff0a6eda6f894be9d590fc7"; // USDC_V_TOKEN
export const STRATEGY = "0x87593272c06f4fc49ec2942ebda0972d2f1ab521"; // USDC_INTEREST_RATE_STRATEGY

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
