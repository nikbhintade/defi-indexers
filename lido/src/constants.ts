/**
 * Ported from src/constants.ts of the Lido subgraph (mainnet only).
 * All addresses lowercased per HyperIndex conventions.
 */
import { BigDecimal } from "envio";

export const low = (x: string): string => x.toLowerCase();

// Units
export const ZERO = 0n;
export const ONE = 1n;

export const CALCULATION_UNIT = 10000n;
export const ONE_HUNDRED_PERCENT = new BigDecimal(100);
export const E27_PRECISION_BASE = new BigDecimal("1000000000000000000000000000");
export const SECONDS_PER_YEAR = BigInt(60 * 60 * 24 * 365);

// 1 ETH in WEI
export const ETHER = 1000000000000000000n;

// Deposits
export const DEPOSIT_SIZE = 32n;
export const DEPOSIT_AMOUNT = DEPOSIT_SIZE * ETHER;

// Addresses (mainnet, lowercase)
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export const LIDO_ADDRESS = low("0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84");
export const NOS_ADDRESS = low("0x55032650b14df07b85bF18A3a3eC8E0Af2e028d5");
export const TREASURY_ADDRESS = low("0x3e40D73EB977Dc6a537aF587D48316feE66E9C8c");
export const SR_ADDRESS = low("0xFdDf38947aFB03C621C71b06C9C70bce73f12999");
export const BURNER_ADDRESS = low("0xD15a672319Cf0352560eE76d9e89eAB0889046D3");
export const ACCOUNTING_ORACLE_ADDRESS = low(
  "0x852deD011285fe67063a08005c71a85690503Cee"
);

// Aragon Apps
export const KERNEL_APP_BASES_NAMESPACE = low(
  "0xf1f3eb40f5bc1ad1344716ced8b8a0431d840b5783aea1fd01786bc26f35ac0f"
);

export const LIDO_APP_ID = low(
  "0x3ca7c3e38968823ccb4c78ea688df41356f182ae1d159e4ee608d30d68cef320"
);
export const NOR_APP_ID = low(
  "0x7071f283424072341f856ac9e947e7ec0eb68719f757a7e785979b6b8717579d"
);
export const ORACLE_APP_ID = low(
  "0x8b47ba2a8454ec799cd91646e7ec47168e91fd139b23f017455f3e5898aaba93"
);
export const VOTING_APP_ID = low(
  "0x0abcd104777321a82b010357f20887d61247493d89d2e987ff57bcecbde00e1e"
);

// https://docs.lido.fi/deployed-contracts/ — mainnet AppRepo addresses keyed by appId (lowercase)
export const APP_REPOS: Map<string, string> = new Map([
  [LIDO_APP_ID, low("0xF5Dc67E54FC96F993CD06073f71ca732C1E654B1")],
  [NOR_APP_ID, low("0x0D97E876ad14DB2b183CFeEB8aa1A5C788eB1831")],
  [ORACLE_APP_ID, low("0xF9339DE629973c60c4d2b76749c81E6F40960E3A")],
  [VOTING_APP_ID, low("0x4Ee3118E3858E8D7164A634825BfE0F73d99C792")],
]);

// Upgrade indices (matching the subgraph's PROTOCOL_UPG_IDX_* enum)
export const PROTOCOL_UPG_IDX_V1 = 0;
export const PROTOCOL_UPG_IDX_V1_SHARES = 1;
export const PROTOCOL_UPG_IDX_V2 = 2;
export const PROTOCOL_UPG_IDX_V2_ADDED_CSM = 3;
export const PROTOCOL_UPG_IDX_V3 = 4;

// mainnet block numbers per upgrade (used for fast detection)
export const PROTOCOL_UPG_BLOCKS: bigint[] = [
  11473216n, // V1
  14860268n, // V1_SHARES
  17266004n, // V2
  21043699n, // V2 CSM Update
  23938902n, // V3
];

// per-appId min compatible contract major version, by upgrade index (mainnet)
export const PROTOCOL_UPG_APP_VERS: Map<string, number[]> = new Map([
  [LIDO_APP_ID, [1, 3, 4, 5]],
  [NOR_APP_ID, [1, 3, 4]],
  [ORACLE_APP_ID, [1, 3, 4]],
  [VOTING_APP_ID, []],
]);

// Contract address resolver (mirrors getAddress in the subgraph).
// INSURANCE_FUND resolution needs the LidoConfig.insuranceFund; callers pass it in.
export const getAddress = (
  contract: string,
  insuranceFund?: string | null
): string => {
  switch (contract) {
    case "LIDO":
      return LIDO_ADDRESS;
    case "STAKING_ROUTER":
      return SR_ADDRESS;
    case "NO_REGISTRY":
      return NOS_ADDRESS;
    case "BURNER":
      return BURNER_ADDRESS;
    case "TREASURY":
      return TREASURY_ADDRESS;
    case "ACCOUNTING_ORACLE":
      return ACCOUNTING_ORACLE_ADDRESS;
    case "INSURANCE_FUND":
      // Initially insurance fund was the treasury.
      return insuranceFund ? low(insuranceFund) : TREASURY_ADDRESS;
    default:
      throw new Error(`unknown contract alias ${contract}`);
  }
};
