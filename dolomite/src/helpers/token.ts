import type { EvmOnEventContext, Token } from "envio";
import { CHAIN_ID, USDC_ADDRESS, ZERO_BD, ZERO_BI, a } from "../constants.js";
import { erc20Decimals, erc20Name, erc20Symbol } from "../effects/contracts.js";

type Ctx = EvmOnEventContext;

const DGD = "0xe0b7927c4af23765cb51314a0e0521a9645f0e2a";
const AAVE = "0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9";
const DGLP = "0x34df4e8062a8c8ae97e3382b452bd7bf60542698";

async function fetchTokenSymbol(context: Ctx, addr: string): Promise<string> {
  if (addr === DGD) return "DGD";
  if (addr === AAVE) return "AAVE";
  const r = await erc20Symbol(context.effect, addr);
  return r === null ? "unknown" : r;
}

async function fetchTokenName(context: Ctx, addr: string): Promise<string> {
  if (addr === DGD) return "DGD";
  if (addr === AAVE) return "Aave Token";
  const r = await erc20Name(context.effect, addr);
  return r === null ? "unknown" : r;
}

async function fetchTokenDecimals(context: Ctx, addr: string): Promise<bigint> {
  if (addr === AAVE) return 18n;
  const r = await erc20Decimals(context.effect, addr);
  return r === null ? 0n : BigInt(r);
}

/**
 * initializeToken: creates a Token + its TokenMarketIdReverseLookup, fetching
 * ERC20 metadata via effects. Registers the address as an IsolationModeVault
 * template if the name contains "Dolomite Isolation:" or it is dfsGLP.
 * Returns the created/updated token.
 */
export async function initializeToken(
  context: Ctx,
  tokenId: string,
  marketId: bigint,
): Promise<Token> {
  const id = a(tokenId);
  let symbol = await fetchTokenSymbol(context, id);
  let name = await fetchTokenName(context, id);
  const decimals = await fetchTokenDecimals(context, id);

  if (id === USDC_ADDRESS) {
    // Arbitrum One: bridged USDC override
    name = "Bridged USDC";
    symbol = "USDC.e";
  }

  const isIsolationMode = name.includes("Dolomite Isolation:") || id === DGLP;

  const token: Token = {
    id,
    chainId: CHAIN_ID,
    symbol,
    name,
    decimals,
    isIsolationMode,
    marketId,
    tradeVolume: ZERO_BD,
    tradeVolumeUSD: ZERO_BD,
    transactionCount: ZERO_BI,
    ammTradeLiquidity: ZERO_BD,
    supplyLiquidity: ZERO_BD,
    supplyLiquidityUSD: ZERO_BD,
    borrowLiquidity: ZERO_BD,
    borrowLiquidityUSD: ZERO_BD,
    derivedETH: ZERO_BD,
  };
  context.Token.set(token);

  context.TokenMarketIdReverseLookup.set({ id: marketId.toString(), token_id: token.id });

  return token;
}
