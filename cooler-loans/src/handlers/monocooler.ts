/**
 * Port of src/monocooler.ts (MonoCooler v2 position accounting).
 *
 * Timeseries entities (account/global snapshots, loan origination, liquidation)
 * used graph-node auto-ids; ported to deterministic `txHash-logIndex` (+suffix
 * to disambiguate the snapshots emitted within one event). Activity / oracle
 * change ids match the subgraph (`txHash-logIndex`). Documented in MIGRATION.md.
 */
import { indexer } from "envio";
import type { MonoCoolerAccount, MonoCoolerGlobalState } from "envio";
import { low } from "../utils";
import {
  MONO_GLOBAL_STATE_ID,
  RAY,
  WAD,
  MONO_FALLBACK_MAX_ORIGINATION_LTV,
  MONO_FALLBACK_LIQUIDATION_LTV,
} from "../constants";
import * as C from "../effects/contracts";

type MonoCtx = {
  effect: import("envio").EffectCaller;
  MonoCoolerAccount: {
    get: (id: string) => Promise<MonoCoolerAccount | undefined>;
    set: (e: MonoCoolerAccount) => void;
  };
  MonoCoolerGlobalState: {
    get: (id: string) => Promise<MonoCoolerGlobalState | undefined>;
    set: (e: MonoCoolerGlobalState) => void;
  };
  MonoCoolerAccountSnapshot: { set: (e: any) => void };
  MonoCoolerGlobalSnapshot: { set: (e: any) => void };
  MonoCoolerActivity: { set: (e: any) => void };
  MonoCoolerLtvOracleChange: { set: (e: any) => void };
  MonoCoolerLoanOrigination: { set: (e: any) => void };
  MonoCoolerLiquidation: { set: (e: any) => void };
};

/** getLtvValues: loanToValues() with fallback to constant [3000, 3300] WAD. */
async function getLtvValues(ctx: MonoCtx, addr: string, block: number): Promise<[bigint, bigint]> {
  const r = await C.monoLoanToValues(ctx.effect, addr, block);
  if (r === null) return [MONO_FALLBACK_MAX_ORIGINATION_LTV, MONO_FALLBACK_LIQUIDATION_LTV];
  return [r[0], r[1]];
}

async function getOrCreateGlobalState(ctx: MonoCtx, addr: string, timestamp: number, block: number): Promise<MonoCoolerGlobalState> {
  const existing = await ctx.MonoCoolerGlobalState.get(MONO_GLOBAL_STATE_ID);
  if (existing !== undefined) return existing;
  const state: MonoCoolerGlobalState = {
    id: MONO_GLOBAL_STATE_ID,
    totalCollateral: (await C.monoTotalCollateral(ctx.effect, addr, block)) ?? 0n,
    totalDebt: (await C.monoTotalDebt(ctx.effect, addr, block)) ?? 0n,
    interestAccumulatorRay: (await C.monoInterestAccumulatorRay(ctx.effect, addr, block)) ?? RAY,
    interestRateWad: (await C.monoInterestRateWad(ctx.effect, addr, block)) ?? 0n,
    ltvOracle: (await C.monoLtvOracle(ctx.effect, addr, block)) ?? "0x",
    liquidationPaused: (await C.monoLiquidationsPaused(ctx.effect, addr, block)) ?? false,
    borrowsPaused: (await C.monoBorrowsPaused(ctx.effect, addr, block)) ?? false,
    treasuryBorrower: (await C.monoTreasuryBorrower(ctx.effect, addr, block)) ?? "0x",
    updatedAt: BigInt(timestamp),
  };
  ctx.MonoCoolerGlobalState.set(state);
  return state;
}

function getOrCreateAccount(existing: MonoCoolerAccount | undefined, address: string): MonoCoolerAccount {
  if (existing !== undefined) return existing;
  return {
    id: address,
    address,
    collateral: 0n,
    debt: 0n,
    interestAccumulatorRay: RAY,
    ltv: 0n,
    healthFactor: 0n,
    updatedAt: 0n,
  };
}

/** updateAccountMetrics: accountPosition().{currentLtv, healthFactor}, else 0. */
async function updateAccountMetrics(ctx: MonoCtx, account: MonoCoolerAccount, addr: string, block: number): Promise<MonoCoolerAccount> {
  const pos = await C.monoAccountPosition(ctx.effect, addr, account.address, block);
  if (pos === null) return { ...account, ltv: 0n, healthFactor: 0n };
  return { ...account, ltv: pos.currentLtv, healthFactor: pos.healthFactor };
}

