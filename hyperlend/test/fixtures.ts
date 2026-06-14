/**
 * Shared addresses + mock helpers for the offline tests. All eth_calls are
 * mocked via HYPERLEND_CALL_MOCK (no RPC).
 *
 * The Ponder log id is `${block.hash}-${logIndex}`, so each simulate item sets
 * an explicit block hash and the expected id is built the same way.
 */
import type { MockResult } from "../src/effects/calls";

// Static contracts (from ponder.config.ts).
export const CORE_POOL = "0x00a89d7a5a02160f20150ebea7a2b5e4879a1a8b";
export const ORACLE = "0xc9fb4fbe842d57eac1df3e641a281827493a630e";
export const HTOKEN_FACTORY = "0x8cb4310dd38f6fd59388c9de225f328092bdc379";

// Reserve + its aToken (HToken), registered via ReserveInitialized.
export const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
export const ATOKEN = "0x98c23e9d8f34fefb1b7bd6a91b7ff122f4e16f5c"; // hUSDC
export const STOKEN = "0x307ffe186f84a3bc2613d1ea417a5737d69a7007";
export const VTOKEN = "0x72e95b8931767c79ba4eee721354d6e99a61d004";
export const STRATEGY = "0x76884cafef8d3a7f6a9c8a4c1c0c9c0d2c3e4f5a";

export const USER = "0x1111111111111111111111111111111111111111";
export const ONBEHALF = "0x2222222222222222222222222222222222222222";

export const big = (value: bigint): MockResult => ({ kind: "bigint", value: value.toString() });
export const revert: MockResult = { kind: "revert" };

/** Build the Ponder log id used as the entity id. */
export const logId = (blockHash: string, logIndex: number): string =>
  `${blockHash.toLowerCase()}-${logIndex}`;
