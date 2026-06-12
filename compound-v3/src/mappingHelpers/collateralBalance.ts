/**
 * Port of src/mappingHelpers/collateralBalance.ts.
 */
import type { CollateralToken, MarketCollateralBalance, Position, PositionCollateralBalance } from "envio";
import type { Ctx, Ev, Mutable } from "../common/types";
import { ZERO_BD, ZERO_BI } from "../common/constants";
import { bigIntBytes, hexConcat, utf8Hex } from "../common/graphBytes";
import { computeTokenValueUsd } from "../common/utils";
import { cometGetCollateralReserves, cometTotalsCollateral, cometUserCollateralBalance } from "../effects/contracts";
import { getCollateralTokenPriceUsd, getOrCreateToken } from "./token";

////
// Market Collateral Balance
////

export async function getOrCreateMarketCollateralBalance(
  ctx: Ctx,
  collateralToken: CollateralToken,
  event: Ev,
): Promise<Mutable<MarketCollateralBalance>> {
  const id = hexConcat(collateralToken.id, utf8Hex("BAL"));
  let collateralBalance = await ctx.MarketCollateralBalance.get(id);

  if (!collateralBalance) {
    const created: Mutable<MarketCollateralBalance> = {
      id,
      creationBlockNumber: BigInt(event.block.number),
      collateralToken_id: collateralToken.id,
      market_id: collateralToken.market_id,
      lastUpdateBlockNumber: ZERO_BI,
      balance: ZERO_BI,
      reserves: ZERO_BI,
      balanceUsd: ZERO_BD,
      reservesUsd: ZERO_BD,
    };

    await updateMarketCollateralBalance(ctx, created, event);
    await updateMarketCollateralBalanceUsd(ctx, created, event);

    ctx.MarketCollateralBalance.set({ ...created });
    return created;
  }

  return { ...collateralBalance };
}

export async function updateMarketCollateralBalance(
  ctx: Ctx,
  collateralBalance: Mutable<MarketCollateralBalance>,
  event: Ev,
): Promise<void> {
  const collateralToken = await ctx.CollateralToken.getOrThrow(collateralBalance.collateralToken_id); // Guaranteed to exist
  const collateralTokenToken = await getOrCreateToken(ctx, collateralToken.token_id, event);

  // Non-try call in the original; fall back to 0 on revert.
  const totalSupplyAsset = await cometTotalsCollateral(
    ctx.effect,
    collateralBalance.market_id,
    collateralToken.token_id,
    event.block.number,
  );
  if (totalSupplyAsset === null) {
    ctx.log.error(`comet.totalsCollateral(${collateralToken.token_id}) reverted for ${collateralBalance.market_id} (original would abort)`);
  }

  collateralBalance.lastUpdateBlockNumber = BigInt(event.block.number);
  collateralBalance.balance = totalSupplyAsset ?? ZERO_BI;

  const tryGetReserves = await cometGetCollateralReserves(
    ctx.effect,
    collateralBalance.market_id,
    collateralTokenToken.address,
    event.block.number,
  );
  collateralBalance.reserves = tryGetReserves === null ? ZERO_BI : tryGetReserves;
}

export function createMarketCollateralBalanceSnapshot(
  ctx: Ctx,
  collateralBalance: MarketCollateralBalance,
  event: Ev,
): MarketCollateralBalance {
  const snapshotId = hexConcat(
    collateralBalance.id,
    bigIntBytes(BigInt(event.block.number)),
    bigIntBytes(BigInt(event.logIndex)),
  );

  const copiedConfig: MarketCollateralBalance = { ...collateralBalance, id: snapshotId };

  ctx.MarketCollateralBalance.set(copiedConfig);

  return copiedConfig;
}

