/**
 * Port of src/mappings/comet.ts.
 */
import { indexer } from "envio";
import {
  ABSORB_DEBT_EVENT_SIGNATURE,
  InteractionType,
  SUPPLY_EVENT_SIGNATURE,
  WITHDRAW_EVENT_SIGNATURE,
  ZERO_ADDRESS,
  ZERO_BD,
  ZERO_BI,
} from "../common/constants";
import { bigIntMax, bigIntMin, low, presentValue } from "../common/utils";
import { tryGetReceiptTopics } from "../effects/calls";
import {
  getOrCreateMarket,
  getOrCreateMarketAccounting,
  getOrCreateMarketConfiguration,
  updateMarketAccounting,
  updateMarketConfiguration,
} from "../mappingHelpers/market";
import {
  createPositionAccountingSnapshot,
  getOrCreatePosition,
  getOrCreatePositionAccounting,
  updatePositionAccounting,
} from "../mappingHelpers/position";
import { getOrCreateAccount } from "../mappingHelpers/account";
import {
  createAbsorbCollateralInteraction,
  createAbsorbDebtInteraction,
  createBuyCollateralInteraction,
  createSupplyBaseInteraction,
  createSupplyCollateralInteraction,
  createTransferBaseInteraction,
  createTransferCollateralInteraction,
  createWithdrawBaseInteraction,
  createWithdrawCollateralInteraction,
  createWithdrawReservesInteraction,
} from "../mappingHelpers/interaction";
import {
  getOrCreateMarketCollateralBalance,
  getOrCreatePositionCollateralBalance,
  updateMarketCollateralBalance,
  updatePositionCollateralBalance,
} from "../mappingHelpers/collateralBalance";
import { getOrCreateCollateralToken, getOrCreateToken } from "../mappingHelpers/token";
import { updateUsageMetrics } from "../mappingHelpers/usage";

indexer.onEvent(
  { contract: "Comet", event: "Upgraded" },
  async ({ event, context }) => {
    // Create market if not yet made
    const market = await getOrCreateMarket(context, low(event.srcAddress), event);
    const marketConfiguration = await getOrCreateMarketConfiguration(context, market, event);

    // Trigger the market to update its configuration
    await updateMarketConfiguration(context, market, marketConfiguration, event);

    // Cannot read from contract since need to read memory slot since only owner can read proxy
    marketConfiguration.cometImplementation = low(event.params.implementation);
    context.MarketConfiguration.set({ ...marketConfiguration });
  },
);

indexer.onEvent(
  { contract: "Comet", event: "Supply" },
  async ({ event, context }) => {
    const ownerAddress = low(event.params.dst);
    const amount = event.params.amount;
    const from = low(event.params.from);

    const market = await getOrCreateMarket(context, low(event.srcAddress), event);
    const marketAccounting = await getOrCreateMarketAccounting(context, market, event);
    const account = await getOrCreateAccount(context, ownerAddress, event);
    const position = await getOrCreatePosition(context, market, account, event);
    const positionAccounting = await getOrCreatePositionAccounting(context, position, event);

    await updateMarketAccounting(context, market, marketAccounting, event);

    const supplyBaseInteraction = await createSupplyBaseInteraction(context, market, position, from, amount, event);
    const transaction = await context.Transaction.getOrThrow(supplyBaseInteraction.transaction_id);

    // Update position accounting
    await updatePositionAccounting(context, position, positionAccounting, event);
    positionAccounting.cumulativeBaseSupplied = positionAccounting.cumulativeBaseSupplied + supplyBaseInteraction.amount;
    positionAccounting.cumulativeBaseSuppliedUsd = positionAccounting.cumulativeBaseSuppliedUsd.plus(
      supplyBaseInteraction.amountUsd,
    );
    positionAccounting.cumulativeGasUsedWei = positionAccounting.cumulativeGasUsedWei + (transaction.gasUsed ?? ZERO_BI);
    positionAccounting.cumulativeGasUsedUsd = positionAccounting.cumulativeGasUsedUsd.plus(
      transaction.gasUsedUsd ?? ZERO_BD,
    );
    context.PositionAccounting.set({ ...positionAccounting });
    await createPositionAccountingSnapshot(context, positionAccounting, event); // Manually retrigger snapshot

    await updateUsageMetrics(context, account, market, InteractionType.SUPPLY_BASE, event);

    context.MarketAccounting.set({ ...marketAccounting });
  },
);

