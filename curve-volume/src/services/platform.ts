/** Port of src/services/platform.ts */
import type { EvmOnEventContext, Platform } from "envio";
import { BIG_INT_ZERO, CURVE_PLATFORM_ID } from "../constants";

export async function getPlatform(context: EvmOnEventContext): Promise<Platform> {
  return context.Platform.getOrCreate({
    id: CURVE_PLATFORM_ID,
    poolAddresses: [],
    latestPoolSnapshot: BIG_INT_ZERO,
  });
}
