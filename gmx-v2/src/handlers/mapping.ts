/**
 * GMX V2 dispatcher — the heart of the port.
 *
 * The EventEmitter contract emits generic `EventLog` / `EventLog1` / `EventLog2`
 * events whose `eventData` is a nested struct of (key,value) item arrays. We
 * register each of the three events ONCE, wrap `event.params.eventData` in the
 * `EventData` accessor, and dispatch on `event.params.eventName` to the ported
 * per-event entity logic (src/entities/*). This mirrors src/mapping.ts exactly.
 *
 * Network is fixed to "arbitrum" (chain 42161).
 */
import { indexer, type EvmContractRegisterContext, type EffectCaller } from "envio";
import { EventData } from "../utils/eventData";
import type { handlerContext, TxEv } from "../types";
import { getIdFromEvent, getOrCreateTransaction } from "../entities/common";
import { saveDistribution } from "../entities/distributions";
import {
  getMarketInfo,
  saveMarketInfo,
  saveMarketInfoMarketTokensSupplyFromPoolUpdated,
  saveMarketInfoTokensSupply,
} from "../entities/markets";
import {
  orderTypes,
  saveOrder,
  saveOrderCancelledState,
  saveOrderCollateralAutoUpdate,
  saveOrderExecutedState,
  saveOrderFrozenState,
  saveOrderSizeDeltaAutoUpdate,
  saveOrderUpdate,
} from "../entities/orders";
import { savePositionDecrease, savePositionIncrease } from "../entities/positions";
import {
  getSwapActionByFeeType,
  handlePositionImpactPoolDistributed,
  saveCollectedMarketFees,
  savePositionFeesInfo,
  savePositionFeesInfoWithPeriod,
  saveSwapFeesInfo,
  saveSwapFeesInfoWithPeriod,
} from "../entities/fees";
import {
  getMarketPoolValueFromContract,
  getMarketTokensSupplyFromContract,
} from "../effects/contracts";
import { handleSwapInfo } from "../entities/swaps";
import {
  saveOrderCancelledTradeAction,
  saveOrderCreatedTradeAction,
  saveOrderFrozenTradeAction,
  saveOrderUpdatedTradeAction,
  savePositionDecreaseExecutedTradeAction,
  savePositionIncreaseExecutedTradeAction,
  saveSwapExecutedTradeAction,
} from "../entities/trades";
import {
  handleCollateralClaimAction,
  isFundingFeeSettleOrder,
  saveClaimableFundingFeeInfo,
  saveClaimActionOnOrderCancelled,
  saveClaimActionOnOrderCreated,
  saveClaimActionOnOrderExecuted,
} from "../entities/claims";
import {
  handleClaimableCollateralUpdated,
  handleCollateralClaimed,
  handleSetClaimableCollateralFactorForAccount,
  handleSetClaimableCollateralFactorForTime,
} from "../entities/priceImpactRebate";
import { handleOraclePriceUpdate, getTokenPrice } from "../entities/prices";
import { saveUserStat } from "../entities/user";
import { saveUserGmTokensBalanceChange } from "../entities/userBalance";
import { savePositionVolumeInfo, saveSwapVolumeInfo, saveVolumeInfo } from "../entities/volume";
import {
  saveLiquidityProviderIncentivesStat,
  saveLiquidityProviderInfo,
  saveMarketIncentivesStat,
  saveUserGlpGmMigrationStatGlpData,
  saveUserGlpGmMigrationStatGmData,
} from "../entities/incentives/liquidityIncentives";
import { saveTradingIncentivesStat } from "../entities/incentives/tradingIncentives";

const ADDRESS_ZERO = "0x0000000000000000000000000000000000000000";
const SELL_USDG_ID = "last";

function isDepositOrWithdrawalAction(action: string): boolean {
  return action === "deposit" || action === "withdrawal";
}

