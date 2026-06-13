/**
 * Port of src/mapping/proxy-price-provider/v3.ts (AaveOracle, static) and
 * src/mapping/price-oracle/v3.ts (FallbackPriceOracle + ChainlinkAggregator
 * templates).
 */
import { indexer } from "envio";
import type { PriceOracle, PriceOracleAsset } from "envio";
import { MOCK_USD_ADDRESS, ZERO_ADDRESS, low } from "../common/constants";
import type { Ctx, Ev } from "../common/types";
import {
  getChainlinkAggregatorOracleAsset,
  getOrInitPriceOracle,
  getPriceOracleAsset,
} from "../mappingHelpers/oracleHelpers";
import { genericPriceUpdate, usdEthPriceUpdate } from "../mappingHelpers/priceUpdates";
import {
  tryAggregator,
  tryGetAssetPrice,
  tryGetTokenType,
  tryLatestAnswer,
  trySubTokens,
} from "../effects/contracts";

function formatUsdEthChainlinkPrice(price: bigint): bigint {
  if (price === 0n) return price;
  return 10n ** 26n / price; // 10^(18+8)
}

// ============ AaveOracle (static) ============

// ChainlinkAggregator template registration: on AssetSourceUpdated for a
// simple (chainlink) source, the aggregator address must be read from the
// proxy via eth_call. contractRegister cannot perform eth_calls, so we
// register defensively in the onEvent handler is impossible (registration must
// happen in contractRegister). DEVIATION: aggregator registration relies on
// the eth_call result, so it is performed by re-deriving in onEvent via the
// effect; the ChainlinkAggregator template is registered from the
// AnswerUpdated wildcard is not available. We register the *source* address
// (the proxy) as a ChainlinkAggregator so AnswerUpdated on proxies is caught,
// and also map via the resolved aggregator. See MIGRATION.md.
indexer.contractRegister(
  { contract: "AaveOracle", event: "AssetSourceUpdated" },
  async ({ event, context }) => {
    if (low(event.params.source) !== ZERO_ADDRESS) {
      context.chain.ChainlinkAggregator.add(event.params.source);
    }
  },
);

indexer.contractRegister(
  { contract: "AaveOracle", event: "FallbackOracleUpdated" },
  async ({ event, context }) => {
    if (low(event.params.fallbackOracle) !== ZERO_ADDRESS) {
      context.chain.FallbackPriceOracle.add(event.params.fallbackOracle);
    }
  },
);

