/**
 * Shared port of the M0 subgraph's `handleNewBlock` (timeseries) and
 * `handleMinterAttributes` (per-minter) logic from src/minter-gateway.ts.
 *
 * The subgraph calls these from two places:
 *   1. `handleNewBlock` — the polling block handler (every 300 blocks) and also
 *      re-invoked from `handleMinterAttributes` on every minter event. It reads
 *      5 aggregate values from MinterGateway and writes the *OwedM timeseries
 *      entities keyed by `block.hash` (+ a daily snapshot keyed by day number).
 *   2. `handleMinterAttributes` — invoked by every minter event. Calls
 *      `handleNewBlock` then writes 4 per-minter entities keyed by
 *      `minter-blockNumber`.
 *
 * Write guards are preserved exactly:
 *   - `createTimeseriesEntity`: only writes when `amount && amount > 0`.
 *   - `createMinterAttributeEntity`: only writes when `amount` is truthy
 *     (in graph-ts a successful call always returns a value; here a reverted
 *     call yields `null` and is skipped, matching "if (amount)").
 */
import type { EvmOnEventContext, EffectCaller } from "envio";
import {
  principalOfTotalActiveOwedM,
  totalOwedM,
  totalActiveOwedM,
  totalInactiveOwedM,
  excessOwedM,
  activeOwedMOf,
  inactiveOwedMOf,
  principalOfActiveOwedMOf,
  collateralOf,
} from "./effects/contracts";
import { SECONDS_PER_DAY, dayFromTimestamp } from "./utils";

export type BlockMeta = {
  number: number;
  hash: string;
  timestamp: bigint;
};

/**
 * Port of `handleNewBlock(block)`. `gateway` is the MinterGateway address
 * (subgraph binds `dataSource.address()` / `event.address`).
 */
export async function handleNewBlock(
  context: EvmOnEventContext,
  effect: EffectCaller,
  gateway: string,
  block: BlockMeta,
): Promise<void> {
  const ec = effect;
  const blockNumber = BigInt(block.number);

  // handlePrincipalOfTotalActiveOwedM
  {
    const amount = await principalOfTotalActiveOwedM(ec, gateway, block.number);
    if (amount !== null && amount > 0n) {
      context.PrincipalOfTotalActiveOwedM.set({
        id: block.hash,
        amount,
        blockNumber,
        blockTimestamp: block.timestamp,
      });
    }
  }

  // handleTotalOwedM
  {
    const amount = await totalOwedM(ec, gateway, block.number);
    if (amount !== null && amount > 0n) {
      context.TotalOwedM.set({
        id: block.hash,
        amount,
        blockNumber,
        blockTimestamp: block.timestamp,
      });
    }
  }

  // handleTotalActiveOwedM (+ daily snapshot)
  {
    const amount = await totalActiveOwedM(ec, gateway, block.number);
    if (amount !== null && amount > 0n) {
      context.TotalActiveOwedM.set({
        id: block.hash,
        amount,
        blockNumber,
        blockTimestamp: block.timestamp,
      });
    }
    // createTotalActiveOwedMDailySnapshot — written unconditionally (no >0
    // guard in the subgraph), but `amount` may be null on revert; the subgraph
    // would have a value here so we only skip on the (live-only) revert case.
    if (amount !== null) {
      const day = dayFromTimestamp(block.timestamp);
      const id = day.toString();
      context.TotalActiveOwedMDailySnapshot.set({
        id,
        amount,
        blockNumber,
        blockTimestamp: block.timestamp,
        timestamp: day * SECONDS_PER_DAY,
      });
    }
  }

  // handleTotalInactiveOwedM
  {
    const amount = await totalInactiveOwedM(ec, gateway, block.number);
    if (amount !== null && amount > 0n) {
      context.TotalInactiveOwedM.set({
        id: block.hash,
        amount,
        blockNumber,
        blockTimestamp: block.timestamp,
      });
    }
  }

  // handleTotalExcessOwedM
  {
    const amount = await excessOwedM(ec, gateway, block.number);
    if (amount !== null && amount > 0n) {
      context.TotalExcessOwedM.set({
        id: block.hash,
        amount,
        blockNumber,
        blockTimestamp: block.timestamp,
      });
    }
  }
}

/**
 * Port of `handleMinterAttributes(event)`: re-runs handleNewBlock, then writes
 * the 4 per-minter entities keyed by `minter-blockNumber`. `minter` must be the
 * lowercase address (subgraph uses `event.params.minter.toString()`, which is
 * lowercase hex in graph-ts).
 */
export async function handleMinterAttributes(
  context: EvmOnEventContext,
  effect: EffectCaller,
  gateway: string,
  minter: string,
  block: BlockMeta,
): Promise<void> {
  const ec = effect;
  const blockNumber = BigInt(block.number);
  const idBase = minter + "-" + block.number.toString();

  await handleNewBlock(context, effect, gateway, block);

  // handleMinterActiveOwedMOf
  {
    const amount = await activeOwedMOf(ec, gateway, minter, block.number);
    if (amount !== null) {
      context.MinterActiveOwedMOf.set({
        id: idBase,
        minter,
        amount,
        blockNumber,
        blockTimestamp: block.timestamp,
      });
    }
  }

  // handleMinterInactiveOwedMOf
  {
    const amount = await inactiveOwedMOf(ec, gateway, minter, block.number);
    if (amount !== null) {
      context.MinterInactiveOwedMOf.set({
        id: idBase,
        minter,
        amount,
        blockNumber,
        blockTimestamp: block.timestamp,
      });
    }
  }

  // handleMinterPrincipalOfActiveOwedMOf
  {
    const amount = await principalOfActiveOwedMOf(ec, gateway, minter, block.number);
    if (amount !== null) {
      context.MinterPrincipalOfActiveOwedMOf.set({
        id: idBase,
        minter,
        amount,
        blockNumber,
        blockTimestamp: block.timestamp,
      });
    }
  }

  // handleMinterCollateralOf
  {
    const amount = await collateralOf(ec, gateway, minter, block.number);
    if (amount !== null) {
      context.MinterCollateralOf.set({
        id: idBase,
        minter,
        amount,
        blockNumber,
        blockTimestamp: block.timestamp,
      });
    }
  }
}