indexer.onEvent(
  { contract: "Comet", event: "Withdraw" },
  async ({ event, context }) => {
    const ownerAddress = low(event.params.src);
    const amount = event.params.amount;
    const destination = low(event.params.to);

    const market = await getOrCreateMarket(context, low(event.srcAddress), event);
    const marketAccounting = await getOrCreateMarketAccounting(context, market, event);
    const account = await getOrCreateAccount(context, ownerAddress, event);
    const position = await getOrCreatePosition(context, market, account, event);
    const positionAccounting = await getOrCreatePositionAccounting(context, position, event);

    await updateMarketAccounting(context, market, marketAccounting, event);

    const interaction = await createWithdrawBaseInteraction(context, market, position, destination, amount, event);
    const transaction = await context.Transaction.getOrThrow(interaction.transaction_id);

    // Update position cumulatives
    await updatePositionAccounting(context, position, positionAccounting, event);
    positionAccounting.cumulativeBaseWithdrawn = positionAccounting.cumulativeBaseWithdrawn + interaction.amount;
    positionAccounting.cumulativeBaseWithdrawnUsd = positionAccounting.cumulativeBaseWithdrawnUsd.plus(
      interaction.amountUsd,
    );
    positionAccounting.cumulativeGasUsedWei = positionAccounting.cumulativeGasUsedWei + (transaction.gasUsed ?? ZERO_BI);
    positionAccounting.cumulativeGasUsedUsd = positionAccounting.cumulativeGasUsedUsd.plus(
      transaction.gasUsedUsd ?? ZERO_BD,
    );
    context.PositionAccounting.set({ ...positionAccounting });
    await createPositionAccountingSnapshot(context, positionAccounting, event); // Manually retrigger snapshot

    await updateUsageMetrics(context, account, market, InteractionType.WITHDRAW_BASE, event);

    context.MarketAccounting.set({ ...marketAccounting });
  },
);

indexer.onEvent(
  { contract: "Comet", event: "AbsorbDebt" },
  async ({ event, context }) => {
    const ownerAddress = low(event.params.borrower);
    const basePaidOut = event.params.basePaidOut;
    const absorber = low(event.params.absorber);

    const market = await getOrCreateMarket(context, low(event.srcAddress), event);
    const marketAccounting = await getOrCreateMarketAccounting(context, market, event);
    const account = await getOrCreateAccount(context, ownerAddress, event);
    const position = await getOrCreatePosition(context, market, account, event);
    const positionAccounting = await getOrCreatePositionAccounting(context, position, event);

    await createAbsorbDebtInteraction(context, market, position, absorber, basePaidOut, event);

    // Market accounting
    await updateMarketAccounting(context, market, marketAccounting, event);
    await updatePositionAccounting(context, position, positionAccounting, event);

    await updateUsageMetrics(context, account, market, InteractionType.LIQUIDATION, event);

    context.MarketAccounting.set({ ...marketAccounting });
    context.PositionAccounting.set({ ...positionAccounting });
  },
);

