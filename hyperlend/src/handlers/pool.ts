/**
 * CorePool handlers — 1:1 port of the `CorePool:*` indexing functions in the
 * Ponder `src/index.ts`. Each handler inserts a single event-record row keyed by
 * the Ponder log id (block.hash-logIndex).
 *
 * Ponder mapping notes:
 *   event.args.*        -> event.params.*
 *   event.log.id        -> logId(event)  (block.hash-logIndex)
 *   event.log.address   -> event.srcAddress  (the pool address)
 *   event.transaction.hash -> event.transaction.hash
 *   getOraclePrice(reserve) -> oracle eth_call effect, pinned to event block.
 *
 * Ponder stores lowercase hex; HyperIndex delivers checksummed addresses, so all
 * address values are lowercased for data parity.
 */
import { indexer } from "envio";
import { logId, low } from "../common/ids";
import { getOraclePrice } from "../effects/contracts";

const ts = (event: { block: { timestamp: number } }) => event.block.timestamp;

// Borrow — Ponder swallows oracle errors into a null price.
indexer.onEvent({ contract: "CorePool", event: "Borrow" }, async ({ event, context }) => {
  const price = await getOraclePrice(context.effect, low(event.params.reserve), event.block.number);
  context.Borrow.set({
    id: logId(event),
    txHash: event.transaction.hash,
    pool: low(event.srcAddress),
    reserve: low(event.params.reserve),
    user: low(event.params.user),
    onBehalfOf: low(event.params.onBehalfOf),
    amount: event.params.amount,
    interestRateMode: Number(event.params.interestRateMode),
    borrowRate: event.params.borrowRate,
    referralCode: Number(event.params.referralCode),
    timestamp: ts(event),
    price,
  });
});

indexer.onEvent({ contract: "CorePool", event: "Repay" }, async ({ event, context }) => {
  const price = await getOraclePrice(context.effect, low(event.params.reserve), event.block.number);
  context.Repay.set({
    id: logId(event),
    txHash: event.transaction.hash,
    pool: low(event.srcAddress),
    reserve: low(event.params.reserve),
    user: low(event.params.user),
    repayer: low(event.params.repayer),
    amount: event.params.amount,
    useATokens: event.params.useATokens,
    timestamp: ts(event),
    price,
  });
});

indexer.onEvent({ contract: "CorePool", event: "Supply" }, async ({ event, context }) => {
  const price = await getOraclePrice(context.effect, low(event.params.reserve), event.block.number);
  context.Supply.set({
    id: logId(event),
    txHash: event.transaction.hash,
    pool: low(event.srcAddress),
    reserve: low(event.params.reserve),
    user: low(event.params.user),
    onBehalfOf: low(event.params.onBehalfOf),
    amount: event.params.amount,
    referralCode: Number(event.params.referralCode),
    timestamp: ts(event),
    price,
  });
});

indexer.onEvent({ contract: "CorePool", event: "Withdraw" }, async ({ event, context }) => {
  const price = await getOraclePrice(context.effect, low(event.params.reserve), event.block.number);
  context.Withdraw.set({
    id: logId(event),
    txHash: event.transaction.hash,
    pool: low(event.srcAddress),
    reserve: low(event.params.reserve),
    user: low(event.params.user),
    to: low(event.params.to),
    amount: event.params.amount,
    timestamp: ts(event),
    price,
  });
});

indexer.onEvent({ contract: "CorePool", event: "LiquidationCall" }, async ({ event, context }) => {
  const priceCollateral = await getOraclePrice(
    context.effect,
    low(event.params.collateralAsset),
    event.block.number,
  );
  const priceDebt = await getOraclePrice(
    context.effect,
    low(event.params.debtAsset),
    event.block.number,
  );
  context.LiquidationCall.set({
    id: logId(event),
    txHash: event.transaction.hash,
    pool: low(event.srcAddress),
    collateralAsset: low(event.params.collateralAsset),
    debtAsset: low(event.params.debtAsset),
    user: low(event.params.user),
    debtToCover: event.params.debtToCover,
    liquidatedCollateralAmount: event.params.liquidatedCollateralAmount,
    liquidator: low(event.params.liquidator),
    receiveAToken: event.params.receiveAToken,
    timestamp: ts(event),
    priceCollateral,
    priceDebt,
  });
});

indexer.onEvent({ contract: "CorePool", event: "FlashLoan" }, async ({ event, context }) => {
  const price = await getOraclePrice(context.effect, low(event.params.asset), event.block.number);
  context.FlashLoan.set({
    id: logId(event),
    txHash: event.transaction.hash,
    pool: low(event.srcAddress),
    target: low(event.params.target),
    initiator: low(event.params.initiator),
    asset: low(event.params.asset),
    amount: event.params.amount,
    interestRateMode: Number(event.params.interestRateMode),
    premium: event.params.premium,
    referralCode: Number(event.params.referralCode),
    timestamp: ts(event),
    price,
  });
});

