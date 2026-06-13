/**
 * Offline test of the market-creation flow: Comptroller.NewPriceOracle creates
 * the Comptroller singleton, then MarketListed creates Market entities (vBNB
 * native-underlying special case + a generic vBEP20) with all eth_calls mocked
 * via setCallMock (no RPC).
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTestIndexer } from "envio";
import { setCallMock, type CallMockRule } from "../src/effects/calls";

const COMPTROLLER = "0xfd36e2c2a6789db23113685031d7f16329158384";
const ORACLE = "0xb0fcf0d45c15235d4ebc30d3c01d7d0d72fd44ab";

const VBNB = "0xa07c5b74c9b40447a954e1466938b865b6bbea36";
const NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

const VUSDC = "0xeca88125a5adbe82614ffc12d0db554e2e2867c8";
const USDC = "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d";
const IRM = "0x594942c0e62ec577889777424cd367545c796a74";

const BLOCK = 2480000;
const TS = 1622000000;

const str = (value: string) => ({ kind: "string", value }) as const;
const num = (value: number) => ({ kind: "number", value }) as const;
const big = (value: bigint) => ({ kind: "bigint", value: value.toString() }) as const;
const revert = { kind: "revert" } as const;

afterEach(() => setCallMock(undefined));

describe("market listing flow", () => {
  it("NewPriceOracle creates Comptroller; MarketListed creates vBNB and a generic vBEP20 market", async () => {
    const rules: CallMockRule[] = [
      // ---- vBNB (native underlying; no underlying() / BEP20 calls) ----
      { fn: "comptroller", to: VBNB, result: str(COMPTROLLER) },
      { fn: "name", to: VBNB, result: str("Venus BNB") },
      { fn: "symbol", to: VBNB, result: str("vBNB") },
      { fn: "decimals", to: VBNB, result: num(8) },
      { fn: "venusSupplySpeeds", to: COMPTROLLER, args: [VBNB], result: big(1000n) },
      { fn: "venusBorrowSpeeds", to: COMPTROLLER, args: [VBNB], result: big(2000n) },
      { fn: "interestRateModel", to: VBNB, result: str(IRM) },
      { fn: "reserveFactorMantissa", to: VBNB, result: big(100000000000000000n) }, // 0.1
      // getUnderlyingPrice(vBNB): decimals 18 -> factor 36-18-2=16; 3e18 / 1e16 = 300 cents
      { fn: "getUnderlyingPrice", to: ORACLE, args: [VBNB], result: big(3n * 10n ** 18n) },
      { fn: "accrualBlockNumber", to: VBNB, result: big(2479999n) },
      { fn: "borrowRatePerBlock", to: VBNB, result: big(11111111n) },
      { fn: "supplyRatePerBlock", to: VBNB, result: big(22222222n) },
      { fn: "exchangeRateStored", to: VBNB, result: big(2n * 10n ** 26n) },
      { fn: "getCash", to: VBNB, result: big(1418171344423412457n) },
      { fn: "borrowIndex", to: VBNB, result: big(1100000000000000000n) }, // 1.1e18

      // ---- generic vUSDC (vBEP20: underlying() + BEP20 metadata) ----
      { fn: "comptroller", to: VUSDC, result: str(COMPTROLLER) },
      { fn: "name", to: VUSDC, result: str("Venus USDC") },
      { fn: "symbol", to: VUSDC, result: str("vUSDC") },
      { fn: "decimals", to: VUSDC, result: num(8) },
      { fn: "venusSupplySpeeds", to: COMPTROLLER, args: [VUSDC], result: revert }, // -> speeds 0
      { fn: "venusBorrowSpeeds", to: COMPTROLLER, args: [VUSDC], result: big(9999n) }, // ignored (supply reverted)
      { fn: "underlying", to: VUSDC, result: str(USDC) },
      { fn: "name", to: USDC, result: str("USD Coin") },
      { fn: "symbol", to: USDC, result: str("USDC") },
      { fn: "decimals", to: USDC, result: num(18) },
      { fn: "interestRateModel", to: VUSDC, result: str(IRM) },
      { fn: "reserveFactorMantissa", to: VUSDC, result: big(0n) },
      // getUnderlyingPrice(vUSDC): decimals 18 -> factor 16; 1e18 / 1e16 = 100 cents
      { fn: "getUnderlyingPrice", to: ORACLE, args: [VUSDC], result: big(1n * 10n ** 18n) },
      { fn: "accrualBlockNumber", to: VUSDC, result: big(2479998n) },
      { fn: "borrowRatePerBlock", to: VUSDC, result: big(33333333n) },
      { fn: "supplyRatePerBlock", to: VUSDC, result: revert }, // -> NOT_AVAILABLE (-1)
      { fn: "exchangeRateStored", to: VUSDC, result: big(2n * 10n ** 14n) },
      { fn: "getCash", to: VUSDC, result: big(5000n) },
      { fn: "borrowIndex", to: VUSDC, result: big(1000000000000000000n) },
    ];
    setCallMock({ strict: true, rules });

    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        56: {
          simulate: [
            {
              contract: "Comptroller",
              event: "NewPriceOracle",
              srcAddress: COMPTROLLER as `0x${string}`,
              params: { oldPriceOracle: NATIVE as `0x${string}`, newPriceOracle: ORACLE as `0x${string}` },
              block: { number: BLOCK - 1, timestamp: TS - 15 },
            },
            {
              contract: "Comptroller",
              event: "MarketListed",
              srcAddress: COMPTROLLER as `0x${string}`,
              // checksummed on purpose: ids must be lowercased
              params: { vToken: "0xA07c5b74C9B40447a954e1466938b865b6BBea36" as `0x${string}` },
              block: { number: BLOCK, timestamp: TS },
            },
            {
              contract: "Comptroller",
              event: "MarketListed",
              srcAddress: COMPTROLLER as `0x${string}`,
              params: { vToken: VUSDC as `0x${string}` },
              block: { number: BLOCK + 1, timestamp: TS + 15 },
            },
          ],
        },
      },
    });

    // ---- Comptroller singleton (id = comptroller address) ----
    const comptroller = await indexer.Comptroller.getOrThrow(COMPTROLLER);
    expect(comptroller.id).toBe(COMPTROLLER);
    expect(comptroller.address).toBe(COMPTROLLER);
    expect(comptroller.priceOracle).toBe(ORACLE);
    expect(comptroller.closeFactorMantissa).toBe(0n);
    expect(comptroller.liquidationIncentive).toBe(0n);

    // ---- vBNB market (native underlying) ----
    const vbnb = await indexer.Market.getOrThrow(VBNB);
    expect(vbnb.id).toBe(VBNB);
    expect(vbnb.address).toBe(VBNB);
    expect(vbnb.symbol).toBe("vBNB");
    expect(vbnb.name).toBe("Venus BNB");
    expect(vbnb.vTokenDecimals).toBe(8);
    expect(vbnb.isListed).toBe(true);
    expect(vbnb.underlyingToken_id).toBe(NATIVE);
    expect(vbnb.interestRateModelAddress).toBe(IRM);
    expect(vbnb.reserveFactorMantissa).toBe(100000000000000000n);
    expect(vbnb.collateralFactorMantissa).toBe(0n); // reset on listing
    expect(vbnb.xvsSupplySpeed).toBe(1000n);
    expect(vbnb.xvsBorrowSpeed).toBe(2000n);
    expect(vbnb.xvsSupplyStateIndex).toBe(1000000000000000000000000000000000000n);
    expect(vbnb.xvsBorrowStateIndex).toBe(1000000000000000000000000000000000000n);
    expect(vbnb.xvsSupplyStateBlock).toBe(BigInt(BLOCK));
    expect(vbnb.xvsBorrowStateBlock).toBe(BigInt(BLOCK));
    expect(vbnb.accrualBlockNumber).toBe(2479999n); // from accrualBlockNumber() call
    expect(vbnb.lastUnderlyingPriceCents).toBe(300n);
    expect(vbnb.lastUnderlyingPriceBlockNumber).toBe(BigInt(BLOCK));
    expect(vbnb.borrowRateMantissa).toBe(11111111n);
    expect(vbnb.supplyRateMantissa).toBe(22222222n);
    expect(vbnb.exchangeRateMantissa).toBe(2n * 10n ** 26n);
    expect(vbnb.cashMantissa).toBe(1418171344423412457n);
    expect(vbnb.borrowIndex).toBe(1100000000000000000n);
    expect(vbnb.totalSupplyVTokenMantissa).toBe(0n);
    expect(vbnb.totalBorrowsMantissa).toBe(0n);
    expect(vbnb.reservesMantissa).toBe(0n);
    expect(vbnb.supplierCount).toBe(0n);
    expect(vbnb.borrowerCount).toBe(0n);
    expect(vbnb.totalXvsDistributedMantissa).toBe(0n);

    // native Token entity
    const native = await indexer.Token.getOrThrow(NATIVE);
    expect(native.name).toBe("BNB");
    expect(native.symbol).toBe("BNB");
    expect(native.decimals).toBe(18);

    // ---- vUSDC market (generic vBEP20) ----
    const vusdc = await indexer.Market.getOrThrow(VUSDC);
    expect(vusdc.underlyingToken_id).toBe(USDC);
    expect(vusdc.symbol).toBe("vUSDC");
    expect(vusdc.name).toBe("Venus USDC");
    // supply speed reverted -> both speeds 0 (preserved copy-paste bug gates borrow on supply)
    expect(vusdc.xvsSupplySpeed).toBe(0n);
    expect(vusdc.xvsBorrowSpeed).toBe(0n);
    expect(vusdc.supplyRateMantissa).toBe(-1n); // try_supplyRatePerBlock reverted -> NOT_AVAILABLE
    expect(vusdc.borrowRateMantissa).toBe(33333333n);
    expect(vusdc.reserveFactorMantissa).toBe(0n);
    expect(vusdc.lastUnderlyingPriceCents).toBe(100n);
    expect(vusdc.accrualBlockNumber).toBe(2479998n);

    // underlying USDC Token entity
    const usdc = await indexer.Token.getOrThrow(USDC);
    expect(usdc.name).toBe("USD Coin");
    expect(usdc.symbol).toBe("USDC");
    expect(usdc.decimals).toBe(18);
  });
});