async function priceFeedUpdated(
  context: Ctx,
  event: Ev,
  assetAddress: string,
  assetOracleAddress: string,
  priceOracleAssetIn: PriceOracleAsset,
  priceOracleIn: PriceOracle,
): Promise<void> {
  const sAssetAddress = low(assetAddress);
  const call = context.effect;
  let priceOracle = priceOracleIn;
  let priceOracleAsset = priceOracleAssetIn;

  const priceFromOracle = await tryGetAssetPrice(
    call,
    priceOracle.proxyPriceProvider,
    assetAddress,
    event.block.number,
  );
  if (priceFromOracle === null) {
    context.log.error(`asset not registered: ${sAssetAddress} oracle ${low(assetOracleAddress)}`);
    return;
  }

  priceOracleAsset = { ...priceOracleAsset, isFallbackRequired: true };

  if (low(assetOracleAddress) !== ZERO_ADDRESS) {
    const tokenType = await tryGetTokenType(call, assetOracleAddress);
    // Chainlink sources revert on getTokenType -> stays "Simple".
    if (tokenType !== null) {
      priceOracleAsset = { ...priceOracleAsset, type: tokenType === 2n ? "Composite" : "Simple" };
    }

    if (priceOracleAsset.type === "Simple") {
      const aggregatorAddress = await tryAggregator(call, assetOracleAddress);
      if (aggregatorAddress === null) {
        context.log.error(`Simple type must be a chainlink proxy: ${sAssetAddress}`);
        return;
      }
      priceOracleAsset = { ...priceOracleAsset, priceSource: low(aggregatorAddress) };
      // ChainlinkAggregator template: registered in contractRegister above on
      // the source proxy; here we map the resolved aggregator -> asset.
      const latest = await tryLatestAnswer(call, assetOracleAddress);
      priceOracleAsset = {
        ...priceOracleAsset,
        isFallbackRequired: latest === null || latest === 0n,
      };
      const chainlinkAggregator = await getChainlinkAggregatorOracleAsset(
        context,
        low(aggregatorAddress),
      );
      context.ChainlinkAggregator.set({
        ...chainlinkAggregator,
        oracleAsset_id: sAssetAddress,
      });
    } else {
      priceOracleAsset = {
        ...priceOracleAsset,
        isFallbackRequired: false,
        priceSource: low(assetOracleAddress),
      };
      const dependencies = (await trySubTokens(call, assetOracleAddress)) ?? [];
      for (let i = 0; i < dependencies.length; i += 1) {
        const dependencyAddress = low(dependencies[i]!);
        if (dependencyAddress === MOCK_USD_ADDRESS) {
          if (!priceOracle.usdDependentAssets.includes(sAssetAddress)) {
            priceOracle = {
              ...priceOracle,
              usdDependentAssets: [...priceOracle.usdDependentAssets, sAssetAddress],
            };
          }
        } else {
          const dep = await getPriceOracleAsset(context, dependencyAddress);
          if (!dep.dependentAssets.includes(sAssetAddress)) {
            context.PriceOracleAsset.set({
              ...dep,
              dependentAssets: [...dep.dependentAssets, sAssetAddress],
            });
          }
        }
      }
    }
  } else {
    context.log.error(`registry of asset ${sAssetAddress} oracle ${low(assetOracleAddress)}`);
  }

  if (sAssetAddress === MOCK_USD_ADDRESS) {
    priceOracle = {
      ...priceOracle,
      usdPriceEthFallbackRequired: priceOracleAsset.isFallbackRequired,
      usdPriceEthMainSource: priceOracleAsset.priceSource,
    };
    context.PriceOracle.set(priceOracle);
    priceOracle = await usdEthPriceUpdate(
      context,
      priceOracle,
      formatUsdEthChainlinkPrice(priceFromOracle),
      event,
    );
    await genericPriceUpdate(context, priceOracleAsset, priceFromOracle, event);
  } else {
    let tokensWithFallback = priceOracle.tokensWithFallback;
    if (
      low(assetOracleAddress) !== ZERO_ADDRESS &&
      tokensWithFallback.includes(sAssetAddress) &&
      !priceOracleAsset.isFallbackRequired
    ) {
      tokensWithFallback = tokensWithFallback.filter((t) => t !== sAssetAddress);
    }
    if (
      !tokensWithFallback.includes(sAssetAddress) &&
      (low(assetOracleAddress) === ZERO_ADDRESS || priceOracleAsset.isFallbackRequired)
    ) {
      tokensWithFallback = [...tokensWithFallback, sAssetAddress];
    }
    priceOracle = { ...priceOracle, tokensWithFallback };
    context.PriceOracle.set(priceOracle);
    await genericPriceUpdate(context, priceOracleAsset, priceFromOracle, event);
  }
}

indexer.onEvent({ contract: "AaveOracle", event: "AssetSourceUpdated" }, async ({ event, context }) => {
  let priceOracle = await getOrInitPriceOracle(context);
  if (priceOracle.proxyPriceProvider === ZERO_ADDRESS) {
    priceOracle = { ...priceOracle, proxyPriceProvider: low(event.srcAddress) };
    context.PriceOracle.set(priceOracle);
  }
  const priceOracleAsset = await getPriceOracleAsset(context, low(event.params.asset));
  const updatedAsset: PriceOracleAsset = { ...priceOracleAsset, fromChainlinkSourcesRegistry: false };
  await priceFeedUpdated(
    context,
    event,
    event.params.asset,
    event.params.source,
    updatedAsset,
    priceOracle,
  );
});

