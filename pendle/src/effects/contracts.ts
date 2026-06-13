/**
 * Typed wrappers around `tryContractCall` for every eth_call the Pendle
 * subgraph-v3 mappings performed. Each wrapper documents the corresponding
 * subgraph call and whether it is block-pinned.
 *
 * eth_call -> Effect table (see MIGRATION.md):
 * | Subgraph call                                  | Wrapper                | Pinned |
 * | ---------------------------------------------- | ---------------------- | ------ |
 * | ERC20.try_symbol()  / ERC20SymbolBytes         | erc20Symbol / Bytes32  | no     |
 * | ERC20.try_name()    / ERC20NameBytes           | erc20Name   / Bytes32  | no     |
 * | ERC20.try_decimals()                           | erc20Decimals          | no     |
 * | ERC20.totalSupply()         (non-try)          | erc20TotalSupply       | yes*   |
 * | ERC20.balanceOf(addr)       (non-try)          | erc20BalanceOf         | yes    |
 * | ICToken.exchangeRateCurrent() (non-try)        | cTokenExchangeRate     | yes    |
 * | UniswapPool.token0()/token1()                  | uniToken0 / uniToken1  | no     |
 * | UniswapPool.slot0()         (non-try)          | uniSlot0SqrtPrice      | yes    |
 * | PendleMarket.getReserves()  (non-try)          | marketGetReserves      | yes    |
 * | PendleMarket.totalSupply()  (non-try)          | marketTotalSupply      | yes    |
 * | PendleMarket.expiry()       (non-try)          | marketExpiry           | no     |
 * | SushiswapPair.token0()/totalSupply()/getReserves | sushi*               | yes(state)|
 * | LMv1.startTime()/epochDuration()               | lm1StartTime/...       | no     |
 * | LMv1.try_startTime()                            | lm1TryStartTime        | no     |
 * | LMv1.readExpiryData()/readEpochData()          | lm1ReadExpiry/Epoch    | yes    |
 * | LMv1.latestSetting()/allocationSettings()      | lm1LatestSetting/Alloc | yes    |
 * | LMv2.stakeToken()                               | lm2StakeToken          | no     |
 * | LMv2.startTime()/epochDuration()/totalStake()  | lm2*                   | yes(state)|
 * | LMv2.readEpochData(epoch,user)                 | lm2ReadEpochData       | yes    |
 * | PendleLpHolder.pendleMarket()                  | lpHolderPendleMarket   | no     |
 *
 *  *ERC20.totalSupply() is read for OT/XYT after mint/redeem to capture the
 *   live supply at the event block, so it is pinned.
 */
import type { EffectCaller } from "envio";
import { tryContractCall } from "./calls";

type EC = EffectCaller | null;

const lower = (a: string | null): string | null => (a === null ? null : a.toLowerCase());

// ---------- ERC20 metadata (immutable, unpinned) ----------

/** ERC20.symbol() returns (string) */
export const erc20Symbol = (ec: EC, token: string) =>
  tryContractCall<string>(ec, token, "function symbol() view returns (string)", "symbol", []);

/** ERC20SymbolBytes.symbol() returns (bytes32) — raw 0x… hex (or a pre-decoded mock value) */
export const erc20SymbolBytes32 = (ec: EC, token: string) =>
  tryContractCall<string>(
    ec,
    token,
    "function symbol() view returns (bytes32)",
    "symbol",
    [],
    undefined,
    "symbolBytes32",
  );

/** ERC20.name() returns (string) */
export const erc20Name = (ec: EC, token: string) =>
  tryContractCall<string>(ec, token, "function name() view returns (string)", "name", []);

/** ERC20NameBytes.name() returns (bytes32) */
export const erc20NameBytes32 = (ec: EC, token: string) =>
  tryContractCall<string>(
    ec,
    token,
    "function name() view returns (bytes32)",
    "name",
    [],
    undefined,
    "nameBytes32",
  );

/** ERC20.decimals() returns (uint8) */
export const erc20Decimals = (ec: EC, token: string) =>
  tryContractCall<number>(ec, token, "function decimals() view returns (uint8)", "decimals", []);

// ---------- ERC20 state reads (pinned to event block) ----------

/** ERC20.totalSupply() returns (uint256) — non-try in the original. */
export const erc20TotalSupply = (ec: EC, token: string, block: number) =>
  tryContractCall<bigint>(
    ec,
    token,
    "function totalSupply() view returns (uint256)",
    "totalSupply",
    [],
    block,
  );

/** ERC20.balanceOf(addr) returns (uint256) — non-try in the original. */
export const erc20BalanceOf = (ec: EC, token: string, owner: string, block: number) =>
  tryContractCall<bigint>(
    ec,
    token,
    "function balanceOf(address) view returns (uint256)",
    "balanceOf",
    [owner as `0x${string}`],
    block,
  );

