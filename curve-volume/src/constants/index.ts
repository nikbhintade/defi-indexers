/**
 * Port of packages/constants/index.template.ts with the mainnet mustache
 * values from config/mainnet.json.
 *
 * All addresses are stored as lowercase 0x-prefixed strings (the subgraph
 * stored `Bytes` which serialize to lowercase hex).
 */
import { BigDecimal } from "envio";

export const CURVE_PLATFORM_ID = "Curve";

export const BIG_DECIMAL_1E8 = new BigDecimal("1e8");
export const BIG_DECIMAL_1E18 = new BigDecimal("1e18");
export const BIG_DECIMAL_ZERO = new BigDecimal("0");
export const BIG_DECIMAL_ONE = new BigDecimal("1");
export const BIG_DECIMAL_TWO = new BigDecimal("2");

export const BIG_INT_ZERO = 0n;
export const BIG_INT_ONE = 1n;

export const FEE_PRECISION = new BigDecimal("1e10");

export const NATIVE_PLACEHOLDER = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
// mainnet: native_token == weth
export const NATIVE_TOKEN = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
export const ADDRESS_ZERO = "0x0000000000000000000000000000000000000000";

export const THREE_CRV_TOKEN = "0x6c3f90f043a72fa612cbac8115ee7e52bde6e490";
export const TWO_CRV_TOKEN = "0x0000000000000000000000000000000000000000";
export const THREE_BTC_TOKEN = "0x075b1bb99792c9e1041ba13afef80c91a1e70fb3";
export const TWO_BTC_TOKEN = "0x49849c98ae39fff122806c06791fa73784fb3675";

export const THREE_CRV_POOL = "0xbebc44782c7db0a1a60cb6fe97d0b483032ff1c7";
export const TWO_CRV_POOL = "0x0000000000000000000000000000000000000000";
export const THREE_BTC_POOL = "0x7fc77b5c7614e1533320ea6ddc2eb61fa00a9714";
export const TWO_BTC_POOL = "0x93054188d876f558f4a66b2ef1d97d16edf0895b";

export const METATOKEN_TO_METAPOOL_MAPPING: Record<string, string> = {
  [THREE_BTC_TOKEN]: THREE_BTC_POOL,
  [THREE_CRV_TOKEN]: THREE_CRV_POOL,
  [TWO_BTC_TOKEN]: TWO_BTC_POOL,
  [TWO_CRV_TOKEN]: TWO_CRV_POOL,
};

export const WETH_TOKEN = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
export const WBTC_TOKEN = "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599";
export const USDT_TOKEN = "0xdac17f958d2ee523a2206206994597c13d831ec7";
export const WETH_ADDRESS = WETH_TOKEN;
export const USDT_ADDRESS = USDT_TOKEN;
export const WBTC_ADDRESS = WBTC_TOKEN;
export const FXS_TOKEN = "0x3432b6a60d23ca0dfca7761b7ab56459d9c964d0";
export const CVXFXS_TOKEN = "0xfeef77d3f69374f66429c91d732a244f074bdf74";

// for Forex and EUR pool, map lp token to Chainlink price feed
export const EURT_LP_TOKEN = "0xfd5db7463a3ab53fd211b4af195c5bccc1a03890";
export const EURS_LP_TOKEN = "0x194ebd173f6cdace046c53eacce9b953f28411d1";
export const EURN_LP_TOKEN = "0x3fb78e61784c9c637d560ede23ad57ca1294c14a";

// Fixed forex proper
export const EUR_LP_TOKEN = "0x19b080fe1ffa0553469d20ca36219f17fcf03859";
export const JPY_LP_TOKEN = "0x8818a9bb44fbf33502be7c15c500d0c783b73067";
export const KRW_LP_TOKEN = "0x8461a004b50d321cb22b7d034969ce6803911899";
export const GBP_LP_TOKEN = "0xd6ac1cb9019137a896343da59dde6d097f710538";
export const AUD_LP_TOKEN = "0x3f1b0278a9ee595635b61817630cc19de792f506";
export const CHF_LP_TOKEN = "0x9c2c8910f113181783c249d8f6aa41b51cde0f0c";

export const METAPOOL_FACTORY_ADDRESS = "0x0959158b6040d32d04c301a72cbfd6b39e21c9ae";

// Mixed USDT-forex (USDT-Forex) pools
export const EURS_USDC_LP_TOKEN = "0x3d229e1b4faab62f621ef2f6a610961f7bd7b23b";
export const EURT_USDT_LP_TOKEN = "0x3b6831c0077a1e44ed0a21841c3bc4dc11bce833";

