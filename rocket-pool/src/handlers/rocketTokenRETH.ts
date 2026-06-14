/**
 * Ported from src/mappings/rocketTokenRETHMapping.ts.
 * rETH Transfer (mint/burn/transfer) -> Staker balances + RocketETHTransaction.
 *
 * eth_call: rocketTokenRETH.getExchangeRate() (block-pinned).
 */
import { indexer } from "envio";
import {
  a,
  ZERO_ADDRESS_STRING,
  ROCKET_TOKEN_RETH_CONTRACT_ADDRESS,
} from "../constants";
import {
  type HandlerContext,
  type Mutable,
  extractIdForEntity,
  getOrCreateProtocol,
  createStaker,
  createRocketETHTransaction,
} from "../helpers";
import { getExchangeRate } from "../effects";
import type { Staker } from "envio";

/** stakerUtilities.changeStakerBalances */
function changeStakerBalances(
  staker: Mutable<Staker>,
  rEthAmount: bigint,
  increase: boolean
): void {
  if (staker.id === ZERO_ADDRESS_STRING) return;
  if (increase) {
    staker.rETHBalance = staker.rETHBalance + rEthAmount;
  } else {
    if (staker.rETHBalance >= rEthAmount)
      staker.rETHBalance = staker.rETHBalance - rEthAmount;
    else staker.rETHBalance = 0n;
  }
}

indexer.onEvent(
  { contract: "RocketTokenRETH", event: "Transfer" },
  async ({ event, context }) => {
    const ctx = context as HandlerContext;
    const id = extractIdForEntity(event);

    // Preliminary check to ensure we haven't handled this before.
    if (await ctx.RocketETHTransaction.get(id)) return;

    const fromAddr = a(event.params.from);
    const toAddr = a(event.params.to);
    const rETHAmount = event.params.value;
    const blockNumber = BigInt(event.block.number);
    const blockTime = BigInt(event.block.timestamp);

    // getTransactionStakers: load or create both stakers.
    let from: Mutable<Staker> =
      (await ctx.Staker.get(fromAddr)) ??
      createStaker(fromAddr, blockNumber, blockTime);
    let to: Mutable<Staker> =
      (await ctx.Staker.get(toAddr)) ??
      createStaker(toAddr, blockNumber, blockTime);
    from = { ...from };
    to = { ...to };

    // saveTransaction
    const rEthTransaction = createRocketETHTransaction(
      id,
      from.id,
      to.id,
      rETHAmount,
      event
    );

    const protocol = { ...(await getOrCreateProtocol(ctx)) };

    // exchange rate (block-pinned eth_call)
    const exchangeRate = await getExchangeRate(
      ctx.effect,
      ROCKET_TOKEN_RETH_CONTRACT_ADDRESS,
      event.block.number
    );

    changeStakerBalances(from, rETHAmount, false);
    changeStakerBalances(to, rETHAmount, true);

    // protocol.stakers
    const stakers = protocol.stakers.slice();
    if (stakers.indexOf(from.id) === -1) stakers.push(from.id);
    if (stakers.indexOf(to.id) === -1) stakers.push(to.id);
    protocol.stakers = stakers;

    // protocol.activeStakers + stakersWithAnRETHBalance
    const activeStakers = protocol.activeStakers.slice();
    if (from.rETHBalance > 0n && activeStakers.indexOf(from.id) === -1) {
      activeStakers.push(from.id);
      protocol.stakersWithAnRETHBalance = protocol.stakersWithAnRETHBalance + 1n;
    } else if (
      from.rETHBalance === 0n &&
      activeStakers.indexOf(from.id) !== -1
    ) {
      activeStakers.splice(activeStakers.indexOf(from.id), 1);
      protocol.stakersWithAnRETHBalance = protocol.stakersWithAnRETHBalance - 1n;
    }

    if (to.rETHBalance > 0n && activeStakers.indexOf(to.id) === -1) {
      activeStakers.push(to.id);
      protocol.stakersWithAnRETHBalance = protocol.stakersWithAnRETHBalance + 1n;
    } else if (to.rETHBalance === 0n && activeStakers.indexOf(to.id) !== -1) {
      activeStakers.splice(activeStakers.indexOf(to.id), 1);
      protocol.stakersWithAnRETHBalance = protocol.stakersWithAnRETHBalance - 1n;
    }
    protocol.activeStakers = activeStakers;

    // Recipient avg rETH entry + entry time (weighted averages).
    if (exchangeRate > 0n && to.rETHBalance > 0n) {
      const priorETH = (to.rETHBalance - rETHAmount) * to.avgEntry;
      const inputETH = rETHAmount * exchangeRate;
      to.avgEntry = (priorETH + inputETH) / to.rETHBalance;

      const priorTime = to.AvgEntryTime * priorETH;
      const inputTime = blockTime * inputETH;
      to.AvgEntryTime = (priorTime + inputTime) / (to.rETHBalance * exchangeRate);
    }

    // zero out avg upon total exit
    if (from.rETHBalance === 0n) {
      from.avgEntry = 0n;
      from.AvgEntryTime = 0n;
    }

    ctx.Staker.set(from);
    ctx.Staker.set(to);
    ctx.RocketETHTransaction.set(rEthTransaction);
    ctx.RocketPoolProtocol.set(protocol);
  }
);
