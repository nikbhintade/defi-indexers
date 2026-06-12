/**
 * Port of src/mappingHelpers/position.ts.
 */
import type { Account, Market, Position, PositionAccounting } from "envio";
import type { Ctx, Ev, Mutable } from "../common/types";
import { ZERO_BD, ZERO_BI } from "../common/constants";
import { bigIntBytes, hexConcat } from "../common/graphBytes";
import { computeTokenValueUsd, presentValue } from "../common/utils";
import { cometUserBasic } from "../effects/contracts";
import { getOrCreateMarket, getOrCreateMarketAccounting, getOrCreateMarketConfiguration } from "./market";
import { getBaseTokenPriceUsd, getOrCreateToken } from "./token";
import {
  createPositionCollateralBalanceSnapshot,
  getOrCreatePositionCollateralBalance,
  updatePositionCollateralBalanceUsd,
} from "./collateralBalance";

////
// Position Accounting
////

export async function getOrCreatePositionAccounting(
  ctx: Ctx,
  position: Position,
  event: Ev,
): Promise<Mutable<PositionAccounting>> {
  const id = position.id;

  const positionAccounting = await ctx.PositionAccounting.get(id);

  if (!positionAccounting) {
    const created: Mutable<PositionAccounting> = {
      id,
      position_id: position.id,

      // Set here to solve init issue, since we optimize to not update when block number didn't change
      lastUpdatedBlockNumber: ZERO_BI,

      basePrincipal: ZERO_BI,
      baseBalance: ZERO_BI,
      baseTrackingIndex: ZERO_BI,
      baseTrackingAccrued: ZERO_BI,
      baseBalanceUsd: ZERO_BD,
      collateralBalanceUsd: ZERO_BD,
      collateralBalances: [],

      // Set cumulatives
      cumulativeBaseSupplied: ZERO_BI,
      cumulativeBaseWithdrawn: ZERO_BI,
      cumulativeBaseDebtAbsorbed: ZERO_BI,

      cumulativeBaseSuppliedUsd: ZERO_BD,
      cumulativeBaseWithdrawnUsd: ZERO_BD,
      cumulativeCollateralLiquidatedUsd: ZERO_BD,

      cumulativeRewardsClaimed: ZERO_BI,
      cumulativeRewardsClaimedUsd: ZERO_BD,

      cumulativeGasUsedWei: ZERO_BI,
      cumulativeGasUsedUsd: ZERO_BD,
    };

    await updatePositionAccounting(ctx, position, created, event);
    ctx.PositionAccounting.set({ ...created });
    return created;
  }

  return { ...positionAccounting, collateralBalances: [...positionAccounting.collateralBalances] };
}

