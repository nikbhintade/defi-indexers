/** Port of src/services/pools.ts */
import type { BasePool, EvmOnEventContext, Pool } from "envio";
import { getDecimals, getName } from "../utils/pricing";
import {
  ADDRESS_ZERO,
  BIG_DECIMAL_ZERO,
  BIG_INT_ONE,
  CRVUSD,
  CRYPTO_FACTORY,
  METAPOOL_FACTORY,
  METAPOOL_FACTORY_ADDRESS,
  REBASING_POOL_IMPLEMENTATIONS,
  STABLE_FACTORY,
} from "../constants";
import { getPlatform } from "./platform";
import { getFactory } from "./factory";
import {
  erc20Name,
  erc20Symbol,
  factoryGetImplementationAddress,
  poolCoins,
  poolCoins128,
  poolName,
  poolSymbol,
  poolUnderlyingCoins,
  poolUnderlyingCoins128,
  registryPoolList,
} from "../effects/contracts";

type PoolType = Pool["poolType"];

export async function createNewPool(
  context: EvmOnEventContext,
  poolAddress: string,
  lpToken: string,
  name: string,
  symbol: string,
  poolType: PoolType,
  metapool: boolean,
  isV2: boolean,
  isRebasing: boolean,
  block: bigint,
  tx: string,
  timestamp: bigint,
  basePool: string,
): Promise<void> {
  const ec = context.effect;
  const platform = await getPlatform(context);
  context.Platform.set({
    ...platform,
    poolAddresses: [...platform.poolAddresses, poolAddress],
  });

  const coins: string[] = [];
  const coinDecimals: bigint[] = [];
  const coinNames: string[] = [];
  let c128 = false;

  let i = 0;
  let coinResult = await poolCoins(ec, poolAddress, i);

  if (coinResult === null) {
    // some pools require an int128 for coins and will revert with the
    // regular abi. e.g. 0x7fc77b5c7614e1533320ea6ddc2eb61fa00a9714
    c128 = true;
    let coinResult128 = await poolCoins128(ec, poolAddress, i);
    if (coinResult128 === null) {
      context.log.warn(`Call to int128 coins failed for ${poolAddress}`);
      c128 = false;
    }
    while (coinResult128 !== null) {
      coins.push(coinResult128);
      coinNames.push(await getName(ec, coinResult128));
      coinDecimals.push(await getDecimals(ec, coinResult128));
      i += 1;
      coinResult128 = await poolCoins128(ec, poolAddress, i);
    }
  } else {
    while (coinResult !== null) {
      coins.push(coinResult);
      coinNames.push(await getName(ec, coinResult));
      coinDecimals.push(await getDecimals(ec, coinResult));
      i += 1;
      coinResult = await poolCoins(ec, poolAddress, i);
    }
  }

  const pool: Pool = {
    id: poolAddress,
    name,
    platform_id: platform.id,
    lpToken,
    symbol,
    metapool,
    isV2,
    isRebasing,
    address: poolAddress,
    creationBlock: block,
    creationTx: tx,
    creationDate: timestamp,
    poolType,
    c128,
    basePool,
    cumulativeVolume: BIG_DECIMAL_ZERO,
    cumulativeVolumeUSD: BIG_DECIMAL_ZERO,
    cumulativeFeesUSD: BIG_DECIMAL_ZERO,
    virtualPrice: BIG_DECIMAL_ZERO,
    baseApr: BIG_DECIMAL_ZERO,
    coins,
    coinNames,
    coinDecimals,
    assetType: isV2 ? 4 : poolType == CRVUSD ? 0 : getAssetType(name, symbol, coinNames),
  };
  context.Pool.set(pool);
}