// On chains like avalanche, pools use aave synthetics instead of the wrapped tokens
export const SIDECHAIN_SUBSTITUTES: Record<string, string> = {
  [NATIVE_PLACEHOLDER]: NATIVE_TOKEN,
  // avalanche
  "0x686bef2417b6dc32c50a3cbfbcc3bb60e1e9a15d": WBTC_ADDRESS,
  "0x53f7c5869a859f0aec3d334ee8b4cf01e3492f21": WETH_ADDRESS,
  // polygon / moonbeam
  "0x5c2ed810328349100a66b82b78a1791b101c9d61": WBTC_ADDRESS,
  "0x28424507fefb6f7f8e9d3860f56504e4e5f5f390": WETH_ADDRESS,
};

// handle tokens that only trade on Curve
export type OracleInfo = { pricingToken: string; tokenIndex: number };
export const T_TOKEN = "0xcdf7028ceab81fa0c6971208e83fa7872994bee5";
export const CNC_TOKEN = "0x9ae380f0272e2162340a5bb646c354271c0f5cfc";
export const GEAR_TOKEN = "0xba3335588d9403515223f109edc4eb7269a9ab5d";
export const CURVE_ONLY_TOKENS: Record<string, OracleInfo> = {
  [CVXFXS_TOKEN]: { pricingToken: FXS_TOKEN, tokenIndex: 1 },
  [T_TOKEN]: { pricingToken: WETH_ADDRESS, tokenIndex: 1 },
  [CNC_TOKEN]: { pricingToken: WETH_ADDRESS, tokenIndex: 0 },
  [GEAR_TOKEN]: { pricingToken: WETH_ADDRESS, tokenIndex: 0 },
};

// Metapools from the 1st metapool factory don't implement the `base_pool`
// method (see original source for details). Mainnet entries only.
export const UNKNOWN_METAPOOLS: Record<string, string> = {
  "0xd632f22692fac7611d2aa1c0d552930d43caed3b": "0xbebc44782c7db0a1a60cb6fe97d0b483032ff1c7",
  "0x43b4fdfd4ff969587185cdb6f0bd875c5fc83f8c": "0xbebc44782c7db0a1a60cb6fe97d0b483032ff1c7",
  "0x87650d7bbfc3a9f10587d7778206671719d9910d": "0xbebc44782c7db0a1a60cb6fe97d0b483032ff1c7",
  "0x3252efd4ea2d6c78091a1f43982ee2c3659cc3d1": "0xbebc44782c7db0a1a60cb6fe97d0b483032ff1c7",
  "0x6f682319f4ee0320a53cc72341ac28408c4bed19": "0xbebc44782c7db0a1a60cb6fe97d0b483032ff1c7",
  "0x592ae00d0dee274d74faedc6760302f54a5db67e": "0xbebc44782c7db0a1a60cb6fe97d0b483032ff1c7",
  "0xf5a95ccde486b5fe98852bb02d8ec80a4b9422bd": "0xbebc44782c7db0a1a60cb6fe97d0b483032ff1c7",
  "0xe0b99f540b3cd69f88b4666c8f39877c79072851": "0xbebc44782c7db0a1a60cb6fe97d0b483032ff1c7",
  "0x11e0ab0561ee271967f70ea0da54fd538ba7a6b0": "0xbebc44782c7db0a1a60cb6fe97d0b483032ff1c7",
  "0x9547429c0e2c3a8b88c6833b58fce962734c0e8c": "0xbebc44782c7db0a1a60cb6fe97d0b483032ff1c7",
  "0x296b9fa08cf80138dfa6c3fcce497152662bc314": "0xbebc44782c7db0a1a60cb6fe97d0b483032ff1c7",
  "0xe9ab166bc03099d251170d0578fdffb94bcdde6f": "0xbebc44782c7db0a1a60cb6fe97d0b483032ff1c7",
  "0x064841157baddcb2704ca38901d7d754a59b80e8": "0x7fc77b5c7614e1533320ea6ddc2eb61fa00a9714",
  "0x99ae07e7ab61dcce4383a86d14f61c68cdccbf27": "0x7fc77b5c7614e1533320ea6ddc2eb61fa00a9714",
  "0xecd5e75afb02efa118af914515d6521aabd189f1": "0xbebc44782c7db0a1a60cb6fe97d0b483032ff1c7",
  "0x52eeea483ab7a801e2592a904ad209c90e12e471": "0xbebc44782c7db0a1a60cb6fe97d0b483032ff1c7",
};

