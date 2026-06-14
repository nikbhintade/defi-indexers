/**
 * Port of src/mappings/yieldBtc.ts — Yield (YieldBTC NFT) Transfer handler.
 * On mint (from == 0x0), creates a YieldBTC entity keyed by the reward receiver.
 *
 * eth_call (block-pinned, via Effect): Yield.tokenIdToRewardReceiver(tokenId).
 */
import { indexer } from "envio";
import { ADDRESS_ZERO, YIELD_BTC, ZERO_BI } from "../constants";
import { low } from "../utils";
import { createLottery } from "../services/helpers";
import { LOTTERY } from "../constants";
import { tokenIdToRewardReceiver } from "../effects/contracts";

const YIELD = low(YIELD_BTC);

indexer.onEvent({ contract: "Yield", event: "Transfer" }, async ({ event, context }) => {
  let lottery = await context.Lottery.get(low(LOTTERY));
  if (!lottery) lottery = createLottery(context);

  const from = low(event.params.from);
  if (from === ADDRESS_ZERO) {
    const receiver = await tokenIdToRewardReceiver(context.effect, YIELD, event.params.tokenId, event.block.number);
    if (receiver === null) return;
    const rec = low(receiver);
    context.YieldBTC.set({
      id: rec,
      isDeposited: false,
      user_id: low(event.params.to),
      order_id: rec,
      tokenId: event.params.tokenId,
      roundReward: ZERO_BI,
      updatedRound: ZERO_BI,
    });
  }
});