indexer.onEvent(
  { contract: "Comet", event: "SupplyCollateral" },
  async ({ event, context }) => {
    const ownerAddress = low(event.params.dst);
    const amount = event.params.amount;
    const supplier = low(event.params.from);
    const assetAddress = low(event.params.asset);

    const market = await getOrCreateMarket(context, low(event.srcAddress), event);
    const marketAccounting = await getOrCreateMarketAccounting(context, market, event);
    const account = await getOrCreateAccount(context, ownerAddress, event);
    const position = await getOrCreatePosition(context, market, account, event);
    const positionAccounting = await getOrCreatePositionAccounting(context, position, event);
    const token = await getOrCreateToken(context, assetAddress, event);
    const collateralToken = await getOrCreateCollateralToken(context, market, token, event);

    const marketCollateralBalance = await getOrCreateMarketCollateralBalance(context, collateralToken, event);
    const positionCollateralBalance = await getOrCreatePositionCollateralBalance(
      context,
      collateralToken,
      position,
      event,
    );

    await updateMarketCollateralBalance(context, marketCollateralBalance, event);
    await updatePositionCollateralBalance(context, position, positionCollateralBalance, event);

    await updateMarketAccounting(context, market, marketAccounting, event);

    const interaction = await createSupplyCollateralInteraction(
      context,
      market,
      position,
      supplier,
      collateralToken,
      amount,
      event,
    );
    const transaction = await context.Transaction.getOrThrow(interaction.transaction_id);

    // Update position accounting
    await updatePositionAccounting(context, position, positionAccounting, event);
    positionAccounting.cumulativeGasUsedWei = positionAccounting.cumulativeGasUsedWei + (transaction.gasUsed ?? ZERO_BI);
    positionAccounting.cumulativeGasUsedUsd = positionAccounting.cumulativeGasUsedUsd.plus(
      transaction.gasUsedUsd ?? ZERO_BD,
    );
    context.PositionAccounting.set({ ...positionAccounting });
    await createPositionAccountingSnapshot(context, positionAccounting, event); // Manually retrigger snapshot

    await updateUsageMetrics(context, account, market, InteractionType.SUPPLY_COLLATERAL, event);

    context.MarketCollateralBalance.set({ ...marketCollateralBalance });
    context.PositionCollateralBalance.set({ ...positionCollateralBalance });
    context.MarketAccounting.set({ ...marketAccounting });
    context.PositionAccounting.set({ ...positionAccounting });
  },
);

indexer.onEvent(
  { contract: "Comet", event: "WithdrawCollateral" },
  async ({ event, context }) => {
    const ownerAddress = low(event.params.src);
    const amount = -event.params.amount; // original: event.params.amount.neg()
    const destination = low(event.params.to);
    const assetAddress = low(event.params.asset);

    const market = await getOrCreateMarket(context, low(event.srcAddress), event);
    const marketAccounting = await getOrCreateMarketAccounting(context, market, event);
    const account = await getOrCreateAccount(context, ownerAddress, event);
    const position = await getOrCreatePosition(context, market, account, event);
    const positionAccounting = await getOrCreatePositionAccounting(context, position, event);
    const token = await getOrCreateToken(context, assetAddress, event);
    const collateralToken = await getOrCreateCollateralToken(context, market, token, event);

    const marketCollateralBalance = await getOrCreateMarketCollateralBalance(context, collateralToken, event);
    const positionCollateralBalance = await getOrCreatePositionCollateralBalance(
      context,
      collateralToken,
      position,
      event,
    );

    await updateMarketCollateralBalance(context, marketCollateralBalance, event);
    await updatePositionCollateralBalance(context, position, positionCollateralBalance, event);

    await updateMarketAccounting(context, market, marketAccounting, event);

    const interaction = await createWithdrawCollateralInteraction(
      context,
      market,
      position,
      destination,
      collateralToken,
      -amount, // original: amount.neg() (double negative -> positive)
      event,
    );
    const transaction = await context.Transaction.getOrThrow(interaction.transaction_id);

    // Update position accounting
    await updatePositionAccounting(context, position, positionAccounting, event);
    positionAccounting.cumulativeGasUsedWei = positionAccounting.cumulativeGasUsedWei + (transaction.gasUsed ?? ZERO_BI);
    positionAccounting.cumulativeGasUsedUsd = positionAccounting.cumulativeGasUsedUsd.plus(
      transaction.gasUsedUsd ?? ZERO_BD,
    );
    context.PositionAccounting.set({ ...positionAccounting });
    await createPositionAccountingSnapshot(context, positionAccounting, event); // Manually retrigger snapshot

    await updateUsageMetrics(context, account, market, InteractionType.WITHDRAW_COLLATERAL, event);

    context.MarketCollateralBalance.set({ ...marketCollateralBalance });
    context.PositionCollateralBalance.set({ ...positionCollateralBalance });
    context.MarketAccounting.set({ ...marketAccounting });
    context.PositionAccounting.set({ ...positionAccounting });
  },
);

