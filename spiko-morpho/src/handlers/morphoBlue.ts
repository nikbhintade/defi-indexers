/**
 * Port of src/morpho-blue.ts (MorphoBlue mainnet data source handlers).
 */
import { indexer } from "envio";
import { getMarket, createMarket, getZeroMarket } from "../initializers/markets";
import { getProtocol } from "../initializers/protocol";
import { getOrCreateAccount } from "../sdk/account";
import {
  BIGDECIMAL_WAD,
  BIGINT_WAD,
  INT_ONE,
  PositionSide,
  toBD,
} from "../sdk/constants";
import {
  createDataManager,
  createBorrow,
  createDeposit,
  createDepositCollateral,
  createFlashloan,
  createLiquidate,
  createRepay,
  createWithdraw,
  createWithdrawCollateral,
  updateMarketAndProtocolData,
} from "../sdk/manager";
import {
  addBorrowPosition,
  addCollateralPosition,
  addSupplyPosition,
  getCurrentPosition,
  reduceBorrowPosition,
  reduceCollateralPosition,
  reduceSupplyPosition,
} from "../sdk/position";
import { getAmountUSD, getOrCreateToken } from "../sdk/token";
import type { BadDebtRealization } from "envio";
import { low } from "../utils/graphBytes";
import { normEvent } from "../context";

indexer.onEvent(
  { contract: "MorphoBlue", event: "AccrueInterest" },
  async ({ event, context }) => {
    const ev = normEvent(event);
    const id = low(event.params.id);
    const market = await getMarket(context, id);
    const totalBorrow = market.totalBorrow + event.params.interest;
    const updated = {
      ...market,
      interest: market.interest + event.params.interest,
      totalSupply: market.totalSupply + event.params.interest,
      totalBorrow,
      variableBorrowedTokenBalance: totalBorrow,
      inputTokenBalance: market.totalSupply + event.params.interest,
      totalSupplyShares: market.totalSupplyShares + event.params.feeShares,
      lastUpdate: ev.block.timestamp,
    };
    context.Market.set(updated);

    if (event.params.feeShares > 0n) {
      const protocol = await getProtocol(context);
      const feeRecipientAccount = await getOrCreateAccount(
        context,
        protocol.feeRecipient,
      );
      const feeAmount = (event.params.interest * market.fee) / BIGINT_WAD;
      await addSupplyPosition(
        context,
        feeRecipientAccount,
        updated,
        ev,
        event.params.feeShares,
        feeAmount,
      );
    }
  },
);

indexer.onEvent(
  { contract: "MorphoBlue", event: "Borrow" },
  async ({ event, context }) => {
    const ev = normEvent(event);
    const id = low(event.params.id);
    const market = await getMarket(context, id);
    const account = await getOrCreateAccount(context, event.params.onBehalf);

    const position = await addBorrowPosition(
      context,
      account,
      market,
      ev,
      event.params.shares,
    );

    context.Market.set({
      ...(await getMarket(context, id)),
      totalBorrow: market.totalBorrow + event.params.assets,
      totalBorrowShares: market.totalBorrowShares + event.params.shares,
    });

    const dm = await createDataManager(context, id, ev);
    await createBorrow(context, dm, position, event.params.assets, event.params.shares);
    await updateMarketAndProtocolData(context, dm);
  },
);

indexer.onEvent(
  { contract: "MorphoBlue", event: "CreateMarket" },
  async ({ event, context }) => {
    const ev = normEvent(event);
    await createMarket(
      context,
      low(event.params.id),
      {
        loanToken: event.params.marketParams.loanToken,
        collateralToken: event.params.marketParams.collateralToken,
        oracle: event.params.marketParams.oracle,
        irm: event.params.marketParams.irm,
        lltv: event.params.marketParams.lltv,
      },
      ev.block,
    );
  },
);

indexer.onEvent(
  { contract: "MorphoBlue", event: "EnableIrm" },
  async ({ event, context }) => {
    const protocol = await getProtocol(context);
    context.LendingProtocol.set({
      ...protocol,
      irmEnabled: [...protocol.irmEnabled, low(event.params.irm)],
    });
  },
);

