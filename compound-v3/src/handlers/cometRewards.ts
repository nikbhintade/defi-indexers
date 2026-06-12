/**
 * Port of src/mappings/cometRewards.ts.
 *
 * `account.positions.load()` (derived loader) maps to
 * `context.Position.getWhere({ account_id: { _eq: ... } })` (Position.account
 * carries @index in schema.graphql).
 */
import { indexer, type Position } from "envio";
import { ZERO_BD, ZERO_BI } from "../common/constants";
import { low } from "../common/utils";
import { getOrCreateAccount } from "../mappingHelpers/account";
import { createClaimRewardsInteraction } from "../mappingHelpers/interaction";
import {
  getOrCreateMarket,
  getOrCreateMarketAccounting,
  getOrCreateMarketConfiguration,
  updateMarketAccounting,
} from "../mappingHelpers/market";
import {
  createPositionAccountingSnapshot,
  getOrCreatePositionAccounting,
  updatePositionAccounting,
} from "../mappingHelpers/position";
import { getOrCreateToken } from "../mappingHelpers/token";

indexer.onEvent(
  { contract: "CometRewards", event: "RewardClaimed" },
  async ({ event, context }) => {
    const accountAddress = low(event.params.src);
    const tokenAddress = low(event.params.token);
    const destination = low(event.params.recipient);
    const amount = event.params.amount;

    const account = await getOrCreateAccount(context, accountAddress, event);
    const token = await getOrCreateToken(context, tokenAddress, event);

    // infer position, this won't work if there are multiple rewards being claimed in 1 transaction
    // This happens when using the bulker, or a contract another contract is calling multiple claims (ex. smart wallet or vault)
    let positionClaimed: Position | null = null;
    let numberPositionsFound = 0;
    const positions = await context.Position.getWhere({ account_id: { _eq: account.id } });
    for (let i = 0; i < positions.length; i++) {
      const position = positions[i]!;
      const positionAccounting = await getOrCreatePositionAccounting(context, position, event);
      const market = await getOrCreateMarket(context, position.market_id, event);
      const marketAccounting = await getOrCreateMarketAccounting(context, market, event);
      const marketConfig = await getOrCreateMarketConfiguration(context, market, event);

      await updateMarketAccounting(context, market, marketAccounting, event);
      await updatePositionAccounting(context, position, positionAccounting, event);

      if (
        (marketConfig.baseTrackingSupplySpeed !== ZERO_BI &&
          positionAccounting.baseTrackingIndex === marketAccounting.trackingSupplyIndex) ||
        (marketConfig.baseTrackingBorrowSpeed !== ZERO_BI &&
          positionAccounting.baseTrackingIndex === marketAccounting.trackingBorrowIndex)
      ) {
        numberPositionsFound = numberPositionsFound + 1;
        positionClaimed = position;
      }

      context.MarketAccounting.set({ ...marketAccounting });
      // Don't save position accounting since this could make a useless snapshot
    }

    if (numberPositionsFound > 1) {
      positionClaimed = null;
    }

    const interaction = await createClaimRewardsInteraction(
      context,
      account,
      positionClaimed,
      destination,
      token,
      amount,
      event,
    );
    const transaction = await context.Transaction.getOrThrow(interaction.transaction_id);

    if (numberPositionsFound > 1) {
      context.log.warn(
        `handleRewardClaimed - multiple positions inferred, ignoring, ${numberPositionsFound} - ${event.transaction.hash}`,
      );
    } else if (!positionClaimed) {
      context.log.warn(`handleRewardClaimed - no position found for claim ${event.transaction.hash}`);
    } else {
      const positionAccounting = await getOrCreatePositionAccounting(context, positionClaimed, event);

      await updatePositionAccounting(context, positionClaimed, positionAccounting, event);
      positionAccounting.cumulativeRewardsClaimed = positionAccounting.cumulativeRewardsClaimed + interaction.amount;
      positionAccounting.cumulativeRewardsClaimedUsd = positionAccounting.cumulativeRewardsClaimedUsd.plus(
        interaction.amountUsd,
      );
      positionAccounting.cumulativeGasUsedWei = positionAccounting.cumulativeGasUsedWei + (transaction.gasUsed ?? ZERO_BI);
      positionAccounting.cumulativeGasUsedUsd = positionAccounting.cumulativeGasUsedUsd.plus(
        transaction.gasUsedUsd ?? ZERO_BD,
      );
      context.PositionAccounting.set({ ...positionAccounting });

      await createPositionAccountingSnapshot(context, positionAccounting, event); // Manually update snapshot
    }
  },
);
