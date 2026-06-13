/**
 * Port of PSM (Peg Stability Module) SellGem/BuyGem fee revenue handlers.
 * Three static PSM instances (USDC-A, PAX-A, GUSD-A) share one handler.
 */
import { indexer } from "envio";
import { toEventInfo } from "../common/event";
import type { EventInfo, Ctx } from "../common/types";
import { WAD, BIGDECIMAL_ZERO, ProtocolSideRevenueType } from "../common/constants";
import { bigIntToBDUseDecimals } from "../utils/numbers";
import { getMarketAddressFromIlk } from "../common/getters";
import { updateRevenue } from "../common/helpers";
import { psmIlk } from "../effects/contracts";

async function handleSwapFee(ctx: Ctx, ev: EventInfo, fee: bigint): Promise<void> {
  const feeUSD = bigIntToBDUseDecimals(fee, WAD);
  const ilk = await psmIlk(ev.effect, ev.srcAddress);
  if (ilk == null) return;
  const marketID = await getMarketAddressFromIlk(ctx, ilk);
  if (marketID == null) return;
  await updateRevenue(ctx, ev, marketID, feeUSD, BIGDECIMAL_ZERO, ProtocolSideRevenueType.PSM);
}

for (const psm of ["PsmUsdcA", "PsmPaxA", "PsmGusdA"] as const) {
  indexer.onEvent({ contract: psm, event: "SellGem" }, async ({ event, context }) => {
    const ev = toEventInfo(event, context.effect);
    await handleSwapFee(context, ev, event.params.fee);
  });
  indexer.onEvent({ contract: psm, event: "BuyGem" }, async ({ event, context }) => {
    const ev = toEventInfo(event, context.effect);
    await handleSwapFee(context, ev, event.params.fee);
  });
}
