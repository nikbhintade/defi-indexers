/**
 * Port of src/common/networkSpecific.ts — Ethereum mainnet deployment only.
 * All addresses lowercase.
 */
import { ZERO_ADDRESS } from "./constants";

export function getConfiguratorProxyAddress(): string {
  return "0x316f9708bb98af7da9c68c1c3b5e79039cd336e3";
}

export function getCometRewardAddress(): string {
  return "0x1b0e765f6224c21223aea2af16c1c46e38885a40";
}

export function getCompTokenAddress(): string {
  return "0xc00e94cb662c3520282e6f5717214004a7f26888";
}

export function getChainlinkEthUsdPriceFeedAddress(): string {
  return "0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419";
}

export function getChainlinkCompUsdPriceFeedAddress(): string {
  return "0xdbd020caef83efd542f4de03e3cf0c28a4428bd5";
}

// Price feed for the market's unit of account to USD. The market's price
// feeds return prices in this unit of account. If not listed, USD is assumed
// to already be the unit of account (returns zero address).
const marketUnitOfAccountToUsdPriceFeed = new Map<string, string>([
  // WETH market: ETH / USD
  ["0xa17581a9e3356d9a858b789d68b4d866e593ae94", getChainlinkEthUsdPriceFeedAddress()],
  // wstETH market
  ["0x3d0bb1ccab520a66e607822fc55bc921738fafe3", "0x164b276057258d81941e97b0a900d4c7b358bce0"],
]);

/** Returns zero address if the unit of account is already USD */
export function getMarketUnitOfAccountToUsdPriceFeed(marketAddress: string): string {
  return marketUnitOfAccountToUsdPriceFeed.get(marketAddress.toLowerCase()) ?? ZERO_ADDRESS;
}