// ============================================================================
// EventLog1 / EventLog2 dispatch (shared by Arbitrum handlers)
// ============================================================================

async function handleEventLog1(
  context: handlerContext,
  event: TxEv & { params: { eventName: string; eventData: EventData["rawData"] } },
  effectCall: EffectCaller,
): Promise<void> {
  const eventName = event.params.eventName;
  const eventData = new EventData(event.params.eventData);
  const eventId = getIdFromEvent(event);
  const blockNumber = event.block.number;
  const blockTimestamp = event.block.timestamp;

  if (eventName === "MarketCreated") {
    await saveMarketInfo(context, eventData);
    // MarketTokenTemplate registration happens in contractRegister (see below)
    return;
  }

  if (eventName === "GlvCreated") {
    // GlvTokenTemplate registration happens in contractRegister (see below)
    return;
  }

  if (eventName === "DepositCreated") {
    await handleDepositCreated(context, event, eventData);
    return;
  }

  if (eventName === "WithdrawalCreated") {
    const transaction = await getOrCreateTransaction(context, event);
    const account = eventData.getAddressItemString("account")!;
    await saveUserStat(context, "withdrawal", account, transaction.timestamp);
    return;
  }

  if (eventName === "OrderExecuted") {
    const transaction = await getOrCreateTransaction(context, event);
    const order = await saveOrderExecutedState(context, eventData, transaction);
    if (order == null) return;

    if (order.orderType === orderTypes.get("MarketSwap") || order.orderType === orderTypes.get("LimitSwap")) {
      await saveSwapExecutedTradeAction(context, eventId, order, transaction);
    } else if (
      order.orderType === orderTypes.get("MarketIncrease") ||
      order.orderType === orderTypes.get("LimitIncrease") ||
      order.orderType === orderTypes.get("StopIncrease")
    ) {
      await savePositionIncreaseExecutedTradeAction(context, eventId, order, transaction);
    } else if (
      order.orderType === orderTypes.get("MarketDecrease") ||
      order.orderType === orderTypes.get("LimitDecrease") ||
      order.orderType === orderTypes.get("StopLossDecrease") ||
      order.orderType === orderTypes.get("Liquidation")
    ) {
      await savePositionDecreaseExecutedTradeAction(context, eventId, order, transaction);
    }
    return;
  }

  if (eventName === "OrderCancelled") {
    const transaction = await getOrCreateTransaction(context, event);
    const order = await saveOrderCancelledState(context, eventData, transaction);
    if (order !== null) {
      await saveOrderCancelledTradeAction(
        context,
        eventId,
        order,
        order.cancelledReason as string,
        order.cancelledReasonBytes as string,
        transaction,
      );
    }
    return;
  }

  if (eventName === "OrderUpdated") {
    const transaction = await getOrCreateTransaction(context, event);
    const order = await saveOrderUpdate(context, eventData);
    if (order !== null) {
      await saveOrderUpdatedTradeAction(context, eventId, order, transaction);
    }
    return;
  }

  if (eventName === "OrderFrozen") {
    const transaction = await getOrCreateTransaction(context, event);
    const order = await saveOrderFrozenState(context, eventData);
    if (order == null) return;
    await saveOrderFrozenTradeAction(
      context,
      eventId,
      order,
      order.frozenReason as string,
      order.frozenReasonBytes as string,
      transaction,
    );
    return;
  }

  if (eventName === "OrderSizeDeltaAutoUpdated") {
    await saveOrderSizeDeltaAutoUpdate(context, eventData);
    return;
  }

  if (eventName === "OrderCollateralDeltaAmountAutoUpdated") {
    await saveOrderCollateralAutoUpdate(context, eventData);
    return;
  }

  if (eventName === "SwapInfo") {
    const transaction = await getOrCreateTransaction(context, event);
    const tokenIn = eventData.getAddressItemString("tokenIn")!;
    const tokenOut = eventData.getAddressItemString("tokenOut")!;
    const amountIn = eventData.getUintItem("amountIn")!;
    const tokenInPrice = eventData.getUintItem("tokenInPrice")!;
    const volumeUsd = amountIn * tokenInPrice;
    const receiver = eventData.getAddressItemString("receiver")!;

    await handleSwapInfo(context, eventData, transaction);
    await saveSwapVolumeInfo(context, transaction.timestamp, tokenIn, tokenOut, volumeUsd);

    const orderKey = eventData.getBytes32Item("orderKey")!;
    if (orderKey !== "0x0000000000000000000000000000000000000000000000000000000000000000") {
      await saveUserStat(context, "swap", receiver, transaction.timestamp);
    }
    return;
  }

  if (eventName === "SwapFeesCollected") {
    const transaction = await getOrCreateTransaction(context, event);
    const swapFeesInfo = await saveSwapFeesInfo(context, eventData, eventId, transaction);
    const tokenPrice = eventData.getUintItem("tokenPrice")!;
    const feeReceiverAmount = eventData.getUintItem("feeReceiverAmount")!;
    const feeAmountForPool = eventData.getUintItem("feeAmountForPool")!;
    const amountAfterFees = eventData.getUintItem("amountAfterFees")!;
    const action = getSwapActionByFeeType(context, swapFeesInfo.swapFeeType);
    const totalAmountIn = amountAfterFees + feeAmountForPool + feeReceiverAmount;
    const volumeUsd = totalAmountIn * tokenPrice;
    const poolValue = await getMarketPoolValueFromContract(
      context,
      effectCall,
      swapFeesInfo.marketAddress,
      blockNumber,
    );
    const marketTokensSupply = isDepositOrWithdrawalAction(action)
      ? await getMarketTokensSupplyFromContract(effectCall, swapFeesInfo.marketAddress, blockNumber)
      : (await getMarketInfo(context, swapFeesInfo.marketAddress)).marketTokensSupply;

    await saveCollectedMarketFees(
      context,
      transaction,
      swapFeesInfo.marketAddress,
      poolValue,
      swapFeesInfo.feeUsdForPool,
      marketTokensSupply,
    );
    await saveVolumeInfo(context, action, transaction.timestamp, volumeUsd);
    await saveSwapFeesInfoWithPeriod(context, feeAmountForPool, feeReceiverAmount, tokenPrice, transaction.timestamp);
    return;
  }

  if (eventName === "PositionFeesInfo") {
    const transaction = await getOrCreateTransaction(context, event);
    await savePositionFeesInfo(context, eventData, "PositionFeesInfo", transaction);
    return;
  }

  if (eventName === "PositionFeesCollected") {
    const transaction = await getOrCreateTransaction(context, event);
    const positionFeeAmount = eventData.getUintItem("positionFeeAmount")!;
    const positionFeeAmountForPool = eventData.getUintItem("positionFeeAmountForPool")!;
    const collateralTokenPriceMin = eventData.getUintItem("collateralTokenPrice.min")!;
    const liquidationFeeAmount = eventData.getUintItem("liquidationFeeAmount")!;
    const borrowingFeeUsd = eventData.getUintItem("borrowingFeeUsd")!;
    const positionFeesInfo = await savePositionFeesInfo(context, eventData, "PositionFeesCollected", transaction);
    const poolValue = await getMarketPoolValueFromContract(
      context,
      effectCall,
      positionFeesInfo.marketAddress,
      blockNumber,
    );
    const marketInfo = await getMarketInfo(context, positionFeesInfo.marketAddress);

    await saveCollectedMarketFees(
      context,
      transaction,
      positionFeesInfo.marketAddress,
      poolValue,
      positionFeesInfo.feeUsdForPool,
      marketInfo.marketTokensSupply,
    );
    await savePositionFeesInfoWithPeriod(
      context,
      positionFeeAmount,
      positionFeeAmountForPool,
      liquidationFeeAmount,
      borrowingFeeUsd,
      collateralTokenPriceMin,
      transaction.timestamp,
    );
    await saveTradingIncentivesStat(
      context,
      eventData.getAddressItemString("trader")!,
      blockTimestamp,
      positionFeeAmount,
      collateralTokenPriceMin,
    );
    return;
  }

  if (eventName === "PositionIncrease") {
    const transaction = await getOrCreateTransaction(context, event);
    const collateralToken = eventData.getAddressItemString("collateralToken")!;
    const marketToken = eventData.getAddressItemString("market")!;
    const sizeDeltaUsd = eventData.getUintItem("sizeDeltaUsd")!;
    const account = eventData.getAddressItemString("account")!;

    await savePositionIncrease(context, eventData, transaction);
    await saveVolumeInfo(context, "margin", transaction.timestamp, sizeDeltaUsd);
    await savePositionVolumeInfo(context, transaction.timestamp, collateralToken, marketToken, sizeDeltaUsd);
    await saveUserStat(context, "margin", account, transaction.timestamp);
    return;
  }

  if (eventName === "PositionDecrease") {
    const transaction = await getOrCreateTransaction(context, event);
    const collateralToken = eventData.getAddressItemString("collateralToken")!;
    const marketToken = eventData.getAddressItemString("market")!;
    const sizeDeltaUsd = eventData.getUintItem("sizeDeltaUsd")!;
    const account = eventData.getAddressItemString("account")!;

    await savePositionDecrease(context, eventData, transaction);
    await saveVolumeInfo(context, "margin", transaction.timestamp, sizeDeltaUsd);
    await savePositionVolumeInfo(context, transaction.timestamp, collateralToken, marketToken, sizeDeltaUsd);
    await saveUserStat(context, "margin", account, transaction.timestamp);
    return;
  }

  if (eventName === "FundingFeesClaimed") {
    const transaction = await getOrCreateTransaction(context, event);
    await handleCollateralClaimAction(context, "ClaimFunding", eventData, transaction);
    return;
  }

  if (eventName === "CollateralClaimed") {
    const transaction = await getOrCreateTransaction(context, event);
    await handleCollateralClaimAction(context, "ClaimPriceImpact", eventData, transaction);
    await handleCollateralClaimed(context, eventData);
    return;
  }

  if (eventName === "ClaimableFundingUpdated") {
    const transaction = await getOrCreateTransaction(context, event);
    await saveClaimableFundingFeeInfo(context, eventData, transaction);
    return;
  }

  if (eventName === "MarketPoolValueUpdated") {
    // saveMarketIncentivesStat must run before MarketInfo supply is updated
    await saveMarketIncentivesStat(context, eventData, blockTimestamp);
    await saveMarketInfoMarketTokensSupplyFromPoolUpdated(
      context,
      eventData.getAddressItemString("market")!,
      eventData.getUintItem("marketTokensSupply"),
    );
    return;
  }

  if (eventName === "PositionImpactPoolDistributed") {
    const transaction = await getOrCreateTransaction(context, event);
    await handlePositionImpactPoolDistributed(context, effectCall, eventData, transaction, blockNumber);
    return;
  }

  if (eventName === "OraclePriceUpdate") {
    await handleOraclePriceUpdate(context, eventData);
    return;
  }

  if (eventName === "ClaimableCollateralUpdated") {
    await handleClaimableCollateralUpdated(context, eventData);
    return;
  }
}

