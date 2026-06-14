/**
 * Port of src/mapping/lending-pool-configurator/{lending-pool-configurator,gnosis}.ts.
 */
import { indexer } from "envio";
import type { Reserve } from "envio";
import { ZERO_ADDRESS, ZERO_BI, low } from "../common/constants";
import type { Ctx, Ev } from "../common/types";
import {
  createMapContractToPool,
  getOrInitAToken,
  getOrInitReserve,
  getOrInitSToken,
  getOrInitVToken,
  initReserveConfigurationHistoryItem,
} from "../mappingHelpers/initializers";
import {
  ratesStrategy,
  tryDecimals,
  tryName,
  tryNameBytes,
  trySymbol,
} from "../effects/contracts";

/** saveReserve: persist reserve + (over)write ReserveConfigurationHistoryItem keyed by tx hash. */
function saveReserve(context: Ctx, reserve: Reserve, event: Ev): void {
  const timestamp = event.block.timestamp;
  const updated: Reserve = { ...reserve, lastUpdateTimestamp: timestamp };
  context.Reserve.set(updated);

  const item = initReserveConfigurationHistoryItem(
    event.transaction.hash.toLowerCase(),
    updated.id,
  );
  context.ReserveConfigurationHistoryItem.set({
    ...item,
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

/** updateInterestRateStrategy: reads V2 DefaultReserveInterestRateStrategy fields. */
async function updateInterestRateStrategy(
  context: Ctx,
  reserve: Reserve,
  strategy: string,
  init: boolean,
): Promise<Reserve> {
  const s = low(strategy);
  const call = context.effect;
  let r: Reserve = { ...reserve, reserveInterestRateStrategy: s };

  const baseVar = await ratesStrategy.baseVariableBorrowRate(call, s);
  r = { ...r, baseVariableBorrowRate: baseVar ?? ZERO_BI };
  if (init) r = { ...r, variableBorrowRate: r.baseVariableBorrowRate };

  const optimal = await ratesStrategy.optimalUtilizationRate(call, s);
  r = { ...r, optimalUtilisationRate: optimal ?? ZERO_BI };

  const vs1 = await ratesStrategy.variableRateSlope1(call, s);
  r = { ...r, variableRateSlope1: vs1 ?? ZERO_BI };

  const vs2 = await ratesStrategy.variableRateSlope2(call, s);
  r = { ...r, variableRateSlope2: vs2 ?? ZERO_BI };

  const ss1 = await ratesStrategy.stableRateSlope1(call, s);
  r = { ...r, stableRateSlope1: ss1 ?? ZERO_BI };

  const ss2 = await ratesStrategy.stableRateSlope2(call, s);
  r = { ...r, stableRateSlope2: ss2 ?? ZERO_BI };

  return r;
}

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

// ---- ReserveInitialized: register token templates + token metadata ----
indexer.contractRegister(
  { contract: "LendingPoolConfigurator", event: "ReserveInitialized" },
  async ({ event, context }) => {
    context.chain.AToken.add(event.params.aToken);
    context.chain.StableDebtToken.add(event.params.stableDebtToken);
    context.chain.VariableDebtToken.add(event.params.variableDebtToken);
  },
);

indexer.onEvent(
  { contract: "LendingPoolConfigurator", event: "ReserveInitialized" },
  async ({ event, context }) => {
    const underlying = event.params.asset;
    let reserve = await getOrInitReserve(context, underlying, event.srcAddress);
    const call = context.effect;

    // name: try string, then bytes32 fallback, else ""
    let name = await tryName(call, underlying);
    if (name === null) {
      const nb = await tryNameBytes(call, underlying);
      name = nb === null ? "" : decodeBytes32ToString(nb);
    }
    // symbol: source reads aToken.symbol() and slices off the leading char
    const aSymbol = await trySymbol(call, event.params.aToken);
    const symbol = (aSymbol ?? "").slice(1);
    // decimals: source reads underlying.decimals()
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
    const aToken = await getOrInitAToken(context, event.params.aToken);
    context.AToken.set({
      ...aToken,
      underlyingAssetAddress: reserve.underlyingAsset,
      underlyingAssetDecimals: reserve.decimals,
      pool_id: reserve.pool_id,
    });

    // sToken
    await createMapContractToPool(context, event.params.stableDebtToken, reserve.pool_id);
    const sToken = await getOrInitSToken(context, event.params.stableDebtToken);
    context.SToken.set({
      ...sToken,
      underlyingAssetAddress: reserve.underlyingAsset,
      underlyingAssetDecimals: reserve.decimals,
      pool_id: reserve.pool_id,
    });

    // vToken
    await createMapContractToPool(context, event.params.variableDebtToken, reserve.pool_id);
    const vToken = await getOrInitVToken(context, event.params.variableDebtToken);
    context.VToken.set({
      ...vToken,
      underlyingAssetAddress: reserve.underlyingAsset,
      underlyingAssetDecimals: reserve.decimals,
      pool_id: reserve.pool_id,
    });

    reserve = {
      ...reserve,
      aToken_id: aToken.id,
      sToken_id: sToken.id,
      vToken_id: vToken.id,
      isActive: true,
    };
    saveReserve(context, reserve, event);
  },
);

// ---- ReserveInterestRateStrategyChanged ----
indexer.onEvent(
  { contract: "LendingPoolConfigurator", event: "ReserveInterestRateStrategyChanged" },
  async ({ event, context }) => {
    const call = context.effect;
    // source: bail if stable slope reads revert (handles a wrong deployment)
    const ss1 = await ratesStrategy.stableRateSlope1(call, low(event.params.strategy));
    const ss2 = await ratesStrategy.stableRateSlope2(call, low(event.params.strategy));
    if (ss1 === null || ss2 === null) return;

    let reserve = await getOrInitReserve(context, event.params.asset, event.srcAddress);
    if (reserve.aToken_id === ZERO_ADDRESS) return;
    reserve = await updateInterestRateStrategy(context, reserve, event.params.strategy, false);
    saveReserve(context, reserve, event);
  },
);

// ---- simple reserve config flag handlers ----
indexer.onEvent(
  { contract: "LendingPoolConfigurator", event: "BorrowingDisabledOnReserve" },
  async ({ event, context }) => {
    const reserve = await getOrInitReserve(context, event.params.asset, event.srcAddress);
    saveReserve(context, { ...reserve, borrowingEnabled: false }, event);
  },
);
indexer.onEvent(
  { contract: "LendingPoolConfigurator", event: "BorrowingEnabledOnReserve" },
  async ({ event, context }) => {
    const reserve = await getOrInitReserve(context, event.params.asset, event.srcAddress);
    saveReserve(
      context,
      {
        ...reserve,
        borrowingEnabled: true,
        stableBorrowRateEnabled: event.params.stableRateEnabled,
      },
      event,
    );
  },
);
indexer.onEvent(
  { contract: "LendingPoolConfigurator", event: "StableRateDisabledOnReserve" },
  async ({ event, context }) => {
    const reserve = await getOrInitReserve(context, event.params.asset, event.srcAddress);
    saveReserve(context, { ...reserve, stableBorrowRateEnabled: false }, event);
  },
);
indexer.onEvent(
  { contract: "LendingPoolConfigurator", event: "StableRateEnabledOnReserve" },
  async ({ event, context }) => {
    const reserve = await getOrInitReserve(context, event.params.asset, event.srcAddress);
    saveReserve(context, { ...reserve, stableBorrowRateEnabled: true }, event);
  },
);
indexer.onEvent(
  { contract: "LendingPoolConfigurator", event: "ReserveActivated" },
  async ({ event, context }) => {
    const reserve = await getOrInitReserve(context, event.params.asset, event.srcAddress);
    saveReserve(context, { ...reserve, isActive: true }, event);
  },
);
indexer.onEvent(
  { contract: "LendingPoolConfigurator", event: "ReserveDeactivated" },
  async ({ event, context }) => {
    const reserve = await getOrInitReserve(context, event.params.asset, event.srcAddress);
    saveReserve(context, { ...reserve, isActive: false }, event);
  },
);
indexer.onEvent(
  { contract: "LendingPoolConfigurator", event: "ReserveFrozen" },
  async ({ event, context }) => {
    const reserve = await getOrInitReserve(context, event.params.asset, event.srcAddress);
    saveReserve(context, { ...reserve, isFrozen: true }, event);
  },
);
indexer.onEvent(
  { contract: "LendingPoolConfigurator", event: "ReserveUnfrozen" },
  async ({ event, context }) => {
    const reserve = await getOrInitReserve(context, event.params.asset, event.srcAddress);
    saveReserve(context, { ...reserve, isFrozen: false }, event);
  },
);
indexer.onEvent(
  { contract: "LendingPoolConfigurator", event: "CollateralConfigurationChanged" },
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
  { contract: "LendingPoolConfigurator", event: "ReserveFactorChanged" },
  async ({ event, context }) => {
    const reserve = await getOrInitReserve(context, event.params.asset, event.srcAddress);
    saveReserve(context, { ...reserve, reserveFactor: event.params.factor }, event);
  },
);
indexer.onEvent(
  { contract: "LendingPoolConfigurator", event: "ReserveDecimalsChanged" },
  async ({ event, context }) => {
    const reserve = await getOrInitReserve(context, event.params.asset, event.srcAddress);
    saveReserve(context, { ...reserve, decimals: Number(event.params.decimals) }, event);
  },
);

// ---- token-impl upgrades. Source calls getOrInitAToken for all three. ----
indexer.onEvent(
  { contract: "LendingPoolConfigurator", event: "ATokenUpgraded" },
  async ({ event, context }) => {
    const aToken = await getOrInitAToken(context, event.params.proxy);
    context.AToken.set({ ...aToken, tokenContractImpl: low(event.params.implementation) });
  },
);
indexer.onEvent(
  { contract: "LendingPoolConfigurator", event: "StableDebtTokenUpgraded" },
  async ({ event, context }) => {
    const aToken = await getOrInitAToken(context, event.params.proxy);
    context.AToken.set({ ...aToken, tokenContractImpl: low(event.params.implementation) });
  },
);
indexer.onEvent(
  { contract: "LendingPoolConfigurator", event: "VariableDebtTokenUpgraded" },
  async ({ event, context }) => {
    const aToken = await getOrInitAToken(context, event.params.proxy);
    context.AToken.set({ ...aToken, tokenContractImpl: low(event.params.implementation) });
  },
);
