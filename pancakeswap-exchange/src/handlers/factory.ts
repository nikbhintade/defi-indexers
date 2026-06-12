/**
 * Port of mappings/factory.ts (handlePairCreated).
 *
 * `PairTemplate.create(event.params.pair)` maps to `indexer.contractRegister`
 * adding the address to the Pair contract.
 */
import { indexer, type Token } from "envio";
import { FACTORY_ADDRESS, low, ONE_BI, ZERO_BD, ZERO_BI } from "../utils";
import { fetchTokenDecimals, fetchTokenName, fetchTokenSymbol } from "../services/tokens";

indexer.contractRegister(
  { contract: "Factory", event: "PairCreated" },
  async ({ event, context }) => {
    context.chain.Pair.add(event.params.pair);
  },
);

indexer.onEvent(
  { contract: "Factory", event: "PairCreated" },
  async ({ event, context }) => {
    let factory = await context.PancakeFactory.get(FACTORY_ADDRESS);
    if (factory === undefined) {
      factory = {
        id: FACTORY_ADDRESS,
        totalPairs: ZERO_BI,
        totalTransactions: ZERO_BI,
        totalVolumeBNB: ZERO_BD,
        totalLiquidityBNB: ZERO_BD,
        totalVolumeUSD: ZERO_BD,
        untrackedVolumeUSD: ZERO_BD,
        totalLiquidityUSD: ZERO_BD,
      };

      context.Bundle.set({ id: "1", bnbPrice: ZERO_BD });
    }
    factory = { ...factory, totalPairs: factory.totalPairs + ONE_BI };
    context.PancakeFactory.set(factory);

    const token0Id = low(event.params.token0);
    let token0 = await context.Token.get(token0Id);
    if (token0 === undefined) {
      // original quirk: fetchTokenDecimals never actually returns null (a
      // reverted decimals() call coerces to 0), so the original's
      // `if (decimals === null) return` branch is unreachable and not ported.
      token0 = {
        id: token0Id,
        name: await fetchTokenName(context.effect, token0Id),
        symbol: await fetchTokenSymbol(context.effect, token0Id),
        decimals: await fetchTokenDecimals(context.effect, token0Id),
        derivedBNB: ZERO_BD,
        derivedUSD: ZERO_BD,
        tradeVolume: ZERO_BD,
        tradeVolumeUSD: ZERO_BD,
        untrackedVolumeUSD: ZERO_BD,
        totalLiquidity: ZERO_BD,
        totalTransactions: ZERO_BI,
      } satisfies Token;
      context.Token.set(token0);
    }

    const token1Id = low(event.params.token1);
    let token1 = await context.Token.get(token1Id);
    if (token1 === undefined) {
      token1 = {
        id: token1Id,
        name: await fetchTokenName(context.effect, token1Id),
        symbol: await fetchTokenSymbol(context.effect, token1Id),
        decimals: await fetchTokenDecimals(context.effect, token1Id),
        derivedBNB: ZERO_BD,
        derivedUSD: ZERO_BD,
        tradeVolume: ZERO_BD,
        tradeVolumeUSD: ZERO_BD,
        untrackedVolumeUSD: ZERO_BD,
        totalLiquidity: ZERO_BD,
        totalTransactions: ZERO_BI,
      } satisfies Token;
      context.Token.set(token1);
    }

    const pairId = low(event.params.pair);
    context.Pair.set({
      id: pairId,
      token0_id: token0.id,
      token1_id: token1.id,
      name: token0.symbol.concat("-").concat(token1.symbol),
      totalTransactions: ZERO_BI,
      reserve0: ZERO_BD,
      reserve1: ZERO_BD,
      trackedReserveBNB: ZERO_BD,
      reserveBNB: ZERO_BD,
      reserveUSD: ZERO_BD,
      totalSupply: ZERO_BD,
      volumeToken0: ZERO_BD,
      volumeToken1: ZERO_BD,
      volumeUSD: ZERO_BD,
      untrackedVolumeUSD: ZERO_BD,
      token0Price: ZERO_BD,
      token1Price: ZERO_BD,
      block: BigInt(event.block.number),
      timestamp: BigInt(event.block.timestamp),
    });

    // port-internal: mirror the factory's symmetric getPair(a,b) mapping for
    // findBnbPerToken (replaces the original's eth_call — see MIGRATION.md).
    context.PairTokenLookup.set({ id: token0.id.concat("-").concat(token1.id), pair_id: pairId });
    context.PairTokenLookup.set({ id: token1.id.concat("-").concat(token0.id), pair_id: pairId });
  },
);
