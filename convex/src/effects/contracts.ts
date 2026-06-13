/**
 * Typed wrappers around `tryContractCall` for every eth_call the original
 * convex subgraph performed (across mapping.ts, services/*.ts and the shared
 * packages/utils). Each wrapper documents the corresponding subgraph call and
 * its pin policy. Address-returning wrappers lowercase the result.
 *
 * Pinned (state-dependent): virtual prices, balances, totalSupply, rewardRate,
 * periodFinish, reserves, getPool, getPair, latestAnswer, price_oracle, xcp_*,
 * exchangeRateStored, pricePerShare, lend_apr, fee accounting reads.
 * Unpinned (immutable metadata): decimals, symbol, name, coins, minter,
 * underlying, factory, get_pool_from_lp_token, tokenInfo/tokenList/getName,
 * vaults_index / amms (registry membership), discount.
 */
import type { EffectCaller } from "envio";
import { tryContractCall } from "./calls";

type EC = EffectCaller | null;

const lower = (a: string | null): string | null => (a === null ? null : a.toLowerCase());

// ---- ERC20 ----

/** ERC20.try_decimals() — immutable, unpinned. */
export const erc20Decimals = (ec: EC, token: string) =>
  tryContractCall<number>(ec, token, "function decimals() view returns (uint8)", "decimals", []);

/** ERC20.try_symbol() — immutable, unpinned. */
export const erc20Symbol = (ec: EC, token: string) =>
  tryContractCall<string>(ec, token, "function symbol() view returns (string)", "symbol", []);

/** ERC20.try_name() — immutable, unpinned. */
export const erc20Name = (ec: EC, token: string) =>
  tryContractCall<string>(ec, token, "function name() view returns (string)", "name", []);

/** ERC20.try_totalSupply() — state-dependent, pinned. */
export const erc20TotalSupply = (ec: EC, token: string, block: number) =>
  tryContractCall<bigint>(ec, token, "function totalSupply() view returns (uint256)", "totalSupply", [], block);

/** ERC20.try_balanceOf(addr) — state-dependent, pinned. */
export const erc20BalanceOf = (ec: EC, token: string, owner: string, block: number) =>
  tryContractCall<bigint>(ec, token, "function balanceOf(address) view returns (uint256)", "balanceOf", [owner], block);

// ---- Booster ----

/**
 * Booster.try_poolInfo(uint256) -> (lptoken, token, gauge, crvRewards, stash, shutdown)
 * Membership is permanent once added; pinned to the event block to be safe
 * for the (rare) same-block read after an addPool.
 */
export const boosterPoolInfo = (ec: EC, booster: string, pid: bigint, block: number) =>
  tryContractCall<readonly [string, string, string, string, string, boolean]>(
    ec,
    booster,
    "function poolInfo(uint256) view returns (address lptoken, address token, address gauge, address crvRewards, address stash, bool shutdown)",
    "poolInfo",
    [pid],
    block,
  );

/** Booster.poolLength() — state-dependent (grows), pinned. */
export const boosterPoolLength = (ec: EC, booster: string, block: number) =>
  tryContractCall<bigint>(ec, booster, "function poolLength() view returns (uint256)", "poolLength", [], block);

/** Booster.lockIncentive() — pinned (fee params can change). */
export const boosterLockIncentive = (ec: EC, booster: string, block: number) =>
  tryContractCall<bigint>(ec, booster, "function lockIncentive() view returns (uint256)", "lockIncentive", [], block);

/** Booster.earmarkIncentive() — pinned. */
export const boosterEarmarkIncentive = (ec: EC, booster: string, block: number) =>
  tryContractCall<bigint>(ec, booster, "function earmarkIncentive() view returns (uint256)", "earmarkIncentive", [], block);

/** Booster.stakerIncentive() — pinned. */
export const boosterStakerIncentive = (ec: EC, booster: string, block: number) =>
  tryContractCall<bigint>(ec, booster, "function stakerIncentive() view returns (uint256)", "stakerIncentive", [], block);

/** Booster.platformFee() — pinned. */
export const boosterPlatformFee = (ec: EC, booster: string, block: number) =>
  tryContractCall<bigint>(ec, booster, "function platformFee() view returns (uint256)", "platformFee", [], block);

// ---- Curve registry / token / pool ----

/** CurveRegistry.try_get_pool_from_lp_token(addr) — registry membership, unpinned. */
export const registryGetPoolFromLpToken = async (ec: EC, registry: string, lpToken: string) =>
  lower(
    await tryContractCall<string>(
      ec,
      registry,
      "function get_pool_from_lp_token(address) view returns (address)",
      "get_pool_from_lp_token",
      [lpToken],
    ),
  );

/** CurveRegistry.get_pool_name(addr) — non-try in original; metadata, unpinned. */
export const registryGetPoolName = (ec: EC, registry: string, pool: string) =>
  tryContractCall<string>(ec, registry, "function get_pool_name(address) view returns (string)", "get_pool_name", [pool]);

