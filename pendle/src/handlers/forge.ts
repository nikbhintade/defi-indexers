/**
 * Port of src/pendle/forge.ts (IPendleForge template handlers):
 * handleNewYieldContracts / handleMintYieldToken / handleRedeemYieldContracts.
 */
import { indexer, type YieldContract } from "envio";
import { ONE_BI, ZERO_BD, ZERO_BI, convertTokenToDecimal, forgeIdToString, low } from "../utils";
import { generateNewToken } from "../services/tokens";
import { fetchTokenTotalSupply } from "../services/tokens";
import { getUniswapTokenPrice } from "../services/pricing";
import { printDebug } from "../services/helpers";

indexer.onEvent({ contract: "IPendleForge", event: "NewYieldContracts" }, async ({ event, context }) => {
  const block = event.block.number;
  const forgeId = forgeIdToString(event.params.forgeId);
  const underlyingToken = await generateNewToken(context, low(event.params.underlyingAsset), block);
  const yieldBearingToken0 = await generateNewToken(context, low(event.params.yieldBearingAsset), block);
  const xytToken0 = await generateNewToken(context, low(event.params.xyt), block);
  const otToken0 = await generateNewToken(context, low(event.params.ot), block);

  // Setting up yield tokens
  const xytToken = { ...xytToken0, forgeId, underlyingAsset: yieldBearingToken0.id, type: "yt" };
  const otToken = { ...otToken0, forgeId, underlyingAsset: yieldBearingToken0.id, type: "ot" };
  const yieldBearingToken = {
    ...yieldBearingToken0,
    forgeId,
    underlyingAsset: underlyingToken.id,
    type: "yieldBearing",
  };

  context.Token.set(xytToken);
  context.Token.set(otToken);
  context.Token.set(yieldBearingToken);

  const yieldContract: YieldContract = {
    id: forgeId.concat("-").concat(underlyingToken.id).concat("-").concat(event.params.expiry.toString()),
    forgeId,
    underlyingAsset_id: underlyingToken.id,
    yieldBearingAsset_id: yieldBearingToken.id,
    xyt_id: xytToken.id,
    ot_id: otToken.id,
    expiry: event.params.expiry,
    mintTxCount: ZERO_BI,
    redeemTxCount: ZERO_BI,
    interestSettledTxCount: ZERO_BI,
    lockedVolume: ZERO_BD,
    mintVolume: ZERO_BD,
    redeemVolume: ZERO_BD,
    lockedVolumeUSD: ZERO_BD,
    mintVolumeUSD: ZERO_BD,
    redeemVolumeUSD: ZERO_BD,
    interestSettledVolume: ZERO_BD,
  };
  context.YieldContract.set(yieldContract);
});

indexer.onEvent({ contract: "IPendleForge", event: "MintYieldTokens" }, async ({ event, context }) => {
  const block = event.block.number;
  await printDebug(context, event.block.number.toString(), "mint");
  const underlyingToken = await context.Token.getOrThrow(low(event.params.underlyingAsset));
  const forgeId = forgeIdToString(event.params.forgeId);
  const yieldContractid = forgeId.concat("-").concat(underlyingToken.id).concat("-").concat(event.params.expiry.toString());
  const yieldContract = await context.YieldContract.getOrThrow(yieldContractid);
  let xytToken = await context.Token.getOrThrow(yieldContract.xyt_id);
  let otToken = await context.Token.getOrThrow(yieldContract.ot_id);
  const yieldBearingToken = await context.Token.getOrThrow(yieldContract.yieldBearingAsset_id);
  const yieldTokenPrice = await getUniswapTokenPrice(context, block, yieldBearingToken);

  // Getting the mint volume
  const newMintVolume = convertTokenToDecimal(event.params.amountToTokenize, yieldBearingToken.decimals);
  const newMintVolumeUSD = newMintVolume.times(yieldTokenPrice);

  const lockedVolume = yieldContract.lockedVolume.plus(newMintVolume);
  const mintVolume = yieldContract.mintVolume.plus(newMintVolume);
  context.Token.set({ ...underlyingToken, mintVolume: underlyingToken.mintVolume.plus(newMintVolume), txCount: underlyingToken.txCount + ONE_BI });

  const updatedYC: YieldContract = {
    ...yieldContract,
    lockedVolume,
    mintVolume,
    lockedVolumeUSD: lockedVolume.times(yieldTokenPrice),
    mintVolumeUSD: mintVolume.times(yieldTokenPrice),
    mintTxCount: yieldContract.mintTxCount + ONE_BI,
  };
  context.YieldContract.set(updatedYC);

  // Updating OT and XYT total supply
  xytToken = { ...xytToken, totalSupply: await fetchTokenTotalSupply(context, yieldContract.xyt_id, block) };
  otToken = { ...otToken, totalSupply: await fetchTokenTotalSupply(context, yieldContract.ot_id, block) };
  context.Token.set(xytToken);
  context.Token.set(otToken);

  // Creating new MintYieldToken entity (id = tx hash)
  context.MintYieldToken.set({
    id: low(event.transaction.hash),
    mintedValueUSD: newMintVolumeUSD,
    blockNumber: BigInt(event.block.number),
    timestamp: BigInt(event.block.timestamp),
    forgeId,
    amountToTokenize: newMintVolume,
    amountMinted: convertTokenToDecimal(event.params.amountTokenMinted, xytToken.decimals),
    expiry: event.params.expiry,
    from: low(event.transaction.from ?? ""),
    underlyingAsset_id: underlyingToken.id,
    yieldContract_id: updatedYC.id,
    yieldBearingAsset_id: updatedYC.yieldBearingAsset_id,
    xytAsset_id: xytToken.id,
    otAsset_id: otToken.id,
  });
});

