/**
 * Typed wrappers around `tryContractCall` for every eth_call the original
 * subgraph performed. Each wrapper documents the corresponding subgraph call.
 * Address-returning wrappers lowercase the result.
 */
import type { EffectCaller } from "envio";
import { tryContractCall } from "./calls";
import { MULTICALL } from "../constants";

type EC = EffectCaller | null;

const lower = (a: string | null): string | null => (a === null ? null : a.toLowerCase());

// ---- ERC20 (immutable metadata: unpinned) ----

/** ERC20.try_decimals() */
export const erc20Decimals = (ec: EC, token: string) =>
  tryContractCall<number>(ec, token, "function decimals() view returns (uint8)", "decimals", []);

/** ERC20.try_symbol() */
export const erc20Symbol = (ec: EC, token: string) =>
  tryContractCall<string>(ec, token, "function symbol() view returns (string)", "symbol", []);

/** ERC20.name() */
export const erc20Name = (ec: EC, token: string) =>
  tryContractCall<string>(ec, token, "function name() view returns (string)", "name", []);

/** ERC20.try_totalSupply() — state-dependent, pinned. */
export const erc20TotalSupply = (ec: EC, token: string, block: number) =>
  tryContractCall<bigint>(ec, token, "function totalSupply() view returns (uint256)", "totalSupply", [], block);

/** ERC20.try_balanceOf(addr) — state-dependent, pinned. */
export const erc20BalanceOf = (ec: EC, token: string, owner: string, block: number) =>
  tryContractCall<bigint>(ec, token, "function balanceOf(address) view returns (uint256)", "balanceOf", [owner], block);

// ---- Curve pools ----

/** CurvePool.try_coins(uint256) — immutable, unpinned. */
export const poolCoins = async (ec: EC, pool: string, i: number) =>
  lower(await tryContractCall<string>(ec, pool, "function coins(uint256) view returns (address)", "coins", [BigInt(i)]));

/** CurvePoolCoin128.try_coins(int128) — immutable, unpinned. */
export const poolCoins128 = async (ec: EC, pool: string, i: number) =>
  lower(await tryContractCall<string>(ec, pool, "function coins(int128) view returns (address)", "coins", [BigInt(i)]));

/** CurveLendingPool.try_underlying_coins(uint256) — immutable, unpinned. */
export const poolUnderlyingCoins = async (ec: EC, pool: string, i: number) =>
  lower(
    await tryContractCall<string>(
      ec,
      pool,
      "function underlying_coins(uint256) view returns (address)",
      "underlying_coins",
      [BigInt(i)],
    ),
  );

/** CurveLendingPoolCoin128.try_underlying_coins(int128) — immutable, unpinned. */
export const poolUnderlyingCoins128 = async (ec: EC, pool: string, i: number) =>
  lower(
    await tryContractCall<string>(
      ec,
      pool,
      "function underlying_coins(int128) view returns (address)",
      "underlying_coins",
      [BigInt(i)],
    ),
  );

/** MetaPool.try_base_pool() — immutable, unpinned. */
export const metaPoolBasePool = async (ec: EC, pool: string) =>
  lower(await tryContractCall<string>(ec, pool, "function base_pool() view returns (address)", "base_pool", []));

/** CurvePool.name() / symbol() (factory v1 pools are themselves ERC20s). */
export const poolName = erc20Name;
export const poolSymbol = erc20Symbol;

/** CurvePoolV2.try_get_virtual_price() — pinned. */
export const poolVirtualPrice = (ec: EC, pool: string, block: number) =>
  tryContractCall<bigint>(
    ec,
    pool,
    "function get_virtual_price() view returns (uint256)",
    "get_virtual_price",
    [],
    block,
  );

/** CurvePoolV2.try_balances(uint256) — pinned. */
export const poolBalances = (ec: EC, pool: string, i: number, block: number) =>
  tryContractCall<bigint>(ec, pool, "function balances(uint256) view returns (uint256)", "balances", [BigInt(i)], block);

/** CurvePoolCoin128.try_balances(int128) — pinned. */
export const poolBalances128 = (ec: EC, pool: string, i: number, block: number) =>
  tryContractCall<bigint>(ec, pool, "function balances(int128) view returns (uint256)", "balances", [BigInt(i)], block);