/** CurveRegistry.try_get_virtual_price_from_lp_token(addr) — pinned. */
export const registryGetVirtualPriceFromLpToken = (ec: EC, registry: string, lpToken: string, block: number) =>
  tryContractCall<bigint>(
    ec,
    registry,
    "function get_virtual_price_from_lp_token(address) view returns (uint256)",
    "get_virtual_price_from_lp_token",
    [lpToken],
    block,
  );

/** CurveToken.try_minter() — immutable, unpinned. */
export const curveTokenMinter = async (ec: EC, lpToken: string) =>
  lower(await tryContractCall<string>(ec, lpToken, "function minter() view returns (address)", "minter", []));

/** CurvePool.try_coins(uint256) — immutable, unpinned. */
export const poolCoins = async (ec: EC, pool: string, i: number) =>
  lower(await tryContractCall<string>(ec, pool, "function coins(uint256) view returns (address)", "coins", [BigInt(i)]));

/** CurvePool.try_get_virtual_price() — pinned. */
export const poolGetVirtualPrice = (ec: EC, pool: string, block: number) =>
  tryContractCall<bigint>(ec, pool, "function get_virtual_price() view returns (uint256)", "get_virtual_price", [], block);

/** CurvePool.try_price_oracle() — pinned. */
export const poolPriceOracle = (ec: EC, pool: string, block: number) =>
  tryContractCall<bigint>(ec, pool, "function price_oracle() view returns (uint256)", "price_oracle", [], block);

/** CurvePoolV2.try_xcp_profit() — pinned. */
export const poolXcpProfit = (ec: EC, pool: string, block: number) =>
  tryContractCall<bigint>(ec, pool, "function xcp_profit() view returns (uint256)", "xcp_profit", [], block);

/** CurvePoolV2.try_xcp_profit_a() — pinned. */
export const poolXcpProfitA = (ec: EC, pool: string, block: number) =>
  tryContractCall<bigint>(ec, pool, "function xcp_profit_a() view returns (uint256)", "xcp_profit_a", [], block);

/** CurveTriCryptoFactoryPool.try_factory() — immutable, unpinned. */
export const triCryptoPoolFactory = async (ec: EC, pool: string) =>
  lower(await tryContractCall<string>(ec, pool, "function factory() view returns (address)", "factory", []));

// ---- OneWay lending factory / vault / Llamma ----

/** OneWayLendingFactory.try_vaults_index(addr) — registry membership, unpinned. */
export const lendingFactoryVaultsIndex = (ec: EC, factory: string, vault: string) =>
  tryContractCall<bigint>(
    ec,
    factory,
    "function vaults_index(address) view returns (uint256)",
    "vaults_index",
    [vault],
  );

/** OneWayLendingFactory.try_amms(uint256) — immutable, unpinned. */
export const lendingFactoryAmms = async (ec: EC, factory: string, index: bigint) =>
  lower(await tryContractCall<string>(ec, factory, "function amms(uint256) view returns (address)", "amms", [index]));

/** LendingVault.try_collateral_token() — immutable, unpinned. */
export const lendingVaultCollateralToken = async (ec: EC, vault: string) =>
  lower(await tryContractCall<string>(ec, vault, "function collateral_token() view returns (address)", "collateral_token", []));

/** LendingVault.try_borrowed_token() — immutable, unpinned. */
export const lendingVaultBorrowedToken = async (ec: EC, vault: string) =>
  lower(await tryContractCall<string>(ec, vault, "function borrowed_token() view returns (address)", "borrowed_token", []));

/** LendingVault.try_lend_apr() — pinned. */
export const lendingVaultLendApr = (ec: EC, vault: string, block: number) =>
  tryContractCall<bigint>(ec, vault, "function lend_apr() view returns (uint256)", "lend_apr", [], block);

/** LendingVault.try_pricePerShare() — pinned. */
export const lendingVaultPricePerShare = (ec: EC, vault: string, block: number) =>
  tryContractCall<bigint>(ec, vault, "function pricePerShare() view returns (uint256)", "pricePerShare", [], block);

// ---- Extra reward stashes ----

/** ExtraRewardStashV1.try_tokenInfo() -> (token, rewardAddress, ...) — unpinned. */
export const stashV1TokenInfo = (ec: EC, stash: string) =>
  tryContractCall<readonly [string, string, string]>(
    ec,
    stash,
    "function tokenInfo() view returns (address token, address rewardAddress, address rewardPool)",
    "tokenInfo",
    [],
  );

/** ExtraRewardStashV2/V30.try_tokenCount() — pinned (count grows). */
export const stashTokenCount = (ec: EC, stash: string, block: number) =>
  tryContractCall<bigint>(ec, stash, "function tokenCount() view returns (uint256)", "tokenCount", [], block);

