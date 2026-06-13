/**
 * Port of src/sushiswap/factory.ts (SushiswapFactory data source + SushiswapPair
 * template handlers): handleNewSushiswapPair / handleSwapSushiswap /
 * handleUpdateSushiswap.
 *
 * Template-registration deviation (see MIGRATION.md): the original calls
 * `SushiswapPairTemplate.create(pair)` only for OT markets (when token0 or
 * token1 is an OT token, i.e. Token.type == "ot"). HyperIndex's
 * `contractRegister` cannot read entities, so OT-ness cannot be tested there.
 * We register every Sushiswap PairCreated pair and instead guard the
 * SushiswapPair template handlers with a `SushiswapPair.get` existence check
 * (non-OT pairs have no SushiswapPair entity and are skipped). The persisted
 * entity set is identical to the original; only the set of *registered*
 * contracts is a superset.
 */
import { indexer, type SushiswapPair } from "envio";
import {
  ERROR_COMPOUND_SUSHISWAP_PAIR,
  ONE_HOUR,
  ZERO_BD,
  convertTokenToDecimal,
  low,
} from "../utils";
import { getUniswapTokenPrice } from "../services/pricing";
import { isOwnershipToken, updateSushiswapPair } from "../services/liquidity-mining";
import { loadToken } from "../services/tokens";

// Register every Sushiswap pair (see header note). OT detection / entity
// creation happens in the onEvent handler below.
indexer.contractRegister({ contract: "SushiswapFactory", event: "PairCreated" }, async ({ event, context }) => {
  if (low(event.params.pair) === ERROR_COMPOUND_SUSHISWAP_PAIR) return;
  context.chain.SushiswapPair.add(event.params.pair);
});

indexer.onEvent({ contract: "SushiswapFactory", event: "PairCreated" }, async ({ event, context }) => {
  const block = event.block.number;
  // skip error compound pair
  if (low(event.params.pair) == ERROR_COMPOUND_SUSHISWAP_PAIR) return;

  let id = "";
  let baseToken = "";
  if (await isOwnershipToken(context, low(event.params.token0))) {
    id = low(event.params.token0);
    baseToken = low(event.params.token1);
  }
  if (await isOwnershipToken(context, low(event.params.token1))) {
    id = low(event.params.token1);
    baseToken = low(event.params.token0);
  }
  if (id != "") {
    // OT Market found
    const otMarket: SushiswapPair = {
      id: low(event.params.pair),
      otToken_id: id,
      baseToken_id: baseToken,
      isOtToken0: await isOwnershipToken(context, low(event.params.token0)),
      totalTradingUSD: ZERO_BD,
      marketWorthUSD: undefined,
      baseTokenBalance: undefined,
      baseTokenPrice: undefined,
      otBalance: undefined,
      otPrice: undefined,
      totalStaked: undefined,
      totalReward: undefined,
      lpPrice: undefined,
      aprPercentage: undefined,
      updatedAt: undefined,
    };
    context.SushiswapPair.set(otMarket);
    await updateSushiswapPair(context, block, low(event.params.pair), BigInt(event.block.timestamp));
  }
});

indexer.onEvent({ contract: "SushiswapPair", event: "Swap" }, async ({ event, context }) => {
  const block = event.block.number;
  // guard: only OT pairs have a SushiswapPair entity (see header note)
  const exists = await context.SushiswapPair.get(low(event.srcAddress));
  if (exists === undefined) return;

  const pair = await updateSushiswapPair(context, block, low(event.srcAddress), BigInt(event.block.timestamp));
  const baseToken = await loadToken(context, pair.baseToken_id, block);

  let tradingValue = ZERO_BD;
  if (pair.isOtToken0) {
    tradingValue = convertTokenToDecimal(event.params.amount1In + event.params.amount1Out, baseToken.decimals);
  } else {
    tradingValue = convertTokenToDecimal(event.params.amount0In + event.params.amount0Out, baseToken.decimals);
  }
  tradingValue = tradingValue.times(await getUniswapTokenPrice(context, block, baseToken));

  const timestamp = Number(event.block.timestamp);
  const hourID = Math.floor(timestamp / ONE_HOUR);
  const hourStartUnix = hourID * ONE_HOUR;
  const hourPairID = pair.id.concat("-").concat(hourID.toString());

  let sushiswapPairHourData = await context.SushiswapPairHourData.get(hourPairID);
  if (sushiswapPairHourData === undefined) {
    sushiswapPairHourData = {
      id: hourPairID,
      otAddress: pair.id,
      tradingVolumeUSD: ZERO_BD,
      hourStartUnix,
    };
  }

  context.SushiswapPair.set({ ...pair, totalTradingUSD: pair.totalTradingUSD.plus(tradingValue) });
  context.SushiswapPairHourData.set({
    ...sushiswapPairHourData,
    tradingVolumeUSD: sushiswapPairHourData.tradingVolumeUSD.plus(tradingValue),
  });
});

indexer.onEvent({ contract: "SushiswapPair", event: "Mint" }, async ({ event, context }) => {
  const exists = await context.SushiswapPair.get(low(event.srcAddress));
  if (exists === undefined) return;
  await updateSushiswapPair(context, event.block.number, low(event.srcAddress), BigInt(event.block.timestamp));
});

indexer.onEvent({ contract: "SushiswapPair", event: "Burn" }, async ({ event, context }) => {
  const exists = await context.SushiswapPair.get(low(event.srcAddress));
  if (exists === undefined) return;
  await updateSushiswapPair(context, event.block.number, low(event.srcAddress), BigInt(event.block.timestamp));
});
