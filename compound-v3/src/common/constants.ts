/**
 * Port of src/common/constants.ts.
 */
import { BigDecimal } from "envio";
import { keccak256, toBytes } from "viem";

// graph-node BigDecimal keeps 34 significant digits and never serializes
// with exponents. Configure bignumber.js (envio's BigDecimal) to
// approximate that behaviour (same setup as the compound-v2 port).
BigDecimal.config({
  DECIMAL_PLACES: 34,
  EXPONENTIAL_AT: [-1000000, 1000000],
});

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export const DAYS_PER_YEAR = 365n;
export const SECONDS_PER_HOUR = 3600n;
export const SECONDS_PER_DAY = 86400n;
export const SECONDS_PER_WEEK = 604800n;
export const SECONDS_PER_YEAR = 31536000n;

export const SECONDS_PER_BLOCK = 12n;

export const ZERO_BI = 0n;
export const ZERO_BD: BigDecimal = new BigDecimal("0");
export const ONE_BI = 1n;
export const ONE_BD: BigDecimal = new BigDecimal("1");
export const BASE_INDEX_SCALE = 1000000000000000n; // 10^15

export const COMET_FACTOR_SCALE = 1000000000000000000n; // 10^18
export const REWARD_FACTOR_SCALE = 1000000000000000000n; // 10^18
export const PRICE_FEED_FACTOR: BigDecimal = new BigDecimal("100000000"); // 10^8

export const InteractionType = {
  SUPPLY_BASE: "SUPPLY_BASE",
  WITHDRAW_BASE: "WITHDRAW_BASE",
  TRANSFER_BASE: "TRANSFER_BASE",
  LIQUIDATION: "LIQUIDATION",
  SUPPLY_COLLATERAL: "SUPPLY_COLLATERAL",
  WITHDRAW_COLLATERAL: "WITHDRAW_COLLATERAL",
  // Note: original quirk — TRANSFER_COLLATERAL maps to the string "TRANSFER_COLLATERAL_TO"
  TRANSFER_COLLATERAL: "TRANSFER_COLLATERAL_TO",
} as const;

export const SUPPLY_EVENT_SIGNATURE = keccak256(toBytes("Supply(address,address,uint256)"));
export const WITHDRAW_EVENT_SIGNATURE = keccak256(toBytes("Withdraw(address,address,uint256)"));
export const ABSORB_DEBT_EVENT_SIGNATURE = keccak256(toBytes("AbsorbDebt(address,address,uint256,uint256)"));