export async function updatePositionAccounting(
  ctx: Ctx,
  position: Position,
  accounting: Mutable<PositionAccounting>,
  event: Ev,
): Promise<void> {
  if (accounting.lastUpdatedBlockNumber === BigInt(event.block.number)) {
    // Don't bother to update if we already did this block, assume this gets set on init
    return;
  }

  const market = await getOrCreateMarket(ctx, position.market_id, event);
  const marketAccounting = await getOrCreateMarketAccounting(ctx, market, event);
  const marketConfiguration = await getOrCreateMarketConfiguration(ctx, market, event);

  // Non-try call in the original; fall back to zeros on revert.
  const userBasic = await cometUserBasic(ctx.effect, market.id, position.account_id, event.block.number);
  if (userBasic === null) {
    ctx.log.error(`comet.userBasic(${position.account_id}) reverted for ${market.id} (original would abort)`);
  }

  accounting.lastUpdatedBlockNumber = BigInt(event.block.number);
  accounting.basePrincipal = userBasic ? userBasic.principal : ZERO_BI;
  accounting.baseBalance = presentValue(
    accounting.basePrincipal,
    accounting.basePrincipal < ZERO_BI ? marketAccounting.baseBorrowIndex : marketAccounting.baseSupplyIndex,
  );
  accounting.baseTrackingIndex = userBasic ? userBasic.baseTrackingIndex : ZERO_BI;
  accounting.baseTrackingAccrued = userBasic ? userBasic.baseTrackingAccrued : ZERO_BI;

  // Base Token Balance USD
  const baseToken = { ...(await ctx.BaseToken.getOrThrow(marketConfiguration.baseToken_id)) };
  const baseTokenToken = await getOrCreateToken(ctx, baseToken.token_id, event);
  const baseTokenPriceUsd = await getBaseTokenPriceUsd(ctx, baseToken, event);
  accounting.baseBalanceUsd = computeTokenValueUsd(
    accounting.baseBalance,
    baseTokenToken.decimals ?? 0,
    baseTokenPriceUsd,
  );

  // Collateral Balance USD
  const collateralTokenIds = marketConfiguration.collateralTokens;
  let totalCollateralBalanceUsd = ZERO_BD;
  const collateralBalances: string[] = [];
  for (let i = 0; i < collateralTokenIds.length; i++) {
    const collateralToken = await ctx.CollateralToken.getOrThrow(collateralTokenIds[i]!); // Guaranteed to exist
    const collateralBalance = await getOrCreatePositionCollateralBalance(ctx, collateralToken, position, event);

    await updatePositionCollateralBalanceUsd(ctx, collateralBalance, event);
    ctx.PositionCollateralBalance.set({ ...collateralBalance });

    collateralBalances.push(collateralBalance.id);

    totalCollateralBalanceUsd = totalCollateralBalanceUsd.plus(collateralBalance.balanceUsd);
  }
  accounting.collateralBalanceUsd = totalCollateralBalanceUsd;
  accounting.collateralBalances = collateralBalances;

  // Create snapshot on change
  await createPositionAccountingSnapshot(ctx, accounting, event);
}

export async function createPositionAccountingSnapshot(
  ctx: Ctx,
  accounting: PositionAccounting,
  event: Ev,
): Promise<void> {
  const snapshotId = hexConcat(
    accounting.position_id,
    bigIntBytes(BigInt(event.block.number)),
    bigIntBytes(BigInt(event.logIndex)),
  );

  // Copy collateral balances (needs special handling since we need to deep copy)
  const collateralBalancesSnapshot: string[] = [];
  for (let i = 0; i < accounting.collateralBalances.length; i++) {
    const collateralBalance = await ctx.PositionCollateralBalance.getOrThrow(accounting.collateralBalances[i]!); // Guaranteed to exist
    const collateralBalanceSnapshot = createPositionCollateralBalanceSnapshot(ctx, collateralBalance, event);
    collateralBalancesSnapshot.push(collateralBalanceSnapshot.id);
  }

  // If we already took it, but have manually retriggered, update it (a plain
  // set overwrites all fields, matching the original's copy-entries flow)
  const accountingSnapshot: PositionAccounting = {
    ...accounting,
    id: snapshotId,
    collateralBalances: collateralBalancesSnapshot,
  };
  ctx.PositionAccounting.set(accountingSnapshot);

  // Create snapshot, or we already took it, but have manually retriggered, update it
  ctx.PositionAccountingSnapshot.set({
    id: snapshotId,
    timestamp: BigInt(event.block.timestamp),
    position_id: accountingSnapshot.position_id,
    accounting_id: accountingSnapshot.id,
  });
}

////
// Position
////

export async function getOrCreatePosition(ctx: Ctx, market: Market, account: Account, event: Ev): Promise<Position> {
  const id = hexConcat(market.id, account.id);
  let position = await ctx.Position.get(id);

  if (!position) {
    const created: Mutable<Position> = {
      id,
      creationBlockNumber: BigInt(event.block.number),
      market_id: market.id,
      account_id: account.id,
      accounting_id: "",
    };

    const accounting = await getOrCreatePositionAccounting(ctx, created, event);
    created.accounting_id = accounting.id;

    ctx.Position.set({ ...created });
    return created;
  }

  return position;
}
