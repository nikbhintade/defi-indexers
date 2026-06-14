/**
 * Port of mappings/factory.ts (handleNewPair).
 *
 * `PairTemplate.create(event.params.pair)` maps to `indexer.contractRegister`
 * adding the address to the Pair contract.
 *
 * Whitelist tracking: when the *other* token of the new pair is a whitelist
 * token, the pair address is pushed onto this token's `whitelist` array — this
 * is exactly what findEthPerToken later iterates (no Factory.getPair eth_call).
 */
import { indexer, type Token } from "envio";
import { FACTORY_ADDRESS, low, ZERO_BD, ZERO_BI } from "../utils";
import { isOnBlacklist, isOnWhitelist } from "../pricing";
import {
  fetchTokenDecimals,
  fetchTokenName,
  fetchTokenSymbol,
  fetchTokenTotalSupply,
} from "../services/tokens";

indexer.contractRegister(
  { contract: "Factory", event: "PairCreated" },
  async ({ event, context }) => {
    context.chain.Pair.add(event.params.pair);
  },
);

indexer.onEvent(
  { contract: "Factory", event: "PairCreated" },
  async ({ event, context }) => {
    let factory = await context.UniswapFactory.get(FACTORY_ADDRESS);
    if (factory === undefined) {
      factory = {
        id: FACTORY_ADDRESS,
        pairCount: 0,
        totalVolumeETH: ZERO_BD,
        totalLiquidityETH: ZERO_BD,
        totalVolumeUSD: ZERO_BD,
        untrackedVolumeUSD: ZERO_BD,
        totalLiquidityUSD: ZERO_BD,
        txCount: ZERO_BI,
      };

      context.Bundle.set({ id: "1", ethPrice: ZERO_BD });
    }
    factory = { ...factory, pairCount: factory.pairCount + 1 };
    context.UniswapFactory.set(factory);

    const pairId = low(event.params.pair);

    const token0Id = low(event.params.token0);
    let token0 = await context.Token.get(token0Id);
    if (token0 === undefined) {
      // original bails on blacklist before any metadata fetch
      if (isOnBlacklist(token0Id)) {
        return;
      }
      // original quirk: fetchTokenDecimals never actually returns null (a
      // reverted decimals() call coerces to 0), so the original's
      // `if (decimals === null) return` branch is unreachable and not ported.
      token0 = {
        id: token0Id,
        symbol: await fetchTokenSymbol(context.effect, token0Id),
        name: await fetchTokenName(context.effect, token0Id),
        totalSupply: await fetchTokenTotalSupply(context.effect, token0Id),
        decimals: await fetchTokenDecimals(context.effect, token0Id),
        derivedETH: ZERO_BD,
        tradeVolume: ZERO_BD,
        tradeVolumeUSD: ZERO_BD,
        untrackedVolumeUSD: ZERO_BD,
        totalLiquidity: ZERO_BD,
        whitelist: [],
        txCount: ZERO_BI,
      } satisfies Token;
    }

    const token1Id = low(event.params.token1);
    let token1 = await context.Token.get(token1Id);
    if (token1 === undefined) {
      if (isOnBlacklist(token1Id)) {
        return;
      }
      token1 = {
        id: token1Id,
        symbol: await fetchTokenSymbol(context.effect, token1Id),
        name: await fetchTokenName(context.effect, token1Id),
        totalSupply: await fetchTokenTotalSupply(context.effect, token1Id),
        decimals: await fetchTokenDecimals(context.effect, token1Id),
        derivedETH: ZERO_BD,
        tradeVolume: ZERO_BD,
        tradeVolumeUSD: ZERO_BD,
        untrackedVolumeUSD: ZERO_BD,
        totalLiquidity: ZERO_BD,
        whitelist: [],
        txCount: ZERO_BI,
      } satisfies Token;
    }

    // whitelist tracking: push the pair onto the partner token's list when the
    // other side is a whitelist token (mirrors mappings/factory.ts).
    if (isOnWhitelist(token1.id)) {
      token0 = { ...token0, whitelist: token0.whitelist.concat([pairId]) };
    }
    if (isOnWhitelist(token0.id)) {
      token1 = { ...token1, whitelist: token1.whitelist.concat([pairId]) };
    }

    context.Token.set(token0);
    context.Token.set(token1);

    context.Pair.set({
      id: pairId,
      token0_id: token0.id,
      token1_id: token1.id,
      liquidityProviderCount: ZERO_BI,
      createdAtTimestamp: BigInt(event.block.timestamp),
      createdAtBlockNumber: BigInt(event.block.number),
      txCount: ZERO_BI,
      reserve0: ZERO_BD,
      reserve1: ZERO_BD,
      trackedReserveETH: ZERO_BD,
      reserveETH: ZERO_BD,
      reserveUSD: ZERO_BD,
      totalSupply: ZERO_BD,
      volumeToken0: ZERO_BD,
      volumeToken1: ZERO_BD,
      volumeUSD: ZERO_BD,
      untrackedVolumeUSD: ZERO_BD,
      token0Price: ZERO_BD,
      token1Price: ZERO_BD,
    });
  },
);
