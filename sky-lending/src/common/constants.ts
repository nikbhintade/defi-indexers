/**
 * Port of src/common/constants.ts.
 */
import { BigDecimal } from "envio";

// graph-node BigDecimal keeps 34 significant digits and never serializes with
// exponents. Configure bignumber.js (envio's BigDecimal) to approximate that.
BigDecimal.config({
  DECIMAL_PLACES: 34,
  EXPONENTIAL_AT: [-1000000, 1000000],
});

export const PROTOCOL_NAME = "MakerDAO";
export const PROTOCOL_SLUG = "makerdao";

export const Network = {
  MAINNET: "MAINNET",
} as const;

export const ProtocolType = {
  LENDING: "LENDING",
} as const;

export const LendingType = {
  CDP: "CDP",
  POOLED: "POOLED",
} as const;

export const InterestRateType = {
  STABLE: "STABLE",
  VARIABLE: "VARIABLE",
  FIXED: "FIXED",
} as const;

export const InterestRateSide = {
  LENDER: "LENDER",
  BORROW: "BORROWER", // NB: subgraph maps BORROW -> "BORROWER" string
} as const;

// u32 selectors in source; numeric here
export const ProtocolSideRevenueType = {
  STABILITYFEE: 1,
  LIQUIDATION: 2,
  PSM: 3,
} as const;

export const PositionSide = {
  LENDER: "LENDER",
  BORROWER: "BORROWER",
} as const;

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export const DEFAULT_DECIMALS = 18;

export const BIGINT_ZERO = 0n;
export const BIGINT_ONE = 1n;
export const BIGINT_NEG_ONE = -1n;
export const BIGINT_NEG_HUNDRED = -100n;

// 10^27
export const BIGINT_ONE_RAY = 1000000000000000000000000000n;

export const INT_ZERO = 0;
export const INT_ONE = 1;

export const BIGDECIMAL_ZERO = new BigDecimal(0);
export const BIGDECIMAL_ONE = new BigDecimal(1);
export const BIGDECIMAL_TWO = new BigDecimal(2);
export const BIGDECIMAL_THREE = new BigDecimal(3);
export const BIGDECIMAL_SIX = new BigDecimal(6);
export const BIGDECIMAL_TWELVE = new BigDecimal(12);
export const BIGDECIMAL_ONE_HUNDRED = new BigDecimal(100);
export const BIGDECIMAL_NEG_ONE = new BigDecimal(-1);

export const WAD = 18;
export const RAY = 27;
export const RAD = 45;

export const SECONDS_PER_HOUR = 60 * 60;
export const SECONDS_PER_DAY = 60 * 60 * 24;
export const SECONDS_PER_YEAR_BIGDECIMAL = new BigDecimal(60 * 60 * 24 * 365);

// Protocol-specific addresses (lowercased)
export const VAT_ADDRESS = "0x35d1b3f3d7966a1dfe207aa4514c12a259a0492b";
export const VOW_ADDRESS = "0xa950524441892a31ebddf91d3ceefa04bf454466";
export const DAI_ADDRESS = "0x6b175474e89094c44da98b954eedeac495271d0f";
export const MIGRATION_ADDRESS = "0xc73e0383f3aff3215e6f04b0331d58cecf0ab849";
export const CAT_V1_ADDRESS = "0x78f2c2af65126834c51822f56be0d7469d7a523e";

export const ILK_SAI =
  "0x5341490000000000000000000000000000000000000000000000000000000000";
export const ILK_ETH_A =
  "0x4554482d41000000000000000000000000000000000000000000000000000000";

// Schema versions (mirror generated/versions in subgraph; static for parity)
export const SCHEMA_VERSION = "2.0.1";
export const SUBGRAPH_VERSION = "1.1.6";
export const METHODOLOGY_VERSION = "1.0.0";
