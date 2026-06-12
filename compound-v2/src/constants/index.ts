/**
 * Hardcoded addresses / constants from src/mappings/markets.ts. All lowercase.
 */
export const cUSDCAddress = "0x39aa39c021dfbae8fac545936693ac917d5e7563";
export const cETHAddress = "0x4ddc2d193948926d02f9b1fe9e1daa0718270ed5";
export const daiAddress = "0x89d24a6b4ccb1b6faa2625fe562bdd9a23260359";

/** PriceOracle(1), valid from Comptroller deployment until block 7715908 (per the original mapping). */
export const priceOracle1Address = "0x02557a5e05defeffd4cae6d83ea3d173b272c904";

/**
 * USDC address used by getUSDCpriceETH's oracle-1 branch. The original
 * AssemblyScript literal contained a trailing space
 * ('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48 ') that graph-ts'
 * Address.fromString tolerated; trimmed here.
 */
export const USDCAddress = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

export const ADDRESS_ZERO = "0x0000000000000000000000000000000000000000";
