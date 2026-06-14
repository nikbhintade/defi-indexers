/**
 * Port of src/mapping/lending-pool-configurator/v3.ts.
 */
import { indexer } from "envio";
import type { EModeCategory, Reserve } from "envio";
import { ZERO_ADDRESS, ZERO_BI, low } from "../common/constants";
import type { Ctx, Ev } from "../common/types";
import {
  createMapContractToPool,
  getOrInitReserve,
  getOrInitSubToken,
  getPoolByContract,
} from "../mappingHelpers/initializers";
import { ratesStrategy, tryName, tryNameBytes, trySymbol, trySymbolBytes, tryDecimals } from "../effects/contracts";

/** saveReserve: persist reserve + append ReserveConfigurationHistoryItem. */
function saveReserve(context: Ctx, reserve: Reserve, event: Ev): void {
  const timestamp = event.block.timestamp;
  const updated: Reserve = { ...reserve, lastUpdateTimestamp: timestamp };
  context.Reserve.set(updated);

  // subgraph keyed config-history by tx hash (overwrites within a tx)
  context.ReserveConfigurationHistoryItem.set({
    id: event.transaction.hash.toLowerCase(),
    reserve_id: updated.id,
    usageAsCollateralEnabled: updated.usageAsCollateralEnabled,
    borrowingEnabled: updated.borrowingEnabled,
    stableBorrowRateEnabled: updated.stableBorrowRateEnabled,
    isActive: updated.isActive,
    isFrozen: updated.isFrozen,
    reserveInterestRateStrategy: updated.reserveInterestRateStrategy,
    baseLTVasCollateral: updated.baseLTVasCollateral,
    reserveLiquidationThreshold: updated.reserveLiquidationThreshold,
    reserveLiquidationBonus: updated.reserveLiquidationBonus,
    timestamp,
  });
}

/** updateInterestRateStrategy: V1 (no-arg) reads with V2 (per-asset) fallback. */
async function updateInterestRateStrategy(
  context: Ctx,
  reserve: Reserve,
  strategy: string,
  init: boolean,
): Promise<Reserve> {
  const s = low(strategy);
  const asset = reserve.underlyingAsset;
  const call = context.effect;
  let r: Reserve = { ...reserve, reserveInterestRateStrategy: s };

  let baseVar = await ratesStrategy.baseVariableBorrowRate(call, s);
  if (baseVar === null) {
    baseVar = await ratesStrategy.baseVariableBorrowRateV2(call, s, asset);
  }
  if (baseVar !== null) r = { ...r, baseVariableBorrowRate: baseVar };

  if (init) r = { ...r, variableBorrowRate: r.baseVariableBorrowRate };

  let optimal = await ratesStrategy.optimalUsageRatio(call, s);
  if (optimal === null) optimal = await ratesStrategy.optimalUsageRatioV2(call, s, asset);
  if (optimal !== null) r = { ...r, optimalUtilisationRate: optimal };

  let vs1 = await ratesStrategy.variableRateSlope1(call, s);
  if (vs1 === null) vs1 = await ratesStrategy.variableRateSlope1V2(call, s, asset);
  if (vs1 !== null) r = { ...r, variableRateSlope1: vs1 };

  let vs2 = await ratesStrategy.variableRateSlope2(call, s);
  if (vs2 === null) vs2 = await ratesStrategy.variableRateSlope2V2(call, s, asset);
  if (vs2 !== null) r = { ...r, variableRateSlope2: vs2 };

  const ss1 = await ratesStrategy.stableRateSlope1(call, s);
  r = { ...r, stableRateSlope1: ss1 ?? ZERO_BI };

  const ss2 = await ratesStrategy.stableRateSlope2(call, s);
  r = { ...r, stableRateSlope2: ss2 ?? ZERO_BI };

  return r;
}

// ---- simple reserve config flag handlers ----

indexer.onEvent(
  { contract: "PoolConfigurator", event: "ReserveInterestRateStrategyChanged" },
  async ({ event, context }) => {
    let reserve = await getOrInitReserve(context, event.params.asset, event.srcAddress);
    if (reserve.aToken_id === ZERO_ADDRESS) return;
    reserve = await updateInterestRateStrategy(context, reserve, event.params.newStrategy, false);
    saveReserve(context, reserve, event);
  },
);

indexer.onEvent(
  { contract: "PoolConfigurator", event: "ReserveBorrowing" },
  async ({ event, context }) => {
    const reserve = await getOrInitReserve(context, event.params.asset, event.srcAddress);
    saveReserve(context, { ...reserve, borrowingEnabled: event.params.enabled }, event);
  },
);