async function handleEventLog2(
  context: handlerContext,
  event: TxEv & { params: { eventName: string; eventData: EventData["rawData"] } },
): Promise<void> {
  const eventName = event.params.eventName;
  const eventData = new EventData(event.params.eventData);
  const eventId = getIdFromEvent(event);

  if (eventName === "OrderCreated") {
    const transaction = await getOrCreateTransaction(context, event);
    const order = await saveOrder(context, eventData, transaction);
    if (isFundingFeeSettleOrder(order)) {
      await saveClaimActionOnOrderCreated(context, transaction, eventData);
    } else {
      await saveOrderCreatedTradeAction(context, eventId, order, transaction);
    }
    return;
  }

  if (eventName === "SetClaimableCollateralFactorForTime") {
    await handleSetClaimableCollateralFactorForTime(context, eventData);
    return;
  }

  if (eventName === "SetClaimableCollateralFactorForAccount") {
    await handleSetClaimableCollateralFactorForAccount(context, eventData);
    return;
  }

  if (eventName === "DepositCreated") {
    await handleDepositCreated(context, event, eventData);
    return;
  }

  if (eventName === "DepositExecuted") {
    await handleDepositExecuted(context, event, eventData);
    return;
  }

  if (eventName === "WithdrawalCreated") {
    const transaction = await getOrCreateTransaction(context, event);
    const account = eventData.getAddressItemString("account")!;
    await saveUserStat(context, "withdrawal", account, transaction.timestamp);
    return;
  }

  if (eventName === "OrderExecuted") {
    const transaction = await getOrCreateTransaction(context, event);
    const order = await saveOrderExecutedState(context, eventData, transaction);
    if (order == null) return;

    if (order.orderType === orderTypes.get("MarketSwap") || order.orderType === orderTypes.get("LimitSwap")) {
      await saveSwapExecutedTradeAction(context, eventId, order, transaction);
    } else if (
      order.orderType === orderTypes.get("MarketIncrease") ||
      order.orderType === orderTypes.get("LimitIncrease") ||
      order.orderType === orderTypes.get("StopIncrease")
    ) {
      await savePositionIncreaseExecutedTradeAction(context, eventId, order, transaction);
    } else if (
      order.orderType === orderTypes.get("MarketDecrease") ||
      order.orderType === orderTypes.get("LimitDecrease") ||
      order.orderType === orderTypes.get("StopLossDecrease") ||
      order.orderType === orderTypes.get("Liquidation")
    ) {
      if (await context.ClaimRef.get(order.id)) {
        await saveClaimActionOnOrderExecuted(context, transaction, eventData);
      } else {
        await savePositionDecreaseExecutedTradeAction(context, eventId, order, transaction);
      }
    }
    return;
  }

  if (eventName === "OrderCancelled") {
    const transaction = await getOrCreateTransaction(context, event);
    const order = await saveOrderCancelledState(context, eventData, transaction);
    if (order !== null) {
      if (await context.ClaimRef.get(order.id)) {
        await saveClaimActionOnOrderCancelled(context, transaction, eventData);
      } else {
        await saveOrderCancelledTradeAction(
          context,
          eventId,
          order,
          order.cancelledReason as string,
          order.cancelledReasonBytes as string,
          transaction,
        );
      }
    }
    return;
  }

  if (eventName === "OrderUpdated") {
    const transaction = await getOrCreateTransaction(context, event);
    const order = await saveOrderUpdate(context, eventData);
    if (order !== null) {
      await saveOrderUpdatedTradeAction(context, eventId, order, transaction);
    }
    return;
  }

  if (eventName === "OrderFrozen") {
    const transaction = await getOrCreateTransaction(context, event);
    const order = await saveOrderFrozenState(context, eventData);
    if (order == null) return;
    await saveOrderFrozenTradeAction(
      context,
      eventId,
      order,
      order.frozenReason as string,
      order.frozenReasonBytes as string,
      transaction,
    );
    return;
  }
}

