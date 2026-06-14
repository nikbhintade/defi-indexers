/**
 * Ported from liquity/dev packages/subgraph/src/mappings/LqtyStake.ts.
 * Data source: LQTYStaking contract.
 */
import { indexer } from "envio";

import { updateStake, withdrawStakeGains } from "../entities/LqtyStake";

indexer.onEvent(
  { contract: "LQTYStaking", event: "StakeChanged" },
  async ({ event, context }) => {
    await updateStake(context, event, event.params.staker, event.params.newStake);
  },
);

indexer.onEvent(
  { contract: "LQTYStaking", event: "StakingGainsWithdrawn" },
  async ({ event, context }) => {
    await withdrawStakeGains(
      context,
      event,
      event.params.staker,
      event.params.LUSDGain,
      event.params.ETHGain,
    );
  },
);
