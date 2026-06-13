/**
 * Port of src/pendle/liquidity-mining-v1.ts and src/pendle/liquidity-mining-v2.ts
 * (PendleLiquidityMiningV1 / PendleLiquidityMiningV2 template handlers).
 *
 * V1 handleStake / handleWithdrawn are no-ops in the source (preserved).
 * The V1 `redeemLpInterests(uint256,address)` callHandler is omitted
 * (HyperIndex has no callHandlers — see MIGRATION.md).
 */
import { indexer } from "envio";
import { PENDLE_TOKEN_ADDRESS, convertTokenToDecimal, low } from "../utils";
import { lm2StakeToken } from "../effects/contracts";
import { loadToken } from "../services/tokens";
import { loadUserMarketData } from "../services/helpers";
import { getPendlePrice } from "../services/pricing";
import { getExpiryMarket, getOtApr, updateMarketLiquidityMiningApr } from "../services/liquidity-mining";

// ---------- PendleLiquidityMiningV1 ----------

indexer.onEvent({ contract: "PendleLiquidityMiningV1", event: "Staked" }, async () => {
  // no-op in the original
});

indexer.onEvent({ contract: "PendleLiquidityMiningV1", event: "Withdrawn" }, async () => {
  // no-op in the original
});

indexer.onEvent({ contract: "PendleLiquidityMiningV1", event: "PendleRewardsSettled" }, async ({ event, context }) => {
  const block = event.block.number;
  const market = await getExpiryMarket(context, block, low(event.srcAddress), event.params.expiry);
  // original getExpiryMarket is non-try and would abort on revert; guard here.
  if (market === null) return;
  const rel = await loadUserMarketData(context, low(event.params.user), market);
  const pendleToken = await loadToken(context, PENDLE_TOKEN_ADDRESS, block);
  const amount = convertTokenToDecimal(event.params.amount, pendleToken.decimals);
  const pendleRewardReceivedRaw = rel.pendleRewardReceivedRaw.plus(amount);
  context.UserMarketData.set({
    ...rel,
    pendleRewardReceivedRaw,
    pendleRewardReceivedUSD: pendleRewardReceivedRaw.times(await getPendlePrice(context, block)),
  });
});

// ---------- PendleLiquidityMiningV2 ----------

indexer.onEvent({ contract: "PendleLiquidityMiningV2", event: "Staked" }, async ({ event, context }) => {
  await handleLmV2(context, event.srcAddress, event.block.number, BigInt(event.block.timestamp));
});

indexer.onEvent({ contract: "PendleLiquidityMiningV2", event: "Withdrawn" }, async ({ event, context }) => {
  await handleLmV2(context, event.srcAddress, event.block.number, BigInt(event.block.timestamp));
});

async function handleLmV2(
  context: Parameters<Parameters<typeof indexer.onEvent>[1]>[0]["context"],
  lmAddress: string,
  block: number,
  timestamp: bigint,
): Promise<void> {
  const poolAddress = (await lm2StakeToken(context.effect, low(lmAddress))) ?? "";
  const otpair = await context.SushiswapPair.get(low(poolAddress));
  const ytpair = await context.Pair.get(low(poolAddress));
  if (otpair !== undefined) await getOtApr(context, block, otpair, timestamp);
  if (ytpair !== undefined) await updateMarketLiquidityMiningApr(context, block, timestamp, ytpair);
}
