/**
 * Offline test of the supply flow on a seeded market: AccrueInterest (runs
 * updateMarket with mocked, block-pinned eth_calls incl. the PriceOracle2
 * path used after block 7715908), then Mint and the accompanying Transfer in
 * the same transaction. Asserts Market, Account, AccountCToken,
 * AccountCTokenTransaction, MintEvent and TransferEvent with exact values.
 */
import { afterEach, describe, expect, it } from "vitest";
import { BigDecimal, createTestIndexer, type Market } from "envio";
import { setCallMock, type CallMockRule } from "../src/effects/calls";

const ORACLE = "0xddc46a3b076aec7ab17b3d503ed57bc8b9dbcc85";
const CBAT = "0x6c8c6b02e7b2be14d4fa6022dfd6d75921d90e4e";
const BAT = "0x0d8775f648430679a709e98d2b0cb6250d2887ef";
const CUSDC = "0x39aa39c021dfbae8fac545936693ac917d5e7563";
const IRM = "0x1111111111111111111111111111111111111111";
const MINTER = "0xabcdabcdabcdabcdabcdabcdabcdabcdabcdabcd";

const TX = "0x" + "aa".repeat(32);
const BLOCK = 7800000; // > 7715908 -> PriceOracle2 / ETH-based pricing path
const TS = 1559000000;

const ZERO = new BigDecimal("0");

function seedMarket(): Market {
  return {
    id: CBAT,
    borrowRate: ZERO,
    cash: ZERO,
    collateralFactor: ZERO,
    exchangeRate: ZERO,
    interestRateModelAddress: IRM,
    name: "Compound Basic Attention Token",
    reserves: ZERO,
    supplyRate: ZERO,
    symbol: "cBAT",
    totalBorrows: ZERO,
    totalSupply: ZERO,
    underlyingAddress: BAT,
    underlyingName: "Basic Attention Token",
    underlyingPrice: ZERO,
    underlyingSymbol: "BAT",
    accrualBlockNumber: 0,
    blockTimestamp: 0,
    borrowIndex: ZERO,
    reserveFactor: 100000000000000000n,
    underlyingPriceUSD: ZERO,
    underlyingDecimals: 18,
  };
}

afterEach(() => setCallMock(undefined));

