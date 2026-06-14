/**
 * Ported from src/constants.ts, src/token.ts, src/bophades.ts (mainnet only).
 * All addresses lowercase.
 */
export const CLEARINGHOUSE_SINGLETON_ID = "ROOT";

export const COOLER_LOANS_CLEARINGHOUSE_V1 = "0xd6a6e8d9e82534bd65821142fccd91ec9cf31880";
export const COOLER_LOANS_CLEARINGHOUSE_V1_1 = "0xe6343ad0675c9b8d3f32679ae6adba0766a2ab4c";

// src/token.ts (mainnet)
export const GOHM_ADDRESS = "0x0ab87046fbb341d058f17cbc4c1133f25a20a52f";

// src/bophades.ts (mainnet kernel) — TRSRY module looked up dynamically.
export const KERNEL_ADDRESS = "0x2286d7f9639e8158fad1169e76d1fbc38247f54b";
// keccak/keycode "TRSRY" as bytes5 = 0x5452535259
export const TRSRY_KEYCODE = "0x5452535259";

// src/price.ts (mainnet Chainlink feeds)
export const OHM_ETH_FEED = "0x9a72298ae3886221820b1c878d12d872087d3a23";
export const ETH_USD_FEED = "0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419";

// MonoCooler global state singleton id (src/monocooler.ts)
export const MONO_GLOBAL_STATE_ID = "singleton";
// RAY 1e27 (initial interestAccumulatorRay)
export const RAY = 1000000000000000000000000000n;
// WAD 1e18
export const WAD = 1000000000000000000n;
// MonoCooler getLtvValues fallback (3000 / 3300 USDS per gOHM in WAD)
export const MONO_FALLBACK_MAX_ORIGINATION_LTV = 3000000000000000000000n;
export const MONO_FALLBACK_LIQUIDATION_LTV = 3300000000000000000000n;
