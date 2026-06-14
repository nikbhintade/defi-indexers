/**
 * Port of src/mappings/bitcoinStake.ts — BitcoinStake precompile `delegated`.
 * Records the BTC lock tx and, the first time an order is BTC-staked, fills in
 * the order's BTC amount / validator / unlock time and bumps the owner's valid
 * order count.
 *
 * eth_call: `bitcoinStake.btcTxMap(txid).lockTime` (block-pinned) -> Effect.
 */
import { indexer } from "envio";
import { ADDRESS_ZERO } from "../constants";
import { low } from "../utils";
import { btcTxMapLockTime } from "../effects/contracts";

const BITCOIN_STAKE = "0x0000000000000000000000000000000000001014";

indexer.onEvent(
  { contract: "BitcoinStake", event: "delegated" },
  async ({ event, context }) => {
    const txid = low(event.params.txid);

    let lockTx = await context.BtcTxLock.get(txid);
    if (!lockTx) {
      context.BtcTxLock.set({
        id: txid,
        amount: event.params.amount,
        timestamp: BigInt(event.block.timestamp),
      });
    }

    const order = await context.Order.get(low(event.params.delegator));
    if (!order) return;
    if (order.bitcoinLockTx === ADDRESS_ZERO) {
      const user = await context.User.get(order.owner);
      if (!user) return;

      // block-pinned read of btcTxMap(txid).lockTime via Effect
      const lt = await btcTxMapLockTime(
        context.effect,
        BITCOIN_STAKE,
        txid,
        event.block.number,
      );

      context.User.set({ ...user, totalValidOrder: user.totalValidOrder + 1 });
      context.Order.set({
        ...order,
        btcAmount: event.params.amount,
        unlockTime: lt ?? 0,
        validator: low(event.params.candidate),
        bitcoinLockTx: txid,
        confirmTimestamp: BigInt(event.block.timestamp),
      });
    }
  },
);
