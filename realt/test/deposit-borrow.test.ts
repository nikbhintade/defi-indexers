/**
 * Offline test of the deposit/borrow accounting flow on a freshly-registered reserve.
 *
 * Walks the full V2 registration chain (so ContractToPoolMapping / Reserve /
 * tokens exist), then:
 *   - LendingPool.ReserveDataUpdated -> sets rates + indexes on the Reserve
 *   - AToken.Mint                    -> deposit: scaled/current aToken balance, reserve totals
 *   - LendingPool.Deposit            -> Deposit history entity
 *   - VariableDebtToken.Mint         -> borrow: scaled/current variable debt, user.borrowedReservesCount
 *   - LendingPool.Borrow             -> Borrow history entity
 *
 * eth_calls mocked: ERC20/strategy reads (reserve init). No state reads needed.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTestIndexer } from "envio";
import { setCallMock } from "../src/effects/calls";
import {
  ATOKEN,
  CONFIGURATOR,
  ID_LENDING_POOL,
  ID_LENDING_POOL_CONFIGURATOR,
  POOL_PROXY,
  PROVIDER,
  STOKEN,
  STRATEGY,
  USDC,
  USER,
  VTOKEN,
  reserveInitRules,
} from "./fixtures";

const RAY = 10n ** 27n;

afterEach(() => setCallMock(undefined));

function registrationSimulate() {
  return [
    {
      contract: "LendingPoolAddressesProviderRegistry" as const,
      event: "AddressesProviderRegistered" as const,
      logIndex: 0,
      params: { newAddress: PROVIDER as `0x${string}` },
      block: { number: 20206000, timestamp: 1700000000 },
      transaction: { hash: "0xaa", transactionIndex: 0 },
    },
    {
      contract: "LendingPoolAddressesProvider" as const,
      event: "ProxyCreated" as const,
      srcAddress: PROVIDER as `0x${string}`,
      logIndex: 0,
      params: { id: ID_LENDING_POOL as `0x${string}`, newAddress: POOL_PROXY as `0x${string}` },
      block: { number: 20206100, timestamp: 1700000100 },
      transaction: { hash: "0xbb", transactionIndex: 0 },
    },
    {
      contract: "LendingPoolAddressesProvider" as const,
      event: "ProxyCreated" as const,
      srcAddress: PROVIDER as `0x${string}`,
      logIndex: 1,
      params: {
        id: ID_LENDING_POOL_CONFIGURATOR as `0x${string}`,
        newAddress: CONFIGURATOR as `0x${string}`,
      },
      block: { number: 20206101, timestamp: 1700000110 },
      transaction: { hash: "0xcc", transactionIndex: 0 },
    },
    {
      contract: "LendingPoolConfigurator" as const,
      event: "ReserveInitialized" as const,
      srcAddress: CONFIGURATOR as `0x${string}`,
      logIndex: 0,
      params: {
        asset: USDC as `0x${string}`,
        aToken: ATOKEN as `0x${string}`,
        stableDebtToken: STOKEN as `0x${string}`,
        variableDebtToken: VTOKEN as `0x${string}`,
        interestRateStrategyAddress: STRATEGY as `0x${string}`,
      },
      block: { number: 20206200, timestamp: 1700000200 },
      transaction: { hash: "0xdd", transactionIndex: 0 },
    },
  ];
}

describe("deposit / borrow flow", () => {
  it("updates Reserve / UserReserve / history with exact values", async () => {
    setCallMock({ strict: true, rules: reserveInitRules() });
    const indexer = createTestIndexer();

    await indexer.process({
      chains: {
        100: {
          simulate: [
            ...registrationSimulate(),
            // rates + indexes
            {
              contract: "LendingPool",
              event: "ReserveDataUpdated",
              srcAddress: POOL_PROXY as `0x${string}`,
              logIndex: 0,
              params: {
                reserve: USDC as `0x${string}`,
                liquidityRate: 20000000000000000000000000n,
                stableBorrowRate: 50000000000000000000000000n,
                variableBorrowRate: 30000000000000000000000000n,
                liquidityIndex: RAY,
                variableBorrowIndex: RAY,
              },
              block: { number: 20206250, timestamp: 1700000250 },
              transaction: { hash: "0xe0", transactionIndex: 0 },
            },
            // deposit: aToken Mint (value 1 USDC, index RAY)
            {
              contract: "AToken",
              event: "Mint",
              srcAddress: ATOKEN as `0x${string}`,
              logIndex: 0,
              params: { from: USER as `0x${string}`, value: 1000000n, index: RAY },
              block: { number: 20206300, timestamp: 1700000300 },
              transaction: { hash: "0xe1", transactionIndex: 0 },
            },
            // LendingPool.Deposit history entity
            {
              contract: "LendingPool",
              event: "Deposit",
              srcAddress: POOL_PROXY as `0x${string}`,
              logIndex: 1,
              params: {
                reserve: USDC as `0x${string}`,
                user: USER as `0x${string}`,
                onBehalfOf: USER as `0x${string}`,
                amount: 1000000n,
                referral: 0n,
              },
              block: { number: 20206300, timestamp: 1700000300 },
              transaction: { hash: "0xe1", transactionIndex: 0 },
            },
            // borrow: variable debt token Mint (value 0.5 USDC, index RAY)
            {
              contract: "VariableDebtToken",
              event: "Mint",
              srcAddress: VTOKEN as `0x${string}`,
              logIndex: 0,
              params: {
                from: USER as `0x${string}`,
                onBehalfOf: USER as `0x${string}`,
                value: 500000n,
                index: RAY,
              },
              block: { number: 20206400, timestamp: 1700000400 },
              transaction: { hash: "0xe2", transactionIndex: 0 },
            },
            // LendingPool.Borrow history entity
            {
              contract: "LendingPool",
              event: "Borrow",
              srcAddress: POOL_PROXY as `0x${string}`,
              logIndex: 1,
              params: {
                reserve: USDC as `0x${string}`,
                user: USER as `0x${string}`,
                onBehalfOf: USER as `0x${string}`,
                amount: 500000n,
                borrowRateMode: 2n,
                borrowRate: 30000000000000000000000000n,
                referral: 0n,
              },
              block: { number: 20206400, timestamp: 1700000400 },
              transaction: { hash: "0xe2", transactionIndex: 0 },
            },
          ],
        },
      },
    });

    const reserveId = USDC + PROVIDER;
    const userReserveId = USER + USDC + PROVIDER;

    // ---- rates / indexes from ReserveDataUpdated ----
    let reserve = await indexer.Reserve.getOrThrow(reserveId);
    expect(reserve.liquidityRate).toBe(20000000000000000000000000n);
    expect(reserve.variableBorrowRate).toBe(30000000000000000000000000n);
    expect(reserve.liquidityIndex).toBe(RAY);
    expect(reserve.variableBorrowIndex).toBe(RAY);

    // ---- deposit (aToken Mint) ----
    reserve = await indexer.Reserve.getOrThrow(reserveId);
    expect(reserve.totalATokenSupply).toBe(1000000n);
    expect(reserve.totalLiquidity).toBe(1000000n);
    expect(reserve.lifetimeLiquidity).toBe(1000000n);
    expect(reserve.totalDeposits).toBe(1000000n);
    // NB: availableLiquidity is asserted after the borrow below (the deposit
    // added 1,000,000 then the borrow removed 500,000).

    const userReserve = await indexer.UserReserve.getOrThrow(userReserveId);
    expect(userReserve.scaledATokenBalance).toBe(1000000n);
    expect(userReserve.currentATokenBalance).toBe(1000000n);

    // aToken balance-history item (userReserveId ++ txHash)
    const aHist = await indexer.ATokenBalanceHistoryItem.getOrThrow(userReserveId + "0xe1");
    expect(aHist.scaledATokenBalance).toBe(1000000n);

    // ---- Deposit history entity (id = block:txIndex:txHash:logIndex) ----
    const deposit = await indexer.Deposit.getOrThrow("20206300:0:0xe1:1");
    expect(deposit.amount).toBe(1000000n);
    expect(deposit.reserve_id).toBe(reserveId);
    expect(deposit.user_id).toBe(USER);

    // ---- borrow (variable debt Mint) ----
    reserve = await indexer.Reserve.getOrThrow(reserveId);
    expect(reserve.totalScaledVariableDebt).toBe(500000n);
    expect(reserve.totalCurrentVariableDebt).toBe(500000n);
    expect(reserve.lifetimeBorrows).toBe(500000n);
    // availableLiquidity reduced by borrow (1,000,000 - 500,000)
    expect(reserve.availableLiquidity).toBe(500000n);

    const ur2 = await indexer.UserReserve.getOrThrow(userReserveId);
    expect(ur2.scaledVariableDebt).toBe(500000n);
    expect(ur2.currentVariableDebt).toBe(500000n);
    expect(ur2.currentTotalDebt).toBe(500000n);

    const user = await indexer.User.getOrThrow(USER);
    expect(user.borrowedReservesCount).toBe(1);

    // ---- Borrow history entity ----
    const borrow = await indexer.Borrow.getOrThrow("20206400:0:0xe2:1");
    expect(borrow.amount).toBe(500000n);
    expect(borrow.borrowRateMode).toBe("Variable");
    expect(borrow.borrowRate).toBe(30000000000000000000000000n);
    // vToken Mint fires before LendingPool.Borrow in the tx, so scaled debt is set
    expect(borrow.variableTokenDebt).toBe(500000n);
  });
});