describe("mint flow", () => {
  it("AccrueInterest + Mint + Transfer updates Market/Account/AccountCToken and stores events", async () => {
    const rules: CallMockRule[] = [
      // ---- updateMarket state reads (all pinned to BLOCK) ----
      { fn: "accrualBlockNumber", to: CBAT, result: big(7800000n) },
      { fn: "totalSupply", to: CBAT, result: big(50000n * 10n ** 8n) }, // 50,000 cBAT
      { fn: "exchangeRateStored", to: CBAT, result: big(2n * 10n ** 26n) }, // 0.02
      { fn: "borrowIndex", to: CBAT, result: big(1100000000000000000n) }, // 1.1
      { fn: "totalReserves", to: CBAT, result: big(0n) },
      { fn: "totalBorrows", to: CBAT, result: big(200n * 10n ** 18n) }, // 200 BAT
      { fn: "getCash", to: CBAT, result: big(1000n * 10n ** 18n) }, // 1,000 BAT
      { fn: "borrowRatePerBlock", to: CBAT, result: big(10n ** 10n) }, // * 2102400 / 1e18 = 0.021024
      { fn: "supplyRatePerBlock", to: CBAT, result: { kind: "revert" } }, // try_-branch -> 0
      // ---- oracle (PriceOracle2: getUnderlyingPrice(cToken)) ----
      // BAT: 5e15 / 10^(18-18+18) = 0.005 ETH
      { fn: "getUnderlyingPrice", to: ORACLE, args: [CBAT], result: big(5n * 10n ** 15n) },
      // USDC: 5e27 / 10^(18-6+18) = 0.005 ETH (i.e. ETH = $200)
      { fn: "getUnderlyingPrice", to: ORACLE, args: [CUSDC], result: big(5n * 10n ** 27n) },
    ];
    setCallMock({ strict: true, rules });

    const indexer = createTestIndexer();
    indexer.Comptroller.set({
      id: "1",
      priceOracle: ORACLE,
      closeFactor: 500000000000000000n,
      liquidationIncentive: 1080000000000000000n,
      maxAssets: 20n,
    });
    indexer.Market.set(seedMarket());

    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "CToken",
              event: "AccrueInterest",
              srcAddress: CBAT as `0x${string}`,
              logIndex: 1,
              params: {
                interestAccumulated: 10n ** 18n,
                borrowIndex: 1100000000000000000n,
                totalBorrows: 200n * 10n ** 18n,
              },
              block: { number: BLOCK, timestamp: TS },
            },
            {
              contract: "CToken",
              event: "Mint",
              srcAddress: CBAT as `0x${string}`,
              logIndex: 2,
              params: {
                minter: MINTER as `0x${string}`,
                mintAmount: 1000n * 10n ** 18n, // 1,000 BAT supplied
                mintTokens: 50000n * 10n ** 8n, // 50,000 cBAT minted
              },
              block: { number: BLOCK, timestamp: TS },
              transaction: { hash: TX },
            },
            {
              contract: "CToken",
              event: "Transfer",
              srcAddress: CBAT as `0x${string}`,
              logIndex: 3,
              params: {
                from: CBAT as `0x${string}`, // mints originate from the cToken address
                to: MINTER as `0x${string}`,
                amount: 50000n * 10n ** 8n,
              },
              block: { number: BLOCK, timestamp: TS },
              transaction: { hash: TX },
            },
          ],
        },
      },
    });

    // ---- Market updated by handleAccrueInterest -> updateMarket ----
    const market = await indexer.Market.getOrThrow(CBAT);
    expect(market.accrualBlockNumber).toBe(BLOCK);
    expect(market.blockTimestamp).toBe(TS);
    expect(market.totalSupply.toString()).toBe("50000");
    expect(market.exchangeRate.toString()).toBe("0.02");
    expect(market.borrowIndex.toString()).toBe("1.1");
    expect(market.reserves.toString()).toBe("0");
    expect(market.totalBorrows.toString()).toBe("200");
    expect(market.cash.toString()).toBe("1000");
    expect(market.borrowRate.toString()).toBe("0.021024");
    expect(market.supplyRate.toString()).toBe("0"); // try_supplyRatePerBlock reverted
    expect(market.underlyingPrice.toString()).toBe("0.005"); // in ETH
    expect(market.underlyingPriceUSD.toString()).toBe("1"); // 0.005 / 0.005

    // ---- MintEvent (id = txhash-logIndex) ----
    const mint = await indexer.MintEvent.getOrThrow(`${TX}-2`);
    expect(mint.amount.toString()).toBe("50000");
    expect(mint.to).toBe(MINTER);
    expect(mint.from).toBe(CBAT);
    expect(mint.blockNumber).toBe(BLOCK);
    expect(mint.blockTime).toBe(TS);
    expect(mint.cTokenSymbol).toBe("cBAT");
    expect(mint.underlyingAmount?.toString()).toBe("1000");

    // ---- TransferEvent ----
    const transfer = await indexer.TransferEvent.getOrThrow(`${TX}-3`);
    expect(transfer.amount.toString()).toBe("50000");
    expect(transfer.to).toBe(MINTER);
    expect(transfer.from).toBe(CBAT);
    expect(transfer.blockNumber).toBe(BLOCK);
    expect(transfer.blockTime).toBe(TS);
    expect(transfer.cTokenSymbol).toBe("cBAT");

    // ---- Account (created by handleTransfer's to-branch) ----
    const account = await indexer.Account.getOrThrow(MINTER);
    expect(account.countLiquidated).toBe(0);
    expect(account.countLiquidator).toBe(0);
    expect(account.hasBorrowed).toBe(false);

    // ---- AccountCToken (id = market-account) ----
    const stats = await indexer.AccountCToken.getOrThrow(`${CBAT}-${MINTER}`);
    expect(stats.market_id).toBe(CBAT);
    expect(stats.account_id).toBe(MINTER);
    expect(stats.symbol).toBe("cBAT");
    expect(stats.accrualBlockNumber).toBe(BigInt(BLOCK));
    expect(stats.enteredMarket).toBe(false);
    expect(stats.cTokenBalance.toString()).toBe("50000");
    // exchangeRate (0.02) * 50000 cTokens = 1000 underlying supplied
    expect(stats.totalUnderlyingSupplied.toString()).toBe("1000");
    expect(stats.totalUnderlyingRedeemed.toString()).toBe("0");
    expect(stats.accountBorrowIndex.toString()).toBe("0");
    expect(stats.totalUnderlyingBorrowed.toString()).toBe("0");
    expect(stats.totalUnderlyingRepaid.toString()).toBe("0");
    expect(stats.storedBorrowBalance.toString()).toBe("0");

    // ---- AccountCTokenTransaction (id = accountCToken-txhash-logIndex) ----
    const act = await indexer.AccountCTokenTransaction.getOrThrow(`${CBAT}-${MINTER}-${TX}-3`);
    expect(act.account_id).toBe(`${CBAT}-${MINTER}`);
    expect(act.tx_hash).toBe(TX);
    expect(act.timestamp).toBe(BigInt(TS));
    expect(act.block).toBe(BigInt(BLOCK));
    expect(act.logIndex).toBe(3n);
  });
});

function big(value: bigint) {
  return { kind: "bigint", value: value.toString() } as const;
}