indexer.onEvent(
  { contract: "Comet", event: "TransferCollateral" },
  async ({ event, context }) => {
    const from = low(event.params.from);
    const to = low(event.params.to);
    const assetAddress = low(event.params.asset);
    const amount = event.params.amount;

    const market = await getOrCreateMarket(context, low(event.srcAddress), event);
    const marketAccounting = await getOrCreateMarketAccounting(context, market, event);
    const fromAccount = await getOrCreateAccount(context, from, event);
    const toAccount = await getOrCreateAccount(context, to, event);
    const token = await getOrCreateToken(context, assetAddress, event);
    const collateralToken = await getOrCreateCollateralToken(context, market, token, event);
    const fromPosition = await getOrCreatePosition(context, market, fromAccount, event);
    const fromPositionAccounting = await getOrCreatePositionAccounting(context, fromPosition, event);
    const toPosition = await getOrCreatePosition(context, market, toAccount, event);
    const toPositionAccounting = await getOrCreatePositionAccounting(context, toPosition, event);

    const fromPositionCollateralBalance = await getOrCreatePositionCollateralBalance(
      context,
      collateralToken,
      fromPosition,
      event,
    );
    const toPositionCollateralBalance = await getOrCreatePositionCollateralBalance(
      context,
      collateralToken,
      toPosition,
      event,
    );

    await updatePositionCollateralBalance(context, fromPosition, fromPositionCollateralBalance, event);
    await updatePositionCollateralBalance(context, toPosition, toPositionCollateralBalance, event);

    const interaction = await createTransferCollateralInteraction(
      context,
      market,
      fromPosition,
      toPosition,
      collateralToken,
      amount,
      event,
    );
    const transaction = await context.Transaction.getOrThrow(interaction.transaction_id);

    // From position accounting
    await updatePositionAccounting(context, fromPosition, fromPositionAccounting, event);
    fromPositionAccounting.cumulativeGasUsedWei =
      fromPositionAccounting.cumulativeGasUsedWei + (transaction.gasUsed ?? ZERO_BI);
    fromPositionAccounting.cumulativeGasUsedUsd = fromPositionAccounting.cumulativeGasUsedUsd.plus(
      transaction.gasUsedUsd ?? ZERO_BD,
    );
    context.PositionAccounting.set({ ...fromPositionAccounting });
    await createPositionAccountingSnapshot(context, fromPositionAccounting, event); // Manually retrigger snapshot

    await updateMarketAccounting(context, market, marketAccounting, event);
    await updatePositionAccounting(context, toPosition, toPositionAccounting, event);

    await updateUsageMetrics(context, fromAccount, market, InteractionType.TRANSFER_COLLATERAL, event);

    context.PositionCollateralBalance.set({ ...fromPositionCollateralBalance });
    context.PositionCollateralBalance.set({ ...toPositionCollateralBalance });
    context.MarketAccounting.set({ ...marketAccounting });
    context.PositionAccounting.set({ ...fromPositionAccounting });
    context.PositionAccounting.set({ ...toPositionAccounting });
  },
);

