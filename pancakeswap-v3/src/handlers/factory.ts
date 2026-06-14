/**
 * Port of mappings/factory.ts (handlePoolCreated).
 *
 * `PoolTemplate.create(event.params.pool)` maps to `indexer.contractRegister`
 * adding the pool address to the Pool contract.
 */
import { indexer, type Pool, type Token } from "envio";
import { ADDRESS_ZERO, FACTORY_ADDRESS, ONE_BI, ZERO_BD, ZERO_BI, low } from "../utils/constants";
import { WHITELIST_TOKENS } from "../utils/pricing";
import { getOrLoadToken } from "../utils/entity";

function feeTierToProtocolFeeDefault(feeTier: bigint): bigint {
  if (feeTier === 10000n) return 209718400n;
  if (feeTier === 2500n) return 209718400n;
  if (feeTier === 500n) return 222825800n;
  if (feeTier === 100n) return 216272100n;
  return 209718400n;
}

indexer.contractRegister(
  { contract: "Factory", event: "PoolCreated" },
  async ({ event, context }) => {
    context.chain.Pool.add(event.params.pool);
  },
);

indexer.onEvent(
  { contract: "Factory", event: "PoolCreated" },
  async ({ event, context }) => {
    let factory = await context.Factory.get(FACTORY_ADDRESS);
    if (factory === undefined) {
      factory = {
        id: FACTORY_ADDRESS,
        poolCount: ZERO_BI,
        totalVolumeETH: ZERO_BD,
        totalVolumeUSD: ZERO_BD,
        untrackedVolumeUSD: ZERO_BD,
        totalFeesUSD: ZERO_BD,
        totalFeesETH: ZERO_BD,
        totalProtocolFeesUSD: ZERO_BD,
        totalProtocolFeesETH: ZERO_BD,
        totalValueLockedETH: ZERO_BD,
        totalValueLockedUSD: ZERO_BD,
        totalValueLockedUSDUntracked: ZERO_BD,
        totalValueLockedETHUntracked: ZERO_BD,
        txCount: ZERO_BI,
        owner: ADDRESS_ZERO,
      };
      context.Bundle.set({ id: "1", ethPriceUSD: ZERO_BD });
    }

    factory = { ...factory, poolCount: factory.poolCount + ONE_BI };

    const poolId = low(event.params.pool);
    let token0 = await getOrLoadToken(context, event.params.token0);
    let token1 = await getOrLoadToken(context, event.params.token1);

    // update white listed pools
    if (WHITELIST_TOKENS.includes(token0.id)) {
      token1 = { ...token1, whitelistPools: [...token1.whitelistPools, poolId] };
    }
    if (WHITELIST_TOKENS.includes(token1.id)) {
      token0 = { ...token0, whitelistPools: [...token0.whitelistPools, poolId] };
    }

    const feeTier = BigInt(event.params.fee);

    const pool: Pool = {
      id: poolId,
      token0_id: token0.id,
      token1_id: token1.id,
      feeTier,
      createdAtTimestamp: BigInt(event.block.timestamp),
      createdAtBlockNumber: BigInt(event.block.number),
      liquidityProviderCount: ZERO_BI,
      txCount: ZERO_BI,
      liquidity: ZERO_BI,
      sqrtPrice: ZERO_BI,
      feeGrowthGlobal0X128: ZERO_BI,
      feeGrowthGlobal1X128: ZERO_BI,
      feeProtocol: feeTierToProtocolFeeDefault(feeTier),
      token0Price: ZERO_BD,
      token1Price: ZERO_BD,
      observationIndex: ZERO_BI,
      totalValueLockedToken0: ZERO_BD,
      totalValueLockedToken1: ZERO_BD,
      totalValueLockedUSD: ZERO_BD,
      totalValueLockedETH: ZERO_BD,
      totalValueLockedUSDUntracked: ZERO_BD,
      totalValueLockedETHUntracked: ZERO_BD,
      volumeToken0: ZERO_BD,
      volumeToken1: ZERO_BD,
      volumeUSD: ZERO_BD,
      feesUSD: ZERO_BD,
      protocolFeesUSD: ZERO_BD,
      untrackedVolumeUSD: ZERO_BD,
      collectedFeesToken0: ZERO_BD,
      collectedFeesToken1: ZERO_BD,
      collectedFeesUSD: ZERO_BD,
      tick: undefined,
    } satisfies Pool;

    context.Pool.set(pool);
    context.Token.set(token0);
    context.Token.set(token1);
    context.Factory.set(factory);
  },
);
