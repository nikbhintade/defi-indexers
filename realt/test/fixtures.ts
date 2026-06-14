/**
 * Shared addresses + mock-rule builders for the offline tests (all eth_calls
 * mocked via REALT_CALL_MOCK; no RPC).
 *
 * Scenario: a single RealT RMM (Aave V2) addresses provider, one reserve
 * (USDC-like) with aToken/sToken/vToken, driven through registration +
 * deposit/borrow. Addresses are lowercase already (HyperIndex would deliver
 * checksummed, but lowercased ids are what the subgraph stores).
 */
import type { CallMockRule, MockResult } from "../src/effects/calls";

// addresses provider == Pool entity id
export const PROVIDER = "0xae6933231fb83257696e29b050ca6068d6e6cc84";
export const POOL_PROXY = "0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2";
export const CONFIGURATOR = "0x64b761d848206f447fe2dd461b0c635ec39ebb27";

export const USDC = "0xddafbb505ad214d7b80b1f830fccc89b60fb7a83";
export const ATOKEN = "0x98c23e9d8f34fefb1b7bd6a91b7ff122f4e16f5c";
export const STOKEN = "0x307ffe186f84a3bc2613d1ea417a5737d69a7007";
export const VTOKEN = "0x72e95b8931767c79ba4eee721354d6e99a61d004";
export const STRATEGY = "0x76884cafef8d3a7f6a9c8a4c1c0c9c0d2c3e4f5a";

export const USER = "0x1111111111111111111111111111111111111111";

// bytes32 ids used by LendingPoolAddressesProvider.ProxyCreated, ascii-encoded.
const ascii32 = (s: string): string => {
  let hex = "";
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(2, "0");
  return "0x" + hex.padEnd(64, "0");
};
export const ID_LENDING_POOL = ascii32("LENDING_POOL");
export const ID_LENDING_POOL_CONFIGURATOR = ascii32("LENDING_POOL_CONFIGURATOR");

export const big = (value: bigint): MockResult => ({ kind: "bigint", value: value.toString() });
export const num = (value: number): MockResult => ({ kind: "number", value });
export const str = (value: string): MockResult => ({ kind: "string", value });
export const revert: MockResult = { kind: "revert" };

/**
 * Mock rules for ReserveInitialized:
 *  - underlying.name() -> string
 *  - aToken.symbol()   -> string (handler slices off the leading char)
 *  - underlying.decimals() -> uint8
 *  - DefaultReserveInterestRateStrategy no-arg view reads
 */
export function reserveInitRules(): CallMockRule[] {
  return [
    { fn: "name", to: USDC, result: str("USD//C on xDai") },
    { fn: "symbol", to: ATOKEN, result: str("aUSDC") }, // sliced -> "USDC"
    { fn: "decimals", to: USDC, result: num(6) },
    { fn: "baseVariableBorrowRate", to: STRATEGY, result: big(0n) },
    { fn: "OPTIMAL_UTILIZATION_RATE", to: STRATEGY, result: big(900000000000000000000000000n) },
    { fn: "variableRateSlope1", to: STRATEGY, result: big(40000000000000000000000000n) },
    { fn: "variableRateSlope2", to: STRATEGY, result: big(600000000000000000000000000n) },
    { fn: "stableRateSlope1", to: STRATEGY, result: big(5000000000000000000000000n) },
    { fn: "stableRateSlope2", to: STRATEGY, result: big(600000000000000000000000000n) },
  ];
}
