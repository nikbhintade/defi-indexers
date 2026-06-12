/**
 * Port of src/mappingHelpers/token.ts.
 *
 * The original's generic `getTokenPriceUsd<T>` dispatched on entity type via
 * `instanceof`; the port exposes the three concrete functions and call sites
 * pick the right one (statically known in every case).
 */
import type { BigDecimal, BaseToken, CollateralToken, Token } from "envio";
import type { Ctx, Ev, Mutable } from "../common/types";
import { PRICE_FEED_FACTOR, ZERO_ADDRESS, ZERO_BD, ZERO_BI } from "../common/constants";
import { bigIntBytes, hexConcat, utf8Hex } from "../common/graphBytes";
import {
  getChainlinkCompUsdPriceFeedAddress,
  getCompTokenAddress,
  getMarketUnitOfAccountToUsdPriceFeed,
} from "../common/networkSpecific";
import { formatUnits, toBD } from "../common/utils";
import {
  chainlinkLatestAnswer,
  cometAddress,
  cometGetAssetInfoByAddress,
  cometGetPrice,
  erc20Decimals,
  erc20Name,
  erc20Symbol,
} from "../effects/contracts";

////
// Token
////

export async function getOrCreateToken(ctx: Ctx, address: string, _event: Ev): Promise<Mutable<Token>> {
  let token = await ctx.Token.get(address);

  if (!token) {
    const tryName = await erc20Name(ctx.effect, address);
    const trySymbol = await erc20Symbol(ctx.effect, address);
    // Non-try call in the original (graph-node would abort the subgraph on
    // revert); the port logs and falls back to 0.
    const decimals = await erc20Decimals(ctx.effect, address);
    if (decimals === null) {
      ctx.log.error(`erc20.decimals() reverted for ${address} (original would abort); falling back to 0`);
    }

    token = {
      id: address,
      address: address,
      name: tryName === null ? "UNKNOWN" : tryName,
      symbol: trySymbol === null ? "UNKNOWN" : trySymbol,
      decimals: decimals ?? 0,
      lastPriceBlockNumber: ZERO_BI,
      lastPriceUsd: ZERO_BD,
    };

    ctx.Token.set(token);
  }

  return { ...token };
}

////
// Base Token
////

export async function getOrCreateBaseToken(
  ctx: Ctx,
  market: { id: string },
  token: Token,
  event: Ev,
): Promise<Mutable<BaseToken>> {
  const id = hexConcat(market.id, token.id);
  let baseToken = await ctx.BaseToken.get(id);

  if (!baseToken) {
    const created: Mutable<BaseToken> = {
      id,
      creationBlockNumber: BigInt(event.block.number),
      market_id: market.id,
      token_id: token.id,
      lastPriceBlockNumber: ZERO_BI,
      lastPriceUsd: ZERO_BD,
      lastConfigUpdateBlockNumber: ZERO_BI,
      priceFeed: ZERO_ADDRESS,
    };

    await updateBaseTokenConfig(ctx, created, event);

    ctx.BaseToken.set({ ...created });
    return created;
  }

  return { ...baseToken };
}

export async function updateBaseTokenConfig(ctx: Ctx, baseToken: Mutable<BaseToken>, event: Ev): Promise<void> {
  baseToken.lastConfigUpdateBlockNumber = BigInt(event.block.number);
  // Non-try call in the original; fall back to the zero address on revert.
  const priceFeed = await cometAddress(ctx.effect, baseToken.market_id, "baseTokenPriceFeed", event.block.number);
  if (priceFeed === null) {
    ctx.log.error(`comet.baseTokenPriceFeed() reverted for ${baseToken.market_id} (original would abort)`);
  }
  baseToken.priceFeed = priceFeed ?? ZERO_ADDRESS;
}

////
// Collateral Asset
////

export async function getOrCreateCollateralToken(
  ctx: Ctx,
  market: { id: string },
  token: Token,
  event: Ev,
): Promise<Mutable<CollateralToken>> {
  const id = hexConcat(market.id, token.id, utf8Hex("COL"));
  let collateralToken = await ctx.CollateralToken.get(id);

  if (!collateralToken) {
    const created: Mutable<CollateralToken> = {
      id,
      creationBlockNumber: BigInt(event.block.number),
      market_id: market.id,
      token_id: token.id,
      lastPriceBlockNumber: ZERO_BI,
      lastPriceUsd: ZERO_BD,
      lastConfigUpdateBlockNumber: ZERO_BI,
      priceFeed: ZERO_ADDRESS,
      borrowCollateralFactor: ZERO_BD,
      liquidateCollateralFactor: ZERO_BD,
      liquidationFactor: ZERO_BD,
      supplyCap: ZERO_BI,
    };

    await updateCollateralTokenConfig(ctx, created, event);

    ctx.CollateralToken.set({ ...created });
    return created;
  }

  return { ...collateralToken };
}

export async function updateCollateralTokenConfig(
  ctx: Ctx,
  collateralToken: Mutable<CollateralToken>,
  event: Ev,
): Promise<void> {
  // Non-try call in the original; fall back to zeros on revert.
  const assetInfo = await cometGetAssetInfoByAddress(
    ctx.effect,
    collateralToken.market_id,
    collateralToken.token_id,
    event.block.number,
  );
  if (assetInfo === null) {
    ctx.log.error(
      `comet.getAssetInfoByAddress(${collateralToken.token_id}) reverted for ${collateralToken.market_id} (original would abort)`,
    );
  }

  collateralToken.lastConfigUpdateBlockNumber = BigInt(event.block.number);
  collateralToken.priceFeed = assetInfo ? assetInfo.priceFeed : ZERO_ADDRESS;
  collateralToken.borrowCollateralFactor = formatUnits(assetInfo ? assetInfo.borrowCollateralFactor : 0n, 18);
  collateralToken.liquidateCollateralFactor = formatUnits(assetInfo ? assetInfo.liquidateCollateralFactor : 0n, 18);
  collateralToken.liquidationFactor = formatUnits(assetInfo ? assetInfo.liquidationFactor : 0n, 18);
  collateralToken.supplyCap = assetInfo ? assetInfo.supplyCap : ZERO_BI;
}

