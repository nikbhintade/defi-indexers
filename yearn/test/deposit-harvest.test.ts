/**
 * Offline test (b): full deposit + harvest (StrategyReported) flow.
 *
 *   NewVault  -> seed Vault + Token entities
 *   StrategyAddedV2 -> create Strategy, push to vault.strategyIds / queue
 *   Deposit   -> Deposit + AccountVaultPosition(+update) + VaultUpdate + VaultDayData
 *   StrategyReported -> StrategyReport + VaultUpdate (returnsGenerated, pricePerShare)
 *
 * All eth_calls are mocked. The mock is non-strict: unmocked calls revert
 * (resolve to null), mirroring try_ reverts. Values that feed asserted fields
 * are mocked explicitly so the assertions are exact.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTestIndexer } from "envio";
import { setCallMock, type CallMockRule } from "../src/effects/calls";

const REGISTRY = "0xe15461b18ee31b7379019dc523231c57d1cbc18c";
const VAULT = "0xa696a63cc78dffa1a63e9e50587c197387ff6c7e";
const WANT = "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599"; // WBTC, 8 decimals
const STRATEGY = "0x5555555555555555555555555555555555555555";
const USER = "0x6666666666666666666666666666666666666666";
const ORACLE = "0x83d95e0d5f402511db06817aff3f9ea88224b030";

const TXV = "0x" + "a1".repeat(32);
const TXS = "0x" + "a2".repeat(32);
const TXD = "0x" + "a3".repeat(32);
const TXR = "0x" + "a4".repeat(32);

const str = (value: string) => ({ kind: "string", value }) as const;
const num = (value: number) => ({ kind: "number", value }) as const;
const big = (value: bigint) => ({ kind: "bigint", value: value.toString() }) as const;
const addr = (value: string) => ({ kind: "address", value }) as const;
const bool = (value: boolean) => ({ kind: "bool", value }) as const;

// 8-decimal WBTC vault; pricePerShare ~ 1.0 (1e8), totalAssets after deposit = 5e8.
const PPS = 100000000n; // 1.0 with 8 decimals
const DEPOSIT_AMOUNT = 500000000n; // 5 WBTC
const SHARES = 500000000n;
const TOTAL_ASSETS = 500000000n;

afterEach(() => setCallMock(undefined));

const rules: CallMockRule[] = [
  // vault creation metadata
  { fn: "token", to: VAULT, result: addr(WANT) },
  { fn: "decimals", to: WANT, result: num(8) },
  { fn: "name", to: WANT, result: str("Wrapped BTC") },
  { fn: "symbol", to: WANT, result: str("WBTC") },
  { fn: "decimals", to: VAULT, result: num(8) },
  { fn: "name", to: VAULT, result: str("WBTC yVault") },
  { fn: "symbol", to: VAULT, result: str("yvWBTC") },
  { fn: "managementFee", to: VAULT, result: big(200n) },
  { fn: "performanceFee", to: VAULT, result: big(2000n) },
  { fn: "rewards", to: VAULT, result: addr("0x1111111111111111111111111111111111111111") },
  { fn: "management", to: VAULT, result: addr("0x2222222222222222222222222222222222222222") },
  { fn: "guardian", to: VAULT, result: addr("0x3333333333333333333333333333333333333333") },
  { fn: "governance", to: VAULT, result: addr("0x4444444444444444444444444444444444444444") },
  { fn: "depositLimit", to: VAULT, result: big(10000000000n) },
  { fn: "activation", to: VAULT, result: big(1620000000n) },
  { fn: "apiVersion", to: VAULT, result: str("0.3.5") },
  { fn: "emergencyShutdown", to: VAULT, result: bool(false) },

  // vault state reads (deposit + report)
  { fn: "pricePerShare", to: VAULT, result: big(PPS) },
  { fn: "totalAssets", to: VAULT, result: big(TOTAL_ASSETS) },
  { fn: "balanceOf", to: VAULT, args: [USER], result: big(SHARES) },

  // strategy metadata
  { fn: "name", to: STRATEGY, result: str("StrategyWBTC") },
  { fn: "apiVersion", to: STRATEGY, result: str("0.3.5") },
  { fn: "keeper", to: STRATEGY, result: addr("0x7777777777777777777777777777777777777777") },
  { fn: "strategist", to: STRATEGY, result: addr("0x8888888888888888888888888888888888888888") },
  { fn: "rewards", to: STRATEGY, result: addr("0x9999999999999999999999999999999999999999") },
  { fn: "emergencyExit", to: STRATEGY, result: bool(false) },
  { fn: "doHealthCheck", to: STRATEGY, result: bool(false) },
  // healthCheck reverts -> null (left unmocked)
  { fn: "delegatedAssets", to: STRATEGY, result: big(0n) },

  // oracle: 1 WBTC = 60000 USDC (6 decimals on usdc side), recommended price
  { fn: "getPriceUsdcRecommended", to: ORACLE, args: [WANT], result: big(60000000000n) },
];

describe("deposit + harvest flow", () => {
  it("deposit then strategyReported updates Vault/Strategy/VaultUpdate with exact values", async () => {
    setCallMock({ rules });
    const indexer = createTestIndexer();

    await indexer.process({
      chains: {
        1: {
          simulate: [
            // 1) Seed vault via registry
            {
              contract: "Registry",
              event: "NewVault",
              srcAddress: REGISTRY as `0x${string}`,
              params: {
                token: WANT as `0x${string}`,
                deployment_id: 0n,
                vault: VAULT as `0x${string}`,
                api_version: "0.3.5",
              },
              block: { number: 12341475, timestamp: 1620100000 },
              transaction: { hash: TXV, transactionIndex: 1 },
            },
            // 2) Add a strategy (v2)
            {
              contract: "Vault",
              event: "StrategyAddedV2",
              srcAddress: VAULT as `0x${string}`,
              params: {
                strategy: STRATEGY as `0x${string}`,
                debtRatio: 9000n,
                minDebtPerHarvest: 0n,
                maxDebtPerHarvest: 1000000n,
                performanceFee: 1000n,
              },
              block: { number: 12341480, timestamp: 1620100100 },
              transaction: { hash: TXS, transactionIndex: 2 },
            },
            // 3) Deposit (event)
            {
              contract: "Vault",
              event: "Deposit",
              srcAddress: VAULT as `0x${string}`,
              params: { recipient: USER as `0x${string}`, shares: SHARES, amount: DEPOSIT_AMOUNT },
              block: { number: 12341500, timestamp: 1620100500 },
              logIndex: 10,
              transaction: { hash: TXD, transactionIndex: 3 },
            },
            // 4) Strategy report (v0.3.2+) — gain 1 WBTC, no loss
            {
              contract: "Vault",
              event: "StrategyReported",
              srcAddress: VAULT as `0x${string}`,
              params: {
                strategy: STRATEGY as `0x${string}`,
                gain: 100000000n,
                loss: 0n,
                debtPaid: 0n,
                totalGain: 100000000n,
                totalLoss: 0n,
                totalDebt: 450000000n,
                debtAdded: 0n,
                debtRatio: 9000n,
              },
              block: { number: 12341600, timestamp: 1620101000 },
              logIndex: 20,
              transaction: { hash: TXR, transactionIndex: 4 },
            },
          ],
        },
      },
    });

    // --- Strategy created and linked ---
    const strategy = await indexer.Strategy.getOrThrow(STRATEGY);
    expect(strategy.vault_id).toBe(VAULT);
    expect(strategy.name).toBe("StrategyWBTC");
    expect(strategy.apiVersion).toBe("0.3.5");
    expect(strategy.debtLimit).toBe(9000n);
    expect(strategy.maxDebtPerHarvest).toBe(1000000n);
    expect(strategy.performanceFeeBps).toBe(1000n);
    expect(strategy.inQueue).toBe(true);
    expect(strategy.keeper).toBe("0x7777777777777777777777777777777777777777");

    const vaultAfterStrategy = await indexer.Vault.getOrThrow(VAULT);
    expect([...vaultAfterStrategy.strategyIds]).toEqual([STRATEGY]);
    expect([...vaultAfterStrategy.withdrawalQueue]).toEqual([STRATEGY]);

    // --- Deposit entity (id = account-txId-txIndex; txId = txHash-logIndex) ---
    const depositId = USER + "-" + TXD.toLowerCase() + "-10-3";
    const deposit = await indexer.Deposit.getOrThrow(depositId);
    expect(deposit.tokenAmount).toBe(DEPOSIT_AMOUNT);
    expect(deposit.sharesMinted).toBe(SHARES);
    expect(deposit.vault_id).toBe(VAULT);
    expect(deposit.account_id).toBe(USER);

    // --- VaultUpdate from deposit (id = vault-txId-txIndex) ---
    const depositVuId = VAULT + "-" + TXD.toLowerCase() + "-10-3";
    const depositVu = await indexer.VaultUpdate.getOrThrow(depositVuId);
    expect(depositVu.tokensDeposited).toBe(DEPOSIT_AMOUNT);
    expect(depositVu.sharesMinted).toBe(SHARES);
    expect(depositVu.pricePerShare).toBe(PPS);
    expect(depositVu.currentBalanceTokens).toBe(TOTAL_ASSETS);
    // balancePosition = totalAssets * pps / 10**8 = 5e8 * 1e8 / 1e8 = 5e8
    expect(depositVu.balancePosition).toBe(500000000n);

    // --- AccountVaultPosition ---
    const position = await indexer.AccountVaultPosition.getOrThrow(USER + "-" + VAULT);
    expect(position.balanceShares).toBe(SHARES);
    expect(position.balanceTokens).toBe(DEPOSIT_AMOUNT);
    expect(position.balancePosition).toBe(500000000n);

    // --- StrategyReport ---
    const reportId = TXR.toLowerCase() + "-20";
    const report = await indexer.StrategyReport.getOrThrow(reportId);
    expect(report.gain).toBe(100000000n);
    expect(report.loss).toBe(0n);
    expect(report.totalGain).toBe(100000000n);
    expect(report.totalDebt).toBe(450000000n);
    expect(report.debtLimit).toBe(9000n);
    expect(report.strategy_id).toBe(STRATEGY);
    // strategy.latestReport + debtLimit updated by report
    const strategyAfterReport = await indexer.Strategy.getOrThrow(STRATEGY);
    expect(strategyAfterReport.latestReport_id).toBe(reportId);
    expect(strategyAfterReport.debtLimit).toBe(9000n);

    // --- VaultUpdate from report (returnsGenerated = gain - loss - fees; no fees -> 1e8) ---
    const reportVuId = VAULT + "-" + TXR.toLowerCase() + "-20-4";
    const reportVu = await indexer.VaultUpdate.getOrThrow(reportVuId);
    expect(reportVu.returnsGenerated).toBe(100000000n);
    expect(reportVu.pricePerShare).toBe(PPS);
    expect(reportVu.balancePosition).toBe(500000000n);

    // vault.latestUpdate points at the report update
    const finalVault = await indexer.Vault.getOrThrow(VAULT);
    expect(finalVault.latestUpdate_id).toBe(reportVuId);

    // --- VaultDayData populated (token price from oracle) ---
    const dayIndex = (1620100500n * 1000n) / 86400000n;
    const dayData = await indexer.VaultDayData.getOrThrow(VAULT + "-" + dayIndex.toString());
    expect(dayData.tokenPriceUSDC).toBe(60000000000n);
    expect(dayData.deposited).toBe(DEPOSIT_AMOUNT);
  });
});
