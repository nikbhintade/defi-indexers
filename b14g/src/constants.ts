/**
 * Hardcoded addresses / constants ported from src/mappings/helpers.ts.
 * Stored lowercase to match subgraph id/field formatting.
 */
export const ADDRESS_ZERO = "0x0000000000000000000000000000000000000000";
export const ZERO_BI = 0n;
export const B14G_ID = "b14g";

export const DUAL_CORE_VAULT = "0xee21ab613d30330823d35cf91a84ce964808b83f";
export const MARKETPLACE_STRATEGY_ADDRESS =
  "0xcd6d74b6852fbeeb1187ec0e231ab91e700ec3ba";

export const MARKETPLACE = "0x04ea61c431f7934d51fed2acb2c5f942213f8967";
export const FAIR_SHARE_ORDER = "0x13e3ec65efeb0a4583c852f4faf6b2fb31ff04b1";

export const LOTTERY = "0x606499355875aafe39cf0910962f2be4b16d5566";
export const YIELD_BTC = "0xac12840f51495f119290646824e503292607f679";

export const LENDING_VAULT = "0xa3cd4d4a568b76cff01048e134096d2ba0171c27";
export const LENDING_VAULT_MKP_STRATEGY =
  "0x3d096431c05f33b829d01d769f60847c603970d8";
export const COLEND_POOL = "0x0cea9f0f49f30d376390e480ba32f903b43b19c5";
export const CORE_DEBT_TOKEN = "0xac98bb397b8ba98fffdd0124cdc50fa08d7c7a00";
export const WBTC = "0x5832f53d147b3d6cd4578b9cbd62425c7ea9d0bd";
export const WCORE = "0x40375c92d9faf44d2f9db9bd9ba41a3317a2404f";
export const PYTH = "0xa2aa501b19aff244d90cc15a4cf739d2725b5729";

export const LENDING_VAULT_V2 = "0xdf0335ade9fc8eaac71953f290ec1b45b8d72481";
export const LENDING_VAULT_V2_MKP_STRATEGY =
  "0x620cff82faf31c8b80f2f410e4bf92dc8c1cf93a";

export const CORE_PRICE_ID =
  "0x9b4503710cc8c53f75c30e6e4fda1a7064680ef2e0ee97acd2e3a7c37b3c830c";
export const BTC_PRICE_ID =
  "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";

/** ORDER_ACTION enum mirror from helpers.ts */
export const ORDER_ACTION = {
  STAKE: 0,
  WITHDRAW: 1,
  CLAIM_BTC: 2,
  CLAIM_CORE: 3,
} as const;
export type OrderActionKind = (typeof ORDER_ACTION)[keyof typeof ORDER_ACTION];
