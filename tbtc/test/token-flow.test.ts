/**
 * Offline test: TBTCVault.Minted supply accounting + TBTC.Transfer balances.
 *
 * 1. Vault Minted(to, amount) bumps totalMint + totalSupply.
 * 2. A mint Transfer(0x0 -> alice, amount) and a peer Transfer(alice -> bob)
 *    update per-holder balances, totalTokensHeld, and currentTokenHolders with
 *    the exact subgraph arithmetic (including its holder-count quirks).
 */
import { describe, expect, it } from "vitest";
import { createTestIndexer } from "envio";

const VAULT = "0x9c070027cdc9dc8f82416b2e5314e11dfb4fe3cd";
const TBTC = "0x18084fba666a33d37592fa2633fd49a74dd93a88";
const ZERO = "0x0000000000000000000000000000000000000000";
const ALICE = "0xaaaa000000000000000000000000000000000001";
const BOB = "0xbbbb000000000000000000000000000000000002";

const MINT = 1_000_000_000_000_000_000n; // 1 tBTC
const SEND = 400_000_000_000_000_000n; // 0.4 tBTC

describe("token mint + transfer flow", () => {
  it("tracks supply, balances and holder count with exact values", async () => {
    const indexer = createTestIndexer();

    await indexer.process({
      chains: {
        1: {
          simulate: [
            // Vault mints to Alice -> supply accounting
            {
              contract: "TBTCVault",
              event: "Minted",
              srcAddress: VAULT as `0x${string}`,
              params: { to: ALICE as `0x${string}`, amount: MINT },
              block: { number: 16500000, timestamp: 1674000000 },
              transaction: { hash: ("0x" + "11".repeat(32)) as `0x${string}` },
              logIndex: 0,
            },
            // ERC20 mint Transfer 0x0 -> Alice
            {
              contract: "TBTC",
              event: "Transfer",
              srcAddress: TBTC as `0x${string}`,
              params: {
                from: ZERO as `0x${string}`,
                to: ALICE as `0x${string}`,
                value: MINT,
              },
              block: { number: 16500000, timestamp: 1674000000 },
              logIndex: 1,
            },
            // Alice -> Bob transfer
            {
              contract: "TBTC",
              event: "Transfer",
              srcAddress: TBTC as `0x${string}`,
              params: {
                from: ALICE as `0x${string}`,
                to: BOB as `0x${string}`,
                value: SEND,
              },
              block: { number: 16500001, timestamp: 1674000050 },
              logIndex: 0,
            },
          ],
        },
      },
    });

    // Supply: mint bumped totalMint + totalSupply
    const token = await indexer.TBTCToken.getOrThrow("TBTCToken");
    expect(token.totalMint).toBe(MINT);
    expect(token.totalSupply).toBe(MINT);
    expect(token.symbol).toBe("tBTC");
    expect(token.decimals).toBe(18);

    // Balances
    const alice = await indexer.User.getOrThrow(ALICE.toLowerCase());
    const bob = await indexer.User.getOrThrow(BOB.toLowerCase());
    expect(alice.tokenBalance).toBe(MINT - SEND); // 0.6 tBTC
    expect(alice.totalTokensHeld).toBe(MINT); // never decreases
    expect(bob.tokenBalance).toBe(SEND); // 0.4 tBTC
    expect(bob.totalTokensHeld).toBe(SEND);

    // Holder count: zero-address "from" on the mint went negative then Alice
    // joined (+1); Bob joined (+1) on the second transfer. The zero address is
    // counted as a holder going to -1 by the original logic; we preserve it.
    //  mint Transfer:   from=ZERO (0 -> -MINT): prev 0, new -MINT (<0) -> no -1;
    //                   to=ALICE (0 -> MINT): prev 0, new>0 -> +1  => holders=1
    //  alice->bob:      from=ALICE (MINT -> MINT-SEND>0): no change;
    //                   to=BOB (0 -> SEND>0): prev 0 -> +1  => holders=2
    expect(token.currentTokenHolders).toBe(2n);

    // Zero address tracked as a User with negative balance (subgraph parity)
    const zeroUser = await indexer.User.getOrThrow(ZERO);
    expect(zeroUser.tokenBalance).toBe(-MINT);
  });
});
