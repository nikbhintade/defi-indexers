import { BigDecimal } from "envio";

// graph-node BigDecimal: 34 significant digits, no exponential notation.
BigDecimal.config({
  DECIMAL_PLACES: 34,
  EXPONENTIAL_AT: [-1000000, 1000000],
});

export const CHAIN_ID = 42161;

export const ZERO_BI = 0n;
export const ONE_BI = 1n;
export const TEN_BI = 10n;
export const _18_BI = 18n;
export const _100_BI = 100n;
export const ONE_ETH_BI = 10n ** 18n;

export const INTEREST_PRECISION = 18;
export const USD_PRECISION = 18;
export const SECONDS_IN_YEAR = 31536000n;

export const ZERO_BD: BigDecimal = new BigDecimal("0");
export const ONE_BD: BigDecimal = new BigDecimal("1");
export const FIVE_BD: BigDecimal = new BigDecimal("5");
export const ONE_ETH_BD: BigDecimal = new BigDecimal(ONE_ETH_BI.toString());

export const ZERO_BYTES = "0x";
export const ADDRESS_ZERO = "0x0000000000000000000000000000000000000000";

// ---- Arbitrum One addresses (rendered from config/arbitrum-one.json), all lowercase ----
export const DOLOMITE_MARGIN_ADDRESS = "0x6bd780e7fdf01d77e4d475c821f1e7ae05409072";
export const EXPIRY_ADDRESS = "0xdec1ae3b570ac3c57871bbd7bfeacc807f973bea";
export const FACTORY_ADDRESS = "0xd99c21c96103f36bc1fa26dd6448af4da030c1ef";
export const EVENT_EMITTER_PROXY_ADDRESS = "0x4bff12773b0dc3cb35f174b5cd351f662018cc2f";

export const BORROW_POSITION_PROXY_V1_ADDRESS = "0xe43638797513ef7a6d326a95e8647d86d2f5a099";
export const BORROW_POSITION_PROXY_V2_ADDRESS = "0x38e49a617305101216ec6306e3a18065d14bf3a7";
export const DOLOMITE_AMM_ROUTER_PROXY_V1_ADDRESS = "0xa09b4a3fc92965e587a94539ee8b35ecf42d5a08";
export const DOLOMITE_AMM_ROUTER_PROXY_V2_ADDRESS = "0xd8f9c59176ae25414fc4180f6433fc45b0cbb632";

// interest setter addresses (used by interest-setter eth_calls)
export const AAVE_ALT_COIN_COPY_CAT_V1_INTEREST_SETTER_ADDRESS = "0xc2cbd99bb35b22c43010a8c8266cdff057f70bb1";
export const AAVE_STABLE_COIN_COPY_CAT_V1_INTEREST_SETTER_ADDRESS = "0xea4e670fd64ae82af5a3d77b3db6b5e28a5522de";
export const ALWAYS_ZERO_INTEREST_SETTER_ADDRESS = "0x37b6ff70654edfbdaa3c9a723fdadf5844de2168";
export const DOUBLE_EXPONENT_V1_INTEREST_SETTER_ADDRESS = "0xf74fdc3e515f05bd0c5f89fbf03f59a02cfdb37b";
export const MODULAR_LINEAR_STEP_INTEREST_SETTER_ADDRESS = "0xe125c33e0190e7f2048d28188d53a1c23ace6029";

// ---- token addresses ----
export const ARB_ADDRESS = "0x912ce59144191c1204e64559fe8253a0e49e6548";
export const DAI_ADDRESS = "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1";
export const GRAI_ADDRESS = "0x894134a25a5fac1c2c26f1d8fbf05111a3cb9487";
export const LINK_ADDRESS = "0xf97f4df75117a78c1a5a0dbb814af92458539fb4";
export const USDC_ADDRESS = "0xff970a61a04b1ca14834a43f5de4533ebddb5cc8";
export const USDT_ADDRESS = "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9";
export const WBTC_ADDRESS = "0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f";
export const WETH_ADDRESS = "0x82af49447d8a07e3bd95bd0d56f35241523fbab1";
export const WETH_USDC_ADDRESS = "0xb77a493a4950cad1b049e222d62bce14ff423c6f";
export const DAI_WETH_PAIR = "0xfb1d1115ac867acb7347638c4ccda4ac2122d1da";
export const USDT_WETH_PAIR = "0xca7b324e5a15ded8980bef68a91629fadf2ab171";

// strategy account id thresholds
export const STRATEGY_LOWER_ACCOUNT_ID = 1_000_000_000n;
export const STRATEGY_UPPER_ACCOUNT_ID = 10_000_000_000n;
export const STRATEGY_POSITION_ID_THRESHOLD = 1_000_000n;
export const STRATEGY_ID_THRESHOLD = 1_000n;

// Arbitrum One whitelist (WETH, USDC, USDT, DAI, WBTC, LINK)
export const WHITELIST: string[] = [
  WETH_ADDRESS,
  USDC_ADDRESS,
  USDT_ADDRESS,
  DAI_ADDRESS,
  WBTC_ADDRESS,
  LINK_ADDRESS,
];

export function isArbitrumOne(): boolean {
  return true;
}

/** lowercase an address/hex string (HyperIndex delivers checksummed addresses). */
export const a = (x: string): string => x.toLowerCase();

export class ProtocolType {
  static Core = "CORE";
  static Admin = "ADMIN";
  static Expiry = "EXPIRY";
  static Amm = "AMM";
  static Position = "POSITION";
  static Zap = "ZAP";
}

export class MarginPositionStatus {
  static Open = "OPEN";
  static Closed = "CLOSED";
  static Expired = "EXPIRED";
  static Liquidated = "LIQUIDATED";
  static Unknown = "UNKNOWN";
}

export class BorrowPositionStatus {
  static Open = "OPEN";
  static Closed = "CLOSED";
}

export class TradeLiquidationType {
  static LIQUIDATION = "LIQUIDATION";
  static EXPIRATION = "EXPIRATION";
}
