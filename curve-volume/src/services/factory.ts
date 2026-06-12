/** Port of src/services/factory.ts */
import type { EvmOnEventContext, Factory } from "envio";
import { BIG_INT_ZERO } from "../constants";

export async function getFactory(
  context: EvmOnEventContext,
  factoryAddress: string,
  crvUsd: boolean = false,
): Promise<Factory> {
  return context.Factory.getOrCreate({
    id: factoryAddress,
    poolCount: BIG_INT_ZERO,
    crvUsd,
  });
}
