/**
 * Port of src/clearinghouse.ts (Clearinghouse record + snapshot) and
 * src/bophades.ts / src/price.ts (treasury + pricing).
 *
 * `clearinghouseContract.try_*` -> effect wrappers (src/effects/contracts.ts),
 * preserving the subgraph's null-on-revert short-circuits.
 */
import type { BigDecimal } from "envio";
import type { Clearinghouse } from "envio";
import {
  CLEARINGHOUSE_SINGLETON_ID,
  COOLER_LOANS_CLEARINGHOUSE_V1,
  COOLER_LOANS_CLEARINGHOUSE_V1_1,
  KERNEL_ADDRESS,
  TRSRY_KEYCODE,
  ETH_USD_FEED,
  OHM_ETH_FEED,
  GOHM_ADDRESS,
} from "../constants";
import { getISO8601DateStringFromTimestamp, low, toDecimal } from "../utils";
import * as C from "../effects/contracts";

// Minimal subset of the handler context we use (entity stores + effect caller).
// Typed loosely to avoid coupling to the generated HandlerContext type.
export type Ctx = {
  effect: import("envio").EffectCaller;
  Clearinghouse: {
    get: (id: string) => Promise<Clearinghouse | undefined>;
    getWhere: (f: any) => Promise<Clearinghouse[]>;
    set: (e: Clearinghouse) => void;
  };
  ClearinghouseSingleton: {
    get: (id: string) => Promise<{ id: string } | undefined>;
    set: (e: { id: string }) => void;
  };
};

export type EvBlock = { number: number; timestamp: number };

async function getOrCreateSingleton(context: Ctx): Promise<void> {
  const existing = await context.ClearinghouseSingleton.get(CLEARINGHOUSE_SINGLETON_ID);
  if (existing === undefined) {
    context.ClearinghouseSingleton.set({ id: CLEARINGHOUSE_SINGLETON_ID });
  }
}

/** Port of getClearinghouseVersion. */
async function getClearinghouseVersion(context: Ctx, ch: string, block: number): Promise<string> {
  if (ch === COOLER_LOANS_CLEARINGHOUSE_V1) return "1.0";
  if (ch === COOLER_LOANS_CLEARINGHOUSE_V1_1) return "1.1";
  const version = await C.clearinghouseVersion(context.effect, ch);
  if (version === null) return "0.0";
  return `${version[0]}.${version[1]}`;
}

/** Port of getClearinghouseTokens -> [collateral(gohm), reserve, sReserve] or null. */
async function getClearinghouseTokens(context: Ctx, ch: string): Promise<[string, string, string] | null> {
  if (ch === COOLER_LOANS_CLEARINGHOUSE_V1 || ch === COOLER_LOANS_CLEARINGHOUSE_V1_1) {
    const gohm = await C.clearinghouseGohm(context.effect, ch);
    if (gohm === null) return null;
    const dai = await C.clearinghouseDai(context.effect, ch);
    if (dai === null) return null;
    const sdai = await C.clearinghouseSdai(context.effect, ch);
    if (sdai === null) return null;
    return [gohm, dai, sdai];
  }
  const gohm = await C.clearinghouseGohm(context.effect, ch);
  if (gohm === null) return null;
  const reserve = await C.clearinghouseReserve(context.effect, ch);
  if (reserve === null) return null;
  const sReserve = await C.clearinghouseSReserve(context.effect, ch);
  if (sReserve === null) return null;
  return [gohm, reserve, sReserve];
}

