/**
 * Port of src/mappings/comptroller.ts.
 *
 * `CToken.create(event.params.cToken)` (subgraph template instantiation) maps
 * to `indexer.contractRegister` adding the address to the CToken contract.
 */
import { indexer, type Comptroller } from "envio";
import { low, mantissaFactorBD, toBD } from "../utils";
import { createMarket } from "../services/markets";
import { createAccount, updateCommonCTokenStats } from "../services/helpers";

// Dynamically index all new listed tokens
indexer.contractRegister(
  { contract: "Comptroller", event: "MarketListed" },
  async ({ event, context }) => {
    context.chain.CToken.add(event.params.cToken);
  },
);

indexer.onEvent(
  { contract: "Comptroller", event: "MarketListed" },
  async ({ event, context }) => {
    // Create the market for this token, since it's now been listed.
    const market = await createMarket(context, low(event.params.cToken), event.block.number);
    context.Market.set(market);
  },
);

indexer.onEvent(
  { contract: "Comptroller", event: "MarketEntered" },
  async ({ event, context }) => {
    const market = await context.Market.get(low(event.params.cToken));
    // Null check needed to avoid crashing on a new market added.
    if (market != undefined) {
      const accountID = low(event.params.account);
      const account = await context.Account.get(accountID);
      if (account == undefined) {
        createAccount(context, accountID);
      }

      const cTokenStats = await updateCommonCTokenStats(
        context,
        market.id,
        market.symbol,
        accountID,
        low(event.transaction.hash),
        BigInt(event.block.timestamp),
        BigInt(event.block.number),
        BigInt(event.logIndex),
      );
      context.AccountCToken.set({ ...cTokenStats, enteredMarket: true });
    }
  },
);

indexer.onEvent(
  { contract: "Comptroller", event: "MarketExited" },
  async ({ event, context }) => {
    const market = await context.Market.get(low(event.params.cToken));
    // Null check needed to avoid crashing on a new market added.
    if (market != undefined) {
      const accountID = low(event.params.account);
      const account = await context.Account.get(accountID);
      if (account == undefined) {
        createAccount(context, accountID);
      }

      const cTokenStats = await updateCommonCTokenStats(
        context,
        market.id,
        market.symbol,
        accountID,
        low(event.transaction.hash),
        BigInt(event.block.timestamp),
        BigInt(event.block.number),
        BigInt(event.logIndex),
      );
      context.AccountCToken.set({ ...cTokenStats, enteredMarket: false });
    }
  },
);

indexer.onEvent(
  { contract: "Comptroller", event: "NewCloseFactor" },
  async ({ event, context }) => {
    const comptroller = await context.Comptroller.getOrThrow("1");
    context.Comptroller.set({ ...comptroller, closeFactor: event.params.newCloseFactorMantissa });
  },
);

indexer.onEvent(
  { contract: "Comptroller", event: "NewCollateralFactor" },
  async ({ event, context }) => {
    const market = await context.Market.get(low(event.params.cToken));
    // Null check needed to avoid crashing on a new market added.
    if (market != undefined) {
      context.Market.set({
        ...market,
        collateralFactor: toBD(event.params.newCollateralFactorMantissa).div(mantissaFactorBD),
      });
    }
  },
);

// This should be the first event acccording to etherscan but it isn't.... price oracle is. weird
indexer.onEvent(
  { contract: "Comptroller", event: "NewLiquidationIncentive" },
  async ({ event, context }) => {
    const comptroller = await context.Comptroller.getOrThrow("1");
    context.Comptroller.set({
      ...comptroller,
      liquidationIncentive: event.params.newLiquidationIncentiveMantissa,
    });
  },
);

indexer.onEvent(
  { contract: "Comptroller", event: "NewMaxAssets" },
  async ({ event, context }) => {
    const comptroller = await context.Comptroller.getOrThrow("1");
    context.Comptroller.set({ ...comptroller, maxAssets: event.params.newMaxAssets });
  },
);

indexer.onEvent(
  { contract: "Comptroller", event: "NewPriceOracle" },
  async ({ event, context }) => {
    // This is the first event used in this mapping, so we use it to create the entity
    const existing = await context.Comptroller.get("1");
    const comptroller: Comptroller =
      existing ?? {
        id: "1",
        priceOracle: undefined,
        closeFactor: undefined,
        liquidationIncentive: undefined,
        maxAssets: undefined,
      };
    context.Comptroller.set({ ...comptroller, priceOracle: low(event.params.newPriceOracle) });
  },
);