// Early lending pools have no distinctive features in their ABI
// (mainnet entries from the shared constants package)
export const LENDING_POOLS = [
  "0x83f252f036761a1e3d10daca8e16d7b21e3744d7",
  "0x06364f10b501e868329afbc005b3492902d6c763",
  "0x2dded6da1bf5dbdf597c45fcfaa3194e53ecfeaf",
  "0x45f783cce6b7ff23b2ab2d70e416cdb7d6055f51",
  "0x52ea46506b9cc5ef470c5bf89f17dc28bb35d85c",
  "0x79a8c46dea5ada233abaffd40f3a0a2b1e5a4f27",
  "0xa2b47e3d5c44877cca798226b7b8118f9bfb7a56",
  "0xa5407eae9ba41422680e2e00537571bcc53efbfd",
  "0xdebf20617708857ebe4f679508e7b7863a8a8eee",
  "0xeb16ae0052ed37f479f7fe63849198df1765a733",
  "0x8925d9d9b4569d737a48499def3f67baa5a144b9",
];

// Lending pools using cTokens (mainnet entries)
export const CTOKENS = [
  "0x8e595470ed749b85c6f7669de83eae304c2ec68f",
  "0x76eb2fe28b36b3ee97f3adae0c69606eedb2a37c",
  "0x48759f220ed983db51fa7a8c0d2aab8f3ce4166a",
  "0x5d3a536e4d6dbd6114cc1ead35777bab948e3643",
  "0x39aa39c021dfbae8fac545936693ac917d5e7563",
];

export const CTOKEN_POOLS = [
  "0xa2b47e3d5c44877cca798226b7b8118f9bfb7a56",
  "0x8925d9d9b4569d737a48499def3f67baa5a144b9",
  "0x79a8c46dea5ada233abaffd40f3a0a2b1e5a4f27",
  "0x52ea46506b9cc5ef470c5bf89f17dc28bb35d85c",
  "0x45f783cce6b7ff23b2ab2d70e416cdb7d6055f51",
  "0x2dded6da1bf5dbdf597c45fcfaa3194e53ecfeaf",
];

// mainnet mustache value: ['0x55aa9bf126bcabf0bdc17fa9e39ec9239e1ce7a9']
export const REBASING_POOL_IMPLEMENTATIONS = ["0x55aa9bf126bcabf0bdc17fa9e39ec9239e1ce7a9"];

// Addresses and variables needed to compute the APR of rebasing tokens
export const LIDO_ORACLE_ADDRESS = "0x442af784a788a5bd6f42a01ebe9f287a871243fb";
export const CONCENTRATED_LIDO_POOL = "0x828b154032950c8ff7cf8085d841723db2696056";
export const LIDO_POOL = "0xdc24316b9ae028f1497c275eb9192a3ea0f67022";
export const STETH_POOLS = [LIDO_POOL, CONCENTRATED_LIDO_POOL];
export const ATOKEN_POOLS = [
  "0xeb16ae0052ed37f479f7fe63849198df1765a733",
  "0xdebf20617708857ebe4f679508e7b7863a8a8eee",
];

export const YTOKEN_POOLS = [
  "0x45f783cce6b7ff23b2ab2d70e416cdb7d6055f51",
  "0x79a8c46dea5ada233abaffd40f3a0a2b1e5a4f27",
];

export const YTOKENS = [
  "0x16de59092dae5ccf4a1e6439d611fd0653f0bd01",
  "0xd6ad7a6750a7593e092a9b218d66c0a814a3436e",
  "0x83f798e925bcd4017eb265844fddabb448f1707d",
  "0x73a052500105205d34daf004eab301916da8190f",
  "0xc2cb1040220768554cf699b0d863a3cd4324ce32",
  "0x26ea744e5b887e5205727f55dfbe8685e3b21951",
  "0xe6354ed5bc4b393a5aad09f21c46e101e692d447",
  "0x04bc0ab673d88ae9dbc9da2380cb6b79c4bca9ae",
];

export const YC_LENDING_TOKENS = CTOKENS.concat(YTOKENS);
export const Y_AND_C_POOLS = CTOKEN_POOLS.concat(YTOKEN_POOLS);

export const USDN_POOL = "0x0f9cb53ebe405d49a0bbdbd291a65ff571bc83e1";
export const USDN_TOKEN = "0x674c6ad92fd080e4004b2312b45f796a192d27a0";

export const AETH_POOL = "0xa96a65c051bf88b4095ee1f2451c2a9d43f53ae2";
export const AETH_TOKEN = "0xe95a203b1a91a908f9b9ce46459d101078c2c3cb";

export const LIDO_STETH_CONTRACT = "0xae7ab96520de3a18e5e111b5eaab095312d7fe84";