/** ExtraRewardStashV2/V30.try_tokenInfo(uint256) -> (token, rewardAddress) — unpinned. */
export const stashV2TokenInfo = (ec: EC, stash: string, i: bigint) =>
  tryContractCall<readonly [string, string]>(
    ec,
    stash,
    "function tokenInfo(uint256) view returns (address token, address rewardAddress)",
    "tokenInfo",
    [i],
  );

/** ExtraRewardStashV3x.try_getName() — version probe, unpinned. */
export const stashGetName = (ec: EC, stash: string) =>
  tryContractCall<string>(ec, stash, "function getName() view returns (string)", "getName", []);

/** ExtraRewardStashV3.x.try_tokenList(uint256) -> address — unpinned. */
export const stashTokenList = async (ec: EC, stash: string, i: bigint) =>
  lower(await tryContractCall<string>(ec, stash, "function tokenList(uint256) view returns (address)", "tokenList", [i]));

/** ExtraRewardStashV3.x.try_tokenInfo(address) -> (token, rewardAddress) — unpinned. */
export const stashV3TokenInfo = (ec: EC, stash: string, token: string) =>
  tryContractCall<readonly [string, string]>(
    ec,
    stash,
    "function tokenInfo(address) view returns (address token, address rewardAddress)",
    "tokenInfo",
    [token],
  );

// ---- Reward pools ----

/** BaseRewardPool/VirtualBalanceRewardPool.try_periodFinish() — pinned. */
export const rewardPoolPeriodFinish = (ec: EC, pool: string, block: number) =>
  tryContractCall<bigint>(ec, pool, "function periodFinish() view returns (uint256)", "periodFinish", [], block);

/** BaseRewardPool/VirtualBalanceRewardPool.try_totalSupply() — pinned. */
export const rewardPoolTotalSupply = (ec: EC, pool: string, block: number) =>
  tryContractCall<bigint>(ec, pool, "function totalSupply() view returns (uint256)", "totalSupply", [], block);

/** BaseRewardPool/VirtualBalanceRewardPool.try_rewardRate() — pinned. */
export const rewardPoolRewardRate = (ec: EC, pool: string, block: number) =>
  tryContractCall<bigint>(ec, pool, "function rewardRate() view returns (uint256)", "rewardRate", [], block);

/** BaseRewardPool.try_historicalRewards() — pinned. */
export const rewardPoolHistoricalRewards = (ec: EC, pool: string, block: number) =>
  tryContractCall<bigint>(ec, pool, "function historicalRewards() view returns (uint256)", "historicalRewards", [], block);

// ---- Pricing sources ----

/** UniswapV2Factory.getPair(a, b) — non-try in original; pinned. */
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

/** UniswapV2Pair.getReserves() — non-try in original; pinned. */
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
  tryContractCall<bigint>(ec, token, "function exchangeRateStored() view returns (uint256)", "exchangeRateStored", [], block);

/** YToken.try_getPricePerFullShare() — pinned. */
export const yTokenGetPricePerFullShare = (ec: EC, token: string, block: number) =>
  tryContractCall<bigint>(ec, token, "function getPricePerFullShare() view returns (uint256)", "getPricePerFullShare", [], block);

/** RedeemableKeep3r.discount() — non-try in original; treated as pinned. */
export const rKp3rDiscount = (ec: EC, token: string, block: number) =>
  tryContractCall<bigint>(ec, token, "function discount() view returns (uint256)", "discount", [], block);

/** RedeemableKeep3r.try_price() — pinned. */
export const rKp3rPrice = (ec: EC, token: string, block: number) =>
  tryContractCall<bigint>(ec, token, "function price() view returns (uint256)", "price", [], block);

// ---- FeeRegistry / FeeDeposit (FXS path; see MIGRATION.md "Gaps") ----

/** FeeDeposit.callIncentive() — pinned. */
export const feeDepositCallIncentive = (ec: EC, deposit: string, block: number) =>
  tryContractCall<bigint>(ec, deposit, "function callIncentive() view returns (uint256)", "callIncentive", [], block);

/** FeeRegistry.cvxIncentive() — pinned. */
export const feeRegistryCvxIncentive = (ec: EC, registry: string, block: number) =>
  tryContractCall<bigint>(ec, registry, "function cvxIncentive() view returns (uint256)", "cvxIncentive", [], block);

/** FeeRegistry.totalFees() — pinned. */
export const feeRegistryTotalFees = (ec: EC, registry: string, block: number) =>
  tryContractCall<bigint>(ec, registry, "function totalFees() view returns (uint256)", "totalFees", [], block);

/** FeeRegistry.platformIncentive() — pinned. */
export const feeRegistryPlatformIncentive = (ec: EC, registry: string, block: number) =>
  tryContractCall<bigint>(ec, registry, "function platformIncentive() view returns (uint256)", "platformIncentive", [], block);
