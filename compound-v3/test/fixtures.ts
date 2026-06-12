/**
 * Shared addresses + mock-rule builders for the offline tests (all eth_calls
 * mocked via COMPOUND_V3_CALL_MOCK; no RPC).
 *
 * Scenario: the cUSDCv3 market (base USDC, one collateral WBTC, COMP rewards
 * via CometRewards V1).
 */
import type { CallMockRule, MockResult } from "../src/effects/calls";

export const CONFIGURATOR = "0x316f9708bb98af7da9c68c1c3b5e79039cd336e3";
export const REWARDS = "0x1b0e765f6224c21223aea2af16c1c46e38885a40";
export const COMET = "0xc3d688b66703497daa19211eedff47f25384cdc3"; // cUSDCv3
export const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
export const WBTC = "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599";
export const COMP = "0xc00e94cb662c3520282e6f5717214004a7f26888";
export const USDC_FEED = "0x8fffffd4afb6115b954bd326cbe7b4ba576818f6";
export const WBTC_FEED = "0xf4030086522a5beea4988f8ca5b36dbc97bee88c";
export const ETH_USD_FEED = "0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419";
export const COMP_USD_FEED = "0xdbd020caef83efd542f4de03e3cf0c28a4428bd5";

export const FACTORY = "0x1111111111111111111111111111111111111111";
export const GOVERNOR = "0x2222222222222222222222222222222222222222";
export const PAUSE_GUARDIAN = "0x3333333333333333333333333333333333333333";
export const EXTENSION_DELEGATE = "0x4444444444444444444444444444444444444444";
export const IMPLEMENTATION = "0x5555555555555555555555555555555555555555";

export const USER = "0xabcdabcdabcdabcdabcdabcdabcdabcdabcdabcd";

export const str = (value: string): MockResult => ({ kind: "string", value });
export const num = (value: number): MockResult => ({ kind: "number", value });
export const big = (value: bigint): MockResult => ({ kind: "bigint", value: value.toString() });
export const json = (value: unknown): MockResult => ({ kind: "json", value });
export const revert: MockResult = { kind: "revert" };

/** AssetInfo tuple for WBTC: bcf 0.7, lcf 0.77, lf 0.95, supplyCap 12000e8 */
export const WBTC_ASSET_INFO = [
  0,
  WBTC,
  WBTC_FEED,
  "100000000",
  "700000000000000000",
  "770000000000000000",
  "950000000000000000",
  "1200000000000",
];

