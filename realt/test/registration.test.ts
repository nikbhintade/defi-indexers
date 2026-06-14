/**
 * Offline test of the V2 dynamic registration chain:
 *   LendingPoolAddressesProviderRegistry.AddressesProviderRegistered
 *     -> Pool entity + LendingPoolAddressesProvider template
 *   LendingPoolAddressesProvider.ProxyCreated(LENDING_POOL / LENDING_POOL_CONFIGURATOR)
 *     -> Pool.lendingPool / Pool.lendingPoolConfigurator + ContractToPoolMapping + templates
 *   LendingPoolConfigurator.ReserveInitialized
 *     -> Reserve + AToken/SToken/VToken + token-template registration + ERC20/strategy reads
 *
 * All eth_calls mocked via REALT_CALL_MOCK (no RPC).
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
  VTOKEN,
  reserveInitRules,
} from "./fixtures";

afterEach(() => setCallMock(undefined));

describe("registration chain", () => {
  it("registers provider -> pool/configurator -> reserve with exact values", async () => {
    setCallMock({ strict: true, rules: reserveInitRules() });
    const indexer = createTestIndexer();

    await indexer.process({
      chains: {
        100: {
          simulate: [
            {
              contract: "LendingPoolAddressesProviderRegistry",
              event: "AddressesProviderRegistered",
              logIndex: 0,
              params: { newAddress: PROVIDER as `0x${string}` },
              block: { number: 20206000, timestamp: 1700000000 },
              transaction: { hash: "0xaa", transactionIndex: 0 },
            },
            {
              contract: "LendingPoolAddressesProvider",
              event: "ProxyCreated",
              srcAddress: PROVIDER as `0x${string}`,
              logIndex: 0,
              params: { id: ID_LENDING_POOL as `0x${string}`, newAddress: POOL_PROXY as `0x${string}` },
              block: { number: 20206100, timestamp: 1700000100 },
              transaction: { hash: "0xbb", transactionIndex: 0 },
            },
            {
              contract: "LendingPoolAddressesProvider",
              event: "ProxyCreated",
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
              contract: "LendingPoolConfigurator",
              event: "ReserveInitialized",
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
          ],
        },
      },
    });

    // ---- Pool entity ----
    const pool = await indexer.Pool.getOrThrow(PROVIDER);
    expect(pool.active).toBe(true);
    expect(pool.paused).toBe(false);
    expect(pool.protocol_id).toBe("1");
    expect(pool.lendingPool).toBe(POOL_PROXY);
    expect(pool.lendingPoolConfigurator).toBe(CONFIGURATOR);

    // ---- ContractToPoolMapping for pool proxy + configurator ----
    expect((await indexer.ContractToPoolMapping.getOrThrow(POOL_PROXY)).pool_id).toBe(PROVIDER);
    expect((await indexer.ContractToPoolMapping.getOrThrow(CONFIGURATOR)).pool_id).toBe(PROVIDER);

    // ---- Reserve (id = underlyingAsset ++ poolId) ----
    const reserveId = USDC + PROVIDER;
    const reserve = await indexer.Reserve.getOrThrow(reserveId);
    expect(reserve.underlyingAsset).toBe(USDC);
    expect(reserve.pool_id).toBe(PROVIDER);
    expect(reserve.name).toBe("USD//C on xDai");
    expect(reserve.symbol).toBe("USDC"); // aToken symbol "aUSDC" sliced(1)
    expect(reserve.decimals).toBe(6);
    expect(reserve.isActive).toBe(true);
    expect(reserve.aToken_id).toBe(ATOKEN);
    expect(reserve.sToken_id).toBe(STOKEN);
    expect(reserve.vToken_id).toBe(VTOKEN);
    expect(reserve.reserveInterestRateStrategy).toBe(STRATEGY);
    // strategy reads
    expect(reserve.baseVariableBorrowRate).toBe(0n);
    expect(reserve.variableBorrowRate).toBe(0n); // init: = base
    expect(reserve.optimalUtilisationRate).toBe(900000000000000000000000000n);
    expect(reserve.variableRateSlope1).toBe(40000000000000000000000000n);
    expect(reserve.variableRateSlope2).toBe(600000000000000000000000000n);
    expect(reserve.stableRateSlope1).toBe(5000000000000000000000000n);
    expect(reserve.stableRateSlope2).toBe(600000000000000000000000000n);

    // ---- sub-tokens + their pool mapping ----
    const aToken = await indexer.AToken.getOrThrow(ATOKEN);
    expect(aToken.underlyingAssetAddress).toBe(USDC);
    expect(aToken.underlyingAssetDecimals).toBe(6);
    expect(aToken.pool_id).toBe(PROVIDER);
    const vToken = await indexer.VToken.getOrThrow(VTOKEN);
    expect(vToken.underlyingAssetAddress).toBe(USDC);
    const sToken = await indexer.SToken.getOrThrow(STOKEN);
    expect(sToken.underlyingAssetAddress).toBe(USDC);

    // ---- ReserveConfigurationHistoryItem keyed by tx hash ----
    const cfgHist = await indexer.ReserveConfigurationHistoryItem.getOrThrow("0xdd");
    expect(cfgHist.reserve_id).toBe(reserveId);
    expect(cfgHist.isActive).toBe(true);
  });
});