indexer.onEvent(
  { contract: "MorphoBlue", event: "EnableLltv" },
  async ({ event, context }) => {
    const protocol = await getProtocol(context);
    context.LendingProtocol.set({
      ...protocol,
      lltvEnabled: [...protocol.lltvEnabled, event.params.lltv],
    });
  },
);

indexer.onEvent(
  { contract: "MorphoBlue", event: "FlashLoan" },
  async ({ event, context }) => {
    const ev = normEvent(event);
    const market = await getZeroMarket(context, ev.block);
    const dm = await createDataManager(context, market.id, ev);
    await createFlashloan(
      context,
      dm,
      low(event.params.token),
      low(event.params.caller),
      event.params.assets,
    );
  },
);

indexer.onEvent(
  { contract: "MorphoBlue", event: "IncrementNonce" },
  async () => {},
);

indexer.onEvent(
  { contract: "MorphoBlue", event: "Liquidate" },
  async ({ event, context }) => {
    const ev = normEvent(event);
    const id = low(event.params.id);
    const market = await getMarket(context, id);
    context.Market.set({
      ...market,
      totalCollateral: market.totalCollateral - event.params.seizedAssets,
    });

    const liquidatorAccount = await getOrCreateAccount(context, event.params.caller);
    context.Account.set({
      ...liquidatorAccount,
      liquidationCount: liquidatorAccount.liquidationCount + INT_ONE,
    });

    const account = await getOrCreateAccount(context, event.params.borrower);
    context.Account.set({
      ...account,
      liquidateCount: account.liquidateCount + INT_ONE,
    });

    const freshAccount = await getOrCreateAccount(context, event.params.borrower);
    // reduce borrow position counting bad debt shares as repaid by suppliers
    const marketForPos = await getMarket(context, id);
    await reduceBorrowPosition(
      context,
      freshAccount,
      marketForPos,
      ev,
      event.params.repaidShares + event.params.badDebtShares,
    );

    const borrowPosition = await getCurrentPosition(
      context,
      low(event.params.borrower),
      id,
      PositionSide.BORROWER,
    );
    const collateralPosition = await getCurrentPosition(
      context,
      low(event.params.borrower),
      id,
      PositionSide.COLLATERAL,
    );

    const dm = await createDataManager(context, id, ev);
    const liquidate = await createLiquidate(
      context,
      dm,
      low(event.params.caller),
      borrowPosition!,
      collateralPosition!,
      event.params.repaidAssets,
      event.params.seizedAssets,
    );

    const collAccount = await getOrCreateAccount(context, event.params.borrower);
    await reduceCollateralPosition(
      context,
      collAccount,
      await getMarket(context, id),
      ev,
      event.params.seizedAssets,
    );

    let m = await getMarket(context, id);
    m = {
      ...m,
      totalBorrow: m.totalBorrow - event.params.repaidAssets,
      totalBorrowShares:
        m.totalBorrowShares -
        event.params.repaidShares -
        event.params.badDebtShares,
    };
    if (event.params.badDebtShares > 0n) {
      m = {
        ...m,
        totalSupply: m.totalSupply - event.params.badDebtAssets,
        totalBorrow: m.totalBorrow - event.params.badDebtAssets,
      };
      const loanToken = await getOrCreateToken(context, m.borrowedToken_id);
      const badDebtRealization: BadDebtRealization = {
        id: liquidate.id,
        liquidation_id: liquidate.id,
        market_id: m.id,
        badDebt: event.params.badDebtAssets,
        badDebtUSD: getAmountUSD(loanToken, event.params.badDebtAssets),
      };
      context.BadDebtRealization.set(badDebtRealization);
    }
    context.Market.set(m);
    dm.market = m;

    await updateMarketAndProtocolData(context, dm);
  },
);

indexer.onEvent(
  { contract: "MorphoBlue", event: "Repay" },
  async ({ event, context }) => {
    const ev = normEvent(event);
    const id = low(event.params.id);
    const market = await getMarket(context, id);
    const account = await getOrCreateAccount(context, event.params.onBehalf);

    const position = await reduceBorrowPosition(
      context,
      account,
      market,
      ev,
      event.params.shares,
    );

    context.Market.set({
      ...(await getMarket(context, id)),
      totalBorrow: market.totalBorrow - event.params.assets,
      totalBorrowShares: market.totalBorrowShares - event.params.shares,
    });

    const dm = await createDataManager(context, id, ev);
    await createRepay(context, dm, position, event.params.assets, event.params.shares);
    await updateMarketAndProtocolData(context, dm);
  },
);

