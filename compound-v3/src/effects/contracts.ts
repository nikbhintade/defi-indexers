/**
 * Typed wrappers around `tryContractCall` for every eth_call the original
 * subgraph performed. Address-returning wrappers lowercase the result.
 *
 * Pinning policy (per CONVENTIONS.md): every Comet / Configurator /
 * CometRewards / Chainlink read is pinned to the event block (graph-node
 * executes calls at the event block, and Comet config/state changes over
 * time); immutable ERC20 metadata (name, symbol, decimals) is unpinned.
 *
 * Mock values (COMPOUND_V3_CALL_MOCK): scalar results use kind
 * bigint/number/string; tuple results use kind "json" with an array whose
 * elements are decimal strings for numeric slots (wrappers run them through
 * BigInt()/Number()).
 */
import type { EffectCaller } from "envio";
import { tryContractCall } from "./calls";

type EC = EffectCaller | null;

const lower = (a: string | null): string | null => (a === null ? null : a.toLowerCase());

// ---- Comet (abis/Comet.json) ----

export type TotalsBasic = {
  baseSupplyIndex: bigint;
  baseBorrowIndex: bigint;
  trackingSupplyIndex: bigint;
  trackingBorrowIndex: bigint;
  totalSupplyBase: bigint;
  totalBorrowBase: bigint;
  lastAccrualTime: bigint;
  pauseFlags: bigint;
};

/** Comet.totalsBasic() — pinned. */
export async function cometTotalsBasic(ec: EC, comet: string, block: number): Promise<TotalsBasic | null> {
  const r = await tryContractCall<readonly unknown[]>(
    ec,
    comet,
    "function totalsBasic() view returns ((uint64,uint64,uint64,uint64,uint104,uint104,uint40,uint8))",
    "totalsBasic",
    [],
    block,
  );
  if (r === null) return null;
  return {
    baseSupplyIndex: BigInt(r[0] as string | bigint),
    baseBorrowIndex: BigInt(r[1] as string | bigint),
    trackingSupplyIndex: BigInt(r[2] as string | bigint),
    trackingBorrowIndex: BigInt(r[3] as string | bigint),
    totalSupplyBase: BigInt(r[4] as string | bigint),
    totalBorrowBase: BigInt(r[5] as string | bigint),
    lastAccrualTime: BigInt(r[6] as string | bigint),
    pauseFlags: BigInt(r[7] as string | bigint),
  };
}

/** Comet.getReserves() — pinned. */
export const cometGetReserves = (ec: EC, comet: string, block: number) =>
  tryContractCall<bigint>(ec, comet, "function getReserves() view returns (int256)", "getReserves", [], block);

/** Comet.totalSupply() — pinned. */
export const cometTotalSupply = (ec: EC, comet: string, block: number) =>
  tryContractCall<bigint>(ec, comet, "function totalSupply() view returns (uint256)", "totalSupply", [], block);

/** Comet.totalBorrow() — pinned. */
export const cometTotalBorrow = (ec: EC, comet: string, block: number) =>
  tryContractCall<bigint>(ec, comet, "function totalBorrow() view returns (uint256)", "totalBorrow", [], block);

/** Comet.getUtilization() — pinned. */
export const cometGetUtilization = (ec: EC, comet: string, block: number) =>
  tryContractCall<bigint>(ec, comet, "function getUtilization() view returns (uint256)", "getUtilization", [], block);

/** Comet.getSupplyRate(utilization) — pinned. */
export const cometGetSupplyRate = (ec: EC, comet: string, utilization: bigint, block: number) =>
  tryContractCall<bigint>(
    ec,
    comet,
    "function getSupplyRate(uint256 utilization) view returns (uint64)",
    "getSupplyRate",
    [utilization],
    block,
  );

/** Comet.getBorrowRate(utilization) — pinned. */
export const cometGetBorrowRate = (ec: EC, comet: string, utilization: bigint, block: number) =>
  tryContractCall<bigint>(
    ec,
    comet,
    "function getBorrowRate(uint256 utilization) view returns (uint64)",
    "getBorrowRate",
    [utilization],
    block,
  );

/** Comet.getPrice(priceFeed) / try_getPrice — pinned. */
export const cometGetPrice = (ec: EC, comet: string, priceFeed: string, block: number) =>
  tryContractCall<bigint>(
    ec,
    comet,
    "function getPrice(address priceFeed) view returns (uint256)",
    "getPrice",
    [priceFeed],
    block,
  );

export type UserBasic = {
  principal: bigint;
  baseTrackingIndex: bigint;
  baseTrackingAccrued: bigint;
};

