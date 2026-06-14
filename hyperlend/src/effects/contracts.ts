/**
 * Typed `try_`-style wrappers over the generic eth_call layer, ported from
 * `src/helpers/getPrice.ts` in the Ponder source.
 *
 *   getOraclePrice(reserve)  -> Oracle.getAssetPrice(reserve)
 *   getIsolatedOraclePrice(pair) -> pair.exchangeRateInfo().highExchangeRate
 *
 * Both are state/price reads, so they are pinned to the event block. They
 * return null on revert (mirroring the Ponder handlers' try/catch -> null).
 */
import type { EffectCaller } from "envio";
import { tryContractCall } from "./calls";

/** HyperLend main pool oracle (from ponder.config.ts). */
export const ORACLE_ADDRESS = "0xC9Fb4fbE842d57EAc1dF3e641a281827493A630e";

/**
 * Oracle.getAssetPrice(asset) — block-pinned uint256 price. Returns `undefined`
 * on revert (envio's nullable schema fields are `T | undefined`).
 */
export async function getOraclePrice(
  call: EffectCaller | null,
  asset: string,
  block: number,
): Promise<bigint | undefined> {
  const r = await tryContractCall<bigint>(
    call,
    ORACLE_ADDRESS,
    "function getAssetPrice(address) view returns (uint256)",
    "getAssetPrice",
    [asset],
    block,
    "getAssetPrice",
  );
  return r ?? undefined;
}

/**
 * IsolatedPair.exchangeRateInfo().highExchangeRate — block-pinned.
 * The struct returns (oracle, maxOracleDeviation, lastTimestamp,
 * lowExchangeRate, highExchangeRate); we keep the 5th field as the Ponder
 * helper does (`.highExchangeRate`).
 */
export async function getIsolatedOraclePrice(
  call: EffectCaller | null,
  pair: string,
  block: number,
): Promise<bigint | undefined> {
  const res = await tryContractCall<
    | readonly [string, number, bigint, bigint, bigint]
    | { highExchangeRate: bigint }
    | bigint
    | string
  >(
    call,
    pair,
    "function exchangeRateInfo() view returns (address oracle, uint32 maxOracleDeviation, uint184 lastTimestamp, uint256 lowExchangeRate, uint256 highExchangeRate)",
    "exchangeRateInfo",
    [],
    block,
    "exchangeRateInfo",
  );
  if (res === null) return undefined;
  // Tests may mock exchangeRateInfo directly with the highExchangeRate value.
  if (typeof res === "bigint") return res;
  if (typeof res === "string") return BigInt(res);
  if (Array.isArray(res)) return res[4] as bigint;
  return (res as { highExchangeRate: bigint }).highExchangeRate;
}