/** CurvePoolV2.try_A() — pinned. */
export const poolA = (ec: EC, pool: string, block: number) =>
  tryContractCall<bigint>(ec, pool, "function A() view returns (uint256)", "A", [], block);

/** CurvePoolV2.try_fee() — pinned. */
export const poolFee = (ec: EC, pool: string, block: number) =>
  tryContractCall<bigint>(ec, pool, "function fee() view returns (uint256)", "fee", [], block);

/** CurvePoolV2.try_admin_fee() — pinned. */
export const poolAdminFee = (ec: EC, pool: string, block: number) =>
  tryContractCall<bigint>(ec, pool, "function admin_fee() view returns (uint256)", "admin_fee", [], block);

/** CurveTricryptoOptimized.try_ADMIN_FEE() — pinned. */
export const poolAdminFeeNg = (ec: EC, pool: string, block: number) =>
  tryContractCall<bigint>(ec, pool, "function ADMIN_FEE() view returns (uint256)", "ADMIN_FEE", [], block);

/** CurvePoolV2.try_xcp_profit() — pinned. */
export const poolXcpProfit = (ec: EC, pool: string, block: number) =>
  tryContractCall<bigint>(ec, pool, "function xcp_profit() view returns (uint256)", "xcp_profit", [], block);

/** CurvePoolV2.try_xcp_profit_a() — pinned. */
export const poolXcpProfitA = (ec: EC, pool: string, block: number) =>
  tryContractCall<bigint>(ec, pool, "function xcp_profit_a() view returns (uint256)", "xcp_profit_a", [], block);

/** CurvePoolV2.try_price_oracle() — pinned. */
export const poolPriceOracle = (ec: EC, pool: string, block: number) =>
  tryContractCall<bigint>(ec, pool, "function price_oracle() view returns (uint256)", "price_oracle", [], block);

/** CurveLendingPool.try_offpeg_fee_multiplier() — pinned. */
export const poolOffPegFeeMultiplier = (ec: EC, pool: string, block: number) =>
  tryContractCall<bigint>(
    ec,
    pool,
    "function offpeg_fee_multiplier() view returns (uint256)",
    "offpeg_fee_multiplier",
    [],
    block,
  );

// ---- Registries & factories (pinned: registry state changes over time) ----

/** MainRegistry.try_get_lp_token(pool) — pinned. */
export const registryGetLpToken = async (ec: EC, registry: string, pool: string, block: number) =>
  lower(
    await tryContractCall<string>(
      ec,
      registry,
      "function get_lp_token(address) view returns (address)",
      "get_lp_token",
      [pool],
      block,
    ),
  );

/** MainRegistry/StableFactory/CryptoFactory/TriCryptoFactory.try_pool_count() — pinned. */
export const registryPoolCount = (ec: EC, registry: string, block: number) =>
  tryContractCall<bigint>(ec, registry, "function pool_count() view returns (uint256)", "pool_count", [], block);

/** MainRegistry/StableFactory/CryptoFactory/TriCryptoFactory.try_pool_list(i) — pinned. */
export const registryPoolList = async (ec: EC, registry: string, i: bigint, block: number) =>
  lower(
    await tryContractCall<string>(
      ec,
      registry,
      "function pool_list(uint256) view returns (address)",
      "pool_list",
      [i],
      block,
    ),
  );

/** StableFactory.try_get_implementation_address(pool) — pinned. */
export const factoryGetImplementationAddress = async (ec: EC, factory: string, pool: string, block: number) =>
  lower(
    await tryContractCall<string>(
      ec,
      factory,
      "function get_implementation_address(address) view returns (address)",
      "get_implementation_address",
      [pool],
      block,
    ),
  );

/** CryptoFactory.get_token(pool) — pinned. */
export const cryptoFactoryGetToken = async (ec: EC, factory: string, pool: string, block: number) =>
  lower(
    await tryContractCall<string>(
      ec,
      factory,
      "function get_token(address) view returns (address)",
      "get_token",
      [pool],
      block,
    ),
  );

// ---- Pricing sources (pinned: prices/reserves are state) ----

/** UniswapV2Factory.getPair(a, b) — pinned. */
export const uniV2GetPair = async (ec: EC, factory: string, tokenA: string, tokenB: string, block: number) =>
  lower(
    await tryContractCall<string>(
      ec,
      factory,
      "function getPair(address, address) view returns (address)",
      "getPair",
      [tokenA, tokenB],
      block,
    ),
  );