// ---------- ICToken (compound rate) ----------

/** ICToken.exchangeRateCurrent() returns (uint256) — non-try, state-dependent. */
export const cTokenExchangeRate = (ec: EC, cToken: string, block: number) =>
  tryContractCall<bigint>(
    ec,
    cToken,
    "function exchangeRateCurrent() returns (uint256)",
    "exchangeRateCurrent",
    [],
    block,
  );

// ---------- UniswapV3 pool ----------

/** UniswapPool.token0() returns (address) — immutable. */
export const uniToken0 = async (ec: EC, pool: string) =>
  lower(await tryContractCall<string>(ec, pool, "function token0() view returns (address)", "token0", []));

/** UniswapPool.token1() returns (address) — immutable. */
export const uniToken1 = async (ec: EC, pool: string) =>
  lower(await tryContractCall<string>(ec, pool, "function token1() view returns (address)", "token1", []));

/** UniswapPool.slot0().sqrtPriceX96 (value0) — state-dependent, pinned. */
export const uniSlot0SqrtPrice = async (ec: EC, pool: string, block: number) => {
  const res = await tryContractCall<unknown[]>(
    ec,
    pool,
    "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
    "slot0",
    [],
    block,
  );
  return res === null ? null : (res[0] as bigint);
};

// ---------- PendleMarket ----------

export type MarketReserves = {
  xytBalance: bigint;
  xytWeight: bigint;
  tokenBalance: bigint;
  tokenWeight: bigint;
  currentBlock: bigint;
};

/** PendleMarket.getReserves() — non-try, state-dependent, pinned. */
export const marketGetReserves = async (ec: EC, market: string, block: number): Promise<MarketReserves | null> => {
  const res = await tryContractCall<unknown[]>(
    ec,
    market,
    "function getReserves() view returns (uint256 xytBalance, uint256 xytWeight, uint256 tokenBalance, uint256 tokenWeight, uint256 currentBlock)",
    "getReserves",
    [],
    block,
  );
  if (res === null) return null;
  return {
    xytBalance: res[0] as bigint,
    xytWeight: res[1] as bigint,
    tokenBalance: res[2] as bigint,
    tokenWeight: res[3] as bigint,
    currentBlock: res[4] as bigint,
  };
};

/** PendleMarket.totalSupply() — non-try, state-dependent, pinned. */
export const marketTotalSupply = (ec: EC, market: string, block: number) =>
  tryContractCall<bigint>(
    ec,
    market,
    "function totalSupply() view returns (uint256)",
    "totalSupply",
    [],
    block,
    "marketTotalSupply",
  );

/** PendleMarket.expiry() — immutable, unpinned. */
export const marketExpiry = (ec: EC, market: string) =>
  tryContractCall<bigint>(ec, market, "function expiry() view returns (uint256)", "expiry", [], undefined, "marketExpiry");

// ---------- SushiswapPair ----------

/** SushiswapPair.token0() — immutable. */
export const sushiToken0 = async (ec: EC, pair: string) =>
  lower(await tryContractCall<string>(ec, pair, "function token0() view returns (address)", "token0", [], undefined, "sushiToken0"));

/** SushiswapPair.totalSupply() — state-dependent, pinned. */
export const sushiTotalSupply = (ec: EC, pair: string, block: number) =>
  tryContractCall<bigint>(
    ec,
    pair,
    "function totalSupply() view returns (uint256)",
    "totalSupply",
    [],
    block,
    "sushiTotalSupply",
  );

/** SushiswapPair.getReserves().reserve0 (value0) — state-dependent, pinned. */
export const sushiReserve0 = async (ec: EC, pair: string, block: number) => {
  const res = await tryContractCall<unknown[]>(
    ec,
    pair,
    "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
    "getReserves",
    [],
    block,
    "sushiGetReserves",
  );
  return res === null ? null : (res[0] as bigint);
};

// ---------- PendleLiquidityMiningV1 ----------

export const lm1StartTime = (ec: EC, lm: string) =>
  tryContractCall<bigint>(ec, lm, "function startTime() view returns (uint256)", "startTime", [], undefined, "lm1StartTime");

/** LMv1.try_startTime() — the "is deployed?" probe; null == reverted. */
export const lm1TryStartTime = lm1StartTime;

export const lm1EpochDuration = (ec: EC, lm: string) =>
  tryContractCall<bigint>(ec, lm, "function epochDuration() view returns (uint256)", "epochDuration", [], undefined, "lm1EpochDuration");

export type Lm1ExpiryData = {
  totalStakeLP: bigint;
  lastNYield: bigint;
  paramL: bigint;
  lpHolder: string;
};