async function handleDepositCreated(
  context: handlerContext,
  event: TxEv,
  eventData: EventData,
): Promise<void> {
  const transaction = await getOrCreateTransaction(context, event);
  const account = eventData.getAddressItemString("account")!;
  await saveUserStat(context, "deposit", account, transaction.timestamp);

  context.DepositRef.set({
    id: eventData.getBytes32Item("key")!,
    marketAddress: eventData.getAddressItemString("market")!,
    account: eventData.getAddressItemString("account")!,
  });
}

async function handleDepositExecuted(
  context: handlerContext,
  event: TxEv,
  eventData: EventData,
): Promise<void> {
  const key = eventData.getBytes32Item("key")!;
  const depositRef = await context.DepositRef.get(key);
  if (depositRef == null) {
    if (context.isPreload) return;
    throw new Error("DepositRef not found " + key);
  }
  const marketInfo = await context.MarketInfo.get(depositRef.marketAddress);
  if (marketInfo == null) {
    if (context.isPreload) return;
    throw new Error("MarketInfo not found " + depositRef.marketAddress);
  }

  const longTokenAmount = eventData.getUintItem("longTokenAmount")!;
  const longTokenPrice = await getTokenPrice(context, marketInfo.longToken);

  const shortTokenAmount = eventData.getUintItem("shortTokenAmount")!;
  const shortTokenPrice = await getTokenPrice(context, marketInfo.shortToken);

  const depositUsd = longTokenAmount * longTokenPrice + shortTokenAmount * shortTokenPrice;
  await saveUserGlpGmMigrationStatGmData(context, depositRef.account, event.block.timestamp, depositUsd);
}

