import type { CallMockRule, MockResult } from "../src/effects/calls.js";

export const MARGIN = "0x6bd780e7fdf01d77e4d475c821f1e7ae05409072";
export const FACTORY = "0xd99c21c96103f36bc1fa26dd6448af4da030c1ef";
export const EXPIRY = "0xdec1ae3b570ac3c57871bbd7bfeacc807f973bea";

// two markets for tests
export const TOKEN_A = "0x1111111111111111111111111111111111111111"; // 18 decimals
export const TOKEN_B = "0x2222222222222222222222222222222222222222"; // 6 decimals
export const USER = "0xabcdabcdabcdabcdabcdabcdabcdabcdabcdabcd";

export const str = (value: string): MockResult => ({ kind: "string", value });
export const num = (value: number): MockResult => ({ kind: "number", value });
export const big = (value: bigint): MockResult => ({ kind: "bigint", value: value.toString() });
export const json = (value: unknown): MockResult => ({ kind: "json", value });
export const revert: MockResult = { kind: "revert" };

/** Block-independent risk-param + metadata reads used during LogAddMarket. */
export function adminRules(): CallMockRule[] {
  return [
    { fn: "getMarginRatio", to: MARGIN, result: json({ value: "150000000000000000" }) }, // 0.15e18 -> 1.15
    { fn: "getLiquidationSpread", to: MARGIN, result: json({ value: "50000000000000000" }) }, // 0.05e18 -> 1.05
    { fn: "getEarningsRate", to: MARGIN, result: json({ value: "900000000000000000" }) }, // 0.9
    { fn: "getMinBorrowedValue", to: MARGIN, result: json({ value: "0" }) },
    { fn: "getAccountMaxNumberOfMarketsWithBalances", to: MARGIN, result: big(32n) },
    { fn: "g_expiryRampTime", to: EXPIRY, result: big(3600n) },
  ];
}

/** ERC20 metadata for a token (unpinned). */
export function tokenMeta(token: string, name: string, symbol: string, decimals: number): CallMockRule[] {
  return [
    { fn: "name", to: token, result: str(name) },
    { fn: "symbol", to: token, result: str(symbol) },
    { fn: "decimals", to: token, result: num(decimals) },
  ];
}
