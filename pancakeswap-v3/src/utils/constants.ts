/**
 * Port of utils/constants.template.ts rendered with BSC (config/bsc.js) values.
 */
import { BigDecimal } from "envio";

// graph-node BigDecimal keeps 34 significant digits and never serializes with
// exponents. Configure bignumber.js to approximate that behaviour.
BigDecimal.config({
  DECIMAL_PLACES: 34,
  EXPONENTIAL_AT: [-1000000, 1000000],
});

export const ADDRESS_ZERO = "0x0000000000000000000000000000000000000000";
// BSC v3 factory
export const FACTORY_ADDRESS = "0x0bfbcf9fa4f9c56b0f40a671ad40e0805a091865";
// BSC NonfungiblePositionManager
export const NFPM_ADDRESS = "0x46a15b0b27311cedf172ab29e4f4766fbe7f4364";

export const ZERO_BI = 0n;
export const ONE_BI = 1n;
export const ZERO_BD = new BigDecimal("0");
export const ONE_BD = new BigDecimal("1");
export const BI_18 = 18n;
export const TWO_BD = new BigDecimal("2");

/** lowercase an address / hash (HyperIndex delivers checksummed addresses). */
export function low(input: string): string {
  return input.toLowerCase();
}
