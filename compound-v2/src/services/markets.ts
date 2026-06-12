/**
 * Port of src/mappings/markets.ts: createMarket, updateMarket and the price
 * oracle logic (PriceOracle1 before/at block 7715908, PriceOracle2 after;
 * USD-based oracle after block 10678764; cETH / cUSDC / DAI special cases).
 *
 * Non-`try_` subgraph calls would abort graph-node on revert; here they fall
 * back to neutral values with an error log (see MIGRATION.md).
 */
import { BigDecimal, type EvmOnEventContext, type Market } from "envio";
import {
  cTokenAccrualBlockNumber,
  cTokenBorrowIndex,
  cTokenBorrowRatePerBlock,
  cTokenExchangeRateStored,
  cTokenGetCash,
  cTokenInterestRateModel,
  cTokenName,
  cTokenReserveFactorMantissa,
  cTokenSupplyRatePerBlock,
  cTokenSymbol,
  cTokenTotalBorrows,
  cTokenTotalReserves,
  cTokenTotalSupply,
  cTokenUnderlying,
  erc20Decimals,
  erc20Name,
  erc20Symbol,
  oracle1GetPrice,
  oracle2GetUnderlyingPrice,
} from "../effects/contracts";
import {
  ADDRESS_ZERO,
  cETHAddress,
  cUSDCAddress,
  daiAddress,
  priceOracle1Address,
  USDCAddress,
} from "../constants";
import {
  cTokenDecimalsBD,
  exponentToBigDecimal,
  mantissaFactor,
  mantissaFactorBD,
  toBD,
  truncate,
  zeroBD,
} from "../utils";

async function getOracleAddress(context: EvmOnEventContext): Promise<string> {
  // Original: Comptroller.load('1').priceOracle as Address — crashes when
  // missing. NewPriceOracle is the first Comptroller event on mainnet, so the
  // oracle is always set by the time any market event needs it.
  const comptroller = await context.Comptroller.getOrThrow("1");
  if (comptroller.priceOracle == undefined) {
    throw new Error("Comptroller.priceOracle is not set");
  }
  return comptroller.priceOracle;
}

/** Used for all cERC20 contracts. Returns the token price (in ETH before block
 *  10678764; the oracle returns USD afterwards). */
async function getTokenPrice(
  context: EvmOnEventContext,
  blockNumber: number,
  eventAddress: string,
  underlyingAddress: string,
  underlyingDecimals: number,
): Promise<BigDecimal> {
  const oracleAddress = await getOracleAddress(context);
  let underlyingPrice: BigDecimal;

  /* PriceOracle2 is used at the block the Comptroller starts using it.
   * See block 7715908. This must use the cToken address.
   *
   * Note this returns the value without factoring in token decimals and wei,
   * so we must divide by (ethDecimals - tokenDecimals + 18).
   * USDC would be 10 ^ ((18 - 6) + 18) = 10 ^ 30 */
  if (blockNumber > 7715908) {
    const mantissaDecimalFactor = 18 - underlyingDecimals + 18;
    const bdFactor = exponentToBigDecimal(mantissaDecimalFactor);
    const tryPrice = await oracle2GetUnderlyingPrice(context.effect, oracleAddress, eventAddress, blockNumber);

    underlyingPrice = tryPrice === null ? zeroBD : toBD(tryPrice).div(bdFactor);

    /* PriceOracle(1) is used (only for the first ~100 blocks of Comptroller).
     * This must use the token address, not the cToken address.
     * Note this returns the value already factoring in token decimals and wei,
     * therefore we only need to divide by the mantissa, 10^18 */
  } else {
    const price = await oracle1GetPrice(context.effect, priceOracle1Address, underlyingAddress, blockNumber);
    if (price === null) {
      // non-try call in the original (would abort graph-node)
      context.log.error(`PriceOracle.getPrice reverted for ${underlyingAddress} at block ${blockNumber}`);
      underlyingPrice = zeroBD;
    } else {
      underlyingPrice = toBD(price).div(mantissaFactorBD);
    }
  }
  return underlyingPrice;
}

/** Returns the price of USDC in eth. i.e. 0.005 would mean ETH is $200 */
async function getUSDCpriceETH(context: EvmOnEventContext, blockNumber: number): Promise<BigDecimal> {
  const oracleAddress = await getOracleAddress(context);
  let usdPrice: BigDecimal;

  // See notes on block number if statement in getTokenPrice()
  if (blockNumber > 7715908) {
    const mantissaDecimalFactorUSDC = 18 - 6 + 18;
    const bdFactorUSDC = exponentToBigDecimal(mantissaDecimalFactorUSDC);
    const tryPrice = await oracle2GetUnderlyingPrice(context.effect, oracleAddress, cUSDCAddress, blockNumber);

    usdPrice = tryPrice === null ? zeroBD : toBD(tryPrice).div(bdFactorUSDC);
  } else {
    const price = await oracle1GetPrice(context.effect, priceOracle1Address, USDCAddress, blockNumber);
    if (price === null) {
      // non-try call in the original (would abort graph-node)
      context.log.error(`PriceOracle.getPrice reverted for USDC at block ${blockNumber}`);
      usdPrice = zeroBD;
    } else {
      usdPrice = toBD(price).div(mantissaFactorBD);
    }
  }
  return usdPrice;
}