export const BENCHMARK_STABLE_ASSETS = [
  WBTC_TOKEN,
  THREE_CRV_TOKEN,
  TWO_CRV_TOKEN,
  TWO_BTC_TOKEN,
  THREE_BTC_TOKEN,
  WETH_TOKEN,
  NATIVE_TOKEN,
  USDT_TOKEN,
];

// Some pools use ridiculous decimals / fake exchange rates; filtered out.
export const SCAM_POOLS = [
  "0x0950ea36770ed3b95a428c83a532b1ffa46088bc",
  "0xb5be5a8126244da7e388a88f16ee8be54d22117c",
  "0xdaedd59fa2c5c63d46a3bae5ed115247df9eb6ec",
  "0x5e0458211702142aa0833a4a60a4535cd891dcc7",
  "0x84997fafc913f1613f51bb0e2b5854222900514b",
];

// some v2 pools can have Forex : Crypto pairs (non-mainnet tokens kept for parity)
export const POLYGON_EURT_TOKEN = "0x7bdf330f423ea880ff95fc41a280fd5ecfd3d09f";
export const POLYGON_AGEUR_TOKEN = "0xe0b52e49357fd4daf2c15e02058dce6bc0057db4";
export const POLYGON_JJPY_TOKEN = "0x8343091f2499fd4b6174a46d067a920a3b851ff9";
export const POLYGON_JPYC_TOKEN = "0x6ae7dfc73e0dde2aa99ac063dcf7e8a63265108c";
export const ARBI_EURS_TOKEN = "0xd22a58f79e9481d1a88e00c343885a588b34b68b";
export const ARBI_FXEUR_TOKEN = "0x116172b2482c5dc3e6f445c16ac13367ac3fcd35";
export const POLYGON_EURS_TOKEN = "0xe111178a87a3bff0c8d18decba5798827539ae99";
export const POLYGON_JEUR_TOKEN = "0x4e3decbb3645551b8a19f0ea1678079fcb33fb4c";
export const POLYGON_PAR_TOKEN = "0xe2aa7db6da1dae97c5f5c6914d285fbfcc32a128";
export const POLYGON_AGEUR_POOL = "0x81212149b983602474fcd0943e202f38b38d7484";
export const FOREX_TOKENS = [
  POLYGON_AGEUR_TOKEN,
  POLYGON_EURT_TOKEN,
  POLYGON_JJPY_TOKEN,
  POLYGON_JPYC_TOKEN,
  ARBI_EURS_TOKEN,
  ARBI_FXEUR_TOKEN,
  POLYGON_EURS_TOKEN,
  POLYGON_JEUR_TOKEN,
  POLYGON_PAR_TOKEN,
];

export const POLYGON_2JPY_LP_TOKEN = "0xe8dcea7fb2baf7a9f4d9af608f06d78a687f8d9a";
export const ARBI_EURS_FXEUR_LP_TOKEN = "0xb0d2eb3c2ca3c6916fab8dcbf9d9c165649231ae";
export const FOREX_ORACLES: Record<string, string> = {
  [EURT_USDT_LP_TOKEN]: "0xb49f677943bc038e9857d61e7d053caa2c1734c1",
  [EURS_USDC_LP_TOKEN]: "0xb49f677943bc038e9857d61e7d053caa2c1734c1",
  [EURT_LP_TOKEN]: "0xb49f677943bc038e9857d61e7d053caa2c1734c1",
  [EURS_LP_TOKEN]: "0xb49f677943bc038e9857d61e7d053caa2c1734c1",
  [EURN_LP_TOKEN]: "0xb49f677943bc038e9857d61e7d053caa2c1734c1",
  [EUR_LP_TOKEN]: "0xb49f677943bc038e9857d61e7d053caa2c1734c1",
  [ARBI_EURS_FXEUR_LP_TOKEN]: "0xa14d53bc1f1c0f31b4aa3bd109344e5009051a84",
  [KRW_LP_TOKEN]: "0x01435677fb11763550905594a16b645847c1d0f3",
  [JPY_LP_TOKEN]: "0xbce206cae7f0ec07b545edde332a47c2f75bbeb3",
  [POLYGON_2JPY_LP_TOKEN]: "0xd647a6fc9bc6402301583c91decc5989d8bc382d",
  [GBP_LP_TOKEN]: "0x5c0ab2d9b5a7ed9f470386e82bb36a3613cdd4b5",
  [AUD_LP_TOKEN]: "0x77f9710e7d0a19669a13c055f62cd80d313df022",
  [CHF_LP_TOKEN]: "0x449d117117838ffa61263b61da6301aa2a88b13a",
  [POLYGON_EURT_TOKEN]: "0x73366fe0aa0ded304479862808e02506fe556a98",
  [POLYGON_AGEUR_TOKEN]: "0x73366fe0aa0ded304479862808e02506fe556a98",
  [POLYGON_AGEUR_POOL]: "0x73366fe0aa0ded304479862808e02506fe556a98",
  [POLYGON_EURS_TOKEN]: "0x73366fe0aa0ded304479862808e02506fe556a98",
  [POLYGON_JEUR_TOKEN]: "0x73366fe0aa0ded304479862808e02506fe556a98",
  [POLYGON_PAR_TOKEN]: "0x73366fe0aa0ded304479862808e02506fe556a98",
  [POLYGON_JPYC_TOKEN]: "0xd647a6fc9bc6402301583c91decc5989d8bc382d",
  [POLYGON_JJPY_TOKEN]: "0xd647a6fc9bc6402301583c91decc5989d8bc382d",
  [ARBI_EURS_TOKEN]: "0xa14d53bc1f1c0f31b4aa3bd109344e5009051a84",
  [ARBI_FXEUR_TOKEN]: "0xa14d53bc1f1c0f31b4aa3bd109344e5009051a84",
};