function createAccountSnapshot(ctx: MonoCtx, account: MonoCoolerAccount, ts: number, ltv: [bigint, bigint], idSuffix: string): void {
  ctx.MonoCoolerAccountSnapshot.set({
    id: idSuffix,
    timestamp: BigInt(ts),
    account_id: account.id,
    collateral: account.collateral,
    debt: account.debt,
    ltv: account.ltv,
    healthFactor: account.healthFactor,
    maxOriginationLtv: ltv[0],
    liquidationLtv: ltv[1],
  });
}

function createGlobalSnapshot(ctx: MonoCtx, gs: MonoCoolerGlobalState, ts: number, ltv: [bigint, bigint], idSuffix: string): void {
  ctx.MonoCoolerGlobalSnapshot.set({
    id: idSuffix,
    timestamp: BigInt(ts),
    globalState_id: gs.id,
    totalCollateral: gs.totalCollateral,
    totalDebt: gs.totalDebt,
    interestRateWad: gs.interestRateWad,
    maxOriginationLtv: ltv[0],
    liquidationLtv: ltv[1],
  });
}

function createActivity(
  ctx: MonoCtx,
  type: string,
  account: MonoCoolerAccount,
  amount: bigint,
  collateral: bigint,
  debt: bigint,
  txHash: string,
  logIndex: number,
  ts: number,
  ltv: [bigint, bigint],
  liquidationData: [bigint, bigint, bigint] | null = null,
): void {
  ctx.MonoCoolerActivity.set({
    id: `${low(txHash)}-${logIndex}`,
    type,
    account_id: account.id,
    amount,
    collateral,
    debt,
    ltv: account.ltv,
    maxOriginationLtv: ltv[0],
    liquidationLtv: ltv[1],
    txHash: low(txHash),
    timestamp: BigInt(ts),
    liquidationIncentive: liquidationData ? liquidationData[0] : undefined,
    collateralSeized: liquidationData ? liquidationData[1] : undefined,
    debtWiped: liquidationData ? liquidationData[2] : undefined,
  });
}

const evCommon = (event: { srcAddress: string; block: { number: number; timestamp: number }; transaction: { hash: string }; logIndex: number }) => ({
  addr: low(event.srcAddress),
  block: event.block.number,
  ts: event.block.timestamp,
  tx: event.transaction.hash,
  li: event.logIndex,
});

indexer.onEvent({ contract: "MonoCooler", event: "CollateralAdded" }, async ({ event, context }) => {
  const ctx = context as unknown as MonoCtx;
  const { addr, block, ts, tx, li } = evCommon(event);
  const ltv = await getLtvValues(ctx, addr, block);
  const gs0 = await getOrCreateGlobalState(ctx, addr, ts, block);
  let account = getOrCreateAccount(await ctx.MonoCoolerAccount.get(low(event.params.onBehalfOf)), low(event.params.onBehalfOf));
  const amount = event.params.collateralAmount;

  account = { ...account, collateral: account.collateral + amount, updatedAt: BigInt(ts) };
  account = await updateAccountMetrics(ctx, account, addr, block);
  ctx.MonoCoolerAccount.set(account);

  const gs = { ...gs0, totalCollateral: gs0.totalCollateral + amount, updatedAt: BigInt(ts) };
  ctx.MonoCoolerGlobalState.set(gs);

  createAccountSnapshot(ctx, account, ts, ltv, `${low(tx)}-${li}-acct`);
  createGlobalSnapshot(ctx, gs, ts, ltv, `${low(tx)}-${li}-global`);
  createActivity(ctx, "collateralAdd", account, amount, account.collateral, account.debt, tx, li, ts, ltv);
});

indexer.onEvent({ contract: "MonoCooler", event: "CollateralWithdrawn" }, async ({ event, context }) => {
  const ctx = context as unknown as MonoCtx;
  const { addr, block, ts, tx, li } = evCommon(event);
  const ltv = await getLtvValues(ctx, addr, block);
  const gs0 = await getOrCreateGlobalState(ctx, addr, ts, block);
  let account = getOrCreateAccount(await ctx.MonoCoolerAccount.get(low(event.params.onBehalfOf)), low(event.params.onBehalfOf));
  const amount = event.params.collateralAmount;

  account = { ...account, collateral: account.collateral - amount, updatedAt: BigInt(ts) };
  account = await updateAccountMetrics(ctx, account, addr, block);
  ctx.MonoCoolerAccount.set(account);

  const gs = { ...gs0, totalCollateral: gs0.totalCollateral - amount, updatedAt: BigInt(ts) };
  ctx.MonoCoolerGlobalState.set(gs);

  createAccountSnapshot(ctx, account, ts, ltv, `${low(tx)}-${li}-acct`);
  createGlobalSnapshot(ctx, gs, ts, ltv, `${low(tx)}-${li}-global`);
  createActivity(ctx, "collateralWithdraw", account, amount, account.collateral, account.debt, tx, li, ts, ltv);
});