indexer.onEvent(
  { contract: "PoolConfigurator", event: "SiloedBorrowingChanged" },
  async ({ event, context }) => {
    const reserve = await getOrInitReserve(context, event.params.asset, event.srcAddress);
    saveReserve(context, { ...reserve, siloedBorrowing: event.params.newState }, event);
  },
);

indexer.onEvent(
  { contract: "PoolConfigurator", event: "ReserveStableRateBorrowing" },
  async ({ event, context }) => {
    const reserve = await getOrInitReserve(context, event.params.asset, event.srcAddress);
    saveReserve(context, { ...reserve, stableBorrowRateEnabled: event.params.enabled }, event);
  },
);

indexer.onEvent(
  { contract: "PoolConfigurator", event: "ReserveActive" },
  async ({ event, context }) => {
    const reserve = await getOrInitReserve(context, event.params.asset, event.srcAddress);
    saveReserve(context, { ...reserve, isActive: event.params.active }, event);
  },
);

indexer.onEvent(
  { contract: "PoolConfigurator", event: "ReserveFrozen" },
  async ({ event, context }) => {
    const reserve = await getOrInitReserve(context, event.params.asset, event.srcAddress);
    saveReserve(context, { ...reserve, isFrozen: event.params.frozen }, event);
  },
);

indexer.onEvent(
  { contract: "PoolConfigurator", event: "CollateralConfigurationChanged" },
  async ({ event, context }) => {
    const reserve = await getOrInitReserve(context, event.params.asset, event.srcAddress);
    const usageAsCollateralEnabled = event.params.liquidationThreshold > ZERO_BI;
    saveReserve(
      context,
      {
        ...reserve,
        usageAsCollateralEnabled,
        baseLTVasCollateral: event.params.ltv,
        reserveLiquidationThreshold: event.params.liquidationThreshold,
        reserveLiquidationBonus: event.params.liquidationBonus,
      },
      event,
    );
  },
);

indexer.onEvent(
  { contract: "PoolConfigurator", event: "ReserveFactorChanged" },
  async ({ event, context }) => {
    const reserve = await getOrInitReserve(context, event.params.asset, event.srcAddress);
    saveReserve(context, { ...reserve, reserveFactor: event.params.newReserveFactor }, event);
  },
);

// ---- token-impl upgrades ----
async function setSubTokenImpl(context: Ctx, proxy: string, implementation: string): Promise<void> {
  const token = await getOrInitSubToken(context, proxy);
  context.SubToken.set({ ...token, tokenContractImpl: low(implementation) });
}
indexer.onEvent(
  { contract: "PoolConfigurator", event: "ATokenUpgraded" },
  async ({ event, context }) => setSubTokenImpl(context, event.params.proxy, event.params.implementation),
);
indexer.onEvent(
  { contract: "PoolConfigurator", event: "StableDebtTokenUpgraded" },
  async ({ event, context }) => setSubTokenImpl(context, event.params.proxy, event.params.implementation),
);
indexer.onEvent(
  { contract: "PoolConfigurator", event: "VariableDebtTokenUpgraded" },
  async ({ event, context }) => setSubTokenImpl(context, event.params.proxy, event.params.implementation),
);

