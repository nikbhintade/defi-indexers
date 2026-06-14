/**
 * Port of template/utils/entity.ts (getOrLoadToken). In envio the store access
 * is async and ERC20 metadata is fetched via effects; the returned Token is
 * also written to the store (mirroring `new Token(...)` being implicitly
 * tracked by the subgraph store).
 */
import type { EvmOnEventContext, Token } from "envio";
import { ZERO_BD, ZERO_BI, low } from "./constants";
import { fetchTokenDecimals, fetchTokenName, fetchTokenSymbol, fetchTokenTotalSupply } from "./token";

export async function getOrLoadToken(context: EvmOnEventContext, address: string): Promise<Token> {
  const tokenAddress = low(address);
  let token = await context.Token.get(tokenAddress);

  if (token === undefined) {
    const decimals = await fetchTokenDecimals(context.effect, tokenAddress);
    token = {
      id: tokenAddress,
      symbol: await fetchTokenSymbol(context.effect, tokenAddress),
      name: await fetchTokenName(context.effect, tokenAddress),
      totalSupply: await fetchTokenTotalSupply(context.effect, tokenAddress),
      decimals,
      derivedETH: ZERO_BD,
      derivedUSD: ZERO_BD,
      volume: ZERO_BD,
      volumeUSD: ZERO_BD,
      feesUSD: ZERO_BD,
      protocolFeesUSD: ZERO_BD,
      untrackedVolumeUSD: ZERO_BD,
      totalValueLocked: ZERO_BD,
      totalValueLockedUSD: ZERO_BD,
      totalValueLockedUSDUntracked: ZERO_BD,
      txCount: ZERO_BI,
      poolCount: ZERO_BI,
      whitelistPools: [],
    } satisfies Token;
    context.Token.set(token);
  }

  return token;
}
