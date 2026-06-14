import type { MarketInfo } from "envio";
import type { handlerContext } from "../types";
import { marketConfigs } from "../config/markets";
import type { EventData } from "../utils/eventData";

export async function saveMarketInfo(context: handlerContext, eventData: EventData): Promise<MarketInfo> {
  const id = eventData.getAddressItemString("marketToken")!;
  const marketInfo: MarketInfo = {
    id,
    marketToken: id,
    indexToken: eventData.getAddressItemString("indexToken")!,
    longToken: eventData.getAddressItemString("longToken")!,
    shortToken: eventData.getAddressItemString("shortToken")!,
    marketTokensSupply: 0n,
    marketTokensSupplyFromPoolUpdated: undefined,
  };
  context.MarketInfo.set(marketInfo);
  return marketInfo;
}

export async function getMarketInfo(context: handlerContext, marketAddress: string): Promise<MarketInfo> {
  let entity = await context.MarketInfo.get(marketAddress);

  if (!entity) {
    const marketConfig = marketConfigs.get(marketAddress);

    if (marketConfig) {
      entity = {
        id: marketAddress,
        marketToken: marketConfig.marketToken,
        indexToken: marketConfig.indexToken,
        longToken: marketConfig.longToken,
        shortToken: marketConfig.shortToken,
        marketTokensSupply: 0n,
        marketTokensSupplyFromPoolUpdated: undefined,
      };
      context.MarketInfo.set(entity);
    } else if (context.isPreload) {
      // During the concurrent preload pass, an entity created by an earlier
      // event in the same batch is not yet visible. Return a transient
      // placeholder (not persisted) so the preloading handler can complete;
      // the sequential real pass will read the committed MarketInfo. This
      // mirrors the subgraph's sequential semantics without preload crashes.
      return {
        id: marketAddress,
        marketToken: marketAddress,
        indexToken: "0x0000000000000000000000000000000000000000",
        longToken: "0x0000000000000000000000000000000000000000",
        shortToken: "0x0000000000000000000000000000000000000000",
        marketTokensSupply: 0n,
        marketTokensSupplyFromPoolUpdated: undefined,
      };
    } else {
      context.log.error(`MarketInfo not found ${marketAddress}`);
      throw new Error("MarketInfo not found");
    }
  }

  return entity;
}

export async function saveMarketInfoTokensSupply(
  context: handlerContext,
  marketAddress: string,
  value: bigint,
): Promise<void> {
  const marketInfo = await getMarketInfo(context, marketAddress);
  context.MarketInfo.set({ ...marketInfo, marketTokensSupply: marketInfo.marketTokensSupply + value });
}

export async function saveMarketInfoMarketTokensSupplyFromPoolUpdated(
  context: handlerContext,
  marketAddress: string,
  value: bigint | null,
): Promise<void> {
  if (value != null) {
    const marketInfo = await getMarketInfo(context, marketAddress);
    context.MarketInfo.set({ ...marketInfo, marketTokensSupplyFromPoolUpdated: value });
  }
}
