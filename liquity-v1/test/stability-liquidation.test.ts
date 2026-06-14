/**
 * Offline test of the Stability Pool + liquidation flow:
 *   PriceFeed.LastGoodPriceUpdated      -> seed price = 2000
 *   BorrowerOperations.TroveUpdated     -> open BORROWER's trove (10 ETH / 2000 LUSD)
 *   StabilityPool.ETHGainWithdrawn(0,0) -> sets the tmpDepositUpdate mailbox
 *   StabilityPool.UserDepositChanged    -> DEPOSITOR deposits 1000 LUSD into the
 *                                          Stability Pool (StabilityDeposit +
 *                                          StabilityDepositChange + SystemState)
 *   TroveManager.TroveLiquidated        -> applies (zero) redistribution; no-op
 *   TroveManager.TroveUpdated(coll=0)   -> liquidate-in-normal-mode: closes the
 *                                          trove and offsets debt against the
 *                                          Stability Pool (partial offset)
 *   TroveManager.Liquidation            -> finalizes the Liquidation entity
 *
 * Asserts the exact SP deposit accounting, the partial-offset SystemState math
 * (collateral gas compensation = collateral / 200, truncated to 18 dp), and the
 * Global liquidation counters.
 */
import { describe, expect, it } from "vitest";
import { createTestIndexer, BigDecimal } from "envio";

BigDecimal.config({ DECIMAL_PLACES: 34, EXPONENTIAL_AT: [-1000000, 1000000] });

const PRICEFEED = "0x4c517D4e2C851CA76d7eC94B805269Df0f2201De";
const BORROWER_OPS = "0x24179CD81c9e782A4096035f7eC97fB8B783e007";
const TROVE_MANAGER = "0xA39739EF8b0231DbFA0DcdA07d7e29faAbCf4bb2";
const STABILITY_POOL = "0x66017D22b0f8556afDd19FC67041899Eb65a21bb";

const BORROWER = "0x2222222222222222222222222222222222222222";
const DEPOSITOR = "0x3333333333333333333333333333333333333333";
const LIQUIDATOR = "0x4444444444444444444444444444444444444444";
const e18 = (n: bigint) => n * 10n ** 18n;
const hash = (c: string) => ("0x" + c.repeat(64)) as `0x${string}`;

