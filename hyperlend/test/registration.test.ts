/**
 * Offline test of the factory -> template registration chain:
 *
 *   HTokenFactory.ReserveInitialized(asset, aToken, ...)
 *     -> registers the per-reserve HTokens (aToken) child contract.
 *   HTokens.BalanceTransfer (emitted by that newly-registered aToken)
 *     -> HTokenTransfer row keyed by the Ponder log id.
 *
 * This mirrors the aave-v3 ReserveInitialized -> token-template registration
 * test, adapted to HyperLend (which only tracks the aToken child and has no
 * Reserve accounting entity). No eth_calls are needed for this flow.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTestIndexer } from "envio";
import { setCallMock } from "../src/effects/calls";
import {
  ATOKEN,
  HTOKEN_FACTORY,
  ONBEHALF,
  STOKEN,
  STRATEGY,
  USDC,
  USER,
  VTOKEN,
  logId,
} from "./fixtures";

afterEach(() => setCallMock(undefined));

const BLOCK_HASH_INIT = "0xaaaa000000000000000000000000000000000000000000000000000000000001";
const BLOCK_HASH_XFER = "0xbbbb000000000000000000000000000000000000000000000000000000000002";
const RAY = 1000000000000000000000000000n;

describe("factory -> HTokens template registration", () => {
  it("registers the aToken on ReserveInitialized and indexes its BalanceTransfer", async () => {
    setCallMock({ strict: true, rules: [] });
    const indexer = createTestIndexer();

    await indexer.process({
      chains: {
        999: {
          simulate: [
            {
              contract: "HTokenFactory",
              event: "ReserveInitialized",
              srcAddress: HTOKEN_FACTORY as `0x${string}`,
              logIndex: 0,
              params: {
                asset: USDC as `0x${string}`,
                aToken: ATOKEN as `0x${string}`,
                stableDebtToken: STOKEN as `0x${string}`,
                variableDebtToken: VTOKEN as `0x${string}`,
                interestRateStrategyAddress: STRATEGY as `0x${string}`,
              },
              block: { number: 787001, timestamp: 1700000000, hash: BLOCK_HASH_INIT },
              transaction: {
                hash: "0xdead",
                to: HTOKEN_FACTORY as `0x${string}`,
                from: USER as `0x${string}`,
              },
            },
            // BalanceTransfer emitted by the freshly-registered aToken contract.
            {
              contract: "HTokens",
              event: "BalanceTransfer",
              srcAddress: ATOKEN as `0x${string}`,
              logIndex: 3,
              params: {
                from: USER as `0x${string}`,
                to: ONBEHALF as `0x${string}`,
                value: 5000000n,
                index: RAY,
              },
              block: { number: 787100, timestamp: 1700000100, hash: BLOCK_HASH_XFER },
              transaction: {
                hash: "0xbeef",
                to: ATOKEN as `0x${string}`,
                from: USER as `0x${string}`,
              },
            },
          ],
        },
      },
    });

    const id = logId(BLOCK_HASH_XFER, 3);
    const row = await indexer.HTokenTransfer.getOrThrow(id);
    expect(row.id).toBe(id);
    expect(row.txHash).toBe("0xbeef");
    expect(row.reserve).toBe(ATOKEN); // emitting aToken contract address
    expect(row.from).toBe(USER);
    expect(row.to).toBe(ONBEHALF);
    expect(row.value).toBe(5000000n);
    expect(row.index).toBe(RAY);
  });
});