// ============================================================================
// EventLog (no topic) — only DepositExecuted is dispatched in the original
// ============================================================================
indexer.onEvent({ contract: "EventEmitter", event: "EventLog" }, async ({ event, context }) => {
  const eventName = event.params.eventName;
  if (eventName === "DepositExecuted") {
    const eventData = new EventData(event.params.eventData);
    await handleDepositExecuted(context, event, eventData);
  }
});

indexer.onEvent({ contract: "EventEmitter", event: "EventLog1" }, async ({ event, context }) => {
  await handleEventLog1(context, event as never, context.effect);
});

indexer.onEvent({ contract: "EventEmitter", event: "EventLog2" }, async ({ event, context }) => {
  await handleEventLog2(context, event as never);
});

// ============================================================================
// Dynamic template registration (subgraph `templates`)
// ============================================================================
const asAddr = (x: string): `0x${string}` => x as `0x${string}`;

indexer.contractRegister(
  { contract: "EventEmitter", event: "EventLog1" },
  async ({ event, context }: { event: { params: { eventName: string; eventData: EventData["rawData"] } }; context: EvmContractRegisterContext }) => {
    const eventName = event.params.eventName;
    if (eventName === "MarketCreated") {
      const eventData = new EventData(event.params.eventData);
      const marketToken = eventData.getAddressItem("marketToken");
      if (marketToken) {
        context.chain.MarketTokenTemplate.add(asAddr(marketToken));
      }
    } else if (eventName === "GlvCreated") {
      const eventData = new EventData(event.params.eventData);
      let glvToken = eventData.getAddressItem("glvToken");
      if (!glvToken) glvToken = eventData.getAddressItem("glv");
      if (glvToken) {
        context.chain.GlvTokenTemplate.add(asAddr(glvToken));
      }
    }
  },
);