/** Only to be used after block 10678764, since it's aimed to fix the change
 *  to USD based price oracle. */
async function getETHinUSD(context: EvmOnEventContext, blockNumber: number): Promise<BigDecimal> {
  const oracleAddress = await getOracleAddress(context);
  const tryPrice = await oracle2GetUnderlyingPrice(context.effect, oracleAddress, cETHAddress, blockNumber);

  return tryPrice === null ? zeroBD : toBD(tryPrice).div(mantissaFactorBD);
}

/**
 * Port of createMarket. `blockNumber` pins the state-dependent try-calls
 * (interestRateModel, reserveFactorMantissa) to the event block.
 * Returns the (unsaved) Market; callers persist it with context.Market.set.
 */
export async function createMarket(
  context: EvmOnEventContext,
  marketAddress: string,
  blockNumber: number,
): Promise<Market> {
  const ec = context.effect;
  let underlyingAddress: string;
  let underlyingDecimals: number;
  let underlyingPrice: BigDecimal;
  let underlyingPriceUSD: BigDecimal;
  let underlyingName: string;
  let underlyingSymbol: string;

  // It is cETH, which has a slightly different interface
  if (marketAddress == cETHAddress) {
    underlyingAddress = ADDRESS_ZERO;
    underlyingDecimals = 18;
    underlyingPrice = new BigDecimal("1");
    underlyingName = "Ether";
    underlyingSymbol = "ETH";
    underlyingPriceUSD = zeroBD;
    // It is all other cERC20 contracts
  } else {
    const underlying = await cTokenUnderlying(ec, marketAddress);
    if (underlying === null) {
      // non-try call in the original (would abort graph-node)
      context.log.error(`CToken.underlying reverted for ${marketAddress}`);
      underlyingAddress = ADDRESS_ZERO;
    } else {
      underlyingAddress = underlying;
    }
    underlyingDecimals = (await erc20Decimals(ec, underlyingAddress)) ?? 0;
    if (underlyingAddress != daiAddress) {
      underlyingName = (await erc20Name(ec, underlyingAddress)) ?? "";
      underlyingSymbol = (await erc20Symbol(ec, underlyingAddress)) ?? "";
    } else {
      underlyingName = "Dai Stablecoin v1.0 (DAI)";
      underlyingSymbol = "DAI";
    }
    underlyingPriceUSD = zeroBD;
    underlyingPrice = zeroBD;
    if (marketAddress == cUSDCAddress) {
      underlyingPriceUSD = new BigDecimal("1");
    }
  }

  const interestRateModelAddress = await cTokenInterestRateModel(ec, marketAddress, blockNumber);
  const reserveFactor = await cTokenReserveFactorMantissa(ec, marketAddress, blockNumber);

  return {
    id: marketAddress,
    underlyingAddress,
    underlyingDecimals,
    underlyingPrice,
    underlyingName,
    underlyingSymbol,
    underlyingPriceUSD,
    borrowRate: zeroBD,
    cash: zeroBD,
    collateralFactor: zeroBD,
    exchangeRate: zeroBD,
    interestRateModelAddress: interestRateModelAddress === null ? ADDRESS_ZERO : interestRateModelAddress,
    name: (await cTokenName(ec, marketAddress)) ?? "",
    reserves: zeroBD,
    supplyRate: zeroBD,
    symbol: (await cTokenSymbol(ec, marketAddress)) ?? "",
    totalBorrows: zeroBD,
    totalSupply: zeroBD,
    accrualBlockNumber: 0,
    blockTimestamp: 0,
    borrowIndex: zeroBD,
    reserveFactor: reserveFactor === null ? 0n : reserveFactor,
  };
}

/** Non-try contract read: revert would abort graph-node; fall back to 0n. */
async function mustBigInt(
  context: EvmOnEventContext,
  promise: Promise<bigint | null>,
  what: string,
): Promise<bigint> {
  const value = await promise;
  if (value === null) {
    context.log.error(`***CALL FAILED*** : cERC20 ${what}() reverted`);
    return 0n;
  }
  return value;
}

/**
 * Port of updateMarket. Persists the updated Market (when stale) and returns
 * it, exactly like the original returned the saved entity.
 */
