/**
 * Port of src/services/multicall.ts — fills v2 pool params on the daily
 * snapshot via a single (atomic) Multicall `aggregate` call with raw
 * selectors, exactly like the original.
 *
 * Returns the updated snapshot object (the original mutated + saved it).
 */
import type { DailyPoolSnapshot, EvmOnEventContext, Pool } from "envio";
import { BIG_INT_ZERO, TRICRYPTO2_POOL, TRICRYPTO_FACTORY } from "../constants";
import { intToCallData } from "../utils";
import { multicallAggregate } from "../effects/contracts";

/** ethereum.decode('uint256', bytes): null (-> 0) when not decodable. */
function decodeUint256(data: string | undefined): bigint {
  if (!data || data.length < 66) {
    return BIG_INT_ZERO;
  }
  return BigInt("0x" + data.slice(2, 66));
}

export async function fillV2PoolParamsSnapshot(
  context: EvmOnEventContext,
  block: number,
  snapshot: DailyPoolSnapshot,
  pool: Pool,
): Promise<DailyPoolSnapshot> {
  const CRYPTO_FACTORY_SIGNATURES = [
    "0xb1373929", // gamma
    "0x92526c0c", // mid_fee
    "0xee8de675", // out_fee
    "0x49fe9e77", // allowed_extra_profit
    "0x72d4f0e2", // fee_gamma
    "0x083812e5", // adjustment_step
    "0x662b6274", // ma_half_time
    "0xb9e8c9fd", // price_scale
    "0x86fc88d3", // price_oracle
    "0xc146bf94", // last_prices
    "0x6112c747", // last_prices_timestamp
  ];

  const TRICRYPTO_FACTORY_SIGNATURES = [
    "0xb1373929", // gamma
    "0x92526c0c", // mid_fee
    "0xee8de675", // out_fee
    "0x49fe9e77", // allowed_extra_profit
    "0x72d4f0e2", // fee_gamma
    "0x083812e5", // adjustment_step
    "0xa3f7cdd5" + intToCallData(0), // price_scale(0)
    "0xa3f7cdd5" + intToCallData(1), // price_scale(1)
    "0x68727653" + intToCallData(0), // price_oracle(0)
    "0x68727653" + intToCallData(1), // price_oracle(1)
    "0x59189017" + intToCallData(0), // last_prices(0)
    "0x59189017" + intToCallData(1), // last_prices(1)
    "0x6112c747", // last_prices_timestamp
  ];

  let signatures = pool.poolType == TRICRYPTO_FACTORY ? TRICRYPTO_FACTORY_SIGNATURES : CRYPTO_FACTORY_SIGNATURES;
  if (pool.address == TRICRYPTO2_POOL) {
    signatures = TRICRYPTO_FACTORY_SIGNATURES;
    signatures.push("0x662b6274"); // tricrypto has ma_half_time
  } else if (pool.poolType == TRICRYPTO_FACTORY) {
    signatures.push("0x09c3da6a"); // renamed to ma_time on ng contracts
  }

  const calls = signatures.map((sig) => ({ target: pool.address, callData: sig }));
  const callResult = await multicallAggregate(context.effect, calls, block);
  if (callResult === null) {
    context.log.error(`Multicall failed for pool ${pool.id}`);
    return snapshot;
  }
  const multiResults = callResult[1];
  const intResults: bigint[] = [];
  for (let i = 0; i < multiResults.length; i++) {
    intResults.push(decodeUint256(multiResults[i]));
  }

  let updated: DailyPoolSnapshot = {
    ...snapshot,
    gamma: intResults[0],
    midFee: intResults[1],
    outFee: intResults[2],
    allowedExtraProfit: intResults[3],
    feeGamma: intResults[4],
    adjustmentStep: intResults[5],
  };
  if (pool.poolType == TRICRYPTO_FACTORY || pool.address == TRICRYPTO2_POOL) {
    updated = {
      ...updated,
      priceScale: [...snapshot.priceScale, intResults[6]!, intResults[7]!],
      priceOracle: [...snapshot.priceOracle, intResults[8]!, intResults[9]!],
      lastPrices: [...snapshot.lastPrices, intResults[10]!, intResults[11]!],
      lastPricesTimestamp: intResults[12],
      maHalfTime: intResults[13],
    };
  } else {
    updated = {
      ...updated,
      maHalfTime: intResults[6],
      priceScale: [...snapshot.priceScale, intResults[7]!],
      priceOracle: [...snapshot.priceOracle, intResults[8]!],
      lastPrices: [...snapshot.lastPrices, intResults[9]!],
      lastPricesTimestamp: intResults[10],
    };
  }
  return updated;
}
