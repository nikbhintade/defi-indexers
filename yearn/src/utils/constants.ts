/** Ported from src/utils/constants.ts (mainnet-relevant values only). */
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// yearn-lens USDC oracle on mainnet
export const ETH_MAINNET_USDC_ORACLE_ADDRESS = "0x83d95e0d5f402511db06817aff3f9ea88224b030";

export const DEFAULT_DECIMALS = 18;

export const BIGINT_ZERO = 0n;
export const BIGINT_ONE = 1n;
export const BIGINT_MAX = 115792089237316195423570985008687907853269984665640564039457584007913129639935n;

export const DAYS_PER_YEAR = 365;
export const MS_PER_DAY = 24 * 60 * 60 * 1000; // matches new BigDecimal(86400000) in subgraph

export const YEARN_ENTITY_ID = "1";

export const DON_T_CREATE_VAULT_TEMPLATE = false;
export const DO_CREATE_VAULT_TEMPLATE = true;

export const ENDORSED = "Endorsed";
export const EXPERIMENTAL = "Experimental";
export const RELEASED = "Released";

// Registry v3 default/legacy vault type
export const REGISTRY_V3_VAULT_TYPE_LEGACY = 99999999n;