indexer.onEvent({ contract: "MonoCooler", event: "Borrow" }, async ({ event, context }) => {
  const ctx = context as unknown as MonoCtx;
  const { addr, block, ts, tx, li } = evCommon(event);
  const ltv = await getLtvValues(ctx, addr, block);
  const gs0 = await getOrCreateGlobalState(ctx, addr, ts, block);
  let account = getOrCreateAccount(await ctx.MonoCoolerAccount.get(low(event.params.onBehalfOf)), low(event.params.onBehalfOf));
  const amount = event.params.amount;

  account = { ...account, debt: account.debt + amount, updatedAt: BigInt(ts) };
  account = await updateAccountMetrics(ctx, account, addr, block);
  ctx.MonoCoolerAccount.set(account);

  const gs = { ...gs0, totalDebt: gs0.totalDebt + amount, updatedAt: BigInt(ts) };
  ctx.MonoCoolerGlobalState.set(gs);

  ctx.MonoCoolerLoanOrigination.set({
    id: `${low(tx)}-${li}`,
    timestamp: BigInt(ts),
    account_id: account.id,
    borrowAmount: amount,
    resultingLtv: account.ltv,
    maxOriginationLtv: ltv[0],
    liquidationLtv: ltv[1],
    collateralAtTime: account.collateral,
    debtAtTime: account.debt,
    healthFactor: account.healthFactor,
    utilizationRatio: ltv[0] === 0n ? 0n : (account.ltv * WAD) / ltv[0],
    txHash: low(tx),
  });

  createAccountSnapshot(ctx, account, ts, ltv, `${low(tx)}-${li}-acct`);
  createGlobalSnapshot(ctx, gs, ts, ltv, `${low(tx)}-${li}-global`);
  createActivity(ctx, "borrow", account, amount, account.collateral, account.debt, tx, li, ts, ltv);
});

indexer.onEvent({ contract: "MonoCooler", event: "Repay" }, async ({ event, context }) => {
  const ctx = context as unknown as MonoCtx;
  const { addr, block, ts, tx, li } = evCommon(event);
  const ltv = await getLtvValues(ctx, addr, block);
  const gs0 = await getOrCreateGlobalState(ctx, addr, ts, block);
  let account = getOrCreateAccount(await ctx.MonoCoolerAccount.get(low(event.params.onBehalfOf)), low(event.params.onBehalfOf));
  const amount = event.params.repayAmount;

  let debt = account.debt - amount;
  if (debt < 0n) debt = 0n;
  account = { ...account, debt, updatedAt: BigInt(ts) };
  account = await updateAccountMetrics(ctx, account, addr, block);
  ctx.MonoCoolerAccount.set(account);

  let totalDebt = gs0.totalDebt - amount;
  if (totalDebt < 0n) totalDebt = 0n;
  const gs = { ...gs0, totalDebt, updatedAt: BigInt(ts) };
  ctx.MonoCoolerGlobalState.set(gs);

  createAccountSnapshot(ctx, account, ts, ltv, `${low(tx)}-${li}-acct`);
  createGlobalSnapshot(ctx, gs, ts, ltv, `${low(tx)}-${li}-global`);
  createActivity(ctx, "repay", account, amount, account.collateral, account.debt, tx, li, ts, ltv);
});

indexer.onEvent({ contract: "MonoCooler", event: "Liquidated" }, async ({ event, context }) => {
  const ctx = context as unknown as MonoCtx;
  const { addr, block, ts, tx, li } = evCommon(event);
  const ltv = await getLtvValues(ctx, addr, block);
  const gs0 = await getOrCreateGlobalState(ctx, addr, ts, block);
  const account0 = getOrCreateAccount(await ctx.MonoCoolerAccount.get(low(event.params.account)), low(event.params.account));
  const collateralSeized = event.params.collateralSeized;
  const debtWiped = event.params.debtWiped;
  const incentive = event.params.incentives;

  const ltvAtLiquidation = account0.ltv;
  const healthFactorAtLiquidation = account0.healthFactor;

  ctx.MonoCoolerLiquidation.set({
    id: `${low(tx)}-${li}`,
    timestamp: BigInt(ts),
    account_id: account0.id,
    liquidator: low(event.params.caller),
    collateralSeized,
    debtWiped,
    incentiveReceived: incentive,
    ltvAtLiquidation,
    maxOriginationLtv: ltv[0],
    liquidationLtv: ltv[1],
    excessLtv: ltvAtLiquidation - ltv[1],
    healthFactorAtLiquidation,
    txHash: low(tx),
  });

  const account = { ...account0, collateral: 0n, debt: 0n, ltv: 0n, healthFactor: 0n, updatedAt: BigInt(ts) };
  ctx.MonoCoolerAccount.set(account);

  let totalCollateral = gs0.totalCollateral - collateralSeized;
  if (totalCollateral < 0n) totalCollateral = 0n;
  let totalDebt = gs0.totalDebt - debtWiped;
  if (totalDebt < 0n) totalDebt = 0n;
  const gs = { ...gs0, totalCollateral, totalDebt, updatedAt: BigInt(ts) };
  ctx.MonoCoolerGlobalState.set(gs);

  createAccountSnapshot(ctx, account, ts, ltv, `${low(tx)}-${li}-acct`);
  createGlobalSnapshot(ctx, gs, ts, ltv, `${low(tx)}-${li}-global`);
  createActivity(ctx, "liquidate", account, debtWiped, account.collateral, account.debt, tx, li, ts, ltv, [incentive, collateralSeized, debtWiped]);
});