/** LMv1.readExpiryData(expiry) — state-dependent, pinned. */
export const lm1ReadExpiryData = async (ec: EC, lm: string, expiry: bigint, block: number): Promise<Lm1ExpiryData | null> => {
  const res = await tryContractCall<unknown[]>(
    ec,
    lm,
    "function readExpiryData(uint256 expiry) view returns (uint256 totalStakeLP, uint256 lastNYield, uint256 paramL, address lpHolder)",
    "readExpiryData",
    [expiry],
    block,
  );
  if (res === null) return null;
  return {
    totalStakeLP: res[0] as bigint,
    lastNYield: res[1] as bigint,
    paramL: res[2] as bigint,
    lpHolder: (res[3] as string).toLowerCase(),
  };
};

export type Lm1EpochData = { settingId: bigint; totalRewards: bigint };

/** LMv1.readEpochData(epochId) — state-dependent, pinned. */
export const lm1ReadEpochData = async (ec: EC, lm: string, epochId: bigint, block: number): Promise<Lm1EpochData | null> => {
  const res = await tryContractCall<unknown[]>(
    ec,
    lm,
    "function readEpochData(uint256 epochId) view returns (uint256 settingId, uint256 totalRewards)",
    "readEpochData",
    [epochId],
    block,
  );
  if (res === null) return null;
  return { settingId: res[0] as bigint, totalRewards: res[1] as bigint };
};

export type Lm1LatestSetting = { id: bigint; firstEpochToApply: bigint };

/** LMv1.latestSetting() — state-dependent, pinned. */
export const lm1LatestSetting = async (ec: EC, lm: string, block: number): Promise<Lm1LatestSetting | null> => {
  const res = await tryContractCall<unknown[]>(
    ec,
    lm,
    "function latestSetting() view returns (uint256 id, uint256 firstEpochToApply)",
    "latestSetting",
    [],
    block,
  );
  if (res === null) return null;
  return { id: res[0] as bigint, firstEpochToApply: res[1] as bigint };
};

/** LMv1.allocationSettings(settingId, expiry) — state-dependent, pinned. */
export const lm1AllocationSettings = (ec: EC, lm: string, settingId: bigint, expiry: bigint, block: number) =>
  tryContractCall<bigint>(
    ec,
    lm,
    "function allocationSettings(uint256, uint256) view returns (uint256)",
    "allocationSettings",
    [settingId, expiry],
    block,
  );

// ---------- PendleLiquidityMiningV2 ----------

/** LMv2.stakeToken() — immutable. */
export const lm2StakeToken = async (ec: EC, lm: string) =>
  lower(await tryContractCall<string>(ec, lm, "function stakeToken() view returns (address)", "stakeToken", []));

export const lm2StartTime = (ec: EC, lm: string) =>
  tryContractCall<bigint>(ec, lm, "function startTime() view returns (uint256)", "startTime", [], undefined, "lm2StartTime");

export const lm2EpochDuration = (ec: EC, lm: string) =>
  tryContractCall<bigint>(ec, lm, "function epochDuration() view returns (uint256)", "epochDuration", [], undefined, "lm2EpochDuration");

/** LMv2.totalStake() — state-dependent, pinned. */
export const lm2TotalStake = (ec: EC, lm: string, block: number) =>
  tryContractCall<bigint>(ec, lm, "function totalStake() view returns (uint256)", "totalStake", [], block);

export type Lm2EpochData = {
  totalStakeUnits: bigint;
  totalRewards: bigint;
  lastUpdated: bigint;
  stakeUnitsForUser: bigint;
  availableRewardsForUser: bigint;
};

/** LMv2.readEpochData(epochId, user) — state-dependent, pinned. */
export const lm2ReadEpochData = async (
  ec: EC,
  lm: string,
  epochId: bigint,
  user: string,
  block: number,
): Promise<Lm2EpochData | null> => {
  const res = await tryContractCall<unknown[]>(
    ec,
    lm,
    "function readEpochData(uint256 epochId, address user) view returns (uint256 totalStakeUnits, uint256 totalRewards, uint256 lastUpdated, uint256 stakeUnitsForUser, uint256 availableRewardsForUser)",
    "readEpochData",
    [epochId, user as `0x${string}`],
    block,
  );
  if (res === null) return null;
  return {
    totalStakeUnits: res[0] as bigint,
    totalRewards: res[1] as bigint,
    lastUpdated: res[2] as bigint,
    stakeUnitsForUser: res[3] as bigint,
    availableRewardsForUser: res[4] as bigint,
  };
};

// ---------- PendleLpHolder ----------

/** PendleLpHolder.pendleMarket() — immutable. */
export const lpHolderPendleMarket = async (ec: EC, lpHolder: string) =>
  lower(await tryContractCall<string>(ec, lpHolder, "function pendleMarket() view returns (address)", "pendleMarket", []));