// ============================================================================
// Legacy GMX V1 stat sources
// ============================================================================
indexer.onEvent({ contract: "Vault", event: "SellUSDG" }, async ({ event, context }) => {
  context.SellUSDG.set({
    id: SELL_USDG_ID,
    txHash: event.transaction.hash.toLowerCase(),
    logIndex: event.logIndex,
    feeBasisPoints: event.params.feeBasisPoints,
  });
});

indexer.onEvent({ contract: "GlpManager", event: "RemoveLiquidity" }, async ({ event, context }) => {
  const sellUsdgEntity = await context.SellUSDG.get(SELL_USDG_ID);

  if (sellUsdgEntity == null) {
    context.log.error(`No SellUSDG entity tx: ${event.transaction.hash}`);
    throw new Error("No SellUSDG entity");
  }
  if (sellUsdgEntity.txHash !== event.transaction.hash.toLowerCase()) {
    context.log.error(
      `SellUSDG entity tx hashes don't match: expected ${event.transaction.hash} actual ${sellUsdgEntity.txHash}`,
    );
    throw new Error("SellUSDG entity tx hashes don't match");
  }
  const expectedLogIndex = event.logIndex - 1;
  if (sellUsdgEntity.logIndex !== expectedLogIndex) {
    context.log.error(
      `SellUSDG entity incorrect log index: expected ${expectedLogIndex} got ${sellUsdgEntity.logIndex}`,
    );
    throw new Error("SellUSDG entity tx hashes don't match");
  }

  await saveUserGlpGmMigrationStatGlpData(
    context,
    event.params.account.toLowerCase(),
    event.block.timestamp,
    event.params.usdgAmount,
    sellUsdgEntity.feeBasisPoints,
  );
});

