import { BigDecimal } from "envio";

/** lowercase an address/hex string (HyperIndex delivers checksummed). */
export const low = (x: string): string => x.toLowerCase();

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const MOCK_USD_ADDRESS = "0x10f7fc1f91ba351f9c629c5947ad69bd03c05b96";

export const ZERO_BI = 0n;

export function zeroBD(): BigDecimal {
  return new BigDecimal(0);
}

// graph-node BigDecimal: 10^18 / 10^8 as decimals
export const ETH_PRECISION = new BigDecimal("1000000000000000000"); // 10^18
export const USD_PRECISION = new BigDecimal("100000000"); // 10^8

// Treasury addresses excluded from user reserve accounting on aToken Mint
// (mainnet + polygon collector contracts, lowercased).
export const TREASURY_ADDRESSES: string[] = [
  "0xb2289e329d2f85f1ed31adbb30ea345278f21bcf",
  "0xe8599f3cc5d38a9ad6f3684cd5cea72f10dbc383",
  "0xbe85413851d195fc6341619cd68bfdc26a25b928",
  "0x5ba7fd868c40c16f7adfae6cf87121e13fc2f7a0",
  "0x8a020d92d6b119978582be4d3edfdc9f7b28bf31",
  "0x053d55f9b5af8694c503eb288a1b7e552f590710",
  "0x464c71f6c2f760dda6093dcb91c24c39e5d6e18c",
];
