/**
 * IsolatedPair handlers — port of the `IsolatedPair:*` indexing functions in
 * the Ponder source. Each row's `pair` is `event.transaction.to` (the Ponder
 * code uses `event.transaction.to || "0xNEW"`), and the price comes from the
 * isolated pair's `exchangeRateInfo().highExchangeRate`, pinned to the event
 * block. Oracle-read failures are swallowed into a null price (try/catch in the
 * Ponder source).
 *
 * Ponder stores these addresses as-is (lowercase). The `"0xNEW"` sentinel is
 * preserved verbatim (no lowercasing) for data parity.
 */
import { indexer } from "envio";
import { logId, low } from "../common/ids";
import { getIsolatedOraclePrice } from "../effects/contracts";

const SENTINEL = "0xNEW";

/** `event.transaction.to || "0xNEW"`, lowercased only when a real address. */
function pairOf(to: string | undefined): string {
  return to ? low(to) : SENTINEL;
}

async function priceFor(
  effect: Parameters<typeof getIsolatedOraclePrice>[0],
  pair: string,
  block: number,
): Promise<bigint | undefined> {
  if (pair === SENTINEL) return undefined;
  return getIsolatedOraclePrice(effect, pair, block);
}

indexer.onEvent({ contract: "IsolatedPair", event: "BorrowAsset" }, async ({ event, context }) => {
  const pair = pairOf(event.transaction.to);
  const price = await priceFor(context.effect, pair, event.block.number);
  context.BorrowAssetIsolated.set({
    id: logId(event),
    txHash: event.transaction.hash,
    pair,
    borrower: low(event.params._borrower),
    receiver: low(event.params._receiver),
    borrowAmount: event.params._borrowAmount,
    sharesAdded: event.params._sharesAdded,
    timestamp: event.block.timestamp,
    price,
  });
});

indexer.onEvent({ contract: "IsolatedPair", event: "RepayAsset" }, async ({ event, context }) => {
  const pair = pairOf(event.transaction.to);
  const price = await priceFor(context.effect, pair, event.block.number);
  context.RepayAssetIsolated.set({
    id: logId(event),
    txHash: event.transaction.hash,
    pair,
    borrower: low(event.params.borrower),
    payer: low(event.params.payer),
    amountToRepay: event.params.amountToRepay,
    shares: event.params.shares,
    timestamp: event.block.timestamp,
    price,
  });
});

indexer.onEvent(
  { contract: "IsolatedPair", event: "AddCollateral" },
  async ({ event, context }) => {
    const pair = pairOf(event.transaction.to);
    const price = await priceFor(context.effect, pair, event.block.number);
    context.AddCollateralIsolated.set({
      id: logId(event),
      txHash: event.transaction.hash,
      pair,
      borrower: low(event.params.borrower),
      sender: low(event.params.sender),
      collateralAmount: event.params.collateralAmount,
      timestamp: event.block.timestamp,
      price,
    });
  },
);

indexer.onEvent(
  { contract: "IsolatedPair", event: "RemoveCollateral" },
  async ({ event, context }) => {
    const pair = pairOf(event.transaction.to);
    const price = await priceFor(context.effect, pair, event.block.number);
    context.RemoveCollateralIsolated.set({
      id: logId(event),
      txHash: event.transaction.hash,
      pair,
      receiver: low(event.params._receiver),
      sender: low(event.params._sender),
      borrower: low(event.params._borrower),
      collateralAmount: event.params._collateralAmount,
      timestamp: event.block.timestamp,
      price,
    });
  },
);

indexer.onEvent({ contract: "IsolatedPair", event: "Liquidate" }, async ({ event, context }) => {
  const pair = pairOf(event.transaction.to);
  const price = await priceFor(context.effect, pair, event.block.number);
  context.LiquidateIsolated.set({
    id: logId(event),
    txHash: event.transaction.hash,
    pair,
    borrower: low(event.params._borrower),
    // Ponder uses event.transaction.from for the liquidator.
    liquidator: event.transaction.from ? low(event.transaction.from) : undefined,
    collateralForLiquidator: event.params._collateralForLiquidator,
    sharesToLiquidate: event.params._sharesToLiquidate,
    amountLiquidatorToRepay: event.params._amountLiquidatorToRepay,
    feesAmount: event.params._feesAmount,
    sharesToAdjust: event.params._sharesToAdjust,
    amountToAdjust: event.params._amountToAdjust,
    timestamp: event.block.timestamp,
    price,
  });
});

indexer.onEvent({ contract: "IsolatedPair", event: "Deposit" }, async ({ event, context }) => {
  const pair = pairOf(event.transaction.to);
  const price = await priceFor(context.effect, pair, event.block.number);
  context.DepositIsolated.set({
    id: logId(event),
    txHash: event.transaction.hash,
    pair,
    caller: low(event.params.caller),
    owner: low(event.params.owner),
    assets: event.params.assets,
    shares: event.params.shares,
    timestamp: event.block.timestamp,
    price,
  });
});

indexer.onEvent({ contract: "IsolatedPair", event: "Withdraw" }, async ({ event, context }) => {
  const pair = pairOf(event.transaction.to);
  const price = await priceFor(context.effect, pair, event.block.number);
  context.WithdrawIsolated.set({
    id: logId(event),
    txHash: event.transaction.hash,
    pair,
    caller: low(event.params.caller),
    owner: low(event.params.owner),
    receiver: low(event.params.receiver),
    assets: event.params.assets,
    shares: event.params.shares,
    timestamp: event.block.timestamp,
    price,
  });
});