indexer.onEvent({ contract: "BatchSender", event: "BatchSend" }, async ({ event, context }) => {
  const typeId = event.params.typeId;
  const token = event.params.token.toLowerCase();
  const receivers = event.params.accounts;
  const amounts = event.params.amounts;
  for (let i = 0; i < receivers.length; i++) {
    await saveDistribution(
      context,
      receivers[i]!.toLowerCase(),
      token,
      amounts[i]!,
      Number(typeId),
      event.transaction.hash.toLowerCase(),
      event.block.number,
      event.block.timestamp,
    );
  }
});

// ============================================================================
// Templates: GM / GLV token transfers
// ============================================================================
indexer.onEvent({ contract: "GlvTokenTemplate", event: "Transfer" }, async ({ event, context }) => {
  const glvAddress = event.srcAddress.toLowerCase();
  const from = event.params.from.toLowerCase();
  const to = event.params.to.toLowerCase();
  const value = event.params.value;

  if (from !== ADDRESS_ZERO) {
    await saveLiquidityProviderIncentivesStat(context, from, glvAddress, "Glv", "1w", -value, event.block.timestamp);
    await saveLiquidityProviderInfo(context, from, glvAddress, "Glv", -value);
  }
  if (to !== ADDRESS_ZERO) {
    await saveLiquidityProviderIncentivesStat(context, to, glvAddress, "Glv", "1w", value, event.block.timestamp);
    await saveLiquidityProviderInfo(context, to, glvAddress, "Glv", value);
  }
});

indexer.onEvent({ contract: "MarketTokenTemplate", event: "Transfer" }, async ({ event, context }) => {
  const marketAddress = event.srcAddress.toLowerCase();
  const from = event.params.from.toLowerCase();
  const to = event.params.to.toLowerCase();
  const value = event.params.value;

  if (from !== ADDRESS_ZERO) {
    await saveLiquidityProviderIncentivesStat(context, from, marketAddress, "Market", "1w", -value, event.block.timestamp);
    await saveLiquidityProviderInfo(context, from, marketAddress, "Market", -value);
    const transaction = await getOrCreateTransaction(context, event);
    await saveUserGmTokensBalanceChange(context, from, marketAddress, -value, transaction, BigInt(event.logIndex));
  }
  if (to !== ADDRESS_ZERO) {
    await saveLiquidityProviderIncentivesStat(context, to, marketAddress, "Market", "1w", value, event.block.timestamp);
    await saveLiquidityProviderInfo(context, to, marketAddress, "Market", value);
    const transaction = await getOrCreateTransaction(context, event);
    await saveUserGmTokensBalanceChange(context, to, marketAddress, value, transaction, BigInt(event.logIndex));
  }

  if (from === ADDRESS_ZERO) {
    await saveMarketInfoTokensSupply(context, marketAddress, value);
  }
  if (to === ADDRESS_ZERO) {
    await saveMarketInfoTokensSupply(context, marketAddress, -value);
  }
});