export const SUSHI_FACTORY_ADDRESS = "0xc0aee478e3658e2610c5f7a4a2e1777ce9e4f2ac";
export const UNI_FACTORY_ADDRESS = "0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f";
export const UNI_V3_FACTORY_ADDRESS = "0x1f98431c8ad98523631ae4a59f267346ea31f984";
export const UNI_V3_QUOTER_ADDRESS = "0xb27308f9f90d607463bb33ea1bebb41c27ce5ab6";

export const TRIPOOL_ADDRESS = "0xbebc44782c7db0a1a60cb6fe97d0b483032ff1c7";

export const TRICRYPTO2_POOL = "0xd51a44d3fae010294c616388b506acda1bfaae46";
// Pools that are v2 but were originally added to v1 registry
export const EURT_USD_POOL = "0x9838eccc42659fa8aa7daf2ad134b53984c9427b";
export const EURS_USDC_POOL = "0x98a7f18d4e56cfe84e3d081b40001b3d5bd3eb8b";
export const EARLY_V2_POOLS = [TRICRYPTO2_POOL, EURS_USDC_POOL, EURT_USD_POOL];

export const CRV_FRAX = "0x3175df0976dfa876431c2e9ee6bc45b65d3473cc";
export const CRV_FRAX_ADDRESS = CRV_FRAX;
export const FRAXBP_ADDRESS = "0xdcef968d416a41cdac0ed8702fac8128a64241a2";

export const MATIC_FOUR_EUR_LP_TOKEN_ADDRESS = "0xad326c253a84e9805559b73a08724e11e49ca651";

export const METAPOOL_FACTORY = "METAPOOL_FACTORY" as const;
export const CRYPTO_FACTORY = "CRYPTO_FACTORY" as const;
export const STABLE_FACTORY = "STABLE_FACTORY" as const;
export const REGISTRY_V1 = "REGISTRY_V1" as const;
export const REGISTRY_V2 = "REGISTRY_V2" as const;
export const LENDING = "LENDING" as const;
export const CRVUSD = "CRVUSD" as const;
export const TRICRYPTO_FACTORY = "TRICRYPTO_FACTORY" as const;

export const MULTICALL = "0xeefba1e63905ef1d7acba5a8513c70307c1ce441";

// pools that have been hacked or went awry: stats stop past these timestamps
export const DEPRECATED_POOLS: Record<string, bigint> = {
  "0x06364f10b501e868329afbc005b3492902d6c763": 1680315890n,
  // vyper reentrancy hacks
  "0x8301ae4fc9c624d1d396cbdaa1ed877821d7c511": 1690578357n, // CRV/ETH
  "0xc897b98272aa23714464ea2a0bd5180f1b8c0025": 1690578357n, // msETH
  "0xc4c319e2d4d66cca4464c0c2b32c9bd23ebe784e": 1690578357n, // alETH
  "0x9848482da3ee3076165ce6497eda906e66bb85c5": 1690578357n, // JPEGd
  "0x28b0cf1bafb707f2c6826d10caf6dd901a6540c5": 1691765071n, // zus pools
  "0x68934f60758243eafaf4d2cfed27bf8010bede3a": 1691765071n,
  "0xbedca4252b27cc12ed7daf393f331886f86cd3ce": 1691765071n,
  "0xfc636d819d1a98433402ec9dec633d864014f28c": 1691765071n,
};