/** Comet.userBasic(account) — pinned. */
export async function cometUserBasic(ec: EC, comet: string, account: string, block: number): Promise<UserBasic | null> {
  const r = await tryContractCall<readonly unknown[]>(
    ec,
    comet,
    "function userBasic(address account) view returns (int104, uint64, uint64, uint16, uint8)",
    "userBasic",
    [account],
    block,
  );
  if (r === null) return null;
  return {
    principal: BigInt(r[0] as string | bigint),
    baseTrackingIndex: BigInt(r[1] as string | bigint),
    baseTrackingAccrued: BigInt(r[2] as string | bigint),
  };
}

/** Comet.userCollateral(account, asset).balance — pinned. */
export async function cometUserCollateralBalance(
  ec: EC,
  comet: string,
  account: string,
  asset: string,
  block: number,
): Promise<bigint | null> {
  const r = await tryContractCall<readonly unknown[]>(
    ec,
    comet,
    "function userCollateral(address account, address asset) view returns (uint128, uint128)",
    "userCollateral",
    [account, asset],
    block,
  );
  if (r === null) return null;
  return BigInt(r[0] as string | bigint);
}

/** Comet.totalsCollateral(asset).totalSupplyAsset — pinned. */
export async function cometTotalsCollateral(ec: EC, comet: string, asset: string, block: number): Promise<bigint | null> {
  const r = await tryContractCall<readonly unknown[]>(
    ec,
    comet,
    "function totalsCollateral(address asset) view returns (uint128, uint128)",
    "totalsCollateral",
    [asset],
    block,
  );
  if (r === null) return null;
  return BigInt(r[0] as string | bigint);
}

/** Comet.try_getCollateralReserves(asset) — pinned. */
export const cometGetCollateralReserves = (ec: EC, comet: string, asset: string, block: number) =>
  tryContractCall<bigint>(
    ec,
    comet,
    "function getCollateralReserves(address asset) view returns (uint256)",
    "getCollateralReserves",
    [asset],
    block,
  );

/** Comet.numAssets() — pinned (config read). */
export const cometNumAssets = (ec: EC, comet: string, block: number) =>
  tryContractCall<number>(ec, comet, "function numAssets() view returns (uint8)", "numAssets", [], block);

export type AssetInfo = {
  offset: number;
  asset: string;
  priceFeed: string;
  scale: bigint;
  borrowCollateralFactor: bigint;
  liquidateCollateralFactor: bigint;
  liquidationFactor: bigint;
  supplyCap: bigint;
};

function decodeAssetInfo(r: readonly unknown[]): AssetInfo {
  return {
    offset: Number(r[0]),
    asset: String(r[1]).toLowerCase(),
    priceFeed: String(r[2]).toLowerCase(),
    scale: BigInt(r[3] as string | bigint),
    borrowCollateralFactor: BigInt(r[4] as string | bigint),
    liquidateCollateralFactor: BigInt(r[5] as string | bigint),
    liquidationFactor: BigInt(r[6] as string | bigint),
    supplyCap: BigInt(r[7] as string | bigint),
  };
}

const ASSET_INFO_RET = "((uint8,address,address,uint64,uint64,uint64,uint64,uint128))";

/** Comet.getAssetInfo(i) — pinned (config read). */
export async function cometGetAssetInfo(ec: EC, comet: string, i: number, block: number): Promise<AssetInfo | null> {
  const r = await tryContractCall<readonly unknown[]>(
    ec,
    comet,
    `function getAssetInfo(uint8 i) view returns ${ASSET_INFO_RET}`,
    "getAssetInfo",
    [i],
    block,
  );
  return r === null ? null : decodeAssetInfo(r);
}

/** Comet.getAssetInfoByAddress(asset) — pinned (config read). */
export async function cometGetAssetInfoByAddress(
  ec: EC,
  comet: string,
  asset: string,
  block: number,
): Promise<AssetInfo | null> {
  const r = await tryContractCall<readonly unknown[]>(
    ec,
    comet,
    `function getAssetInfoByAddress(address asset) view returns ${ASSET_INFO_RET}`,
    "getAssetInfoByAddress",
    [asset],
    block,
  );
  return r === null ? null : decodeAssetInfo(r);
}

/** Comet.name() — pinned (config read). */
export const cometName = (ec: EC, comet: string, block: number) =>
  tryContractCall<string>(ec, comet, "function name() view returns (string)", "name", [], block);

/** Comet.symbol() — pinned (config read). */
export const cometSymbol = (ec: EC, comet: string, block: number) =>
  tryContractCall<string>(ec, comet, "function symbol() view returns (string)", "symbol", [], block);

