/**
 * Port of `src/contracts/getMarketPoolValueFromContract.ts`,
 * `getMarketTokensSupplyFromContract.ts` and `readerConfigs.ts`.
 *
 * Scoped to Arbitrum only (network = "arbitrum"). Both reads are block-pinned
 * (state-dependent). `try_getMarketTokenPrice` reverts are common for certain
 * market states; the subgraph falls back to ZERO and downstream fee-fraction
 * math handles a zero pool value, so we mirror that.
 */
import type { EffectCaller } from "envio";
import type { handlerContext } from "../types";
import { tryContractCall } from "./calls";
import { getMarketInfo } from "../entities/markets";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// Arbitrum reader config (from src/contracts/readerConfigs.ts)
const READER_ADDRESS = "0x38d91ed96283d62182fc6d990c24097a918a4d9b";
const DATA_STORE_ADDRESS = "0xfd70de6b91282d8017aa4e741e9ae325cab992d8";
const READER_BLOCK_NUMBER = 112723063 + 1;

const MAX_PNL_FACTOR_FOR_TRADERS =
  "0xab15365d3aa743e766355e2557c230d8f943e195dc84d9b2b05928a07b635ee1";

const GET_MARKET_TOKEN_PRICE_SIG =
  "function getMarketTokenPrice(address dataStore, (address marketToken, address indexToken, address longToken, address shortToken) market, (uint256 min, uint256 max) indexTokenPrice, (uint256 min, uint256 max) longTokenPrice, (uint256 min, uint256 max) shortTokenPrice, bytes32 pnlFactorType, bool maximize) view returns (int256, (int256 poolValue, int256 longPnl, int256 shortPnl, int256 netPnl, uint256 longTokenAmount, uint256 shortTokenAmount, uint256 longTokenUsd, uint256 shortTokenUsd, uint256 totalBorrowingFees, uint256 borrowingFeePoolFactor, uint256 impactPoolAmount))";

const TOTAL_SUPPLY_SIG = "function totalSupply() view returns (uint256)";

type PriceArg = { min: bigint; max: bigint };

async function priceFor(context: handlerContext, tokenAddress: string): Promise<PriceArg> {
  let minPrice = 0n;
  let maxPrice = 0n;
  const tokenPrice = await context.TokenPrice.get(tokenAddress);
  if (tokenPrice) {
    minPrice = tokenPrice.minPrice;
    maxPrice = tokenPrice.maxPrice;
  } else if (tokenAddress !== ZERO_ADDRESS) {
    // subgraph throws here; we log + use zero to avoid crashing the whole indexer
    context.log.error(`TokenPrice not found ${tokenAddress}`);
  }
  return { min: minPrice, max: maxPrice };
}

export async function getMarketPoolValueFromContract(
  context: handlerContext,
  effectCall: EffectCaller | null,
  marketAddress: string,
  blockNumber: number,
): Promise<bigint> {
  if (blockNumber < READER_BLOCK_NUMBER) {
    return 0n;
  }

  const marketInfo = await getMarketInfo(context, marketAddress);

  const marketArg = {
    marketToken: marketInfo.marketToken,
    indexToken: marketInfo.indexToken,
    longToken: marketInfo.longToken,
    shortToken: marketInfo.shortToken,
  };
  const indexTokenPriceArg = await priceFor(context, marketInfo.indexToken);
  const longTokenPriceArg = await priceFor(context, marketInfo.longToken);
  const shortTokenPriceArg = await priceFor(context, marketInfo.shortToken);

  const res = await tryContractCall<readonly [bigint, { poolValue: bigint }]>(
    effectCall,
    READER_ADDRESS,
    GET_MARKET_TOKEN_PRICE_SIG,
    "getMarketTokenPrice",
    [
      DATA_STORE_ADDRESS,
      marketArg,
      indexTokenPriceArg,
      longTokenPriceArg,
      shortTokenPriceArg,
      MAX_PNL_FACTOR_FOR_TRADERS,
      true,
    ],
    blockNumber,
    "getMarketTokenPrice",
  );

  if (res === null) {
    context.log.warn(`getMarketTokenPrice reverted for market ${marketAddress} at block ${blockNumber}`);
    return 0n;
  }
  return res[1].poolValue;
}

export async function getMarketTokensSupplyFromContract(
  effectCall: EffectCaller | null,
  marketAddress: string,
  blockNumber: number,
): Promise<bigint> {
  const res = await tryContractCall<bigint>(
    effectCall,
    marketAddress,
    TOTAL_SUPPLY_SIG,
    "totalSupply",
    [],
    blockNumber,
    "totalSupply",
  );
  return res === null ? 0n : res;
}
