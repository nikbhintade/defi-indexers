/**
 * Offline test of the CorePool Supply + Borrow event-record flow.
 *
 *   CorePool.Supply  -> Supply row, price from Oracle.getAssetPrice(reserve)
 *   CorePool.Borrow  -> Borrow row, price from Oracle.getAssetPrice(reserve)
 *
 * The oracle eth_call is mocked per-block via HYPERLEND_CALL_MOCK; the mock
 * matches on fn=getAssetPrice, args=[reserve], block-pinned to the event block.
 * Entity ids are the Ponder log id (block.hash-logIndex).
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTestIndexer } from "envio";
import { setCallMock, type CallMockRule } from "../src/effects/calls";
import { CORE_POOL, ORACLE, USDC, USER, ONBEHALF, big, logId } from "./fixtures";

afterEach(() => setCallMock(undefined));

const SUPPLY_BLOCK = 787200;
const BORROW_BLOCK = 787300;
const SUPPLY_PRICE = 99980000n; // 8-decimal USD price at supply block
const BORROW_PRICE = 100010000n; // at borrow block
const BORROW_RATE = 30000000000000000000000000n;

const BLOCK_HASH_SUPPLY = "0xcccc000000000000000000000000000000000000000000000000000000000003";
const BLOCK_HASH_BORROW = "0xdddd000000000000000000000000000000000000000000000000000000000004";

describe("CorePool supply / borrow flow", () => {
  it("writes Supply / Borrow rows with oracle prices and exact values", async () => {
    const rules: CallMockRule[] = [
      { fn: "getAssetPrice", to: ORACLE, args: [USDC], block: SUPPLY_BLOCK, result: big(SUPPLY_PRICE) },
      { fn: "getAssetPrice", to: ORACLE, args: [USDC], block: BORROW_BLOCK, result: big(BORROW_PRICE) },
    ];
    setCallMock({ strict: true, rules });
    const indexer = createTestIndexer();

    await indexer.process({
      chains: {
        999: {
          simulate: [
            {
              contract: "CorePool",
              event: "Supply",
              srcAddress: CORE_POOL as `0x${string}`,
              logIndex: 2,
              params: {
                reserve: USDC as `0x${string}`,
                user: USER as `0x${string}`,
                onBehalfOf: ONBEHALF as `0x${string}`,
                amount: 1000000n,
                referralCode: 7n,
              },
              block: { number: SUPPLY_BLOCK, timestamp: 1700001000, hash: BLOCK_HASH_SUPPLY },
              transaction: { hash: "0xs1", to: CORE_POOL as `0x${string}`, from: USER as `0x${string}` },
            },
            {
              contract: "CorePool",
              event: "Borrow",
              srcAddress: CORE_POOL as `0x${string}`,
              logIndex: 5,
              params: {
                reserve: USDC as `0x${string}`,
                user: USER as `0x${string}`,
                onBehalfOf: ONBEHALF as `0x${string}`,
                amount: 500000n,
                interestRateMode: 2n,
                borrowRate: BORROW_RATE,
                referralCode: 0n,
              },
              block: { number: BORROW_BLOCK, timestamp: 1700002000, hash: BLOCK_HASH_BORROW },
              transaction: { hash: "0xb1", to: CORE_POOL as `0x${string}`, from: USER as `0x${string}` },
            },
          ],
        },
      },
    });

    // ---- Supply ----
    const supplyId = logId(BLOCK_HASH_SUPPLY, 2);
    const supply = await indexer.Supply.getOrThrow(supplyId);
    expect(supply.id).toBe(supplyId);
    expect(supply.txHash).toBe("0xs1");
    expect(supply.pool).toBe(CORE_POOL);
    expect(supply.reserve).toBe(USDC);
    expect(supply.user).toBe(USER);
    expect(supply.onBehalfOf).toBe(ONBEHALF);
    expect(supply.amount).toBe(1000000n);
    expect(supply.referralCode).toBe(7);
    expect(supply.timestamp).toBe(1700001000);
    expect(supply.price).toBe(SUPPLY_PRICE);

    // ---- Borrow ----
    const borrowId = logId(BLOCK_HASH_BORROW, 5);
    const borrow = await indexer.Borrow.getOrThrow(borrowId);
    expect(borrow.id).toBe(borrowId);
    expect(borrow.txHash).toBe("0xb1");
    expect(borrow.pool).toBe(CORE_POOL);
    expect(borrow.reserve).toBe(USDC);
    expect(borrow.user).toBe(USER);
    expect(borrow.onBehalfOf).toBe(ONBEHALF);
    expect(borrow.amount).toBe(500000n);
    expect(borrow.interestRateMode).toBe(2);
    expect(borrow.borrowRate).toBe(BORROW_RATE);
    expect(borrow.referralCode).toBe(0);
    expect(borrow.timestamp).toBe(1700002000);
    expect(borrow.price).toBe(BORROW_PRICE);
  });
});