indexer.onEvent({ contract: "MonoCooler", event: "LtvOracleSet" }, async ({ event, context }) => {
  const ctx = context as unknown as MonoCtx;
  const { addr, block, ts, tx, li } = evCommon(event);
  const gs0 = await getOrCreateGlobalState(ctx, addr, ts, block);
  const oldOracle = gs0.ltvOracle;
  const newOracle = low(event.params.oracle);

  // Both old & new LTV reads are pinned to the event block; in practice the
  // contract returns the post-change values for both (preserved from subgraph).
  const oldLtv = await getLtvValues(ctx, addr, block);
  const gs = { ...gs0, ltvOracle: newOracle, updatedAt: BigInt(ts) };
  ctx.MonoCoolerGlobalState.set(gs);
  const newLtv = await getLtvValues(ctx, addr, block);

  ctx.MonoCoolerLtvOracleChange.set({
    id: `${low(tx)}-${li}`,
    globalState_id: gs.id,
    oldOracle,
    newOracle,
    oldMaxOriginationLtv: oldLtv[0],
    oldLiquidationLtv: oldLtv[1],
    newMaxOriginationLtv: newLtv[0],
    newLiquidationLtv: newLtv[1],
    blockNumber: BigInt(block),
    blockTimestamp: BigInt(ts),
    transactionHash: low(tx),
  });

  createGlobalSnapshot(ctx, gs, ts, newLtv, `${low(tx)}-${li}-global`);
});

indexer.onEvent({ contract: "MonoCooler", event: "InterestRateSet" }, async ({ event, context }) => {
  const ctx = context as unknown as MonoCtx;
  const { addr, block, ts, tx, li } = evCommon(event);
  const ltv = await getLtvValues(ctx, addr, block);
  const gs0 = await getOrCreateGlobalState(ctx, addr, ts, block);
  const gs = { ...gs0, interestRateWad: event.params.interestRateWad, updatedAt: BigInt(ts) };
  ctx.MonoCoolerGlobalState.set(gs);
  createGlobalSnapshot(ctx, gs, ts, ltv, `${low(tx)}-${li}-global`);
});

indexer.onEvent({ contract: "MonoCooler", event: "LiquidationsPausedSet" }, async ({ event, context }) => {
  const ctx = context as unknown as MonoCtx;
  const { addr, block, ts, tx, li } = evCommon(event);
  const ltv = await getLtvValues(ctx, addr, block);
  const gs0 = await getOrCreateGlobalState(ctx, addr, ts, block);
  const gs = { ...gs0, liquidationPaused: event.params.isPaused, updatedAt: BigInt(ts) };
  ctx.MonoCoolerGlobalState.set(gs);
  createGlobalSnapshot(ctx, gs, ts, ltv, `${low(tx)}-${li}-global`);
});

indexer.onEvent({ contract: "MonoCooler", event: "BorrowPausedSet" }, async ({ event, context }) => {
  const ctx = context as unknown as MonoCtx;
  const { addr, block, ts, tx, li } = evCommon(event);
  const ltv = await getLtvValues(ctx, addr, block);
  const gs0 = await getOrCreateGlobalState(ctx, addr, ts, block);
  const gs = { ...gs0, borrowsPaused: event.params.isPaused, updatedAt: BigInt(ts) };
  ctx.MonoCoolerGlobalState.set(gs);
  createGlobalSnapshot(ctx, gs, ts, ltv, `${low(tx)}-${li}-global`);
});

indexer.onEvent({ contract: "MonoCooler", event: "TreasuryBorrowerSet" }, async ({ event, context }) => {
  const ctx = context as unknown as MonoCtx;
  const { addr, block, ts, tx, li } = evCommon(event);
  const ltv = await getLtvValues(ctx, addr, block);
  const gs0 = await getOrCreateGlobalState(ctx, addr, ts, block);
  const gs = { ...gs0, treasuryBorrower: low(event.params.treasuryBorrower), updatedAt: BigInt(ts) };
  ctx.MonoCoolerGlobalState.set(gs);
  createGlobalSnapshot(ctx, gs, ts, ltv, `${low(tx)}-${li}-global`);
});
