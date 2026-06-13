import type { ChainlinkAggregator } from "envio";
import type { Ctx } from "../common/types";

export { getOrInitPriceOracle, getPriceOracleAsset } from "./initializers";

/** getChainlinkAggregator from src/helpers/v3/initializers.ts. */
export async function getChainlinkAggregatorOracleAsset(
  context: Ctx,
  id: string,
): Promise<ChainlinkAggregator> {
  let agg = await context.ChainlinkAggregator.get(id);
  if (!agg) {
    agg = { id, oracleAsset_id: "" };
  }
  return agg;
}