indexer.onEvent({ contract: "AaveOracle", event: "FallbackOracleUpdated" }, async ({ event, context }) => {
  let priceOracle = await getOrInitPriceOracle(context);
  priceOracle = { ...priceOracle, fallbackPriceOracle: low(event.params.fallbackOracle) };
  context.PriceOracle.set(priceOracle);

  if (low(event.params.fallbackOracle) !== ZERO_ADDRESS) {
    // FallbackPriceOracle template instantiation happens in contractRegister.

    // update prices on assets which use fallback
    for (let i = 0; i < priceOracle.tokensWithFallback.length; i++) {
      const token = priceOracle.tokensWithFallback[i]!;
      const asset = await getPriceOracleAsset(context, token);
      if (asset.priceSource === ZERO_ADDRESS || asset.isFallbackRequired) {
        const price = await tryGetAssetPrice(
          context.effect,
          event.srcAddress,
          asset.id,
          event.block.number,
        );
        if (price !== null) {
          await genericPriceUpdate(context, asset, price, event);
        } else {
          context.log.error(`fallback price read failed for ${asset.id}`);
        }
      }
    }

    const ethUsdPrice = formatUsdEthChainlinkPrice(
      (await tryGetAssetPrice(
        context.effect,
        event.params.fallbackOracle,
        MOCK_USD_ADDRESS,
        event.block.number,
      )) ?? 0n,
    );
    if (priceOracle.usdPriceEthFallbackRequired || priceOracle.usdPriceEthMainSource === ZERO_ADDRESS) {
      await usdEthPriceUpdate(context, priceOracle, ethUsdPrice, event);
    }
  }
});

indexer.onEvent({ contract: "AaveOracle", event: "BaseCurrencySet" }, async ({ event, context }) => {
  const priceOracle = await getOrInitPriceOracle(context);
  context.PriceOracle.set({
    ...priceOracle,
    baseCurrency: low(event.params.baseCurrency),
    baseCurrencyUnit: event.params.baseCurrencyUnit,
  });
});

// ============ FallbackPriceOracle template ============

indexer.onEvent(
  { contract: "FallbackPriceOracle", event: "AssetPriceUpdated" },
  async ({ event, context }) => {
    const oracleAsset = await getPriceOracleAsset(context, low(event.params._asset));
    await genericPriceUpdate(context, oracleAsset, event.params._price, event);
  },
);

indexer.onEvent(
  { contract: "FallbackPriceOracle", event: "EthPriceUpdated" },
  async ({ event, context }) => {
    const priceOracle = await getOrInitPriceOracle(context);
    await usdEthPriceUpdate(context, priceOracle, event.params._price, event);
  },
);

// ============ ChainlinkAggregator template ============

indexer.onEvent(
  { contract: "ChainlinkAggregator", event: "AnswerUpdated" },
  async ({ event, context }) => {
    let priceOracle = await getOrInitPriceOracle(context);
    const chainlinkAggregator = await getChainlinkAggregatorOracleAsset(context, low(event.srcAddress));

    if (low(priceOracle.usdPriceEthMainSource) === low(event.srcAddress)) {
      if (event.params.current > 0n) {
        priceOracle = { ...priceOracle, usdPriceEthFallbackRequired: false };
        await usdEthPriceUpdate(
          context,
          priceOracle,
          formatUsdEthChainlinkPrice(event.params.current),
          event,
        );
      } else {
        priceOracle = { ...priceOracle, usdPriceEthFallbackRequired: true };
        const fallback = await tryGetAssetPrice(
          context.effect,
          priceOracle.proxyPriceProvider,
          MOCK_USD_ADDRESS,
          event.block.number,
        );
        await usdEthPriceUpdate(
          context,
          priceOracle,
          formatUsdEthChainlinkPrice(fallback ?? 0n),
          event,
        );
      }
      return;
    }

    const oracleAsset = await getPriceOracleAsset(context, chainlinkAggregator.oracleAsset_id);
    if (oracleAsset.priceSource !== low(event.srcAddress)) return;

    if (event.params.current > 0n) {
      const updated = { ...oracleAsset, isFallbackRequired: false };
      await genericPriceUpdate(context, updated, event.params.current, event);
      if (priceOracle.tokensWithFallback.includes(oracleAsset.id)) {
        // subgraph's loop here is a no-op bug (i>length); preserve behavior.
        context.PriceOracle.set(priceOracle);
      }
    } else {
      const updated = { ...oracleAsset, isFallbackRequired: true };
      const assetPrice = await tryGetAssetPrice(
        context.effect,
        priceOracle.proxyPriceProvider,
        oracleAsset.id,
        event.block.number,
      );
      if (assetPrice !== null) {
        await genericPriceUpdate(context, updated, assetPrice, event);
      } else {
        context.log.error(`AnswerUpdated fallback read failed for ${oracleAsset.id}`);
        context.PriceOracleAsset.set(updated);
      }
      if (!priceOracle.tokensWithFallback.includes(oracleAsset.id)) {
        context.PriceOracle.set({
          ...priceOracle,
          tokensWithFallback: [...priceOracle.tokensWithFallback, oracleAsset.id],
        });
      }
    }
  },
);