/** Market configuration / token-metadata reads (block-independent values). */
export function configRules(): CallMockRule[] {
  return [
    { fn: "factory", to: CONFIGURATOR, args: [COMET], result: str(FACTORY) },
    { fn: "name", to: COMET, result: str("Compound USDC") },
    { fn: "symbol", to: COMET, result: str("cUSDCv3") },
    { fn: "governor", to: COMET, result: str(GOVERNOR) },
    { fn: "pauseGuardian", to: COMET, result: str(PAUSE_GUARDIAN) },
    { fn: "extensionDelegate", to: COMET, result: str(EXTENSION_DELEGATE) },
    { fn: "supplyKink", to: COMET, result: big(800000000000000000n) }, // 0.8
    { fn: "supplyPerSecondInterestRateSlopeLow", to: COMET, result: big(1030568239n) },
    { fn: "supplyPerSecondInterestRateSlopeHigh", to: COMET, result: big(12683916793n) },
    { fn: "supplyPerSecondInterestRateBase", to: COMET, result: big(0n) },
    { fn: "borrowKink", to: COMET, result: big(900000000000000000n) }, // 0.9
    { fn: "borrowPerSecondInterestRateSlopeLow", to: COMET, result: big(1109842719n) },
    { fn: "borrowPerSecondInterestRateSlopeHigh", to: COMET, result: big(7610350076n) },
    { fn: "borrowPerSecondInterestRateBase", to: COMET, result: big(475646879n) },
    { fn: "storeFrontPriceFactor", to: COMET, result: big(600000000000000000n) },
    { fn: "trackingIndexScale", to: COMET, result: big(1000000000000000n) },
    { fn: "baseTrackingSupplySpeed", to: COMET, result: big(12500000000n) },
    { fn: "baseTrackingBorrowSpeed", to: COMET, result: big(6250000000n) },
    { fn: "baseMinForRewards", to: COMET, result: big(100000000000n) }, // 100k USDC
    { fn: "baseBorrowMin", to: COMET, result: big(100000000n) },
    { fn: "targetReserves", to: COMET, result: big(5000000000000n) },
    { fn: "baseToken", to: COMET, result: str(USDC) },
    { fn: "baseTokenPriceFeed", to: COMET, result: str(USDC_FEED) },
    { fn: "numAssets", to: COMET, result: num(1) },
    { fn: "getAssetInfo", to: COMET, args: ["0"], result: json(WBTC_ASSET_INFO) },
    { fn: "getAssetInfoByAddress", to: COMET, args: [WBTC], result: json(WBTC_ASSET_INFO) },
    // ERC20 metadata (unpinned)
    { fn: "name", to: USDC, result: str("USD Coin") },
    { fn: "symbol", to: USDC, result: str("USDC") },
    { fn: "decimals", to: USDC, result: num(6) },
    { fn: "name", to: WBTC, result: str("Wrapped BTC") },
    { fn: "symbol", to: WBTC, result: str("WBTC") },
    { fn: "decimals", to: WBTC, result: num(8) },
    { fn: "name", to: COMP, result: str("Compound") },
    { fn: "symbol", to: COMP, result: str("COMP") },
    { fn: "decimals", to: COMP, result: num(18) },
    // CometRewards: V2 ABI decode fails on-chain (V1 deployed) -> revert -> V1
    { fn: "rewardConfigV2", to: REWARDS, args: [COMET], result: revert },
    { fn: "rewardConfigV1", to: REWARDS, args: [COMET], result: json([COMP, "1000000000000", true]) },
    // Chainlink answers (price feeds)
    { fn: "latestRoundData", to: COMP_USD_FEED, result: big(5000000000n) }, // COMP = $50
    { fn: "latestRoundData", to: ETH_USD_FEED, result: big(120000000000n) }, // ETH = $1200
    // Comet oracle prices
    { fn: "getPrice", to: COMET, args: [USDC_FEED], result: big(100000000n) }, // $1
    { fn: "getPrice", to: COMET, args: [WBTC_FEED], result: big(2000000000000n) }, // $20,000
    // Market collateral state (constant across the test blocks)
    { fn: "totalsCollateral", to: COMET, args: [WBTC], result: json(["300000000000", "0"]) }, // 3,000 WBTC
    { fn: "getCollateralReserves", to: COMET, args: [WBTC], result: big(100000000n) }, // 1 WBTC
    // Borrow side (constant)
    { fn: "totalBorrow", to: COMET, result: big(500000000000n) }, // 500k USDC
    { fn: "getUtilization", to: COMET, result: big(500000000000000000n) }, // 0.5
    { fn: "getSupplyRate", to: COMET, args: ["500000000000000000"], result: big(2000000000n) }, // APR 0.063072
    { fn: "getBorrowRate", to: COMET, args: ["500000000000000000"], result: big(3000000000n) }, // APR 0.094608
  ];
}

/** Block-pinned market accounting state for one block. */
export function accountingRules(block: number, opts: {
  baseSupplyIndex: bigint;
  baseBorrowIndex: bigint;
  trackingSupplyIndex: bigint;
  trackingBorrowIndex: bigint;
  totalSupplyBase: bigint;
  totalBorrowBase: bigint;
  lastAccrualTime: bigint;
  reserves: bigint;
  totalSupply: bigint;
}): CallMockRule[] {
  return [
    {
      fn: "totalsBasic",
      to: COMET,
      block,
      result: json([
        opts.baseSupplyIndex.toString(),
        opts.baseBorrowIndex.toString(),
        opts.trackingSupplyIndex.toString(),
        opts.trackingBorrowIndex.toString(),
        opts.totalSupplyBase.toString(),
        opts.totalBorrowBase.toString(),
        opts.lastAccrualTime.toString(),
        "0",
      ]),
    },
    { fn: "getReserves", to: COMET, block, result: big(opts.reserves) },
    { fn: "totalSupply", to: COMET, block, result: big(opts.totalSupply) },
  ];
}