/** Comet address getters (governor, pauseGuardian, extensionDelegate, baseToken, baseTokenPriceFeed) — pinned. */
export async function cometAddress(
  ec: EC,
  comet: string,
  fn: "governor" | "pauseGuardian" | "extensionDelegate" | "baseToken" | "baseTokenPriceFeed",
  block: number,
): Promise<string | null> {
  return lower(
    await tryContractCall<string>(ec, comet, `function ${fn}() view returns (address)`, fn, [], block),
  );
}

/** Comet uint256 config getters — pinned. */
export async function cometUint(
  ec: EC,
  comet: string,
  fn:
    | "supplyKink"
    | "supplyPerSecondInterestRateSlopeLow"
    | "supplyPerSecondInterestRateSlopeHigh"
    | "supplyPerSecondInterestRateBase"
    | "borrowKink"
    | "borrowPerSecondInterestRateSlopeLow"
    | "borrowPerSecondInterestRateSlopeHigh"
    | "borrowPerSecondInterestRateBase"
    | "storeFrontPriceFactor"
    | "trackingIndexScale"
    | "baseTrackingSupplySpeed"
    | "baseTrackingBorrowSpeed"
    | "baseMinForRewards"
    | "baseBorrowMin"
    | "targetReserves",
  block: number,
): Promise<bigint | null> {
  return tryContractCall<bigint>(ec, comet, `function ${fn}() view returns (uint256)`, fn, [], block);
}

// ---- Configurator (abis/Configurator.json) ----

/** Configurator.try_factory(cometProxy) — pinned. */
export const configuratorFactory = async (ec: EC, configurator: string, cometProxy: string, block: number) =>
  lower(
    await tryContractCall<string>(
      ec,
      configurator,
      "function factory(address cometProxy) view returns (address)",
      "factory",
      [cometProxy],
      block,
    ),
  );

// ---- CometRewards (abis/CometRewardsV1/V2.json) ----

export type RewardConfigV1 = { token: string; rescaleFactor: bigint; shouldUpscale: boolean };
export type RewardConfigV2 = RewardConfigV1 & { multiplier: bigint };

/** CometRewardsV2.try_rewardConfig(market) — pinned. Mock fn name: "rewardConfigV2". */
export async function rewardConfigV2(ec: EC, rewards: string, market: string, block: number): Promise<RewardConfigV2 | null> {
  const r = await tryContractCall<readonly unknown[]>(
    ec,
    rewards,
    "function rewardConfig(address market) view returns (address, uint64, bool, uint256)",
    "rewardConfig",
    [market],
    block,
    "rewardConfigV2",
  );
  if (r === null) return null;
  return {
    token: String(r[0]).toLowerCase(),
    rescaleFactor: BigInt(r[1] as string | bigint),
    shouldUpscale: Boolean(r[2]),
    multiplier: BigInt(r[3] as string | bigint),
  };
}

/** CometRewardsV1.try_rewardConfig(market) — pinned. Mock fn name: "rewardConfigV1". */
export async function rewardConfigV1(ec: EC, rewards: string, market: string, block: number): Promise<RewardConfigV1 | null> {
  const r = await tryContractCall<readonly unknown[]>(
    ec,
    rewards,
    "function rewardConfig(address market) view returns (address, uint64, bool)",
    "rewardConfig",
    [market],
    block,
    "rewardConfigV1",
  );
  if (r === null) return null;
  return {
    token: String(r[0]).toLowerCase(),
    rescaleFactor: BigInt(r[1] as string | bigint),
    shouldUpscale: Boolean(r[2]),
  };
}

// ---- ChainlinkPriceFeed (abis/ChainlinkPriceFeed.json) ----

/** ChainlinkPriceFeed.try_latestRoundData().answer (value1) — pinned. Mock fn name: "latestRoundData" (kind bigint = answer). */
export async function chainlinkLatestAnswer(ec: EC, feed: string, block: number): Promise<bigint | null> {
  const r = await tryContractCall<readonly unknown[] | bigint>(
    ec,
    feed,
    "function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)",
    "latestRoundData",
    [],
    block,
  );
  if (r === null) return null;
  // mocks provide the answer directly as kind bigint
  if (typeof r === "bigint") return r;
  return BigInt(r[1] as string | bigint);
}

// ---- ERC20 (abis/Erc20.json) ----

/** ERC20.try_name() — immutable, unpinned. */
export const erc20Name = (ec: EC, token: string) =>
  tryContractCall<string>(ec, token, "function name() view returns (string)", "name", []);

/** ERC20.try_symbol() — immutable, unpinned. */
export const erc20Symbol = (ec: EC, token: string) =>
  tryContractCall<string>(ec, token, "function symbol() view returns (string)", "symbol", []);

/** ERC20.decimals() — immutable, unpinned. */
export const erc20Decimals = (ec: EC, token: string) =>
  tryContractCall<number>(ec, token, "function decimals() view returns (uint8)", "decimals", []);
