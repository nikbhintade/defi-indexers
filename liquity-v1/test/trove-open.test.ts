/**
 * Offline test of the core trove flow:
 *   PriceFeed.LastGoodPriceUpdated -> seeds the system price (first price event
 *                                     just initializes price, no PriceChange).
 *   BorrowerOperations.TroveUpdated(openTrove) -> creates the Trove + User +
 *                                     Global + Transaction + TroveChange and
 *                                     advances the SystemState snapshot.
 *
 * No effects are exercised here (no eth_calls in the trove path). Exact values,
 * including the collateral ratio and the global sequential change-counter, are
 * asserted.
 */
import { describe, expect, it } from "vitest";
import { createTestIndexer, BigDecimal } from "envio";

BigDecimal.config({ DECIMAL_PLACES: 34, EXPONENTIAL_AT: [-1000000, 1000000] });

const PRICEFEED = "0x4c517D4e2C851CA76d7eC94B805269Df0f2201De";
const BORROWER_OPS = "0x24179CD81c9e782A4096035f7eC97fB8B783e007";
const USER = "0x1111111111111111111111111111111111111111";
const e18 = (n: bigint) => n * 10n ** 18n;

describe("Trove open flow", () => {
  it("seeds price, opens a trove, and records Global/TroveChange/SystemState", async () => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        1: {
          simulate: [
            // 1) price = 2000 (first price event: initialize only, no PriceChange)
            {
              contract: "PriceFeed",
              event: "LastGoodPriceUpdated",
              srcAddress: PRICEFEED as `0x${string}`,
              logIndex: 0,
              params: { _lastGoodPrice: e18(2000n) },
              block: { number: 100, timestamp: 1000 },
              transaction: {
                hash: ("0x" + "a".repeat(64)) as `0x${string}`,
                from: USER as `0x${string}`,
              },
            },
            // 2) open trove: 10 ETH collateral, 2000 LUSD debt, stake 10, op=0 (openTrove)
            {
              contract: "BorrowerOperations",
              event: "TroveUpdated",
              srcAddress: BORROWER_OPS as `0x${string}`,
              logIndex: 0,
              params: {
                _borrower: USER as `0x${string}`,
                _debt: e18(2000n),
                _coll: e18(10n),
                stake: e18(10n),
                operation: 0n,
              },
              block: { number: 101, timestamp: 1100 },
              transaction: {
                hash: ("0x" + "b".repeat(64)) as `0x${string}`,
                from: USER as `0x${string}`,
              },
            },
          ],
        },
      },
    });

    // ---- Trove ----
    const trove = await indexer.Trove.getOrThrow(USER.toLowerCase());
    expect(trove.status).toBe("open");
    expect(trove.collateral.toString()).toBe("10");
    expect(trove.debt.toString()).toBe("2000");
    expect(trove.rawCollateral).toBe(e18(10n));
    expect(trove.rawDebt).toBe(e18(2000n));
    expect(trove.rawStake).toBe(e18(10n));
    expect(trove.owner_id).toBe(USER.toLowerCase());
    // collateralRatioSortKey = _debt * 1e18 / stake - rawTotalRedistributedDebt(0)
    //                        = 2000e18 * 1e18 / 10e18 = 200e18
    expect(trove.collateralRatioSortKey).toBe(e18(200n));

    // ---- TroveChange (id = global change counter "0") ----
    const change = await indexer.TroveChange.getOrThrow("0");
    expect(change.troveOperation).toBe("openTrove");
    expect(change.trove_id).toBe(USER.toLowerCase());
    expect(change.collateralBefore.toString()).toBe("0");
    expect(change.collateralAfter.toString()).toBe("10");
    expect(change.collateralChange.toString()).toBe("10");
    expect(change.debtBefore.toString()).toBe("0");
    expect(change.debtAfter.toString()).toBe("2000");
    expect(change.debtChange.toString()).toBe("2000");
    expect(change.collateralRatioBefore).toBeUndefined(); // debt was 0
    expect(change.collateralRatioAfter!.toString()).toBe("10"); // 10 * 2000 / 2000
    expect(change.systemStateBefore_id).toBe("0");
    expect(change.systemStateAfter_id).toBe("1");

    // ---- Global ----
    const global = await indexer.Global.getOrThrow("only");
    expect(global.numberOfOpenTroves).toBe(1);
    expect(global.totalNumberOfTroves).toBe(1);
    expect(global.changeCount).toBe(1);
    expect(global.transactionCount).toBe(1);
    expect(global.systemStateCount).toBe(2);
    expect(global.currentSystemState_id).toBe("1");

    // ---- SystemState (latest snapshot) ----
    const ss = await indexer.SystemState.getOrThrow("1");
    expect(ss.totalCollateral.toString()).toBe("10");
    expect(ss.totalDebt.toString()).toBe("2000");
    expect(ss.totalCollateralRatio!.toString()).toBe("10");
    expect(ss.price!.toString()).toBe("2000");

    // ---- Transaction ----
    const tx = await indexer.Transaction.getOrThrow("0x" + "b".repeat(64));
    expect(tx.sequenceNumber).toBe(0);
    expect(tx.blockNumber).toBe(101);
  });
});