export function createCollateralTokenSnapshot(ctx: Ctx, collateralToken: CollateralToken, event: Ev): CollateralToken {
  const snapshotId = hexConcat(
    collateralToken.id,
    bigIntBytes(BigInt(event.block.number)),
    bigIntBytes(BigInt(event.logIndex)),
  );

  const snapshot: CollateralToken = { ...collateralToken, id: snapshotId };

  ctx.CollateralToken.set(snapshot);

  return snapshot;
}

////
// Price
////

function getPriceFeedAddressForToken(ctx: Ctx, token: Token): string {
  // Other feeds can be added here also
  if (token.address === getCompTokenAddress()) {
    return getChainlinkCompUsdPriceFeedAddress();
  } else {
    ctx.log.warn(`getPriceFeedAddressForToken - no price feed for ${token.address}`);
    return ZERO_ADDRESS;
  }
}

export async function getTokenPriceWithGenericOracleUsd(
  ctx: Ctx,
  token: Mutable<Token>,
  event: Ev,
): Promise<BigDecimal> {
  if (token.lastPriceBlockNumber !== BigInt(event.block.number)) {
    const priceFeedAddress = getPriceFeedAddressForToken(ctx, token);

    if (ZERO_ADDRESS !== priceFeedAddress) {
      const tryLatestAnswer = await chainlinkLatestAnswer(ctx.effect, priceFeedAddress, event.block.number);
      if (tryLatestAnswer !== null) {
        const price = toBD(tryLatestAnswer).div(PRICE_FEED_FACTOR);
        token.lastPriceBlockNumber = BigInt(event.block.number);
        token.lastPriceUsd = price;
        ctx.Token.set({ ...token });
      } else {
        ctx.log.warn(
          `getTokenPriceWithGenericOracleUsd - try_latestRoundData reverted for ${priceFeedAddress} - ${token.address}`,
        );
      }
    }
  }

  return token.lastPriceUsd;
}

export async function getBaseTokenPriceUsd(ctx: Ctx, token: Mutable<BaseToken>, event: Ev): Promise<BigDecimal> {
  if (token.lastPriceBlockNumber !== BigInt(event.block.number)) {
    const tryPrice = await cometGetPrice(ctx.effect, token.market_id, token.priceFeed, event.block.number);

    if (tryPrice !== null) {
      let price = toBD(tryPrice).div(PRICE_FEED_FACTOR); // In unit of account

      const unitOfAccountToUsdPriceFeed = getMarketUnitOfAccountToUsdPriceFeed(token.market_id);
      if (unitOfAccountToUsdPriceFeed !== ZERO_ADDRESS) {
        // Non-try call in the original; fall back to 0 on revert.
        const unitOfAccountPrice = await cometGetPrice(
          ctx.effect,
          token.market_id,
          unitOfAccountToUsdPriceFeed,
          event.block.number,
        );
        if (unitOfAccountPrice === null) {
          ctx.log.error(`comet.getPrice(${unitOfAccountToUsdPriceFeed}) reverted for ${token.market_id} (original would abort)`);
        }
        const unitOfAccountPriceUsd = toBD(unitOfAccountPrice ?? 0n).div(PRICE_FEED_FACTOR);
        price = price.times(unitOfAccountPriceUsd);
      }

      token.lastPriceBlockNumber = BigInt(event.block.number);
      token.lastPriceUsd = price;
      ctx.BaseToken.set({ ...token });
    }
  }

  return token.lastPriceUsd;
}

export async function getCollateralTokenPriceUsd(
  ctx: Ctx,
  token: Mutable<CollateralToken>,
  event: Ev,
): Promise<BigDecimal> {
  // Original quirk: the function captures `price` before updating, then a
  // shadowed `let price` inside the if-block receives the fresh value — so
  // the entity is updated with the new price but the STALE price is
  // returned. Replicated exactly.
  const price = token.lastPriceUsd;

  if (token.lastPriceBlockNumber !== BigInt(event.block.number)) {
    const tryPrice = await cometGetPrice(ctx.effect, token.market_id, token.priceFeed, event.block.number);

    if (tryPrice !== null) {
      let freshPrice = toBD(tryPrice).div(PRICE_FEED_FACTOR);

      const unitOfAccountToUsdPriceFeed = getMarketUnitOfAccountToUsdPriceFeed(token.market_id);
      if (unitOfAccountToUsdPriceFeed !== ZERO_ADDRESS) {
        // Non-try call in the original; fall back to 0 on revert.
        const unitOfAccountPrice = await cometGetPrice(
          ctx.effect,
          token.market_id,
          unitOfAccountToUsdPriceFeed,
          event.block.number,
        );
        if (unitOfAccountPrice === null) {
          ctx.log.error(`comet.getPrice(${unitOfAccountToUsdPriceFeed}) reverted for ${token.market_id} (original would abort)`);
        }
        const unitOfAccountPriceUsd = toBD(unitOfAccountPrice ?? 0n).div(PRICE_FEED_FACTOR);
        freshPrice = freshPrice.times(unitOfAccountPriceUsd);
      }

      token.lastPriceBlockNumber = BigInt(event.block.number);
      token.lastPriceUsd = freshPrice;
      ctx.CollateralToken.set({ ...token });
    }
  }

  return price;
}
