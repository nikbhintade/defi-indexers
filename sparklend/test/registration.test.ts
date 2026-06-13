/**
 * Offline test of the dynamic registration chain:
 *   PoolAddressesProviderRegistry.AddressesProviderRegistered
 *     -> Pool entity + PoolAddressesProvider template
 *   PoolAddressesProvider.ProxyCreated(POOL / POOL_CONFIGURATOR)
 *     -> Pool.pool / Pool.poolConfigurator + ContractToPoolMapping + templates
 *   PoolConfigurator.ReserveInitialized
 *     -> Reserve + SubToken(a/s/v) + token-template registration + ERC20/strategy reads
 *
 * All eth_calls mocked via AAVE_V3_CALL_MOCK (no RPC).
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTestIndexer } from "envio";
import { setCallMock } from "../src/effects/calls";
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
        1: {
          simulate: [
            {
              contract: "PoolAddressesProviderRegistry",
              event: "AddressesProviderRegistered",
              logIndex: 0,
              params: { addressesProvider: PROVIDER as `0x${string}`, id: 30n },
              block: { number: 16776006, timestamp: 1671000000 },
              transaction: { hash: "0xaa", transactionIndex: 0 },
            },
            {
              contract: "PoolAddressesProvider",
              event: "ProxyCreated",
              srcAddress: PROVIDER as `0x${string}`,
              logIndex: 0,
              params: {
                id: ID_POOL as `0x${string}`,
                proxyAddress: POOL_PROXY as `0x${string}`,
                implementationAddress: "0x0000000000000000000000000000000000000001" as `0x${string}`,
              },
              block: { number: 16776100, timestamp: 1671000100 },
              transaction: { hash: "0xbb", transactionIndex: 0 },
            },
            {
              contract: "PoolAddressesProvider",
              event: "ProxyCreated",
              srcAddress: PROVIDER as `0x${string}`,
              logIndex: 1,
              params: {
                id: ID_POOL_CONFIGURATOR as `0x${string}`,
                proxyAddress: CONFIGURATOR as `0x${string}`,
                implementationAddress: "0x0000000000000000000000000000000000000002" as `0x${string}`,
              },
              block: { number: 16776101, timestamp: 1671000110 },
              transaction: { hash: "0xcc", transactionIndex: 0 },
            },
            {
              contract: "PoolConfigurator",
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
              block: { number: 16776200, timestamp: 1671000200 },
              transaction: { hash: "0xdd", transactionIndex: 0 },
            },
          ],
        },
      },
    });

    // ---- Pool entity ----
    const pool = await indexer.Pool.getOrThrow(PROVIDER);
    expect(pool.addressProviderId).toBe(30n);
    expect(pool.active).toBe(true);
    expect(pool.paused).toBe(false);
    expect(pool.protocol_id).toBe("1");
    expect(pool.pool).toBe(POOL_PROXY);
    expect(pool.poolConfigurator).toBe(CONFIGURATOR);

    // ---- ContractToPoolMapping for pool proxy + configurator ----
    const poolMap = await indexer.ContractToPoolMapping.getOrThrow(POOL_PROXY);
    expect(poolMap.pool_id).toBe(PROVIDER);
    const cfgMap = await indexer.ContractToPoolMapping.getOrThrow(CONFIGURATOR);
    expect(cfgMap.pool_id).toBe(PROVIDER);

    // ---- Reserve (id = underlyingAsset ++ poolId) ----
    const reserveId = USDC + PROVIDER;
    const reserve = await indexer.Reserve.getOrThrow(reserveId);
    expect(reserve.underlyingAsset).toBe(USDC);
    expect(reserve.pool_id).toBe(PROVIDER);
    expect(reserve.name).toBe("USD Coin");
    expect(reserve.symbol).toBe("USDC");
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

    // ---- SubTokens + their pool mapping ----
    const aToken = await indexer.SubToken.getOrThrow(ATOKEN);
    expect(aToken.underlyingAssetAddress).toBe(USDC);
    expect(aToken.underlyingAssetDecimals).toBe(6);
    expect(aToken.pool_id).toBe(PROVIDER);
    const vToken = await indexer.SubToken.getOrThrow(VTOKEN);
    expect(vToken.underlyingAssetAddress).toBe(USDC);

    // ---- ReserveConfigurationHistoryItem keyed by tx hash ----
    const cfgHist = await indexer.ReserveConfigurationHistoryItem.getOrThrow("0xdd");
    expect(cfgHist.reserve_id).toBe(reserveId);
    expect(cfgHist.isActive).toBe(true);
  });
});