/** Port of getOrCreateClearinghouse. Returns null when the address is not a valid clearinghouse. */
export async function getOrCreateClearinghouse(
  context: Ctx,
  clearinghouseAddress: string,
  block: EvBlock,
): Promise<Clearinghouse | null> {
  const ch = low(clearinghouseAddress);
  const existing = await context.Clearinghouse.get(ch);
  if (existing !== undefined) return existing;

  const tokens = await getClearinghouseTokens(context, ch);
  if (tokens === null) return null;

  const collateralDecimals = await C.erc20Decimals(context.effect, tokens[0]);
  if (collateralDecimals === null) return null;
  const reserveDecimals = await C.erc20Decimals(context.effect, tokens[1]);
  if (reserveDecimals === null) return null;
  const sReserveDecimals = await C.erc20Decimals(context.effect, tokens[2]);
  if (sReserveDecimals === null) return null;

  const interestRate = await C.clearinghouseInterestRate(context.effect, ch);
  if (interestRate === null) return null;
  const duration = await C.clearinghouseDuration(context.effect, ch);
  if (duration === null) return null;
  const fundCadence = await C.clearinghouseFundCadence(context.effect, ch);
  if (fundCadence === null) return null;
  const fundAmount = await C.clearinghouseFundAmount(context.effect, ch);
  if (fundAmount === null) return null;
  const loanToCollateral = await C.clearinghouseLoanToCollateral(context.effect, ch);
  if (loanToCollateral === null) return null;
  const factory = await C.clearinghouseFactory(context.effect, ch);
  if (factory === null) return null;

  await getOrCreateSingleton(context);

  const record: Clearinghouse = {
    id: ch,
    createdBlock: BigInt(block.number),
    createdTimestamp: BigInt(block.timestamp),
    version: await getClearinghouseVersion(context, ch, block.number),
    singleton_id: CLEARINGHOUSE_SINGLETON_ID,
    address: ch,
    coolerFactoryAddress: factory,
    collateralToken: tokens[0],
    collateralTokenDecimals: collateralDecimals,
    reserveToken: tokens[1],
    reserveTokenDecimals: reserveDecimals,
    sReserveToken: tokens[2],
    sReserveTokenDecimals: sReserveDecimals,
    interestRate: toDecimal(interestRate, 18),
    duration,
    fundCadence,
    fundAmount: toDecimal(fundAmount, reserveDecimals),
    loanToCollateral: toDecimal(loanToCollateral, reserveDecimals),
  };
  context.Clearinghouse.set(record);
  return record;
}

/** Port of getTreasuryBalances. Returns [reserve, sReserve, sReserveInReserve]. */
async function getTreasuryBalances(
  context: Ctx,
  clearinghouse: Clearinghouse,
  block: number,
): Promise<[BigDecimal, BigDecimal, BigDecimal]> {
  const trsry = await C.kernelGetModuleForKeycode(context.effect, KERNEL_ADDRESS, TRSRY_KEYCODE, block);
  // The subgraph assumes these calls succeed (no try_); treat null as 0n.
  let reserveBalanceInt = trsry === null ? 0n : (await C.trsryGetReserveBalance(context.effect, trsry, clearinghouse.reserveToken, block)) ?? 0n;
  let sReserveBalanceInt = trsry === null ? 0n : (await C.trsryGetReserveBalance(context.effect, trsry, clearinghouse.sReserveToken, block)) ?? 0n;

  // Subtract clearinghouse debt across all clearinghouses sharing the reserve token.
  const all = await context.Clearinghouse.getWhere({ singleton_id: { _eq: CLEARINGHOUSE_SINGLETON_ID } });
  for (const current of all) {
    if (current.reserveToken !== clearinghouse.reserveToken) continue;
    if (trsry !== null) {
      reserveBalanceInt -= (await C.trsryReserveDebt(context.effect, trsry, clearinghouse.reserveToken, current.address, block)) ?? 0n;
      sReserveBalanceInt -= (await C.trsryReserveDebt(context.effect, trsry, clearinghouse.sReserveToken, current.address, block)) ?? 0n;
    }
  }

  const previewed = (await C.previewRedeem(context.effect, clearinghouse.sReserveToken, sReserveBalanceInt, block)) ?? 0n;
  const treasurySReserveInReserveBalance = toDecimal(previewed, clearinghouse.sReserveTokenDecimals);
  const treasurySReserveBalance = toDecimal(sReserveBalanceInt, clearinghouse.sReserveTokenDecimals);
  const treasuryReserveBalance = toDecimal(reserveBalanceInt, clearinghouse.reserveTokenDecimals);
  return [treasuryReserveBalance, treasurySReserveBalance, treasurySReserveInReserveBalance];
}