describe("Stability Pool deposit + liquidation flow", () => {
  it("deposits into SP, then liquidates a trove with partial SP offset", async () => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "PriceFeed",
              event: "LastGoodPriceUpdated",
              srcAddress: PRICEFEED as `0x${string}`,
              logIndex: 0,
              params: { _lastGoodPrice: e18(2000n) },
              block: { number: 100, timestamp: 1000 },
              transaction: { hash: hash("a"), from: BORROWER as `0x${string}` },
            },
            {
              contract: "BorrowerOperations",
              event: "TroveUpdated",
              srcAddress: BORROWER_OPS as `0x${string}`,
              logIndex: 0,
              params: {
                _borrower: BORROWER as `0x${string}`,
                _debt: e18(2000n),
                _coll: e18(10n),
                stake: e18(10n),
                operation: 0n,
              },
              block: { number: 101, timestamp: 1100 },
              transaction: { hash: hash("b"), from: BORROWER as `0x${string}` },
            },
            // SP deposit: ETHGainWithdrawn(0,0) primes tmpDepositUpdate, then
            // UserDepositChanged applies the new deposit.
            {
              contract: "StabilityPool",
              event: "ETHGainWithdrawn",
              srcAddress: STABILITY_POOL as `0x${string}`,
              logIndex: 0,
              params: { _depositor: DEPOSITOR as `0x${string}`, _ETH: 0n, _LUSDLoss: 0n },
              block: { number: 102, timestamp: 1200 },
              transaction: { hash: hash("c"), from: DEPOSITOR as `0x${string}` },
            },
            {
              contract: "StabilityPool",
              event: "UserDepositChanged",
              srcAddress: STABILITY_POOL as `0x${string}`,
              logIndex: 1,
              params: { _depositor: DEPOSITOR as `0x${string}`, _newDeposit: e18(1000n) },
              block: { number: 102, timestamp: 1200 },
              transaction: { hash: hash("c"), from: DEPOSITOR as `0x${string}` },
            },
            // Liquidation of BORROWER's trove (normal mode).
            {
              contract: "TroveManager",
              event: "TroveLiquidated",
              srcAddress: TROVE_MANAGER as `0x${string}`,
              logIndex: 0,
              params: {
                _borrower: BORROWER as `0x${string}`,
                _debt: e18(2000n),
                _coll: e18(10n),
                _operation: 1n,
              },
              block: { number: 103, timestamp: 1300 },
              transaction: { hash: hash("d"), from: LIQUIDATOR as `0x${string}` },
            },
            {
              contract: "TroveManager",
              event: "TroveUpdated",
              srcAddress: TROVE_MANAGER as `0x${string}`,
              logIndex: 1,
              params: {
                _borrower: BORROWER as `0x${string}`,
                _debt: 0n,
                _coll: 0n,
                _stake: 0n,
                _operation: 1n, // liquidateInNormalMode
              },
              block: { number: 103, timestamp: 1300 },
              transaction: { hash: hash("d"), from: LIQUIDATOR as `0x${string}` },
            },
            {
              contract: "TroveManager",
              event: "Liquidation",
              srcAddress: TROVE_MANAGER as `0x${string}`,
              logIndex: 2,
              params: {
                _liquidatedDebt: e18(2000n),
                _liquidatedColl: e18(10n) - e18(10n) / 200n, // coll minus gas comp
                _collGasCompensation: e18(10n) / 200n,
                _LUSDGasCompensation: e18(200n),
              },
              block: { number: 103, timestamp: 1300 },
              transaction: { hash: hash("d"), from: LIQUIDATOR as `0x${string}` },
            },
          ],
        },
      },
    });

    // ---- StabilityDeposit ----
    const sd = await indexer.StabilityDeposit.getOrThrow(DEPOSITOR.toLowerCase());
    expect(sd.depositedAmount.toString()).toBe("1000");
    expect(sd.owner_id).toBe(DEPOSITOR.toLowerCase());

    // ---- StabilityDepositChange ----
    // global change counter: trove-open took "0", this SP deposit takes "1".
    const sdc = await indexer.StabilityDepositChange.getOrThrow("1");
    expect(sdc.stabilityDepositOperation).toBe("depositTokens");
    expect(sdc.depositedAmountBefore.toString()).toBe("0");
    expect(sdc.depositedAmountAfter.toString()).toBe("1000");
    expect(sdc.depositedAmountChange.toString()).toBe("1000");

    // ---- Trove closed by liquidation ----
    const trove = await indexer.Trove.getOrThrow(BORROWER.toLowerCase());
    expect(trove.status).toBe("closedByLiquidation");
    expect(trove.collateral.toString()).toBe("0");
    expect(trove.debt.toString()).toBe("0");

    // ---- Liquidation entity ----
    const liq = await indexer.Liquidation.getOrThrow("0");
    expect(liq.liquidator_id).toBe(LIQUIDATOR.toLowerCase());
    expect(liq.liquidatedDebt.toString()).toBe("2000");
    expect(liq.liquidatedCollateral.toString()).toBe("9.95"); // 10 - 0.05
    expect(liq.collGasCompensation.toString()).toBe("0.05"); // 10 / 200
    expect(liq.tokenGasCompensation.toString()).toBe("200");

    // ---- SystemState (latest snapshot) ----
    // collateralGasComp = 10 / 200 = 0.05; totalCollateral = 10 - 0.05 = 9.95
    // partial offset: pool has 1000 of 2000 debt ->
    //   collateral removed = 9.95 * 1000 / 2000 = 4.975 -> totalCollateral = 4.975
    //   totalDebt = 2000 - 1000 = 1000; tokensInStabilityPool = 0
    //   TCR = 4.975 * 2000 / 1000 = 9.95
    const global = await indexer.Global.getOrThrow("only");
    const ss = await indexer.SystemState.getOrThrow(global.currentSystemState_id!);
    expect(ss.tokensInStabilityPool.toString()).toBe("0");
    expect(ss.totalCollateral.toString()).toBe("4.975");
    expect(ss.totalDebt.toString()).toBe("1000");
    expect(ss.totalCollateralRatio!.toString()).toBe("9.95");

    // ---- Global counters ----
    expect(global.numberOfOpenTroves).toBe(0);
    expect(global.numberOfLiquidatedTroves).toBe(1);
    expect(global.totalNumberOfTroves).toBe(1);
    expect(global.liquidationCount).toBe(1);
    expect(global.currentLiquidation_id).toBeUndefined(); // cleared by finishCurrentLiquidation
  });
});
