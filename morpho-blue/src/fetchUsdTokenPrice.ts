/**
 * Ported from src/fetchUsdTokenPrice.ts. USD pricing via a hardcoded chainlink
 * feed map plus WstEth/REth/ERC4626 special cases. State-dependent calls are
 * pinned to the event block.
 *
 * NB: the source's chainlinkDatabase.ts (1284 lines) + chainlink.ts handlers
 * are dead code in the mainnet deployment (the active pricing path is this
 * file's hardcoded maps), so they are intentionally not ported. See MIGRATION.md.
 */
import { BigDecimal, type EffectCaller } from "envio";
import {
  chainlinkLatestRoundData,
  chainlinkDecimals,
  wstEthGetStETHByWstETH,
  rEthGetExchangeRate,
  erc4626ConvertToAssets,
} from "./effects/contracts";
import { BIGDECIMAL_ONE, BIGDECIMAL_WAD, BIGINT_WAD, toBD } from "./sdk/constants";

const ZERO = new BigDecimal("0");

// token addresses (lowercase)
const wbib01 = "0xca2a7068e551d5c4482eb34880b194e4b945712f";
const wstEth = "0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0";
const weth = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const wbtc = "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599";
const usdc = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const sdai = "0x83f20f44975d03b1b09e64809b757c47f942beea";
const dai = "0x6b175474e89094c44da98b954eedeac495271d0f";
const weETH = "0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee";
const osETH = "0xf1c9acdc66974dfb6decb12aa385b9cd01190e38";
const usdt = "0xdac17f958d2ee523a2206206994597c13d831ec7";
const rEth = "0xae78736cd615f374d3085123a210448e74fc6393";
const pyUsd = "0x6c3ea9036406852006290770bedfcaba0e23a0e8";
const wusdm = "0x57f5e098cad7a3d1eed53991d4d66c45c9af7812";
const wbc3m = "0x95d7337d43340e2721960dc402d9b9117f0d81a2";
const EURe = "0x3231cb76718cdef2155fc47b5286d82e6eda273f";
const eurc = "0x1abaea1f7c830bd89acc67ec4af516284b1bc33c";
const ezETH = "0xbf5495efe5db9ce00f80364c8b423567e58d2110";
const mkr = "0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2";
const sUSDE = "0x9d39a5de30e57443bff2a8307a4256c8797a3497";
const usde = "0x4c9edd5852cd905f086c759e8383e09bff1e68b3";

const usdPriceFeeds = new Map<string, string>([
  [wbib01, "0x32d1463eb53b73c095625719afa544d5426354cb"],
  [weth, "0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419"],
  [usdc, "0x8fffffd4afb6115b954bd326cbe7b4ba576818f6"],
  [dai, "0xaed0c38402a5d19df6e4c03f4e2dced6e29c1ee9"],
  [weETH, "0xddb6f90ffb4d3257dd666b69178e5b3c5bf41136"],
  [usdt, "0x3e7d1eab13ad0104d2750b8863b489d65364e32d"],
  [EURe, "0xb49f677943bc038e9857d61e7d053caa2c1734c1"],
  [eurc, "0xb49f677943bc038e9857d61e7d053caa2c1734c1"],
  [mkr, "0xec1d1b3b0443256cc3860e24a46f108e699484aa"],
]);

const ethPriceFeeds = new Map<string, string>([
  [osETH, "0x66ac817f997efd114edfcccdce99f3268557b32c"],
  [ezETH, "0xf4a3e183f59d2599ee3df213ff78b1b3b1923696"],
]);

const eurPriceFeeds = new Map<string, string>([
  [wbc3m, "0x83ec02059f686e747392a22ddfed7833ba0d7ce3"],
]);

async function fetchPriceFromFeed(
  ec: EffectCaller,
  feedAddress: string,
  block: number,
): Promise<BigDecimal> {
  const round = await chainlinkLatestRoundData(ec, feedAddress, block);
  const decimals = await chainlinkDecimals(ec, feedAddress, block);
  // graph-ts call would throw on revert here; for parity we treat a revert as
  // 0/undefined yielding 0 (these feeds never revert in the indexed range).
  const answer = round ? round[1] : 0n;
  const dec = decimals ?? 0;
  return toBD(answer).div(toBD(10n ** BigInt(dec)));
}

/**
 * Port of fetchUsdTokenPrice(tokenAddress). `tokenAddress` is a lowercase
 * 0x-hex address; `block` pins state-dependent reads; `ec` is context.effect.
 */
export async function fetchUsdTokenPrice(
  ec: EffectCaller,
  tokenAddress: string,
  block: number,
): Promise<BigDecimal> {
  const t = tokenAddress.toLowerCase();

  if (usdPriceFeeds.has(t)) {
    return fetchPriceFromFeed(ec, usdPriceFeeds.get(t)!, block);
  }

  if (ethPriceFeeds.has(t)) {
    const p = await fetchPriceFromFeed(ec, ethPriceFeeds.get(t)!, block);
    return p.times(await fetchUsdTokenPrice(ec, weth, block));
  }

  if (eurPriceFeeds.has(t)) {
    const p = await fetchPriceFromFeed(ec, eurPriceFeeds.get(t)!, block);
    return p.times(await fetchUsdTokenPrice(ec, EURe, block));
  }

  if (t === wstEth) {
    const v = await wstEthGetStETHByWstETH(ec, wstEth, BIGINT_WAD, block);
    return toBD(v ?? 0n)
      .div(BIGDECIMAL_WAD)
      .times(await fetchUsdTokenPrice(ec, weth, block));
  }

  if (t === rEth) {
    const v = await rEthGetExchangeRate(ec, rEth, block);
    return toBD(v ?? 0n)
      .div(BIGDECIMAL_WAD)
      .times(await fetchUsdTokenPrice(ec, weth, block));
  }

  if (t === wbtc) {
    const wbtcBtcFeed = "0xfdfd9c85ad200c506cf9e21f1fd8dd01932fbb23";
    const btcUsdFeed = "0xf4030086522a5beea4988f8ca5b36dbc97bee88c";
    const btcUsd = await fetchPriceFromFeed(ec, btcUsdFeed, block);
    const wbtcBtc = await fetchPriceFromFeed(ec, wbtcBtcFeed, block);
    return btcUsd.times(wbtcBtc);
  }

  if (t === sdai) {
    const v = await erc4626ConvertToAssets(ec, sdai, BIGINT_WAD, block);
    return toBD(v ?? 0n)
      .div(BIGDECIMAL_WAD)
      .times(await fetchUsdTokenPrice(ec, dai, block));
  }

  if (t === wusdm || t === sUSDE) {
    // NB: source binds the wusdm contract regardless of which token matched.
    const v = await erc4626ConvertToAssets(ec, wusdm, BIGINT_WAD, block);
    return toBD(v ?? 0n).div(BIGDECIMAL_WAD);
  }

  if (t === pyUsd || t === usde) {
    return BIGDECIMAL_ONE;
  }

  return ZERO;
}
