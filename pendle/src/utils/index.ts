/**
 * Port of src/utils/consts.ts (mainnet mode: src/utils/consts-modes/mainnet_consts.ts)
 * and the numeric helpers from src/utils/helpers.ts, plus graph-node BigDecimal
 * semantics.
 *
 * The original subgraph swaps the active consts file per deployment mode; this
 * port targets the **mainnet** deployment, so the mainnet addresses are used.
 */
import { BigDecimal } from "envio";

// graph-node BigDecimal keeps 34 significant digits and never serializes with
// exponents. Configure bignumber.js to approximate that behaviour: divisions
// keep 34 decimal places (compare tooling tolerates far-decimal differences)
// and toString never switches to exponential notation.
BigDecimal.config({
  DECIMAL_PLACES: 34,
  EXPONENTIAL_AT: [-1000000, 1000000],
});

// ---------- BigInt / BigDecimal constants ----------
export const ZERO_BI = 0n;
export const ONE_BI = 1n;
export const BI_18 = 18n;

export const ZERO_BD = new BigDecimal("0");
export const ONE_BD = new BigDecimal("1");
export const TWO_BD = new BigDecimal("2");

export const ADDRESS_ZERO = "0x0000000000000000000000000000000000000000";

/** RONE = 2^40 (Pendle fixed-point one). */
export const RONE = 2n ** 40n;
export const RONE_BD = new BigDecimal(RONE.toString());

export const COMPOUND_EXCHANGE_RATE_DECIMAL = new BigDecimal((10n ** 18n).toString());

/** Q192 = 2^192 (UniswapV3 price scaling). */
export const UNISWAP_Q192 = new BigDecimal((2n ** 192n).toString());

export const DAYS_PER_YEAR_BD = new BigDecimal("365");
export const DAYS_PER_WEEK_BD = new BigDecimal("7");

export const ONE_DAY = new BigDecimal("86400");
export const ONE_HOUR = 3600;

// ---------- mainnet addresses (mainnet_consts.ts) ----------
export const STABLE_USD_TOKENS: string[] = [
  "0x6b175474e89094c44da98b954eedeac495271d0f", // DAI
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", // USDC
  "0xdac17f958d2ee523a2206206994597c13d831ec7", // USDT
];

export const USDC_WETH_03_POOL = "0x8ad599c3a0ff1de082011efddc58f1908eb6e6d8";
export const WETH_ADDRESS = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
export const USDC_ADDRESS = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
export const PENDLE_TOKEN_ADDRESS = "0x808507121b80c02388fad14726482e061b8da827";
export const PENDLE_ETH_SUSHISWAP = "0x37922c69b08babcceae735a31235c81f1d1e8e43";

export const ERROR_COMPOUND_MARKET = "0x73a62de3b35126ae8f6a4547b9cbc170bc852001";
export const ERROR_COMPOUND_SUSHISWAP_PAIR = "0x1e790169999eb3bf4bcd41c650ab417faa53138d";

export const LIQUIDITY_MINING_PROXY = "0x70e649eb230dbaee72303ac14fa817b81dedcf0b";
export const LM_ALLOC_DENOM = 1000000000n;
export const isMainnet = true;

// ---------- numeric helpers ----------

/** lowercase an address / hash (HyperIndex delivers checksummed addresses). */
export function low(input: string): string {
  return input.toLowerCase();
}

/** AssemblyScript BigInt.toBigDecimal() */
export function toBD(input: bigint): BigDecimal {
  return new BigDecimal(input.toString());
}

/** Port of exponentToBigDecimal (helpers.ts). */
export function exponentToBigDecimal(decimals: bigint): BigDecimal {
  let bd = new BigDecimal("1");
  const ten = new BigDecimal("10");
  for (let i = 0n; i < decimals; i++) {
    bd = bd.times(ten);
  }
  return bd;
}

/** Port of convertTokenToDecimal (helpers.ts). */
export function convertTokenToDecimal(tokenAmount: bigint, exchangeDecimals: bigint): BigDecimal {
  if (exchangeDecimals === ZERO_BI) {
    return toBD(tokenAmount);
  }
  return toBD(tokenAmount).div(exponentToBigDecimal(exchangeDecimals));
}

/** Port of isNullEthValue (token-fetch.ts). */
export function isNullEthValue(value: string): boolean {
  return value == "0x0000000000000000000000000000000000000000000000000000000000000001";
}

/**
 * graph-ts `Bytes.toString()` on a bytes32 return value: UTF-8 decode,
 * stopping at the first null byte (AssemblyScript's null-terminated decode —
 * this is why bytes32 symbols come out without trailing \0 padding).
 */
export function bytes32ToString(hex: string): string {
  if (!hex.startsWith("0x")) {
    // already decoded (e.g. injected by the test call mock)
    return hex;
  }
  const bytes: number[] = [];
  for (let i = 2; i + 1 < hex.length; i += 2) {
    const byte = parseInt(hex.slice(i, i + 2), 16);
    if (byte === 0) break; // null-terminated
    bytes.push(byte);
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/** AssemblyScript `Bytes32 forgeId.toString()` — decode forgeId bytes32 to its
 * human-readable string (e.g. "CompoundV2", "SushiswapSimple"). */
export function forgeIdToString(hex: string): string {
  return bytes32ToString(hex);
}
