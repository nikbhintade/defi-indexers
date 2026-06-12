/**
 * Port of the mainnet rebase mappings:
 * - src/services/rebase/mappingUsdn.ts (USDN Reward)
 * - src/services/rebase/mappingAeth.ts (AETH RatioUpdate)
 * - src/services/rebase/mappingLido.ts (Lido TokenRebased)
 */
import { BigDecimal, indexer } from "envio";
import { low, toBigDecimal } from "../utils";
import { DAY, getIntervalFromTimestamp } from "../utils/time";
import { BIG_DECIMAL_ZERO, BIG_INT_ZERO } from "../constants";
import { erc20TotalSupply } from "../effects/contracts";

// We need to keep track of USDN rewards to compute the rebase APR
// because all the contract's variables are private and the graph does not
// yet support getStorageAt calls.
indexer.onEvent({ contract: "USDN", event: "Reward" }, async ({ event, context }) => {
  const token = low(event.srcAddress);
  const totalSupplyResult = await erc20TotalSupply(context.effect, token, event.block.number);
  const totalSupply = totalSupplyResult === null ? BIG_INT_ZERO : totalSupplyResult;
  const preSupply = totalSupply > event.params.amount ? totalSupply - event.params.amount : BIG_INT_ZERO;
  const dailyApr =
    preSupply > BIG_INT_ZERO
      ? toBigDecimal(event.params.amount).div(toBigDecimal(preSupply))
      : BIG_DECIMAL_ZERO;

  const day = getIntervalFromTimestamp(BigInt(event.block.timestamp), DAY);
  const snapshotId = token + "-" + day.toString() + "-rebase";
  context.TokenSnapshot.set({
    id: snapshotId,
    price: dailyApr,
    token,
    timestamp: day,
  });
});

// We need to keep track of AETH ratio to compute the rebase APR
// because all the contract's variables are private and the graph does not
// yet support getStorageAt calls.
indexer.onEvent({ contract: "AETH", event: "RatioUpdate" }, async ({ event, context }) => {
  const token = low(event.srcAddress);
  const day = getIntervalFromTimestamp(BigInt(event.block.timestamp), DAY);
  const snapshotId = token + "-" + day.toString() + "-rebase";
  context.TokenSnapshot.set({
    id: snapshotId,
    price: toBigDecimal(event.params.newRatio),
    token,
    timestamp: day,
  });
});

// https://docs.lido.fi/integrations/api#last-lido-apr-for-steth
// V2 APR calculation formula
indexer.onEvent({ contract: "Lido", event: "TokenRebased" }, async ({ event, context }) => {
  const token = low(event.srcAddress);
  const day = getIntervalFromTimestamp(BigInt(event.block.timestamp), DAY);
  const snapshotId = token + "-" + day.toString() + "-rebase";
  const decimals = new BigDecimal("1000000000000000000000000000");
  const preShareRate = toBigDecimal(event.params.preTotalEther)
    .times(decimals)
    .div(toBigDecimal(event.params.preTotalShares));
  const postShareRate = toBigDecimal(event.params.postTotalEther)
    .times(decimals)
    .div(toBigDecimal(event.params.postTotalShares));

  const userAPR = toBigDecimal(DAY)
    .times(postShareRate.minus(preShareRate).div(preShareRate))
    .div(toBigDecimal(event.params.timeElapsed));
  context.TokenSnapshot.set({
    id: snapshotId,
    price: userAPR,
    token,
    timestamp: day,
  });
});
