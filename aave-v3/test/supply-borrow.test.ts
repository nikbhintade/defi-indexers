/**
 * Offline test of the supply/borrow accounting flow on a seeded reserve.
 *
 * Walks the full registration chain (so ContractToPoolMapping / Reserve /
 * SubToken exist), then:
 *   - Pool.ReserveDataUpdated  -> sets rates + indexes on the Reserve
 *   - AToken.Mint              -> supply: scaled/current aToken balance, reserve totals
 *   - Pool.Supply              -> Supply history entity (assetPriceUSD via oracle)
 *   - VariableDebtToken.Mint   -> borrow: scaled/current variable debt, user.borrowedReservesCount
 *   - Pool.Borrow              -> Borrow history entity
 *
 * eth_calls mocked: ERC20/strategy reads (reserve init) +
 * Pool.getReserveData(asset).accruedToTreasury (aToken Mint, block-pinned).
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTestIndexer } from "envio";
import { setCallMock, type CallMockRule } from "../src/effects/calls";
import {
  ATOKEN,
  CONFIGURATOR,
  ID_POOL,
  ID_POOL_CONFIGURATOR,
  POOL_PROXY,
  PROVIDER,
  STOKEN,
  STRATEGY,
  USDC,
  USER,
  VTOKEN,
  big,
  reserveInitRules,
} from "./fixtures";

const RAY = 10n ** 27n;
const MINT_BLOCK = 16291300;

afterEach(() => setCallMock(undefined));

function registrationSimulate() {
  return [
    {
      contract: "PoolAddressesProviderRegistry" as const,
      event: "AddressesProviderRegistered" as const,
      logIndex: 0,
      params: { addressesProvider: PROVIDER as `0x${string}`, id: 30n },
      block: { number: 16291006, timestamp: 1671000000 },
      transaction: { hash: "0xaa", transactionIndex: 0 },
    },
    {
      contract: "PoolAddressesProvider" as const,
      event: "ProxyCreated" as const,
      srcAddress: PROVIDER as `0x${string}`,
      logIndex: 0,
      params: {
        id: ID_POOL as `0x${string}`,
        proxyAddress: POOL_PROXY as `0x${string}`,
        implementationAddress: "0x0000000000000000000000000000000000000001" as `0x${string}`,
      },
      block: { number: 16291100, timestamp: 1671000100 },
      transaction: { hash: "0xbb", transactionIndex: 0 },
    },
    {
      contract: "PoolAddressesProvider" as const,
      event: "ProxyCreated" as const,
      srcAddress: PROVIDER as `0x${string}`,
      logIndex: 1,
      params: {
        id: ID_POOL_CONFIGURATOR as `0x${string}`,
        proxyAddress: CONFIGURATOR as `0x${string}`,
        implementationAddress: "0x0000000000000000000000000000000000000002" as `0x${string}`,
      },
      block: { number: 16291101, timestamp: 1671000110 },
      transaction: { hash: "0xcc", transactionIndex: 0 },
    },
    {
      contract: "PoolConfigurator" as const,
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
      block: { number: 16291200, timestamp: 1671000200 },
      transaction: { hash: "0xdd", transactionIndex: 0 },
    },
  ];
}

describe("supply / borrow flow", () => {
  it("updates Reserve / UserReserve / history with exact values", async () => {
    const rules: CallMockRule[] = [
      ...reserveInitRules(),
      // Pool.getReserveData(USDC).accruedToTreasury at the aToken Mint block
      { fn: "getReserveData", to: POOL_PROXY, args: [USDC], block: MINT_BLOCK, result: big(12345n) },
    ];
    setCallMock({ strict: true, rules });
    const indexer = createTestIndexer();

    await indexer.process({
      chains: {
        1: {
          simulate: [
            ...registrationSimulate(),
            // rates + indexes
            {
              contract: "Pool",
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
              block: { number: 16291250, timestamp: 1671000250 },
              transaction: { hash: "0xe0", transactionIndex: 0 },
            },
            // supply: aToken Mint (value 1 USDC, index RAY)
            {
              contract: "AToken",
              event: "Mint",
              srcAddress: ATOKEN as `0x${string}`,
              logIndex: 0,
              params: {
                caller: USER as `0x${string}`,
                onBehalfOf: USER as `0x${string}`,
                value: 1000000n,
                balanceIncrease: 0n,
                index: RAY,
              },
              block: { number: MINT_BLOCK, timestamp: 1671000300 },
              transaction: { hash: "0xe1", transactionIndex: 0 },
            },
            // Pool.Supply history entity
            {
              contract: "Pool",
              event: "Supply",
              srcAddress: POOL_PROXY as `0x${string}`,
              logIndex: 1,
              params: {
                reserve: USDC as `0x${string}`,
                user: USER as `0x${string}`,
                onBehalfOf: USER as `0x${string}`,
                amount: 1000000n,
                referralCode: 0n,
              },
              block: { number: MINT_BLOCK, timestamp: 1671000300 },
              transaction: { hash: "0xe1", transactionIndex: 0 },
            },
            // borrow: variable debt token Mint (value 0.5 USDC, index RAY)
            {
              contract: "VariableDebtToken",
              event: "Mint",
              srcAddress: VTOKEN as `0x${string}`,
              logIndex: 0,
              params: {
                caller: USER as `0x${string}`,
                onBehalfOf: USER as `0x${string}`,
                value: 500000n,
                balanceIncrease: 0n,
                index: RAY,
              },
              block: { number: 16291400, timestamp: 1671000400 },
              transaction: { hash: "0xe2", transactionIndex: 0 },
            },
            // Pool.Borrow history entity
            {
              contract: "Pool",
              event: "Borrow",
              srcAddress: POOL_PROXY as `0x${string}`,
              logIndex: 1,
              params: {
                reserve: USDC as `0x${string}`,
                user: USER as `0x${string}`,
                onBehalfOf: USER as `0x${string}`,
                amount: 500000n,
                interestRateMode: 2n,
                borrowRate: 30000000000000000000000000n,
                referralCode: 0n,
              },
              block: { number: 16291400, timestamp: 1671000400 },
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

    // ---- supply (aToken Mint) ----
    reserve = await indexer.Reserve.getOrThrow(reserveId);
    expect(reserve.totalATokenSupply).toBe(1000000n);
    expect(reserve.totalLiquidity).toBe(1000000n);
    expect(reserve.lifetimeLiquidity).toBe(1000000n);
    expect(reserve.accruedToTreasury).toBe(12345n); // from getReserveData mock

    const userReserve = await indexer.UserReserve.getOrThrow(userReserveId);
    expect(userReserve.scaledATokenBalance).toBe(1000000n);
    expect(userReserve.currentATokenBalance).toBe(1000000n);

    // aToken balance-history item (userReserveId ++ txHash)
    const aHist = await indexer.ATokenBalanceHistoryItem.getOrThrow(userReserveId + "0xe1");
    expect(aHist.scaledATokenBalance).toBe(1000000n);

    // ---- Supply history entity (id = block:txIndex:txHash:logIndex) ----
    const supply = await indexer.Supply.getOrThrow("16291300:0:0xe1:1");
    expect(supply.amount).toBe(1000000n);
    expect(supply.reserve_id).toBe(reserveId);
    expect(supply.user_id).toBe(USER);
    expect(supply.action).toBe("Supply");

    // ---- borrow (variable debt Mint) ----
    reserve = await indexer.Reserve.getOrThrow(reserveId);
    expect(reserve.totalScaledVariableDebt).toBe(500000n);
    expect(reserve.totalCurrentVariableDebt).toBe(500000n);
    expect(reserve.lifetimeBorrows).toBe(500000n);
    // availableLiquidity reduced by borrow
    expect(reserve.availableLiquidity).toBe(500000n);

    const ur2 = await indexer.UserReserve.getOrThrow(userReserveId);
    expect(ur2.scaledVariableDebt).toBe(500000n);
    expect(ur2.currentVariableDebt).toBe(500000n);
    expect(ur2.currentTotalDebt).toBe(500000n);

    const user = await indexer.User.getOrThrow(USER);
    expect(user.borrowedReservesCount).toBe(1);

    // ---- Borrow history entity ----
    const borrow = await indexer.Borrow.getOrThrow("16291400:0:0xe2:1");
    expect(borrow.amount).toBe(500000n);
    expect(borrow.borrowRateMode).toBe(2);
    expect(borrow.borrowRate).toBe(30000000000000000000000000n);
    // vToken Mint fires before Pool.Borrow in the tx, so scaled debt is set
    expect(borrow.variableTokenDebt).toBe(500000n);
  });
});