export async function updateMarket(
  context: EvmOnEventContext,
  marketAddress: string,
  blockNumber: number,
  blockTimestamp: number,
): Promise<Market> {
  const marketID = marketAddress;
  let market = await context.Market.get(marketID);
  if (market == undefined) {
    market = await createMarket(context, marketID, blockNumber);
  }

  // Only updateMarket if it has not been updated this block
  if (market.accrualBlockNumber != blockNumber) {
    const ec = context.effect;
    const contractAddress = market.id;
    const updated = { ...market };

    // After block 10678764 price is calculated based on USD instead of ETH
    if (blockNumber > 10678764) {
      const ethPriceInUSD = await getETHinUSD(context, blockNumber);

      // if cETH, we only update USD price
      if (market.id == cETHAddress) {
        updated.underlyingPriceUSD = truncate(ethPriceInUSD, market.underlyingDecimals);
      } else {
        const tokenPriceUSD = await getTokenPrice(
          context,
          blockNumber,
          contractAddress,
          market.underlyingAddress,
          market.underlyingDecimals,
        );
        updated.underlyingPrice = truncate(tokenPriceUSD.div(ethPriceInUSD), market.underlyingDecimals);
        // if USDC, we only update ETH price
        if (market.id != cUSDCAddress) {
          updated.underlyingPriceUSD = truncate(tokenPriceUSD, market.underlyingDecimals);
        }
      }
    } else {
      const usdPriceInEth = await getUSDCpriceETH(context, blockNumber);

      // if cETH, we only update USD price
      if (market.id == cETHAddress) {
        updated.underlyingPriceUSD = truncate(
          updated.underlyingPrice.div(usdPriceInEth),
          market.underlyingDecimals,
        );
      } else {
        const tokenPriceEth = await getTokenPrice(
          context,
          blockNumber,
          contractAddress,
          market.underlyingAddress,
          market.underlyingDecimals,
        );
        updated.underlyingPrice = truncate(tokenPriceEth, market.underlyingDecimals);
        // if USDC, we only update ETH price
        if (market.id != cUSDCAddress) {
          updated.underlyingPriceUSD = truncate(
            updated.underlyingPrice.div(usdPriceInEth),
            market.underlyingDecimals,
          );
        }
      }
    }

    updated.accrualBlockNumber = Number(
      await mustBigInt(context, cTokenAccrualBlockNumber(ec, contractAddress, blockNumber), "accrualBlockNumber"),
    );
    updated.blockTimestamp = blockTimestamp;
    updated.totalSupply = toBD(
      await mustBigInt(context, cTokenTotalSupply(ec, contractAddress, blockNumber), "totalSupply"),
    ).div(cTokenDecimalsBD);

    /* Exchange rate explanation
       In Practice
        - If you call the cDAI contract on etherscan it comes back (2.0 * 10^26)
        - If you call the cUSDC contract on etherscan it comes back (2.0 * 10^14)
        - The real value is ~0.02. So cDAI is off by 10^28, and cUSDC 10^16
       How to calculate for tokens with different decimals
        - Must div by tokenDecimals, 10^market.underlyingDecimals
        - Must multiply by ctokenDecimals, 10^8
        - Must div by mantissa, 10^18
     */
    updated.exchangeRate = truncate(
      toBD(await mustBigInt(context, cTokenExchangeRateStored(ec, contractAddress, blockNumber), "exchangeRateStored"))
        .div(exponentToBigDecimal(market.underlyingDecimals))
        .times(cTokenDecimalsBD)
        .div(mantissaFactorBD),
      mantissaFactor,
    );
    updated.borrowIndex = truncate(
      toBD(await mustBigInt(context, cTokenBorrowIndex(ec, contractAddress, blockNumber), "borrowIndex")).div(
        mantissaFactorBD,
      ),
      mantissaFactor,
    );

    updated.reserves = truncate(
      toBD(await mustBigInt(context, cTokenTotalReserves(ec, contractAddress, blockNumber), "totalReserves")).div(
        exponentToBigDecimal(market.underlyingDecimals),
      ),
      market.underlyingDecimals,
    );
    updated.totalBorrows = truncate(
      toBD(await mustBigInt(context, cTokenTotalBorrows(ec, contractAddress, blockNumber), "totalBorrows")).div(
        exponentToBigDecimal(market.underlyingDecimals),
      ),
      market.underlyingDecimals,
    );
    updated.cash = truncate(
      toBD(await mustBigInt(context, cTokenGetCash(ec, contractAddress, blockNumber), "getCash")).div(
        exponentToBigDecimal(market.underlyingDecimals),
      ),
      market.underlyingDecimals,
    );

    // Must convert to BigDecimal, and remove 10^18 that is used for Exp in Compound Solidity
    updated.borrowRate = truncate(
      toBD(await mustBigInt(context, cTokenBorrowRatePerBlock(ec, contractAddress, blockNumber), "borrowRatePerBlock"))
        .times(new BigDecimal("2102400"))
        .div(mantissaFactorBD),
      mantissaFactor,
    );

    // This fails on only the first call to cZRX. It is unclear why, but otherwise it works.
    // So we handle it like this.
    const supplyRatePerBlock = await cTokenSupplyRatePerBlock(ec, contractAddress, blockNumber);
    if (supplyRatePerBlock === null) {
      context.log.info("***CALL FAILED*** : cERC20 supplyRatePerBlock() reverted");
      updated.supplyRate = zeroBD;
    } else {
      updated.supplyRate = truncate(
        toBD(supplyRatePerBlock).times(new BigDecimal("2102400")).div(mantissaFactorBD),
        mantissaFactor,
      );
    }
    context.Market.set(updated);
    market = updated;
  }
  return market;
}