indexer.onEvent(
  { contract: "CorePool", event: "ReserveDataUpdated" },
  async ({ event, context }) => {
    const price = await getOraclePrice(
      context.effect,
      low(event.params.reserve),
      event.block.number,
    );
    context.ReserveDataUpdated.set({
      id: logId(event),
      txHash: event.transaction.hash,
      pool: low(event.srcAddress),
      reserve: low(event.params.reserve),
      liquidityRate: event.params.liquidityRate,
      stableBorrowRate: event.params.stableBorrowRate,
      variableBorrowRate: event.params.variableBorrowRate,
      liquidityIndex: event.params.liquidityIndex,
      variableBorrowIndex: event.params.variableBorrowIndex,
      timestamp: ts(event),
      price,
    });
  },
);

indexer.onEvent(
  { contract: "CorePool", event: "ReserveUsedAsCollateralEnabled" },
  async ({ event, context }) => {
    context.ReserveUsedAsCollateralEnabled.set({
      id: logId(event),
      txHash: event.transaction.hash,
      pool: low(event.srcAddress),
      reserve: low(event.params.reserve),
      user: low(event.params.user),
      timestamp: ts(event),
    });
  },
);

indexer.onEvent(
  { contract: "CorePool", event: "ReserveUsedAsCollateralDisabled" },
  async ({ event, context }) => {
    context.ReserveUsedAsCollateralDisabled.set({
      id: logId(event),
      txHash: event.transaction.hash,
      pool: low(event.srcAddress),
      reserve: low(event.params.reserve),
      user: low(event.params.user),
      timestamp: ts(event),
    });
  },
);

indexer.onEvent(
  { contract: "CorePool", event: "SwapBorrowRateMode" },
  async ({ event, context }) => {
    context.SwapBorrowRateMode.set({
      id: logId(event),
      txHash: event.transaction.hash,
      pool: low(event.srcAddress),
      reserve: low(event.params.reserve),
      user: low(event.params.user),
      interestRateMode: Number(event.params.interestRateMode),
      timestamp: ts(event),
    });
  },
);

indexer.onEvent({ contract: "CorePool", event: "UserEModeSet" }, async ({ event, context }) => {
  context.UserEModeSet.set({
    id: logId(event),
    txHash: event.transaction.hash,
    pool: low(event.srcAddress),
    user: low(event.params.user),
    categoryId: Number(event.params.categoryId),
    timestamp: ts(event),
  });
});

indexer.onEvent(
  { contract: "CorePool", event: "MintedToTreasury" },
  async ({ event, context }) => {
    const price = await getOraclePrice(
      context.effect,
      low(event.params.reserve),
      event.block.number,
    );
    context.MintedToTreasury.set({
      id: logId(event),
      txHash: event.transaction.hash,
      pool: low(event.srcAddress),
      reserve: low(event.params.reserve),
      amountMinted: event.params.amountMinted,
      timestamp: ts(event),
      price,
    });
  },
);

indexer.onEvent({ contract: "CorePool", event: "MintUnbacked" }, async ({ event, context }) => {
  const price = await getOraclePrice(context.effect, low(event.params.reserve), event.block.number);
  context.MintUnbacked.set({
    id: logId(event),
    txHash: event.transaction.hash,
    pool: low(event.srcAddress),
    reserve: low(event.params.reserve),
    user: low(event.params.user),
    onBehalfOf: low(event.params.onBehalfOf),
    amount: event.params.amount,
    referralCode: Number(event.params.referralCode),
    timestamp: ts(event),
    price,
  });
});

indexer.onEvent({ contract: "CorePool", event: "BackUnbacked" }, async ({ event, context }) => {
  const price = await getOraclePrice(context.effect, low(event.params.reserve), event.block.number);
  context.BackUnbacked.set({
    id: logId(event),
    txHash: event.transaction.hash,
    pool: low(event.srcAddress),
    reserve: low(event.params.reserve),
    backer: low(event.params.backer),
    amount: event.params.amount,
    fee: event.params.fee,
    timestamp: ts(event),
    price,
  });
});

indexer.onEvent(
  { contract: "CorePool", event: "RebalanceStableBorrowRate" },
  async ({ event, context }) => {
    context.RebalanceStableBorrowRate.set({
      id: logId(event),
      txHash: event.transaction.hash,
      pool: low(event.srcAddress),
      reserve: low(event.params.reserve),
      user: low(event.params.user),
      timestamp: ts(event),
    });
  },
);

indexer.onEvent(
  { contract: "CorePool", event: "IsolationModeTotalDebtUpdated" },
  async ({ event, context }) => {
    context.IsolationModeTotalDebtUpdated.set({
      id: logId(event),
      txHash: event.transaction.hash,
      pool: low(event.srcAddress),
      asset: low(event.params.asset),
      totalDebt: event.params.totalDebt,
      timestamp: ts(event),
    });
  },
);
