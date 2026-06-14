/**
 * Ported from src/Constants/{contractconstants,generalconstants,enumconstants}.ts
 * of the Rocket Pool subgraph. All addresses are stored lowercase (subgraphs
 * store lowercase hex; HyperIndex delivers checksummed addresses, so we
 * normalize on the way in/out).
 */

export const a = (x: string): string => x.toLowerCase();

// Used in calculations that handle amounts in WEI (1e18).
export const ONE_ETHER_IN_WEI = 1000000000n * 1000000000n;

// Represents the RocketPool protocol ID.
export const ROCKETPOOL_PROTOCOL_ROOT_ID =
  "ROCKETPOOL - DECENTRALIZED ETH2.0 STAKING PROTOCOL";

// Used as a prefix for RPL reward intervals.
export const ROCKETPOOL_RPL_REWARD_INTERVAL_ID_PREFIX =
  "ROCKETPOOL_RPL_REWARD_INTERVAL_ID_";

export const ZERO_ADDRESS_STRING =
  "0x0000000000000000000000000000000000000000";

// RocketPool contract addresses (lowercased).
export const ROCKET_TOKEN_RETH_CONTRACT_ADDRESS = a(
  "0xae78736Cd615f374D3085123A210448E74Fc6393"
);
export const ROCKET_DEPOSIT_POOL_CONTRACT_ADDRESS = a(
  "0x4D05E3d48a938db4b7a9A59A802D5b45011BDe58"
);
export const ROCKET_NODE_STAKING_CONTRACT_ADDRESS = a(
  "0x3019227b2b8493e45Bf5d25302139c9a2713BF15"
);
export const ROCKET_NODE_DEPOSIT_CONTRACT_ADDRESS_V1 = a(
  "0xdc9c66155667578179ED82BD17e725aba9dACd09"
);
export const ROCKET_NODE_DEPOSIT_CONTRACT_ADDRESS_V2 = a(
  "0xdcd51fc5cd918e0461b9b7fb75967fdfd10dae2f"
);
export const ROCKET_DAO_PROTOCOL_REWARD_CLAIM_CONTRACT_ADDRESS = a(
  "0x428f0de7a6BF5EcCa29e1c5E8C407B21E8bECD39"
);
export const ROCKET_DAO_TRUSTED_NODE_REWARD_CLAIM_CONTRACT_ADDRESS = a(
  "0x6af730deB0463b432433318dC8002C0A4e9315e8"
);
export const ROCKET_DAO_NODE_TRUSTED_CONTRACT_ADDRESS = a(
  "0xb8e783882b11Ff4f6Cef3C501EA0f4b960152cc9"
);
export const ROCKET_NETWORK_PRICES_CONTRACT_ADDRESS = a(
  "0xd3f500F550F46e504A4D2153127B47e007e11166"
);
export const ROCKET_NETWORK_FEES_CONTRACT_ADDRESS = a(
  "0x0a882C9059Cc2E97c860b80018C27145884D694b"
);
export const ROCKET_DAO_PROTOCOL_SETTINGS_MINIPOOL_CONTRACT_ADDRESS_V1 = a(
  "0x6a032A901F17227b4DB52937FB25f2523A529760"
);
export const ROCKET_DAO_PROTOCOL_SETTINGS_MINIPOOL_CONTRACT_ADDRESS_V2 = a(
  "0x030aEa8378Cc131674D6D655cA26B5A3ef4C63da"
);
export const ROCKET_DAO_PROTOCOL_SETTINGS_NODE_CONTRACT_ADDRESS = a(
  "0xc82D37221940b6E594d6D26D2c5aF775c3F1f437"
);

// RocketPool contract names (as referenced in the contract code).
export const ROCKET_DAO_PROTOCOL_REWARD_CLAIM_CONTRACT_NAME = "rocketClaimDAO";
export const ROCKET_DAO_TRUSTED_NODE_REWARD_CLAIM_CONTRACT_NAME =
  "rocketClaimTrustedNode";
export const ROCKET_NODE_REWARD_CLAIM_CONTRACT_NAME = "rocketClaimNode";

// ---- Enum-like string constants ----
export const NODERPLSTAKETRANSACTIONTYPE_STAKED = "Staked";
export const NODERPLSTAKETRANSACTIONTYPE_WITHDRAWAL = "Withdrawal";
export const NODERPLSTAKETRANSACTIONTYPE_SLASHED = "Slashed";

export const RPLREWARDCLAIMERTYPE_PDAO = "PDAO";
export const RPLREWARDCLAIMERTYPE_ODAO = "ODAO";
export const RPLREWARDCLAIMERTYPE_NODE = "Node";

// Minipool status enum (uint8 from StatusUpdated event).
export const MINIPOOLSTATUS_INITIALIZED = 0n;
export const MINIPOOLSTATUS_PRELAUNCH = 1n;
export const MINIPOOLSTATUS_STAKING = 2n;
export const MINIPOOLSTATUS_WITHDRAWABLE = 3n;
export const MINIPOOLSTATUS_DISSOLVED = 4n;