export type SnapshotInput = {
  date: string;
  timestamp: bigint;
  blockNumber: bigint;
  blockTimestamp: bigint;
  transactionHash: string;
  clearinghouse_id: string;
  isActive: boolean;
  nextRebalanceTimestamp: bigint;
  interestReceivables: BigDecimal;
  principalReceivables: BigDecimal;
  reserveToken: string;
  sReserveToken: string;
  reserveBalance: BigDecimal;
  sReserveBalance: BigDecimal;
  sReserveInReserveBalance: BigDecimal;
  treasuryReserveBalance: BigDecimal;
  treasurySReserveBalance: BigDecimal;
  treasurySReserveInReserveBalance: BigDecimal;
};

/**
 * Port of populateClearinghouseSnapshot. Returns the snapshot field bag (id set
 * by the caller, since the timeseries id is reconstructed deterministically).
 */
export async function populateClearinghouseSnapshot(
  context: Ctx,
  clearinghouseAddress: string,
  block: EvBlock,
  txHash: string,
): Promise<SnapshotInput | null> {
  const record = await getOrCreateClearinghouse(context, clearinghouseAddress, block);
  if (record === null) return null;

  const ch = record.address;
  const isActive = (await C.clearinghouseActive(context.effect, ch, block.number)) ?? false;
  const nextRebalanceTimestamp = (await C.clearinghouseFundTime(context.effect, ch, block.number)) ?? 0n;
  const interestReceivables = toDecimal(
    (await C.clearinghouseInterestReceivables(context.effect, ch, block.number)) ?? 0n,
    record.reserveTokenDecimals,
  );
  const principalReceivables = toDecimal(
    (await C.clearinghousePrincipalReceivables(context.effect, ch, block.number)) ?? 0n,
    record.reserveTokenDecimals,
  );

  const sReserveBalanceInt = (await C.balanceOf(context.effect, record.sReserveToken, ch, block.number)) ?? 0n;
  const reserveBalance = toDecimal(
    (await C.balanceOf(context.effect, record.reserveToken, ch, block.number)) ?? 0n,
    record.reserveTokenDecimals,
  );
  const sReserveBalance = toDecimal(sReserveBalanceInt, record.sReserveTokenDecimals);
  const sReserveInReserveBalance = toDecimal(
    (await C.previewRedeem(context.effect, record.sReserveToken, sReserveBalanceInt, block.number)) ?? 0n,
    record.sReserveTokenDecimals,
  );

  const [treasuryReserveBalance, treasurySReserveBalance, treasurySReserveInReserveBalance] =
    await getTreasuryBalances(context, record, block.number);

  return {
    date: getISO8601DateStringFromTimestamp(BigInt(block.timestamp)),
    timestamp: BigInt(block.timestamp),
    blockNumber: BigInt(block.number),
    blockTimestamp: BigInt(block.timestamp),
    transactionHash: low(txHash),
    clearinghouse_id: record.id,
    isActive,
    nextRebalanceTimestamp,
    interestReceivables,
    principalReceivables,
    reserveToken: record.reserveToken,
    sReserveToken: record.sReserveToken,
    reserveBalance,
    sReserveBalance,
    sReserveInReserveBalance,
    treasuryReserveBalance,
    treasurySReserveBalance,
    treasurySReserveInReserveBalance,
  };
}

/** Port of price.ts getGOhmPrice (OHM/ETH * ETH/USD * gOHM index/1e9). */
export async function getGOhmPrice(context: Ctx, block: number): Promise<BigDecimal> {
  const ethDecimals = await C.feedDecimals(context.effect, ETH_USD_FEED);
  const ethAnswer = await C.feedLatestAnswer(context.effect, ETH_USD_FEED, block);
  const ohmDecimals = await C.feedDecimals(context.effect, OHM_ETH_FEED);
  const ohmAnswer = await C.feedLatestAnswer(context.effect, OHM_ETH_FEED, block);
  if (ethDecimals === null || ethAnswer === null || ohmDecimals === null || ohmAnswer === null) {
    throw new Error("Failed to fetch OHM price");
  }
  const ethUsd = toDecimal(ethAnswer, ethDecimals);
  const ohmEth = toDecimal(ohmAnswer, ohmDecimals);
  const ohmPrice = ohmEth.times(ethUsd);
  const index = (await C.gohmIndex(context.effect, GOHM_ADDRESS, block)) ?? 0n;
  return ohmPrice.times(toDecimal(index, 9));
}
