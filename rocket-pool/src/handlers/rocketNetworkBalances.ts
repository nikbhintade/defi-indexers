/**
 * Ported from src/mappings/rocketNetworkBalancesMapping.ts.
 * BalancesUpdated -> NetworkStakerBalanceCheckpoint (+ RocketETHDailySnapshot).
 * Shared by the legacy rocketNetworkBalances and the Atlas redeploy.
 *
 * eth_calls (block-pinned):
 *   rocketDepositPool.getBalance(), getExcessBalance()
 *   rocketTokenRETH.getTotalCollateral(), getExchangeRate()
 */
import { indexer } from "envio";
import {
  ROCKET_TOKEN_RETH_CONTRACT_ADDRESS,
  ROCKET_DEPOSIT_POOL_CONTRACT_ADDRESS,
} from "../constants";
import {
  type HandlerContext,
  extractIdForEntity,
  getOrCreateProtocol,
  createNetworkStakerBalanceCheckpoint,
  bigDecimalToBigInt,
  bd,
} from "../helpers";
import {
  getDepositPoolBalance,
  getDepositPoolExcessBalance,
  getTotalCollateral,
  getExchangeRate,
} from "../effects";
import type { RocketETHDailySnapshot } from "envio";

/** The RocketETH contract balance = total collateral - deposit pool excess (floored at 0). */
function getRocketETHBalance(
  depositPoolExcess: bigint,
  rocketETHTotalCollateral: bigint
): bigint {
  const v = rocketETHTotalCollateral - depositPoolExcess;
  return v < 0n ? 0n : v;
}

indexer.onEvent(
  { contract: "RocketNetworkBalances", event: "BalancesUpdated" },
  async ({ event, context }) => {
    const ctx = context as HandlerContext;
    const protocol = { ...(await getOrCreateProtocol(ctx)) };

    const block = event.block.number;
    const blockNumber = BigInt(event.block.number);
    const blockTime = BigInt(event.block.timestamp);

    const depositPoolBalance = await getDepositPoolBalance(
      ctx.effect,
      ROCKET_DEPOSIT_POOL_CONTRACT_ADDRESS,
      block
    );
    const depositPoolExcessBalance = await getDepositPoolExcessBalance(
      ctx.effect,
      ROCKET_DEPOSIT_POOL_CONTRACT_ADDRESS,
      block
    );
    const totalCollateral = await getTotalCollateral(
      ctx.effect,
      ROCKET_TOKEN_RETH_CONTRACT_ADDRESS,
      block
    );
    const stakerETHInRocketETHContract = getRocketETHBalance(
      depositPoolExcessBalance,
      totalCollateral
    );

    const rETHExchangeRate = await getExchangeRate(
      ctx.effect,
      ROCKET_TOKEN_RETH_CONTRACT_ADDRESS,
      block
    );

    const id = extractIdForEntity(event);
    const checkpoint = createNetworkStakerBalanceCheckpoint(
      id,
      protocol.lastNetworkStakerBalanceCheckPoint,
      {
        stakingEth: event.params.stakingEth,
        totalEth: event.params.totalEth,
        rethSupply: event.params.rethSupply,
      },
      blockNumber,
      blockTime,
      depositPoolBalance,
      stakerETHInRocketETHContract,
      rETHExchangeRate
    );

    // Retrieve previous checkpoint.
    const previousCheckpointId = protocol.lastNetworkStakerBalanceCheckPoint;
    let previousCheckpoint = previousCheckpointId
      ? await ctx.NetworkStakerBalanceCheckpoint.get(previousCheckpointId)
      : undefined;
    if (previousCheckpoint) {
      previousCheckpoint = {
        ...previousCheckpoint,
        nextCheckpointId: checkpoint.id,
      };
    }

    // rETH timeseries (RocketETHDailySnapshot)
    if (previousCheckpoint) {
      const snapshotId = checkpoint.blockTime / 86400n;
      let rocketETHDailySnapshot =
        await ctx.RocketETHDailySnapshot.get(snapshotId.toString());
      // NOTE: preserving the original mapping bug — previousRocketETHDailySnapshot
      // is loaded with snapshotId (not previousSnapshotId).
      let previousRocketETHDailySnapshot =
        await ctx.RocketETHDailySnapshot.get(snapshotId.toString());

      if (!rocketETHDailySnapshot) {
        // priorDayPercentage is computed in the original but only used to mutate
        // a midnightExchange local that is never persisted; the prior snapshot is
        // re-saved unchanged. We compute it for parity of control flow.
        if (previousRocketETHDailySnapshot) {
          // (no persisted state change — original re-saves previous snapshot as-is)
          ctx.RocketETHDailySnapshot.set(previousRocketETHDailySnapshot);
        }

        const snapshot: RocketETHDailySnapshot = {
          id: snapshotId.toString(),
          stakerETHActivelyStaking: checkpoint.stakerETHActivelyStaking,
          stakerETHWaitingInDepositPool:
            checkpoint.stakerETHWaitingInDepositPool,
          stakerETHInRocketETHContract: checkpoint.stakerETHInRocketETHContract,
          stakerETHInProtocol: checkpoint.stakerETHInProtocol,
          averageStakerETHRewards: checkpoint.averageStakerETHRewards,
          stakersWithAnRETHBalance: protocol.stakersWithAnRETHBalance,
          totalRETHSupply: checkpoint.totalRETHSupply,
          rETHExchangeRate: checkpoint.rETHExchangeRate,
          block: checkpoint.block,
          blockTime: checkpoint.blockTime,
        };
        ctx.RocketETHDailySnapshot.set(snapshot);
      } else {
        const snapshot: RocketETHDailySnapshot = {
          ...rocketETHDailySnapshot,
          stakerETHActivelyStaking: checkpoint.stakerETHActivelyStaking,
          stakerETHWaitingInDepositPool:
            checkpoint.stakerETHWaitingInDepositPool,
          stakerETHInRocketETHContract: checkpoint.stakerETHInRocketETHContract,
          stakerETHInProtocol: checkpoint.stakerETHInProtocol,
          averageStakerETHRewards: checkpoint.averageStakerETHRewards,
          stakersWithAnRETHBalance: protocol.stakersWithAnRETHBalance,
          totalRETHSupply: checkpoint.totalRETHSupply,
          rETHExchangeRate: checkpoint.rETHExchangeRate,
          block: checkpoint.block,
          blockTime: checkpoint.blockTime,
        };
        ctx.RocketETHDailySnapshot.set(snapshot);
      }
      // silence unused warnings while preserving original locals
      void bigDecimalToBigInt;
      void bd;
    }

    protocol.lastNetworkStakerBalanceCheckPoint = checkpoint.id;

    ctx.NetworkStakerBalanceCheckpoint.set(checkpoint);
    if (previousCheckpoint)
      ctx.NetworkStakerBalanceCheckpoint.set(previousCheckpoint);
    ctx.RocketPoolProtocol.set(protocol);
  }
);