/** Update just the USD value of balance based on newest price and existing balance */
export async function updateMarketCollateralBalanceUsd(
  ctx: Ctx,
  collateralBalance: Mutable<MarketCollateralBalance>,
  event: Ev,
): Promise<void> {
  const collateralToken = await ctx.CollateralToken.getOrThrow(collateralBalance.collateralToken_id);
  const collateralTokenToken = await getOrCreateToken(ctx, collateralToken.token_id, event);
  const price = await getCollateralTokenPriceUsd(ctx, { ...collateralToken }, event);

  collateralBalance.lastUpdateBlockNumber = BigInt(event.block.number);
  collateralBalance.balanceUsd = computeTokenValueUsd(
    collateralBalance.balance,
    collateralTokenToken.decimals ?? 0,
    price,
  );
  collateralBalance.reservesUsd = computeTokenValueUsd(
    collateralBalance.reserves,
    collateralTokenToken.decimals ?? 0,
    price,
  );
}

////
// Position Collateral Balance
////

export async function getOrCreatePositionCollateralBalance(
  ctx: Ctx,
  collateralToken: CollateralToken,
  position: Position,
  event: Ev,
): Promise<Mutable<PositionCollateralBalance>> {
  const id = hexConcat(position.id, collateralToken.id);
  let collateralBalance = await ctx.PositionCollateralBalance.get(id);

  if (!collateralBalance) {
    const created: Mutable<PositionCollateralBalance> = {
      id,
      creationBlockNumber: BigInt(event.block.number),
      collateralToken_id: collateralToken.id,
      position_id: position.id,
      lastUpdateBlockNumber: ZERO_BI,
      balance: ZERO_BI,
      balanceUsd: ZERO_BD,
    };

    await updatePositionCollateralBalance(ctx, position, created, event);
    await updatePositionCollateralBalanceUsd(ctx, created, event);

    ctx.PositionCollateralBalance.set({ ...created });
    return created;
  }

  return { ...collateralBalance };
}

export async function updatePositionCollateralBalance(
  ctx: Ctx,
  position: Position,
  collateralBalance: Mutable<PositionCollateralBalance>,
  event: Ev,
): Promise<void> {
  const collateralToken = await ctx.CollateralToken.getOrThrow(collateralBalance.collateralToken_id); // Guaranteed to exist

  // Non-try call in the original; fall back to 0 on revert.
  const balance = await cometUserCollateralBalance(
    ctx.effect,
    position.market_id,
    position.account_id,
    collateralToken.token_id,
    event.block.number,
  );
  if (balance === null) {
    ctx.log.error(`comet.userCollateral(${position.account_id}, ${collateralToken.token_id}) reverted for ${position.market_id} (original would abort)`);
  }

  collateralBalance.lastUpdateBlockNumber = BigInt(event.block.number);
  collateralBalance.balance = balance ?? ZERO_BI;
}

export function createPositionCollateralBalanceSnapshot(
  ctx: Ctx,
  collateralBalance: PositionCollateralBalance,
  event: Ev,
): PositionCollateralBalance {
  const snapshotId = hexConcat(
    collateralBalance.id,
    bigIntBytes(BigInt(event.block.number)),
    bigIntBytes(BigInt(event.logIndex)),
  );

  const copiedConfig: PositionCollateralBalance = { ...collateralBalance, id: snapshotId };

  ctx.PositionCollateralBalance.set(copiedConfig);

  return copiedConfig;
}

export async function updatePositionCollateralBalanceUsd(
  ctx: Ctx,
  collateralBalance: Mutable<PositionCollateralBalance>,
  event: Ev,
): Promise<void> {
  const collateralToken = await ctx.CollateralToken.getOrThrow(collateralBalance.collateralToken_id);
  const collateralTokenToken = await getOrCreateToken(ctx, collateralToken.token_id, event);
  const price = await getCollateralTokenPriceUsd(ctx, { ...collateralToken }, event);

  collateralBalance.lastUpdateBlockNumber = BigInt(event.block.number);
  collateralBalance.balanceUsd = computeTokenValueUsd(
    collateralBalance.balance,
    collateralTokenToken.decimals ?? 0,
    price,
  );
}
