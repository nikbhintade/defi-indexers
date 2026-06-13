/**
 * Port of src/pendle/directory.ts (Directory data source handler).
 *
 * `PendleLiquidityMiningV2.create(newAddress)` -> contractRegister adding the
 * LM address to the PendleLiquidityMiningV2 template contract.
 */
import { indexer } from "envio";
import { forgeIdToString, low } from "../utils";
import { lm2StakeToken } from "../effects/contracts";
import { printDebug } from "../services/helpers";

indexer.contractRegister({ contract: "Directory", event: "NewAddress" }, async ({ event, context }) => {
  if (forgeIdToString(event.params.contractType) == "LiqMiningV2") {
    context.chain.PendleLiquidityMiningV2.add(event.params.contractAddress);
  }
});

indexer.onEvent({ contract: "Directory", event: "NewAddress" }, async ({ event, context }) => {
  const addressNote = forgeIdToString(event.params.contractType);
  const newAddress = low(event.params.contractAddress);
  if (addressNote == "LiqMiningV2") {
    const token = (await lm2StakeToken(context.effect, newAddress)) ?? "";
    context.LiquidityMining.set({ id: low(token), lmAddress: newAddress });
    await printDebug(context, low(token).concat("-").concat(newAddress), "lmv2");
  }
});
