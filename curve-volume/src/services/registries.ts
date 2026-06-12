/**
 * Entity-side registry/factory logic ported from src/mapping.template.ts
 * (addAddress, getLpToken, addRegistryPool) and src/mappingV2.ts
 * (addCryptoRegistryPool). The template-creation side lives in
 * handlers/registration.ts (envio contractRegister).
 */
import type { EvmOnEventContext } from "envio";
import {
  ADDRESS_ZERO,
  EARLY_V2_POOLS,
  LENDING,
  LENDING_POOLS,
  METAPOOL_FACTORY,
  REGISTRY_V1,
  REGISTRY_V2,
  UNKNOWN_METAPOOLS,
} from "../constants";
import { getPlatform } from "./platform";
import { getFactory } from "./factory";
import { catchUp, catchUpTriCrypto } from "./catchup";
import { createNewPool, createNewRegistryPool } from "./pools";
import { getOffPegFeeMultiplierResult } from "./snapshots";
import { erc20Name, erc20Symbol, metaPoolBasePool, registryGetLpToken } from "../effects/contracts";

export async function addAddress(
  context: EvmOnEventContext,
  providedId: bigint,
  addedAddress: string,
  block: bigint,
  timestamp: bigint,
  hash: string,
): Promise<void> {
  await getPlatform(context);

  if (providedId == 0n) {
    const mainRegistry = await context.Registry.get(addedAddress);
    if (!mainRegistry) {
      context.log.info(`New main registry added: ${addedAddress}`);
      context.Registry.set({ id: addedAddress });
      await catchUp(context, addedAddress, false, 1, block, timestamp, hash);
    }
  } else if (providedId == 3n) {
    const stableFactory = await context.Factory.get(addedAddress);
    if (!stableFactory) {
      context.log.info(`New stable factory added: ${addedAddress}`);
      await getFactory(context, addedAddress);
      await catchUp(context, addedAddress, true, 1, block, timestamp, hash);
    }
  } else if (providedId == 5n) {
    const cryptoRegistry = await context.Registry.get(addedAddress);
    if (!cryptoRegistry) {
      context.log.info(`New crypto registry added: ${addedAddress}`);
      context.Registry.set({ id: addedAddress });
      await catchUp(context, addedAddress, false, 2, block, timestamp, hash);
    }
  } else if (providedId == 6n) {
    const cryptoFactory = await context.Factory.get(addedAddress);
    if (!cryptoFactory) {
      context.log.info(`New crypto v2 factory added: ${addedAddress}`);
      await getFactory(context, addedAddress);
      await catchUp(context, addedAddress, true, 2, block, timestamp, hash);
    }
  } else if (providedId == 8n) {
    const crvUsdFactory = await context.Factory.get(addedAddress);
    if (!crvUsdFactory) {
      context.log.info(`New crvUSD factory added: ${addedAddress}`);
      await getFactory(context, addedAddress, true);
      await catchUp(context, addedAddress, true, 1, block, timestamp, hash);
    }
  } else if (providedId == 11n) {
    const triCryptoFactory = await context.Factory.get(addedAddress);
    if (!triCryptoFactory) {
      context.log.info(`New tricrypto factory added: ${addedAddress}`);
      await getFactory(context, addedAddress, false);
      await catchUpTriCrypto(context, addedAddress, block, timestamp, hash);
    }
  }
}

export async function getLpToken(
  context: EvmOnEventContext,
  pool: string,
  registryAddress: string,
  blockNumber: number,
): Promise<string> {
  const lpTokenResult = await registryGetLpToken(context.effect, registryAddress, pool, blockNumber);
  return lpTokenResult === null || lpTokenResult == ADDRESS_ZERO ? pool : lpTokenResult;
}

export async function addRegistryPool(
  context: EvmOnEventContext,
  pool: string,
  registry: string,
  block: bigint,
  timestamp: bigint,
  hash: string,
): Promise<void> {
  context.log.info(`New pool ${pool} added to registry at ${hash}`);
  const ec = context.effect;
  const blockNumber = Number(block);
  // The test would not work on mainnet because there are no
  // specific functions for lending pools there.
  const testLendingResult = await getOffPegFeeMultiplierResult(context, blockNumber, pool);
  if (testLendingResult !== null || LENDING_POOLS.includes(pool)) {
    // Lending pool
    context.log.info(`New lending pool ${pool} added from registry at ${hash}`);
    // template creation (CurvePoolTemplate) handled in handlers/registration.ts
    const lpToken = await getLpToken(context, pool, registry, blockNumber);
    const name = (await erc20Name(ec, lpToken)) ?? "";
    const symbol = (await erc20Symbol(ec, lpToken)) ?? "";
    await createNewPool(
      context,
      pool,
      lpToken,
      name,
      symbol,
      LENDING,
      false,
      false,
      false,
      block,
      hash,
      timestamp,
      pool,
    );
  }

  const testMetaPoolResult = await metaPoolBasePool(ec, pool);
  const unknownMetapool = UNKNOWN_METAPOOLS[pool];

  if (testMetaPoolResult !== null || unknownMetapool !== undefined) {
    context.log.info(`New meta pool ${pool} added from registry at ${hash}`);
    const basePool = unknownMetapool !== undefined ? unknownMetapool : testMetaPoolResult!;
    await createNewRegistryPool(
      context,
      pool,
      basePool,
      await getLpToken(context, pool, registry, blockNumber),
      true,
      EARLY_V2_POOLS.includes(pool) ? true : false,
      // on mainnet the unknown metapools are legacy metapools deployed before the
      // contract was added to the address indexer
      unknownMetapool !== undefined ? METAPOOL_FACTORY : REGISTRY_V1,
      timestamp,
      block,
      hash,
    );
  } else {
    context.log.info(`New plain pool ${pool} added from registry ${registry} at ${hash}`);
    await createNewRegistryPool(
      context,
      pool,
      ADDRESS_ZERO,
      await getLpToken(context, pool, registry, blockNumber),
      false,
      EARLY_V2_POOLS.includes(pool) ? true : false,
      REGISTRY_V1,
      timestamp,
      block,
      hash,
    );
  }
}

/** Port of mappingV2.ts addCryptoRegistryPool */
export async function addCryptoRegistryPool(
  context: EvmOnEventContext,
  pool: string,
  registry: string,
  block: bigint,
  timestamp: bigint,
  hash: string,
): Promise<void> {
  context.log.debug(`New V2 factory crypto pool ${pool} deployed at ${hash}`);
  const blockNumber = Number(block);

  // Useless for now, but v2 metapools may be a thing at some point
  const testMetaPoolResult = await metaPoolBasePool(context.effect, pool);
  if (testMetaPoolResult !== null) {
    await createNewRegistryPool(
      context,
      pool,
      testMetaPoolResult,
      await getLpToken(context, pool, registry, blockNumber),
      true,
      true,
      REGISTRY_V2,
      timestamp,
      block,
      hash,
    );
  } else {
    await createNewRegistryPool(
      context,
      pool,
      ADDRESS_ZERO,
      await getLpToken(context, pool, registry, blockNumber),
      false,
      true,
      REGISTRY_V2,
      timestamp,
      block,
      hash,
    );
  }
}