indexer.onEvent(
  { contract: "MorphoBlue", event: "SetAuthorization" },
  async () => {},
);

indexer.onEvent(
  { contract: "MorphoBlue", event: "SetFee" },
  async ({ event, context }) => {
    const market = await getMarket(context, low(event.params.id));
    context.Market.set({
      ...market,
      fee: event.params.newFee,
      reserveFactor: toBD(event.params.newFee).div(BIGDECIMAL_WAD),
    });
  },
);

indexer.onEvent(
  { contract: "MorphoBlue", event: "SetFeeRecipient" },
  async ({ event, context }) => {
    const protocol = await getProtocol(context);
    context.LendingProtocol.set({
      ...protocol,
      feeRecipient: low(event.params.newFeeRecipient),
    });
  },
);

indexer.onEvent(
  { contract: "MorphoBlue", event: "SetOwner" },
  async ({ event, context }) => {
    const protocol = await getProtocol(context);
    context.LendingProtocol.set({
      ...protocol,
      owner: low(event.params.newOwner),
    });
  },
);

indexer.onEvent(
  { contract: "MorphoBlue", event: "Supply" },
  async ({ event, context }) => {
    const ev = normEvent(event);
    const id = low(event.params.id);
    const market = await getMarket(context, id);
    const account = await getOrCreateAccount(context, event.params.onBehalf);

    const position = await addSupplyPosition(
      context,
      account,
      market,
      ev,
      event.params.shares,
      event.params.assets,
    );

    context.Market.set({
      ...(await getMarket(context, id)),
      totalSupply: market.totalSupply + event.params.assets,
      totalSupplyShares: market.totalSupplyShares + event.params.shares,
    });

    const dm = await createDataManager(context, id, ev);
    await createDeposit(context, dm, position, event.params.assets, event.params.shares);
    await updateMarketAndProtocolData(context, dm);
  },
);

indexer.onEvent(
  { contract: "MorphoBlue", event: "SupplyCollateral" },
  async ({ event, context }) => {
    const ev = normEvent(event);
    const id = low(event.params.id);
    const market = await getMarket(context, id);
    context.Market.set({
      ...market,
      totalCollateral: market.totalCollateral + event.params.assets,
    });

    const account = await getOrCreateAccount(context, event.params.onBehalf);
    const position = await addCollateralPosition(
      context,
      account,
      await getMarket(context, id),
      ev,
      event.params.assets,
    );

    const dm = await createDataManager(context, id, ev);
    await createDepositCollateral(context, dm, position, event.params.assets);
    await updateMarketAndProtocolData(context, dm);
  },
);

indexer.onEvent(
  { contract: "MorphoBlue", event: "Withdraw" },
  async ({ event, context }) => {
    const ev = normEvent(event);
    const id = low(event.params.id);
    const market = await getMarket(context, id);
    const account = await getOrCreateAccount(context, event.params.onBehalf);

    const position = await reduceSupplyPosition(
      context,
      account,
      market,
      ev,
      event.params.shares,
      event.params.assets,
    );

    context.Market.set({
      ...(await getMarket(context, id)),
      totalSupply: market.totalSupply - event.params.assets,
      totalSupplyShares: market.totalSupplyShares - event.params.shares,
    });

    const dm = await createDataManager(context, id, ev);
    await createWithdraw(context, dm, position, event.params.assets, event.params.shares);
    await updateMarketAndProtocolData(context, dm);
  },
);

indexer.onEvent(
  { contract: "MorphoBlue", event: "WithdrawCollateral" },
  async ({ event, context }) => {
    const ev = normEvent(event);
    const id = low(event.params.id);
    const market = await getMarket(context, id);
    context.Market.set({
      ...market,
      totalCollateral: market.totalCollateral - event.params.assets,
    });

    const account = await getOrCreateAccount(context, event.params.onBehalf);
    const position = await reduceCollateralPosition(
      context,
      account,
      await getMarket(context, id),
      ev,
      event.params.assets,
    );

    const dm = await createDataManager(context, id, ev);
    await createWithdrawCollateral(context, dm, position, event.params.assets);
    await updateMarketAndProtocolData(context, dm);
  },
);