/** UniswapV2Pair.getReserves() — pinned. */
export const uniV2GetReserves = (ec: EC, pair: string, block: number) =>
  tryContractCall<readonly [bigint, bigint, number]>(
    ec,
    pair,
    "function getReserves() view returns (uint112, uint112, uint32)",
    "getReserves",
    [],
    block,
  );

/** UniswapV2Pair.token0() — immutable, unpinned. */
export const uniV2Token0 = async (ec: EC, pair: string) =>
  lower(await tryContractCall<string>(ec, pair, "function token0() view returns (address)", "token0", []));

/** UniswapV3Factory.try_getPool(a, b, fee) — pinned. */
export const uniV3GetPool = async (ec: EC, factory: string, tokenA: string, tokenB: string, fee: number, block: number) =>
  lower(
    await tryContractCall<string>(
      ec,
      factory,
      "function getPool(address, address, uint24) view returns (address)",
      "getPool",
      [tokenA, tokenB, fee],
      block,
    ),
  );

/** UniswapV3Quoter.try_quoteExactInputSingle(...) — pinned. */
export const uniV3QuoteExactInputSingle = (
  ec: EC,
  quoter: string,
  tokenIn: string,
  tokenOut: string,
  fee: number,
  amountIn: bigint,
  sqrtPriceLimitX96: bigint,
  block: number,
) =>
  tryContractCall<bigint>(
    ec,
    quoter,
    "function quoteExactInputSingle(address, address, uint24, uint256, uint160) returns (uint256)",
    "quoteExactInputSingle",
    [tokenIn, tokenOut, fee, amountIn, sqrtPriceLimitX96],
    block,
  );

/** ChainlinkAggregator.try_latestAnswer() — pinned. */
export const chainlinkLatestAnswer = (ec: EC, aggregator: string, block: number) =>
  tryContractCall<bigint>(ec, aggregator, "function latestAnswer() view returns (int256)", "latestAnswer", [], block);

/** CToken.try_underlying() — immutable, unpinned. */
export const cTokenUnderlying = async (ec: EC, token: string) =>
  lower(await tryContractCall<string>(ec, token, "function underlying() view returns (address)", "underlying", []));

/** CToken.try_exchangeRateStored() — pinned. */
export const cTokenExchangeRateStored = (ec: EC, token: string, block: number) =>
  tryContractCall<bigint>(
    ec,
    token,
    "function exchangeRateStored() view returns (uint256)",
    "exchangeRateStored",
    [],
    block,
  );

/** YToken.try_getPricePerFullShare() — pinned. */
export const yTokenGetPricePerFullShare = (ec: EC, token: string, block: number) =>
  tryContractCall<bigint>(
    ec,
    token,
    "function getPricePerFullShare() view returns (uint256)",
    "getPricePerFullShare",
    [],
    block,
  );

/** AToken.try_scaledTotalSupply() — pinned. */
export const aTokenScaledTotalSupply = (ec: EC, token: string, block: number) =>
  tryContractCall<bigint>(
    ec,
    token,
    "function scaledTotalSupply() view returns (uint256)",
    "scaledTotalSupply",
    [],
    block,
  );

/** LidoOracle.try_getLastCompletedReportDelta() — pinned. */
export const lidoGetLastCompletedReportDelta = (ec: EC, oracle: string, block: number) =>
  tryContractCall<readonly [bigint, bigint, bigint]>(
    ec,
    oracle,
    "function getLastCompletedReportDelta() view returns (uint256, uint256, uint256)",
    "getLastCompletedReportDelta",
    [],
    block,
  );

// ---- Multicall (used by fillV2PoolParamsSnapshot) ----

/**
 * Multicall.aggregate((address,bytes)[]) — atomic, mirrors the original's
 * single `aggregate` call (the whole thing reverts if one sub-call reverts).
 * Pinned.
 */
export const multicallAggregate = (
  ec: EC,
  calls: readonly { target: string; callData: string }[],
  block: number,
) =>
  tryContractCall<readonly [bigint, readonly string[]]>(
    ec,
    MULTICALL,
    "function aggregate((address target, bytes callData)[] calls) returns (uint256 blockNumber, bytes[] returnData)",
    "aggregate",
    [calls],
    block,
  );
