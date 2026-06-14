/**
 * Offline test of the CoreVault deposit + reward flow.
 * Stats is seeded (the subgraph's handleVaultAction is a no-op until Stats
 * exists — it is created lazily by createUser/handleNewOrder elsewhere; we seed
 * it so the vault accounting is exercised — see MIGRATION.md test coverage).
 *  - Stake: handleVaultAction bumps Stats.totalCoreStaked/totalDualCore and
 *    Vault.stake/total; UserActionCount created & incremented.
 *  - ClaimReward (reward>0): mocked exchangeCore(1e18) stored as
 *    VaultExchangeRate; Stats.totalCoreStaked increased by reward.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTestIndexer } from "envio";
import { setCallMock, type CallMockRule } from "../src/effects/calls";

const VAULT = "0xee21ab613d30330823d35cf91a84ce964808b83f";
const USER = "0x4444444444444444444444444444444444444444";

const TX1 = "0x" + "c3".repeat(32);
const TX2 = "0x" + "d4".repeat(32);
const TS = 1700001000;
const BLOCK = 21007800;

const big = (v: bigint) => ({ kind: "bigint", value: v.toString() }) as const;
const idOf = (tx: string, logIndex: number) =>
  (tx + (logIndex >>> 0).toString(16).padStart(8, "0")).toLowerCase();
const concat = (...p: string[]) =>
  ("0x" + p.map((x) => x.replace(/^0x/i, "")).join("")).toLowerCase();

afterEach(() => setCallMock(undefined));

describe("corevault deposit + reward flow", () => {
  it("Stake updates Vault/Stats; ClaimReward stores VaultExchangeRate and adds reward", async () => {
    const rules: CallMockRule[] = [
      // exchangeCore(1e18) -> 1.05 CORE per dualCORE (scaled 1e18)
      { fn: "exchangeCore", to: VAULT, result: big(1_050_000_000_000_000_000n) },
    ];
    setCallMock({ strict: true, rules });

    const indexer = createTestIndexer();
    // Seed Stats (otherwise handleVaultAction is a no-op) and the Vault.
    indexer.Stats.set({
      id: "b14g",
      totalStaker: 0,
      totalCoreStaked: 0n,
      totalDualCore: 0n,
      vaultMaxCap: 0n,
      totalEarned: 0n,
      marketplaceFee: undefined,
    });

    await indexer.process({
      chains: {
        1116: {
          simulate: [
            {
              contract: "CoreVault",
              event: "Stake",
              srcAddress: VAULT as `0x${string}`,
              logIndex: 0,
              params: {
                user: USER as `0x${string}`,
                coreAmount: 1000n,
                dualCoreAmount: 950n,
              },
              block: { number: BLOCK, timestamp: TS },
              transaction: { hash: TX1 },
            },
            {
              contract: "CoreVault",
              event: "ClaimReward",
              srcAddress: VAULT as `0x${string}`,
              logIndex: 0,
              params: { reward: 200n, fee: 5n },
              block: { number: BLOCK + 5, timestamp: TS + 50 },
              transaction: { hash: TX2 },
            },
          ],
        },
      },
    });

    // ---- Vault updated by handleVaultAction ----
    const vault = await indexer.Vault.getOrThrow(VAULT);
    expect(vault.stake).toBe(1);
    expect(vault.total).toBe(1);
    expect(vault.unbond).toBe(0);
    expect(vault.redeemInstantly).toBe(0);

    // ---- Stats: 1000 staked + 200 reward = 1200; dualCore 950 ----
    const stats = await indexer.Stats.getOrThrow("b14g");
    expect(stats.totalCoreStaked).toBe(1200n);
    expect(stats.totalDualCore).toBe(950n);
    expect(stats.totalStaker).toBe(1); // USER created by handleStake

    // ---- VaultAction (stake) ----
    const action = await indexer.VaultAction.getOrThrow(idOf(TX1, 0));
    expect(action.type).toBe("Stake");
    expect(action.amount).toBe(1000n);
    expect(action.from_id).toBe(USER);
    expect(action.toVault_id).toBe(VAULT);
    expect(action.totalCoreStaked).toBe(1000n); // value at stake time

    // ---- UserActionCount id = user.concat(vault) ----
    const uac = await indexer.UserActionCount.getOrThrow(concat(USER, VAULT));
    expect(uac.stake).toBe(1);
    expect(uac.total).toBe(1);

    // ---- VaultExchangeRate stored by ClaimReward (reward>0) ----
    const rate = await indexer.VaultExchangeRate.getOrThrow(idOf(TX2, 0));
    expect(rate.value).toBe(1_050_000_000_000_000_000n);
    expect(rate.blockNumber).toBe(BigInt(BLOCK + 5));
  });
});
