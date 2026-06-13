/**
 * Offline test of the supply flow on a seeded market. Simulates a v2 Mint
 * (VTokenUpdatedEvents) and asserts the Market total supply, the created
 * MarketPosition (balance + supplierCount transition), and the Transaction
 * entity — all with exact values and byte-for-byte ids. Only one eth_call is
 * needed (try_borrowIndex on position creation), mocked via setCallMock.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTestIndexer, type Market } from "envio";
import { setCallMock, type CallMockRule } from "../src/effects/calls";
import { getMarketPositionId, getTransactionId } from "../src/utilities/ids";

const COMPTROLLER = "0xfd36e2c2a6789db23113685031d7f16329158384";
const ORACLE = "0xb0fcf0d45c15235d4ebc30d3c01d7d0d72fd44ab";
const VUSDC = "0xeca88125a5adbe82614ffc12d0db554e2e2867c8";
const USDC = "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d";
const IRM = "0x594942c0e62ec577889777424cd367545c796a74";
const MINTER = "0xabcdabcdabcdabcdabcdabcdabcdabcdabcdabcd";

const TX = "0x" + "bb".repeat(32);
const BLOCK = 2500000;
const TS = 1622500000;

const big = (value: bigint) => ({ kind: "bigint", value: value.toString() }) as const;

function seedMarket(): Market {
  return {
    id: VUSDC,
    address: VUSDC,
    vTokenDecimals: 8,
    name: "Venus USDC",
    symbol: "vUSDC",
    isListed: true,
    borrowRateMantissa: 0n,
    cashMantissa: 0n,
    collateralFactorMantissa: 0n,
    exchangeRateMantissa: 0n,
    interestRateModelAddress: IRM,
    reservesMantissa: 0n,
    supplyRateMantissa: 0n,
    totalBorrowsMantissa: 0n,
    totalSupplyVTokenMantissa: 1000n * 10n ** 8n, // already 1,000 vUSDC outstanding
    underlyingToken_id: USDC,
    xvsSupplyStateBlock: BigInt(BLOCK - 100),
    xvsSupplyStateIndex: 1000000000000000000000000000000000000n,
    xvsBorrowStateBlock: BigInt(BLOCK - 100),
    xvsBorrowStateIndex: 1000000000000000000000000000000000000n,
    xvsSupplySpeed: 1000n,
    xvsBorrowSpeed: 2000n,
    accrualBlockNumber: BigInt(BLOCK - 100),
    borrowIndex: 1000000000000000000n,
    reserveFactorMantissa: 0n,
    lastUnderlyingPriceCents: 100n,
    lastUnderlyingPriceBlockNumber: BigInt(BLOCK - 100),
    totalXvsDistributedMantissa: 0n,
    supplierCount: 0n,
    borrowerCount: 0n,
  };
}

afterEach(() => setCallMock(undefined));

describe("mint flow (v2)", () => {
  it("Mint creates MarketPosition, bumps supplierCount and market total supply, stores Transaction", async () => {
    const rules: CallMockRule[] = [
      // position creation reads try_borrowIndex (pinned to BLOCK)
      { fn: "borrowIndex", to: VUSDC, result: big(1200000000000000000n) }, // 1.2e18
    ];
    setCallMock({ strict: true, rules });

    const indexer = createTestIndexer();
    indexer.Comptroller.set({
      id: COMPTROLLER,
      address: COMPTROLLER,
      priceOracle: ORACLE,
      closeFactorMantissa: 500000000000000000n,
      liquidationIncentive: 1080000000000000000n,
    });
    indexer.Market.set(seedMarket());

    await indexer.process({
      chains: {
        56: {
          simulate: [
            {
              contract: "VTokenUpdatedEvents",
              event: "Mint",
              srcAddress: VUSDC as `0x${string}`,
              logIndex: 5,
              params: {
                minter: MINTER as `0x${string}`,
                mintAmount: 1000n * 10n ** 18n, // 1,000 USDC supplied
                mintTokens: 50000n * 10n ** 8n, // 50,000 vUSDC minted
                totalSupply: 50000n * 10n ** 8n, // account now holds 50,000 vUSDC
              },
              block: { number: BLOCK, timestamp: TS },
              transaction: { hash: TX },
            },
          ],
        },
      },
    });

    // ---- Market: total supply increased by mintTokens ----
    const market = await indexer.Market.getOrThrow(VUSDC);
    expect(market.totalSupplyVTokenMantissa).toBe(1000n * 10n ** 8n + 50000n * 10n ** 8n);
    // supplierCount bumped 0 -> 1 (previous balance 0, new balance > 0)
    expect(market.supplierCount).toBe(1n);

    // ---- MarketPosition (id = account.concat(market)) ----
    const positionId = getMarketPositionId(MINTER, VUSDC);
    expect(positionId).toBe("0x" + MINTER.slice(2) + VUSDC.slice(2));
    const position = await indexer.MarketPosition.getOrThrow(positionId);
    expect(position.market_id).toBe(VUSDC);
    expect(position.account_id).toBe(MINTER);
    expect(position.vTokenBalanceMantissa).toBe(50000n * 10n ** 8n);
    expect(position.accrualBlockNumber).toBe(BigInt(BLOCK));
    expect(position.borrowIndex).toBe(1200000000000000000n);
    expect(position.enteredMarket).toBe(false);
    expect(position.storedBorrowBalanceMantissa).toBe(0n);
    expect(position.totalUnderlyingRedeemedMantissa).toBe(0n);
    expect(position.totalUnderlyingRepaidMantissa).toBe(0n);

    // ---- Account created by getOrCreateMarketPosition ----
    const account = await indexer.Account.getOrThrow(MINTER);
    expect(account.address).toBe(MINTER);
    expect(account.countLiquidated).toBe(0);
    expect(account.countLiquidator).toBe(0);
    expect(account.hasBorrowed).toBe(false);

    // ---- Transaction (id = txHash ++ logIndex-as-LE-4-bytes) ----
    const txId = getTransactionId(TX, 5);
    expect(txId).toBe(TX + "05000000"); // logIndex 5 little-endian 4 bytes
    const tx = await indexer.Transaction.getOrThrow(txId);
    expect(tx.type).toBe("MINT");
    expect(tx.amountMantissa).toBe(1000n * 10n ** 18n); // mintAmount (underlying)
    expect(tx.to).toBe(MINTER);
    expect(tx.from).toBe(VUSDC); // mints originate from the vToken address
    expect(tx.blockNumber).toBe(BLOCK);
    expect(tx.blockTime).toBe(TS);
  });
});
