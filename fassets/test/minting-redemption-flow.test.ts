/**
 * Offline test (b): minting (CollateralReserved -> MintingExecuted) and
 * redemption (RedemptionRequested -> RedemptionPerformed) flows.
 *
 * Asserts CollateralReserved is created with NONE resolution then flipped to
 * EXECUTED, MintingExecuted points at it, and the same for the redemption
 * request lifecycle — matching the source storer's resolution state machine.
 * No eth_calls are needed for these events, so no call mock is installed.
 */
import { describe, expect, it } from "vitest";
import { createTestIndexer } from "envio";

const ASSET_MANAGER_FXRP = "0x2a3Fe068cD92178554cabcf7c95ADf49B4B0B6A8";
const AGENT_VAULT = "0xCccc000000000000000000000000000000000003";
const MINTER = "0x2222000000000000000000000000000000000008";
const REDEEMER = "0x3333000000000000000000000000000000000009";
const EXECUTOR = "0x4444000000000000000000000000000000000010";
const PAYMENT_REF = "0x" + "ab".repeat(32);
const TX_HASH = "0x" + "cd".repeat(32);

const lc = (x: string) => x.toLowerCase();

describe("minting + redemption resolution lifecycle", () => {
  it("CollateralReserved -> MintingExecuted with exact values and resolution flip", async () => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        14: {
          simulate: [
            {
              contract: "AssetManager",
              event: "CollateralReserved",
              srcAddress: ASSET_MANAGER_FXRP,
              logIndex: 1,
              params: {
                agentVault: AGENT_VAULT,
                minter: MINTER,
                collateralReservationId: 42n,
                valueUBA: 1000000n,
                feeUBA: 2500n,
                firstUnderlyingBlock: 100n,
                lastUnderlyingBlock: 200n,
                lastUnderlyingTimestamp: 1720000500n,
                paymentAddress: "rPaymentAddr",
                paymentReference: PAYMENT_REF,
                executor: EXECUTOR,
                executorFeeNatWei: 5000000000000000n,
              },
              block: { number: 22000300, timestamp: 1720002000 },
            },
            {
              contract: "AssetManager",
              event: "MintingExecuted",
              srcAddress: ASSET_MANAGER_FXRP,
              logIndex: 2,
              params: {
                agentVault: AGENT_VAULT,
                collateralReservationId: 42n,
                mintedAmountUBA: 1000000n,
                agentFeeUBA: 1500n,
                poolFeeUBA: 1000n,
              },
              block: { number: 22000301, timestamp: 1720002012 },
            },
          ],
        },
      },
    });

    const cr = await indexer.CollateralReserved.getOrThrow("0_42");
    expect(cr.collateralReservationId).toBe(42);
    expect(cr.fasset).toBe(0);
    expect(cr.agentVault_id).toBe(lc(AGENT_VAULT));
    expect(cr.minter).toBe(lc(MINTER));
    expect(cr.valueUBA).toBe(1000000n);
    expect(cr.feeUBA).toBe(2500n);
    expect(cr.firstUnderlyingBlock).toBe(100);
    expect(cr.paymentAddress).toBe("rPaymentAddr");
    expect(cr.paymentReference).toBe(lc(PAYMENT_REF));
    expect(cr.executor).toBe(lc(EXECUTOR));
    expect(cr.resolution).toBe(1); // EXECUTED (flipped by MintingExecuted)

    const me = await indexer.MintingExecuted.getOrThrow("14_22000301_2");
    expect(me.collateralReserved_id).toBe("0_42");
    expect(me.poolFeeUBA).toBe(1000n);
  });

  it("RedemptionRequested -> RedemptionPerformed with exact values and resolution flip", async () => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        14: {
          simulate: [
            {
              contract: "AssetManager",
              event: "RedemptionRequested",
              srcAddress: ASSET_MANAGER_FXRP,
              logIndex: 0,
              params: {
                agentVault: AGENT_VAULT,
                redeemer: REDEEMER,
                requestId: 77n,
                paymentAddress: "rRedeemDest",
                valueUBA: 9000000n,
                feeUBA: 9000n,
                firstUnderlyingBlock: 300n,
                lastUnderlyingBlock: 400n,
                lastUnderlyingTimestamp: 1720005000n,
                paymentReference: PAYMENT_REF,
                executor: EXECUTOR,
                executorFeeNatWei: 7000000000000000n,
              },
              block: { number: 22000400, timestamp: 1720003000 },
            },
            {
              contract: "AssetManager",
              event: "RedemptionPerformed",
              srcAddress: ASSET_MANAGER_FXRP,
              logIndex: 0,
              params: {
                agentVault: AGENT_VAULT,
                redeemer: REDEEMER,
                requestId: 77n,
                transactionHash: TX_HASH,
                redemptionAmountUBA: 9000000n,
                spentUnderlyingUBA: 8991000n,
              },
              block: { number: 22000401, timestamp: 1720003012 },
            },
          ],
        },
      },
    });

    const rr = await indexer.RedemptionRequested.getOrThrow("0_77");
    expect(rr.kind).toBe("plain");
    expect(rr.requestId).toBe(77);
    expect(rr.redeemer).toBe(lc(REDEEMER));
    expect(rr.paymentAddress).toBe("rRedeemDest");
    expect(rr.valueUBA).toBe(9000000n);
    expect(rr.executorFeeNatWei).toBe(7000000000000000n);
    expect(rr.resolution).toBe(1); // PERFORMED

    const rp = await indexer.RedemptionPerformed.getOrThrow("14_22000401_0");
    expect(rp.redemptionRequested_id).toBe("0_77");
    expect(rp.transactionHash).toBe(lc(TX_HASH));
    expect(rp.spentUnderlyingUBA).toBe(8991000n);
  });
});
