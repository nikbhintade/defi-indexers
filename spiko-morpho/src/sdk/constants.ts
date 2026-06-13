/**
 * Ported from src/sdk/constants.ts. Enum namespaces become plain string
 * constants; numeric/BigInt/BigDecimal helpers ported with graph-node
 * BigDecimal semantics (34 significant digits, no exponential notation).
 */
import { BigDecimal } from "envio";

// graph-node BigDecimal config (see CONVENTIONS.md).
BigDecimal.config({
  DECIMAL_PLACES: 34,
  EXPONENTIAL_AT: [-1000000, 1000000],
});

export const ProtocolType = {
  EXCHANGE: "EXCHANGE",
  LENDING: "LENDING",
  YIELD: "YIELD",
  BRIDGE: "BRIDGE",
  GENERIC: "GENERIC",
} as const;

export const LendingType = {
  CDP: "CDP",
  POOLED: "POOLED",
} as const;

export const PermissionType = {
  WHITELIST_ONLY: "WHITELIST_ONLY",
  PERMISSIONED: "PERMISSIONED",
  PERMISSIONLESS: "PERMISSIONLESS",
  ADMIN: "ADMIN",
} as const;

export const RiskType = {
  GLOBAL: "GLOBAL",
  ISOLATED: "ISOLATED",
} as const;

export const CollateralizationType = {
  OVER_COLLATERALIZED: "OVER_COLLATERALIZED",
  UNDER_COLLATERALIZED: "UNDER_COLLATERALIZED",
  UNCOLLATERALIZED: "UNCOLLATERALIZED",
} as const;

export const InterestRateType = {
  STABLE: "STABLE",
  VARIABLE: "VARIABLE",
  FIXED: "FIXED",
} as const;

export const InterestRateSide = {
  LENDER: "LENDER",
  BORROWER: "BORROWER",
} as const;

export const FeeType = {
  LIQUIDATION_FEE: "LIQUIDATION_FEE",
  ADMIN_FEE: "ADMIN_FEE",
  PROTOCOL_FEE: "PROTOCOL_FEE",
  MINT_FEE: "MINT_FEE",
  WITHDRAW_FEE: "WITHDRAW_FEE",
  FLASHLOAN_PROTOCOL_FEE: "FLASHLOAN_PROTOCOL_FEE",
  FLASHLOAN_LP_FEE: "FLASHLOAN_LP_FEE",
  OTHER: "OTHER",
} as const;

export const PositionSide = {
  SUPPLIER: "SUPPLIER",
  COLLATERAL: "COLLATERAL",
  BORROWER: "BORROWER",
} as const;

export const TransactionType = {
  DEPOSIT_COLLATERAL: "DEPOSIT_COLLATERAL",
  WITHDRAW_COLLATERAL: "WITHDRAW_COLLATERAL",
  DEPOSIT: "DEPOSIT",
  WITHDRAW: "WITHDRAW",
  BORROW: "BORROW",
  REPAY: "REPAY",
  LIQUIDATE: "LIQUIDATE",
  TRANSFER: "TRANSFER",
  FLASHLOAN: "FLASHLOAN",
  LIQUIDATOR: "LIQUIDATOR",
  LIQUIDATEE: "LIQUIDATEE",
  SWAP: "SWAP",
} as const;

// Matches the AssemblyScript `enum Transaction` (numeric) used in event ids.
export const Transaction = {
  DEPOSIT: 0,
  WITHDRAW: 1,
  BORROW: 2,
  REPAY: 3,
  LIQUIDATE: 4,
  TRANSFER: 5,
  FLASHLOAN: 6,
} as const;

export const InterestRateTypeEnum = InterestRateType;

export const INT_ZERO = 0;
export const INT_ONE = 1;

export const BIGINT_ONE = 1n;
export const BIGINT_WAD = 10n ** 18n;

export const BIGDECIMAL_ONE = new BigDecimal("1");
export const BIGDECIMAL_HUNDRED = new BigDecimal("100");
export const BIGDECIMAL_WAD = new BigDecimal("1000000000000000000");
export const BIGDECIMAL_ZERO = new BigDecimal("0");

export const SECONDS_PER_YEAR = 60 * 60 * 24 * 365;
export const SECONDS_PER_DAY = 60 * 60 * 24; // 86400
export const SECONDS_PER_HOUR = 60 * 60; // 3600

// n => 10^n  (returns a BigDecimal, matching exponentToBigDecimal)
export function exponentToBigDecimal(decimals: number): BigDecimal {
  let result = new BigDecimal("1");
  const ten = new BigDecimal("10");
  for (let i = 0; i < decimals; i++) {
    result = result.times(ten);
  }
  return result;
}

/** AssemblyScript BigInt.toBigDecimal() */
export function toBD(x: bigint): BigDecimal {
  return new BigDecimal(x.toString());
}

/**
 * insert value into arr at index (ported from constants.insert). Default
 * appends at the end.
 */
export function insert<T>(arr: T[], value: T, index = -1): T[] {
  if (arr.length === 0) {
    return [value];
  }
  if (index === -1 || index > arr.length) {
    index = arr.length;
  }
  const result: T[] = [];
  for (let i = 0; i < index; i++) {
    result.push(arr[i]!);
  }
  result.push(value);
  for (let i = index; i < arr.length; i++) {
    result.push(arr[i]!);
  }
  return result;
}
