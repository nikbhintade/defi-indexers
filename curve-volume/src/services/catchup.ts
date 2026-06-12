/**
 * Port of src/services/catchup.ts — retro-adds pools that were already
 * registered on a registry/factory when it got added to the address provider.
 */
import type { EvmOnEventContext } from "envio";
import { ADDRESS_ZERO, BIG_INT_ONE, TRICRYPTO_FACTORY, UNKNOWN_METAPOOLS } from "../constants";
import { createNewFactoryPool, createNewPool } from "./pools";
import { addCryptoRegistryPool, addRegistryPool } from "./registries";
import {
  cryptoFactoryGetToken,
  erc20Name,
  erc20Symbol,
  metaPoolBasePool,
  registryPoolCount,
  registryPoolList,
} from "../effects/contracts";

export async function catchUp(
  context: EvmOnEventContext,
  registryAddress: string,
  factory: boolean,
  version: number,
  block: bigint,
  timestamp: bigint,
  hash: string,
): Promise<void> {
  context.log.info(`Adding missing pools on registry ${registryAddress} at block ${block.toString()}`);
  const ec = context.effect;
  const blockNumber = Number(block);
  // ABI also works for factories since we're only using pool_count/pool_list
  const poolCount = await registryPoolCount(ec, registryAddress, blockNumber);
  if (poolCount === null) {
    context.log.error(`Error calling pool count on registry ${registryAddress}`);
    return;
  }
  context.log.error(`Found ${poolCount.toString()} pools when registry added to address provider`);
  for (let i = 0; i < Number(poolCount); i++) {
    const poolAddress = await registryPoolList(ec, registryAddress, BigInt(i), blockNumber);
    if (poolAddress === null) {
      context.log.error(`Unable to get pool ${i} on registry ${registryAddress}`);
      continue;
    }
    const pool = await context.Pool.get(poolAddress);
    if (pool || poolAddress == ADDRESS_ZERO) {
      context.log.warn(`Pool ${poolAddress} already exists ${pool ? "y" : "n"} or is zero`);
      // still need to increase pool count because pool will be registered
      if (factory) {
        const factoryEntity = await context.Factory.get(registryAddress);
        if (!factoryEntity) {
          return;
        }
        context.Factory.set({ ...factoryEntity, poolCount: factoryEntity.poolCount + BIG_INT_ONE });
      }
      continue;
    }
    if (!factory) {
      if (version == 1) {
        context.log.info(`Retro adding stable registry pool: ${poolAddress}`);
        await addRegistryPool(context, poolAddress, registryAddress, block, timestamp, hash);
      } else {
        context.log.info(`Retro adding crypto registry pool: ${poolAddress}`);
        await addCryptoRegistryPool(context, poolAddress, registryAddress, block, timestamp, hash);
      }
    } else {
      // crypto factories are straightforward
      if (version == 2) {
        context.log.info(`Retro adding crypto factory pool: ${poolAddress}`);
        const token = await cryptoFactoryGetToken(ec, registryAddress, poolAddress, blockNumber);
        if (token === null) {
          // deviation: the original used a non-try call and would have crashed
          context.log.error(`get_token reverted for pool ${poolAddress} on factory ${registryAddress}`);
          continue;
        }
        await createNewFactoryPool(context, blockNumber, 2, registryAddress, false, ADDRESS_ZERO, token, timestamp, block, hash);
      } else {
        context.log.info(`Retro adding stable factory pool: ${poolAddress}`);
        const testMetaPoolResult = await metaPoolBasePool(ec, poolAddress);
        const unknownMetapool = UNKNOWN_METAPOOLS[poolAddress];
        const basePool =
          unknownMetapool !== undefined
            ? unknownMetapool
            : testMetaPoolResult === null
              ? ADDRESS_ZERO
              : testMetaPoolResult;
        await createNewFactoryPool(
          context,
          blockNumber,
          1,
          registryAddress,
          testMetaPoolResult !== null || unknownMetapool !== undefined,
          basePool,
          ADDRESS_ZERO,
          timestamp,
          block,
          hash,
        );
      }
    }
  }
}

export async function catchUpTriCrypto(
  context: EvmOnEventContext,
  factoryAddress: string,
  block: bigint,
  timestamp: bigint,
  hash: string,
): Promise<void> {
  const ec = context.effect;
  const blockNumber = Number(block);
  const poolCount = await registryPoolCount(ec, factoryAddress, blockNumber);
  if (poolCount === null) {
    context.log.error(`Error calling pool count on tricrypto factory ${factoryAddress}`);
    return;
  }
  context.log.error(`Found ${poolCount.toString()} pools when tricrypto factory added to address provider`);
  for (let i = 0; i < Number(poolCount); i++) {
    const poolAddress = await registryPoolList(ec, factoryAddress, BigInt(i), blockNumber);
    if (poolAddress === null) {
      context.log.error(`Unable to get pool ${i} on tricrypto factory ${factoryAddress}`);
      continue;
    }
    // template creation (TriCryptoOptimizedTemplateV2) handled in handlers/registration.ts
    const name = (await erc20Name(ec, poolAddress)) ?? "";
    const symbol = (await erc20Symbol(ec, poolAddress)) ?? "";
    await createNewPool(
      context,
      poolAddress,
      poolAddress,
      name,
      symbol,
      TRICRYPTO_FACTORY,
      false,
      true,
      false,
      block,
      hash,
      timestamp,
      ADDRESS_ZERO,
    );
  }
}