// ---- caps / fees / pause / drop (no config-history) ----
indexer.onEvent(
  { contract: "PoolConfigurator", event: "ReservePaused" },
  async ({ event, context }) => {
    const reserve = await getOrInitReserve(context, event.params.asset, event.srcAddress);
    context.Reserve.set({ ...reserve, isPaused: event.params.paused });
  },
);
indexer.onEvent(
  { contract: "PoolConfigurator", event: "ReserveDropped" },
  async ({ event, context }) => {
    const reserve = await getOrInitReserve(context, event.params.asset, event.srcAddress);
    context.Reserve.set({ ...reserve, isDropped: true });
  },
);
indexer.onEvent(
  { contract: "PoolConfigurator", event: "BorrowCapChanged" },
  async ({ event, context }) => {
    const reserve = await getOrInitReserve(context, event.params.asset, event.srcAddress);
    context.Reserve.set({ ...reserve, borrowCap: event.params.newBorrowCap });
  },
);
indexer.onEvent(
  { contract: "PoolConfigurator", event: "SupplyCapChanged" },
  async ({ event, context }) => {
    const reserve = await getOrInitReserve(context, event.params.asset, event.srcAddress);
    context.Reserve.set({ ...reserve, supplyCap: event.params.newSupplyCap });
  },
);
indexer.onEvent(
  { contract: "PoolConfigurator", event: "LiquidationProtocolFeeChanged" },
  async ({ event, context }) => {
    const reserve = await getOrInitReserve(context, event.params.asset, event.srcAddress);
    context.Reserve.set({ ...reserve, liquidationProtocolFee: event.params.newFee });
  },
);
indexer.onEvent(
  { contract: "PoolConfigurator", event: "UnbackedMintCapChanged" },
  async ({ event, context }) => {
    // subgraph re-saves without updating any field; preserve that quirk
    const reserve = await getOrInitReserve(context, event.params.asset, event.srcAddress);
    context.Reserve.set({ ...reserve });
  },
);
indexer.onEvent(
  { contract: "PoolConfigurator", event: "DebtCeilingChanged" },
  async ({ event, context }) => {
    const reserve = await getOrInitReserve(context, event.params.asset, event.srcAddress);
    context.Reserve.set({ ...reserve, debtCeiling: event.params.newDebtCeiling });
  },
);
indexer.onEvent(
  { contract: "PoolConfigurator", event: "BorrowableInIsolationChanged" },
  async ({ event, context }) => {
    const reserve = await getOrInitReserve(context, event.params.asset, event.srcAddress);
    context.Reserve.set({ ...reserve, borrowableInIsolation: event.params.borrowable });
  },
);

// ---- eMode ----
indexer.onEvent(
  { contract: "PoolConfigurator", event: "EModeAssetCategoryChanged" },
  async ({ event, context }) => {
    const reserve = await getOrInitReserve(context, event.params.asset, event.srcAddress);
    context.Reserve.set({ ...reserve, eMode_id: event.params.newCategoryId.toString() });
  },
);
indexer.onEvent(
  { contract: "PoolConfigurator", event: "EModeCategoryAdded" },
  async ({ event, context }) => {
    const id = event.params.categoryId.toString();
    const existing = await context.EModeCategory.get(id);
    const cat: EModeCategory = {
      id,
      ltv: event.params.ltv,
      oracle: low(event.params.oracle),
      liquidationBonus: event.params.liquidationBonus,
      liquidationThreshold: event.params.liquidationThreshold,
      label: event.params.label,
    };
    void existing;
    context.EModeCategory.set(cat);
  },
);

async function getOrInitEModeCategory(context: Ctx, id: string): Promise<EModeCategory> {
  let cat = await context.EModeCategory.get(id);
  if (!cat) {
    cat = {
      id,
      ltv: ZERO_BI,
      oracle: ZERO_ADDRESS,
      liquidationBonus: ZERO_BI,
      liquidationThreshold: ZERO_BI,
      label: "PLACEHOLDER",
    };
    context.EModeCategory.set(cat);
  }
  return cat;
}

indexer.onEvent(
  { contract: "PoolConfigurator", event: "AssetCollateralInEModeChanged" },
  async ({ event, context }) => {
    const categoryId = (await getOrInitEModeCategory(context, event.params.categoryId.toString())).id;
    const configId = low(event.params.asset) + categoryId;
    const existing = await context.EModeCategoryConfig.get(configId);
    context.EModeCategoryConfig.set({
      id: configId,
      category_id: categoryId,
      asset: low(event.params.asset),
      collateral: event.params.collateral,
      borrowable: existing?.borrowable ?? false,
    });
  },
);
indexer.onEvent(
  { contract: "PoolConfigurator", event: "AssetBorrowableInEModeChanged" },
  async ({ event, context }) => {
    const categoryId = (await getOrInitEModeCategory(context, event.params.categoryId.toString())).id;
    const configId = low(event.params.asset) + categoryId;
    const existing = await context.EModeCategoryConfig.get(configId);
    context.EModeCategoryConfig.set({
      id: configId,
      category_id: categoryId,
      asset: low(event.params.asset),
      collateral: existing?.collateral ?? false,
      borrowable: event.params.borrowable,
    });
  },
);