indexer.onEvent(
  { contract: "Comet", event: "AbsorbCollateral" },
  async ({ event, context }) => {
    const absorber = low(event.params.absorber);
    const ownerAddress = low(event.params.borrower);
    const assetAddress = low(event.params.asset);
    const amount = event.params.collateralAbsorbed;

    const market = await getOrCreateMarket(context, low(event.srcAddress), event);
    const marketAccounting = await getOrCreateMarketAccounting(context, market, event);
    const account = await getOrCreateAccount(context, ownerAddress, event);
    const position = await getOrCreatePosition(context, market, account, event);
    const positionAccounting = await getOrCreatePositionAccounting(context, position, event);
    const token = await getOrCreateToken(context, assetAddress, event);
    const collateralToken = await getOrCreateCollateralToken(context, market, token, event);

    const marketCollateralBalance = await getOrCreateMarketCollateralBalance(context, collateralToken, event);
    const positionCollateralBalance = await getOrCreatePositionCollateralBalance(
      context,
      collateralToken,
      position,
      event,
    );

    await updateMarketCollateralBalance(context, marketCollateralBalance, event);
    await updatePositionCollateralBalance(context, position, positionCollateralBalance, event);

    await updateMarketAccounting(context, market, marketAccounting, event);

    const interaction = await createAbsorbCollateralInteraction(
      context,
      market,
      position,
      absorber,
      collateralToken,
      amount,
      event,
    );

    await updatePositionAccounting(context, position, positionAccounting, event);
    positionAccounting.cumulativeCollateralLiquidatedUsd = positionAccounting.cumulativeCollateralLiquidatedUsd.plus(
      interaction.amountUsd,
    );
    context.PositionAccounting.set({ ...positionAccounting });
    await createPositionAccountingSnapshot(context, positionAccounting, event); // Manually retrigger snapshot

    context.MarketCollateralBalance.set({ ...marketCollateralBalance });
    context.PositionCollateralBalance.set({ ...positionCollateralBalance });
    context.MarketAccounting.set({ ...marketAccounting });
  },
);

indexer.onEvent(
  { contract: "Comet", event: "BuyCollateral" },
  async ({ event, context }) => {
    const assetAddress = low(event.params.asset);
    const buyer = low(event.params.buyer);
    const collateralAmount = event.params.collateralAmount;
    const baseAmount = event.params.baseAmount;

    const market = await getOrCreateMarket(context, low(event.srcAddress), event);
    const token = await getOrCreateToken(context, assetAddress, event);
    const collateralToken = await getOrCreateCollateralToken(context, market, token, event);

    const marketCollateralBalance = await getOrCreateMarketCollateralBalance(context, collateralToken, event);

    await updateMarketCollateralBalance(context, marketCollateralBalance, event);

    await createBuyCollateralInteraction(context, market, buyer, collateralToken, collateralAmount, baseAmount, event);

    context.MarketCollateralBalance.set({ ...marketCollateralBalance });
  },
);

indexer.onEvent(
  { contract: "Comet", event: "WithdrawReserves" },
  async ({ event, context }) => {
    const market = await getOrCreateMarket(context, low(event.srcAddress), event);
    const marketAccounting = await getOrCreateMarketAccounting(context, market, event);
    const destination = low(event.params.to);
    const amount = event.params.amount;

    await updateMarketAccounting(context, market, marketAccounting, event);

    await createWithdrawReservesInteraction(context, market, destination, amount, event);

    context.MarketAccounting.set({ ...marketAccounting });
  },
);

