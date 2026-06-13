/**
 * Price-update helpers ported from src/helpers/v3/price-updates.ts.
 */
import type { PriceOracle, PriceOracleAsset } from "envio";
import type { Ctx, Ev } from "../common/types";
import { getOrInitPriceOracle, getPriceOracleAsset } from "./initializers";
import { tryGetAssetPrice } from "../effects/contracts";

export function savePriceToHistory(
  context: Ctx,
  oracleAsset: PriceOracleAsset,
  event: Ev,
): void {
  const id =
    oracleAsset.id + event.block.number.toString() + event.transaction.transactionIndex.toString();
  context.PriceHistoryItem.set({
    id,
    asset_id: oracleAsset.id,
    price: oracleAsset.priceInEth,
    timestamp: oracleAsset.lastUpdateTimestamp,
  });
}

export async function updateDependentAssets(
  context: Ctx,
  dependentAssets: readonly string[],
  event: Ev,
): Promise<void> {
  const proxyPriceProviderAddress = (await getOrInitPriceOracle(context)).proxyPriceProvider;
  for (let i = 0; i < dependentAssets.length; i += 1) {
    const dependentAsset = dependentAssets[i]!;
    let dependentOracleAsset = await getPriceOracleAsset(context, dependentAsset);
    const assetPrice = await tryGetAssetPrice(
      context.effect,
      proxyPriceProviderAddress,
      dependentOracleAsset.id,
      event.block.number,
    );
    if (assetPrice !== null) {
      dependentOracleAsset = { ...dependentOracleAsset, priceInEth: assetPrice };
    } else {
      context.log.error(`DependentAsset price read failed: ${dependentOracleAsset.id}`);
    }
    context.PriceOracleAsset.set(dependentOracleAsset);
    savePriceToHistory(context, dependentOracleAsset, event);
  }
}

export async function usdEthPriceUpdate(
  context: Ctx,
  priceOracle: PriceOracle,
  price: bigint,
  event: Ev,
): Promise<PriceOracle> {
  const updated: PriceOracle = {
    ...priceOracle,
    usdPriceEth: price,
    lastUpdateTimestamp: event.block.timestamp,
  };
  context.PriceOracle.set(updated);

  context.UsdEthPriceHistoryItem.set({
    id: event.block.number.toString() + event.transaction.transactionIndex.toString(),
    oracle_id: updated.id,
    price: updated.usdPriceEth,
    timestamp: updated.lastUpdateTimestamp,
  });

  await updateDependentAssets(context, updated.usdDependentAssets, event);
  return updated;
}

export async function genericPriceUpdate(
  context: Ctx,
  oracleAsset: PriceOracleAsset,
  price: bigint,
  event: Ev,
): Promise<PriceOracleAsset> {
  const updated: PriceOracleAsset = {
    ...oracleAsset,
    priceInEth: price,
    lastUpdateTimestamp: event.block.timestamp,
  };
  context.PriceOracleAsset.set(updated);
  savePriceToHistory(context, updated, event);
  await updateDependentAssets(context, updated.dependentAssets, event);
  return updated;
}