// ---- pool-level fees ----
async function setPoolField(
  context: Ctx,
  srcAddress: string,
  patch: (poolId: string) => Promise<void>,
): Promise<void> {
  const poolId = await getPoolByContract(context, srcAddress);
  await patch(poolId);
}
indexer.onEvent(
  { contract: "PoolConfigurator", event: "BridgeProtocolFeeUpdated" },
  async ({ event, context }) => {
    await setPoolField(context, event.srcAddress, async (poolId) => {
      const pool = await context.Pool.get(poolId);
      if (pool) context.Pool.set({ ...pool, bridgeProtocolFee: event.params.newBridgeProtocolFee });
    });
  },
);
indexer.onEvent(
  { contract: "PoolConfigurator", event: "FlashloanPremiumTotalUpdated" },
  async ({ event, context }) => {
    await setPoolField(context, event.srcAddress, async (poolId) => {
      const pool = await context.Pool.get(poolId);
      if (pool)
        context.Pool.set({ ...pool, flashloanPremiumTotal: event.params.newFlashloanPremiumTotal });
    });
  },
);
indexer.onEvent(
  { contract: "PoolConfigurator", event: "FlashloanPremiumToProtocolUpdated" },
  async ({ event, context }) => {
    await setPoolField(context, event.srcAddress, async (poolId) => {
      const pool = await context.Pool.get(poolId);
      if (pool)
        context.Pool.set({
          ...pool,
          flashloanPremiumToProtocol: event.params.newFlashloanPremiumToProtocol,
        });
    });
  },
);

// ---- ReserveInitialized: register token templates + token metadata ----
indexer.contractRegister(
  { contract: "PoolConfigurator", event: "ReserveInitialized" },
  async ({ event, context }) => {
    context.chain.AToken.add(event.params.aToken);
    if (low(event.params.stableDebtToken) !== ZERO_ADDRESS) {
      context.chain.StableDebtToken.add(event.params.stableDebtToken);
    }
    context.chain.VariableDebtToken.add(event.params.variableDebtToken);
  },
);

indexer.onEvent(
  { contract: "PoolConfigurator", event: "ReserveInitialized" },
  async ({ event, context }) => {
    const underlying = event.params.asset;
    let reserve = await getOrInitReserve(context, underlying, event.srcAddress);
    const call = context.effect;

    // name (string with bytes32 fallback)
    let name = await tryName(call, underlying);
    if (name === null) {
      const nb = await tryNameBytes(call, underlying);
      name = nb === null ? "" : decodeBytes32ToString(nb);
    }
    // symbol
    let symbol = await trySymbol(call, underlying);
    if (symbol === null) {
      const sb = await trySymbolBytes(call, underlying);
      symbol = sb === null ? "" : decodeBytes32ToString(sb);
    }
    const decimals = (await tryDecimals(call, underlying)) ?? 0;
    reserve = { ...reserve, name, symbol, decimals };

    reserve = await updateInterestRateStrategy(
      context,
      reserve,
      event.params.interestRateStrategyAddress,
      true,
    );

    // aToken
    await createMapContractToPool(context, event.params.aToken, reserve.pool_id);
    const aToken = await getOrInitSubToken(context, event.params.aToken);
    context.SubToken.set({
      ...aToken,
      underlyingAssetAddress: reserve.underlyingAsset,
      underlyingAssetDecimals: reserve.decimals,
      pool_id: reserve.pool_id,
    });
    reserve = { ...reserve, aToken_id: aToken.id };

    // sToken (zero address in v3.2+)
    if (low(event.params.stableDebtToken) !== ZERO_ADDRESS) {
      await createMapContractToPool(context, event.params.stableDebtToken, reserve.pool_id);
      const sToken = await getOrInitSubToken(context, event.params.stableDebtToken);
      context.SubToken.set({
        ...sToken,
        underlyingAssetAddress: reserve.underlyingAsset,
        underlyingAssetDecimals: reserve.decimals,
        pool_id: reserve.pool_id,
      });
      reserve = { ...reserve, sToken_id: sToken.id };
    }

    // vToken
    await createMapContractToPool(context, event.params.variableDebtToken, reserve.pool_id);
    const vToken = await getOrInitSubToken(context, event.params.variableDebtToken);
    context.SubToken.set({
      ...vToken,
      underlyingAssetAddress: reserve.underlyingAsset,
      underlyingAssetDecimals: reserve.decimals,
      pool_id: reserve.pool_id,
    });
    reserve = { ...reserve, vToken_id: vToken.id, isActive: true };

    saveReserve(context, reserve, event);
  },
);

/** bytes32 (0x + 64 hex) -> utf8 string, trimming trailing zero bytes. */
function decodeBytes32ToString(b: string): string {
  const hex = b.startsWith("0x") ? b.slice(2) : b;
  let out = "";
  for (let i = 0; i + 1 < hex.length; i += 2) {
    const code = parseInt(hex.slice(i, i + 2), 16);
    if (code !== 0) out += String.fromCharCode(code);
  }
  return out;
}