indexer.onEvent(
  { contract: "Comet", event: "Transfer" },
  async ({ event, context }) => {
    // Port of logsContainWithdrawOrSupplyOrAbsorbDebtEvents (event.receipt):
    // receipt topics fetched via cached effect.
    const topics = await tryGetReceiptTopics(context.effect, event.transaction.hash);
    if (topics === null) {
      // Should never get here since we require receipts in subgraph.yaml
      context.log.error(`No logs for event: ${event.transaction.hash} ${event.logIndex}`);
    } else if (
      topics.some(
        (t) => t === SUPPLY_EVENT_SIGNATURE || t === WITHDRAW_EVENT_SIGNATURE || t === ABSORB_DEBT_EVENT_SIGNATURE,
      )
    ) {
      // Ignore any transfers when there is supply or withdraw events
      return;
    }

    const transferFromAddress = low(event.params.from);
    const transferToAddress = low(event.params.to);

    const market = await getOrCreateMarket(context, low(event.srcAddress), event);
    const marketAccounting = await getOrCreateMarketAccounting(context, market, event);

    await updateMarketAccounting(context, market, marketAccounting, event);

    // Transfers are only ever burn or mint (never actually between accounts)
    if (transferFromAddress !== ZERO_ADDRESS) {
      const fromAccount = await getOrCreateAccount(context, transferFromAddress, event);
      const fromPosition = await getOrCreatePosition(context, market, fromAccount, event);
      const fromPositionAccounting = await getOrCreatePositionAccounting(context, fromPosition, event);

      const basePrincipalBefore = fromPositionAccounting.basePrincipal;
      await updatePositionAccounting(context, fromPosition, fromPositionAccounting, event);
      const basePrincipalAfter = fromPositionAccounting.basePrincipal;

      const withdrawPrincipal =
        basePrincipalBefore > ZERO_BI ? basePrincipalBefore - bigIntMax(basePrincipalAfter, ZERO_BI) : ZERO_BI;
      const borrowPrincipal =
        basePrincipalAfter < ZERO_BI ? bigIntMin(basePrincipalBefore, ZERO_BI) - basePrincipalAfter : ZERO_BI;

      const withdrawBase = presentValue(withdrawPrincipal, marketAccounting.baseSupplyIndex);
      const borrowBase = presentValue(borrowPrincipal, marketAccounting.baseBorrowIndex);
      const totalBaseWithdraw = withdrawBase + borrowBase;

      const interaction = await createTransferBaseInteraction(
        context,
        market,
        fromPosition,
        null,
        -totalBaseWithdraw,
        event,
      );

      fromPositionAccounting.cumulativeBaseWithdrawn = fromPositionAccounting.cumulativeBaseWithdrawn - interaction.amount; // Double negative here
      fromPositionAccounting.cumulativeBaseWithdrawnUsd = fromPositionAccounting.cumulativeBaseWithdrawnUsd.minus(
        interaction.amountUsd,
      ); // Double negative here

      context.PositionAccounting.set({ ...fromPositionAccounting });

      await createPositionAccountingSnapshot(context, fromPositionAccounting, event); // Manually retrigger snapshot

      await updateUsageMetrics(context, fromAccount, market, InteractionType.TRANSFER_BASE, event);
    } else {
      // Transfer to
      const toAccount = await getOrCreateAccount(context, transferToAddress, event);
      const toPosition = await getOrCreatePosition(context, market, toAccount, event);
      const toPositionAccounting = await getOrCreatePositionAccounting(context, toPosition, event);

      const basePrincipalBefore = toPositionAccounting.basePrincipal;
      await updatePositionAccounting(context, toPosition, toPositionAccounting, event);
      const basePrincipalAfter = toPositionAccounting.basePrincipal;

      const supplyPrincipal =
        basePrincipalAfter > ZERO_BI ? basePrincipalAfter - bigIntMax(basePrincipalBefore, ZERO_BI) : ZERO_BI;
      const repayPrincipal =
        basePrincipalBefore < ZERO_BI ? bigIntMin(basePrincipalAfter, ZERO_BI) - basePrincipalBefore : ZERO_BI;

      const supplyBase = presentValue(supplyPrincipal, marketAccounting.baseSupplyIndex);
      const repayBase = presentValue(repayPrincipal, marketAccounting.baseBorrowIndex);
      const totalBaseSupply = supplyBase + repayBase;

      const interaction = await createTransferBaseInteraction(context, market, null, toPosition, totalBaseSupply, event);

      toPositionAccounting.cumulativeBaseSupplied = toPositionAccounting.cumulativeBaseSupplied + interaction.amount;
      toPositionAccounting.cumulativeBaseSuppliedUsd = toPositionAccounting.cumulativeBaseSuppliedUsd.plus(
        interaction.amountUsd,
      );

      context.PositionAccounting.set({ ...toPositionAccounting });

      await createPositionAccountingSnapshot(context, toPositionAccounting, event); // Manually retrigger snapshot

      await updateUsageMetrics(context, toAccount, market, InteractionType.TRANSFER_BASE, event);
    }

    context.MarketAccounting.set({ ...marketAccounting });
  },
);