export async function createNewFactoryPool(
  context: EvmOnEventContext,
  blockNumber: number,
  version: number,
  factoryContract: string,
  metapool: boolean,
  basePool: string,
  lpToken: string,
  timestamp: bigint,
  block: bigint,
  tx: string,
): Promise<void> {
  const ec = context.effect;
  let factoryPool: string | null;
  let poolType: PoolType;
  const factoryEntity = await getFactory(context, factoryContract);
  const poolCount = factoryEntity.poolCount;
  let isRebasing = false;
  if (version == 1) {
    poolType = factoryContract == METAPOOL_FACTORY_ADDRESS ? METAPOOL_FACTORY : STABLE_FACTORY;
    poolType = factoryEntity.crvUsd ? CRVUSD : poolType;
    factoryPool = await registryPoolList(ec, factoryContract, poolCount, blockNumber);
    if (factoryPool === null) {
      // deviation: the original used a non-try call and would have crashed
      context.log.error(`pool_list(${poolCount.toString()}) reverted for factory ${factoryContract}`);
      return;
    }
    const implementationResult = await factoryGetImplementationAddress(ec, factoryContract, factoryPool, blockNumber);
    if (implementationResult !== null) {
      isRebasing = REBASING_POOL_IMPLEMENTATIONS.includes(implementationResult);
    }
    context.log.info(
      `New factory pool (metapool: ${metapool}, base pool: ${basePool}) added ${factoryPool} with id ${poolCount.toString()}`,
    );
  } else {
    poolType = CRYPTO_FACTORY;
    factoryPool = await registryPoolList(ec, factoryContract, poolCount, blockNumber);
    if (factoryPool === null) {
      // deviation: the original used a non-try call and would have crashed
      context.log.error(`pool_list(${poolCount.toString()}) reverted for factory ${factoryContract}`);
      return;
    }
    context.log.info(`New factory pool added (v2.0) ${factoryPool} with id ${poolCount.toString()}`);
  }
  context.Factory.set({ ...factoryEntity, poolCount: factoryEntity.poolCount + BIG_INT_ONE });

  let name: string, symbol: string;
  if (version == 2) {
    // template creation (CurvePoolTemplateV2) handled in handlers/registration.ts
    name = (await erc20Name(ec, lpToken)) ?? "";
    symbol = (await erc20Symbol(ec, lpToken)) ?? "";
  } else {
    // template creation (CurvePoolTemplate) handled in handlers/registration.ts
    name = (await poolName(ec, factoryPool)) ?? "";
    symbol = (await poolSymbol(ec, factoryPool)) ?? "";
  }
  await createNewPool(
    context,
    factoryPool,
    lpToken == ADDRESS_ZERO ? factoryPool : lpToken,
    name,
    symbol,
    poolType,
    metapool,
    version == 2,
    isRebasing,
    block,
    tx,
    timestamp,
    basePool,
  );
}

export async function createNewRegistryPool(
  context: EvmOnEventContext,
  poolAddress: string,
  basePool: string,
  lpToken: string,
  metapool: boolean,
  isV2: boolean,
  poolType: PoolType,
  timestamp: bigint,
  block: bigint,
  tx: string,
): Promise<void> {
  const ec = context.effect;
  if (!(await context.Pool.get(poolAddress))) {
    // template creation (CurvePoolTemplate / CurvePoolTemplateV2) handled in
    // handlers/registration.ts
    const name = (await erc20Name(ec, lpToken)) ?? "";
    const symbol = (await erc20Symbol(ec, lpToken)) ?? "";
    await createNewPool(
      context,
      poolAddress,
      lpToken,
      name,
      symbol,
      poolType,
      metapool,
      isV2,
      false,
      block,
      tx,
      timestamp,
      basePool,
    );
  } else {
    context.log.debug(`Pool: ${poolAddress} added to the registry at ${tx} but already tracked`);
  }
}

