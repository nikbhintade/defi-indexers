/**
 * Offline test of the market-creation flow: Comptroller.NewPriceOracle
 * creates the Comptroller singleton, then MarketListed creates Market
 * entities (cERC20 generic path, cETH special case, SAI/"DAI" special case)
 * with all eth_calls mocked via setCallMock (no RPC).
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTestIndexer } from "envio";
import { setCallMock, type CallMockRule } from "../src/effects/calls";

const COMPTROLLER = "0x3d9819210a31b4961b30ef54be2aed79b9c9cd3b";
const ORACLE = "0x02557a5e05defeffd4cae6d83ea3d173b272c904";

const CBAT = "0x6c8c6b02e7b2be14d4fa6022dfd6d75921d90e4e";
const BAT = "0x0d8775f648430679a709e98d2b0cb6250d2887ef";
const CETH = "0x4ddc2d193948926d02f9b1fe9e1daa0718270ed5";
const CSAI = "0xf5dce57282a584d2746faf1593d3121fcac444dc";
const SAI = "0x89d24a6b4ccb1b6faa2625fe562bdd9a23260359"; // daiAddress in the original
const IRM = "0x1111111111111111111111111111111111111111";

const ZERO = "0x0000000000000000000000000000000000000000";

const str = (value: string) => ({ kind: "string", value }) as const;
const num = (value: number) => ({ kind: "number", value }) as const;
const big = (value: bigint) => ({ kind: "bigint", value: value.toString() }) as const;
const revert = { kind: "revert" } as const;

afterEach(() => setCallMock(undefined));

describe("market listing flow", () => {
  it("NewPriceOracle creates Comptroller; MarketListed creates Markets (cERC20 / cETH / SAI cases)", async () => {
    const rules: CallMockRule[] = [
      // cBAT: generic cERC20 path
      { fn: "underlying", to: CBAT, result: str(BAT) },
      { fn: "decimals", to: BAT, result: num(18) },
      { fn: "name", to: BAT, result: str("Basic Attention Token") },
      { fn: "symbol", to: BAT, result: str("BAT") },
      { fn: "interestRateModel", to: CBAT, result: str(IRM) },
      { fn: "reserveFactorMantissa", to: CBAT, result: big(100000000000000000n) },
      { fn: "name", to: CBAT, result: str("Compound Basic Attention Token") },
      { fn: "symbol", to: CBAT, result: str("cBAT") },
      // cETH: no underlying()/ERC20 calls; try-calls revert to defaults
      { fn: "interestRateModel", to: CETH, result: revert },
      { fn: "reserveFactorMantissa", to: CETH, result: revert },
      { fn: "name", to: CETH, result: str("Compound Ether") },
      { fn: "symbol", to: CETH, result: str("cETH") },
      // cSAI: SAI-address special case (no ERC20 name()/symbol() calls — the
      // strict mock proves the hardcoded branch is taken)
      { fn: "underlying", to: CSAI, result: str(SAI) },
      { fn: "decimals", to: SAI, result: num(18) },
      { fn: "interestRateModel", to: CSAI, result: str(IRM) },
      { fn: "reserveFactorMantissa", to: CSAI, result: big(0n) },
      { fn: "name", to: CSAI, result: str("Compound Dai") },
      { fn: "symbol", to: CSAI, result: str("cDAI") },
    ];
    setCallMock({ strict: true, rules });

    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "Comptroller",
              event: "NewPriceOracle",
              srcAddress: COMPTROLLER as `0x${string}`,
              params: { oldPriceOracle: ZERO as `0x${string}`, newPriceOracle: ORACLE as `0x${string}` },
              block: { number: 7710000, timestamp: 1557800000 },
            },
            {
              contract: "Comptroller",
              event: "MarketListed",
              srcAddress: COMPTROLLER as `0x${string}`,
              // checksummed on purpose: ids must be lowercased
              params: { cToken: "0x6C8c6b02E7b2BE14d4fA6022Dfd6d75921D90E4E" as `0x${string}` },
              block: { number: 7710001, timestamp: 1557800015 },
            },
            {
              contract: "Comptroller",
              event: "MarketListed",
              srcAddress: COMPTROLLER as `0x${string}`,
              params: { cToken: CETH as `0x${string}` },
              block: { number: 7710002, timestamp: 1557800030 },
            },
            {
              contract: "Comptroller",
              event: "MarketListed",
              srcAddress: COMPTROLLER as `0x${string}`,
              params: { cToken: CSAI as `0x${string}` },
              block: { number: 7710003, timestamp: 1557800045 },
            },
          ],
        },
      },
    });

    // Comptroller singleton, id '1'
    const comptroller = await indexer.Comptroller.getOrThrow("1");
    expect(comptroller.priceOracle).toBe(ORACLE);
    expect(comptroller.closeFactor).toBeUndefined();

    // cBAT market (generic cERC20)
    const cbat = await indexer.Market.getOrThrow(CBAT);
    expect(cbat.id).toBe(CBAT);
    expect(cbat.underlyingAddress).toBe(BAT);
    expect(cbat.underlyingDecimals).toBe(18);
    expect(cbat.underlyingName).toBe("Basic Attention Token");
    expect(cbat.underlyingSymbol).toBe("BAT");
    expect(cbat.underlyingPrice.toString()).toBe("0");
    expect(cbat.underlyingPriceUSD.toString()).toBe("0");
    expect(cbat.name).toBe("Compound Basic Attention Token");
    expect(cbat.symbol).toBe("cBAT");
    expect(cbat.interestRateModelAddress).toBe(IRM);
    expect(cbat.reserveFactor).toBe(100000000000000000n);
    expect(cbat.borrowRate.toString()).toBe("0");
    expect(cbat.exchangeRate.toString()).toBe("0");
    expect(cbat.totalSupply.toString()).toBe("0");
    expect(cbat.totalBorrows.toString()).toBe("0");
    expect(cbat.cash.toString()).toBe("0");
    expect(cbat.reserves.toString()).toBe("0");
    expect(cbat.collateralFactor.toString()).toBe("0");
    expect(cbat.accrualBlockNumber).toBe(0);
    expect(cbat.blockTimestamp).toBe(0);
    expect(cbat.borrowIndex.toString()).toBe("0");

    // cETH market (hardcoded underlying metadata)
    const ceth = await indexer.Market.getOrThrow(CETH);
    expect(ceth.underlyingAddress).toBe(ZERO);
    expect(ceth.underlyingDecimals).toBe(18);
    expect(ceth.underlyingName).toBe("Ether");
    expect(ceth.underlyingSymbol).toBe("ETH");
    expect(ceth.underlyingPrice.toString()).toBe("1");
    expect(ceth.underlyingPriceUSD.toString()).toBe("0");
    expect(ceth.interestRateModelAddress).toBe(ZERO); // try_interestRateModel reverted
    expect(ceth.reserveFactor).toBe(0n); // try_reserveFactorMantissa reverted
    expect(ceth.name).toBe("Compound Ether");
    expect(ceth.symbol).toBe("cETH");

    // cSAI market (hardcoded "DAI" metadata for the SAI address)
    const csai = await indexer.Market.getOrThrow(CSAI);
    expect(csai.underlyingAddress).toBe(SAI);
    expect(csai.underlyingName).toBe("Dai Stablecoin v1.0 (DAI)");
    expect(csai.underlyingSymbol).toBe("DAI");
    expect(csai.underlyingPrice.toString()).toBe("0");
    expect(csai.underlyingPriceUSD.toString()).toBe("0");
  });
});