indexer.onEvent({ contract: "IPendleForge", event: "RedeemYieldToken" }, async ({ event, context }) => {
  const block = event.block.number;
  const forgeId = forgeIdToString(event.params.forgeId);
  const underlyingToken = await context.Token.getOrThrow(low(event.params.underlyingAsset));
  const yieldContractid = forgeId.concat("-").concat(underlyingToken.id).concat("-").concat(event.params.expiry.toString());
  const yieldContract = await context.YieldContract.getOrThrow(yieldContractid);
  const yieldBearingToken = await context.Token.getOrThrow(yieldContract.yieldBearingAsset_id);

  const newRedeenVolume = convertTokenToDecimal(event.params.redeemedAmount, yieldBearingToken.decimals);
  const yieldTokenPrice = await getUniswapTokenPrice(context, block, yieldBearingToken);
  const newRedeenVolumeUSD = newRedeenVolume.times(yieldTokenPrice);

  const redeemVolume = yieldContract.redeemVolume.plus(newRedeenVolume);
  const lockedVolume = yieldContract.lockedVolume.minus(newRedeenVolume);
  context.Token.set({ ...underlyingToken, redeemVolume: underlyingToken.redeemVolume.plus(newRedeenVolume), txCount: underlyingToken.txCount + ONE_BI });

  const updatedYC: YieldContract = {
    ...yieldContract,
    redeemVolume,
    lockedVolume,
    redeemVolumeUSD: redeemVolume.times(yieldTokenPrice),
    lockedVolumeUSD: lockedVolume.times(yieldTokenPrice),
    redeemTxCount: yieldContract.redeemTxCount + ONE_BI,
  };
  context.YieldContract.set(updatedYC);

  // Updating OT and XYT total supply
  let xytToken = await context.Token.getOrThrow(yieldContract.xyt_id);
  let otToken = await context.Token.getOrThrow(yieldContract.ot_id);
  xytToken = { ...xytToken, totalSupply: await fetchTokenTotalSupply(context, yieldContract.xyt_id, block) };
  otToken = { ...otToken, totalSupply: await fetchTokenTotalSupply(context, yieldContract.ot_id, block) };
  context.Token.set(xytToken);
  context.Token.set(otToken);

  context.RedeemYieldToken.set({
    id: low(event.transaction.hash),
    redeemedValueUSD: newRedeenVolumeUSD,
    blockNumber: BigInt(event.block.number),
    timestamp: BigInt(event.block.timestamp),
    forgeId,
    amountRedeemed: newRedeenVolume,
    amountToRedeem: convertTokenToDecimal(event.params.amountToRedeem, xytToken.decimals),
    expiry: event.params.expiry,
    from: low(event.transaction.from ?? ""),
    underlyingAsset_id: underlyingToken.id,
    yieldBearingAsset_id: updatedYC.yieldBearingAsset_id,
    yieldContract_id: updatedYC.id,
    xytAsset_id: xytToken.id,
    otAsset_id: otToken.id,
  });
});