async function getPoolCoins128(context: EvmOnEventContext, basePool: BasePool): Promise<BasePool> {
  const ec = context.effect;
  let i = 0;
  const coins: string[] = [...basePool.coins];
  const coinDecimals: bigint[] = [...basePool.coinDecimals];
  let coinResult = await poolCoins128(ec, basePool.id, i);
  if (coinResult === null) {
    context.log.warn(`Call to int128 coins failed for ${basePool.id}`);
  }
  while (coinResult !== null) {
    coins.push(coinResult);
    coinDecimals.push(await getDecimals(ec, coinResult));
    i += 1;
    coinResult = await poolCoins128(ec, basePool.id, i);
  }
  const updated: BasePool = { ...basePool, coins, coinDecimals };
  context.BasePool.set(updated);
  return updated;
}

export async function getBasePool(context: EvmOnEventContext, pool: string): Promise<BasePool> {
  const ec = context.effect;
  let basePool = await context.BasePool.get(pool);
  if (!basePool) {
    context.log.info(`Adding new base pool : ${pool}`);
    basePool = { id: pool, coins: [], coinDecimals: [] };

    const coins: string[] = [];
    const coinDecimals: bigint[] = [];
    let i = 0;
    let coinResult = await poolCoins(ec, pool, i);

    if (coinResult === null) {
      // some pools require an int128 for coins
      return getPoolCoins128(context, basePool);
    }

    while (coinResult !== null) {
      coins.push(coinResult);
      coinDecimals.push(await getDecimals(ec, coinResult));
      i += 1;
      coinResult = await poolCoins(ec, pool, i);
    }
    basePool = { ...basePool, coins, coinDecimals };
    context.BasePool.set(basePool);
  }
  return basePool;
}

export async function getVirtualBaseLendingPool(context: EvmOnEventContext, pool: string): Promise<BasePool> {
  // we're creating fake base pools for lending pools just to have
  // an entity where we can store underlying coins and decimals
  const ec = context.effect;
  let basePool = await context.BasePool.get(pool);
  if (!basePool) {
    context.log.info(`Adding new virtual base lending pool : ${pool}`);
    const coins: string[] = [];
    const coinDecimals: bigint[] = [];
    let i = 0;
    let coinResult = await poolUnderlyingCoins(ec, pool, i);

    if (coinResult === null) {
      // some lending pools require an int128 for underlying coins
      // e.g. 0x52ea46506b9cc5ef470c5bf89f17dc28bb35d85c
      let coinResult128 = await poolUnderlyingCoins128(ec, pool, i);
      while (coinResult128 !== null) {
        coins.push(coinResult128);
        coinDecimals.push(await getDecimals(ec, coinResult128));
        i += 1;
        coinResult128 = await poolUnderlyingCoins128(ec, pool, i);
      }
      basePool = { id: pool, coins, coinDecimals };
      context.BasePool.set(basePool);
      return basePool;
    }

    while (coinResult !== null) {
      coins.push(coinResult);
      coinDecimals.push(await getDecimals(ec, coinResult));
      i += 1;
      coinResult = await poolUnderlyingCoins(ec, pool, i);
    }
    basePool = { id: pool, coins, coinDecimals };
    context.BasePool.set(basePool);
  }
  return basePool;
}

export function compareAgainstKnownAssetNames(name: string): number {
  const stables = ["USD", "DAI", "MIM", "TETHER", "FRAX"];
  if (name.indexOf("BTC") >= 0) {
    return 2;
  }
  for (let i = 0; i < stables.length; i++) {
    if (name.indexOf(stables[i]!) >= 0) {
      return 0;
    }
  }
  if (name.indexOf("ETH") >= 0) {
    return 1;
  }
  return -1;
}

export function getAssetType(name: string, symbol: string, coinNames: readonly string[]): number {
  const description = name.toUpperCase() + "-" + symbol.toUpperCase();
  let inferredATFromDesc = compareAgainstKnownAssetNames(description);
  if (inferredATFromDesc != -1) {
    return inferredATFromDesc;
  }
  for (let i = 0; i < coinNames.length; i++) {
    inferredATFromDesc = compareAgainstKnownAssetNames(coinNames[i]!.toUpperCase());
    if (inferredATFromDesc != -1) {
      return inferredATFromDesc;
    }
  }
  return 3;
}
