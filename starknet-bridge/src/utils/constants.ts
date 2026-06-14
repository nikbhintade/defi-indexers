/*
 * Bridge address registry — the rendered "mainnet" variant of the source
 * subgraph's `templates/config.template.ts` (`bridgesAddressesL1` /
 * `bridgesAddressesL2`).
 *
 * The source repo only ships config/stable.json (placeholder zero addresses)
 * and config/staging.json (Goerli). There is no committed mainnet.json, so the
 * mainnet bridge set is materialized here from the canonical StarkGate mainnet
 * registry (starkware-libs/starknet-addresses, bridged_tokens/mainnet.json) as
 * of the port date (2026-06). Index i of L1 pairs with index i of L2 — the
 * isBridge*Message filters require BOTH the L1 and L2 address to match at the
 * same index (see isL1BridgeAddress.ts), mirroring the original loop exactly.
 *
 * Addresses are stored LOWERCASE here; isL1BridgeAddress compares lowercase
 * against lowercased event addresses, reproducing graph-ts Bytes.equals (which
 * compares the underlying lowercase bytes).
 *
 * Entry 0 is the canonical ETH bridge (StarkGate "legacy" ETH bridge); the
 * remaining entries are the per-token bridges. The shared multi-bridge proxy
 * 0xf5b6...69eb (StarknetTokenBridge) backs many tokens on a single L2 bridge
 * 0x0616...9256; it is included once.
 */
export const TransferStatus = {
  PENDING: "PENDING",
  FINISHED: "FINISHED",
} as const;

const RAW_BRIDGES: { l1: string; l2: string }[] = [
  // ETH bridge (ethBridgeL1 / ethBridgeL2 in the source template)
  { l1: "0xae0Ee0A63A2cE6BaeEFFE56e7714FB4EFE48D419", l2: "0x073314940630fd6dcda0d772d4c972c4e0a9946bef9dabf4ef84eda8ef542b82" },
  // Per-token bridges (tokenBridges[] in the source template)
  { l1: "0xcE5485Cfb26914C5dcE00B9BAF0580364daFC7a4", l2: "0x0594c1582459ea03f77deaf9eb7e3917d6994a03c13405ba42867f83d85f085d" }, // STRK
  { l1: "0x283751A21eafBFcD52297820D27C1f1963D9b5b4", l2: "0x07aeec4870975311a7396069033796b61cd66ed49d22a786cba12a8d76717302" }, // WBTC
  { l1: "0xF6080D9fbEEbcd44D89aFfBFd42F098cbFf92816", l2: "0x05cd48fccbfd8aa2773fe22c217e808319ffcc1c5a6a463f7d8fa2da48218196" }, // USDC
  { l1: "0xbb3400F107804DFB482565FF1Ec8D8aE66747605", l2: "0x074761a8d48ce002963002becc6d9c3dd8a2a05b1075d55e5967f42296f16bd0" }, // USDT
  { l1: "0xCA14057f85F2662257fd2637FdEc558626bCe554", l2: "0x07754236934aeaf4c29d287b94b5fde8687ba7d59466ea6b80f3f57d6467b7d6" }, // DAI
  { l1: "0x9F96fE0633eE838D0298E8b8980E6716bE81388d", l2: "0x075ac198e734e289a6892baa8dd14b21095f13bf8401900f5349d5569c3f6e60" }, // DAI v0
  { l1: "0xBf67F59D2988A46FBFF7ed79A621778a3Cd3985B", l2: "0x0088eedbe2fe3918b69ccb411713b7fa72079d4eddf291103ccbe41e78a9615c" }, // wstETH
  { l1: "0xcf58536D6Fab5E59B654228a5a4ed89b13A876C2", l2: "0x0078da8023b3c08e5a41540a34f7c385fd4f4540d5668f1be3ede0d3bb1b9d4d" }, // rETH
  { l1: "0xb27d0dCAFd63db302C155c8864886f33BD2a41E5", l2: "0x00b0cefce685e321eba324fac1c8e2db768892bc1ddb8375fe40fd269fa69fb2" }, // R
  { l1: "0xDc687e1E0B85CB589b2da3C47c933De9Db3d1ebb", l2: "0x006646a87b8e9e51a893c52facd89f99539a152b96e72daee6a7a3734aa5299a" }, // FRAX
  { l1: "0x66ba83ba3D3AD296424a2258145d9910E9E40B7C", l2: "0x06bf25c0911c6c63abfe3600428144d0d0dbf8b7bfbc44306a3386aa95a24296" }, // FXS
  { l1: "0xd8E8531fdD446DF5298819d3Bc9189a5D8948Ee8", l2: "0x06dcc61c4cf056ff42a8f4b8635c207e3da73332282aa2132058022520fa0179" }, // sfrxETH
  { l1: "0xF3F62F23dF9C1D2C7C63D9ea6B90E8d24c7E3DF5", l2: "0x05841ed9b790719b61dc98826246a7a3012dd35b0ed728e3c455af2647385c80" }, // LUSD
  { l1: "0xf76e6bF9e2df09D0f854F045A3B724074dA1236B", l2: "0x04fe90c0c4594b4a5ce3031a4bbdfbc7c046b4b9d7cf31b79647540c85b8ec79" }, // UNI
  { l1: "0x2111A49ebb717959059693a3698872a0aE9866b9", l2: "0x067eb1988556edd7543a3c9ee24cc078be35fd49f0b7f264cc0434aeb6dfb09e" }, // tBTC
  { l1: "0x3cDe3eE221aD64d096C92e0F750Feb8A750519A8", l2: "0x07b8093075fe02cd1e596f1a6bcb2aea1ff84698e1cec42012336f27fc976d87" }, // AAVE
  { l1: "0x9FaDA9F29492Af64A852f35EAfd957b790B7ea7E", l2: "0x0028db8d8b55770675e2ea79382290772368d88b1f9b83eb3e956700447735bc" }, // LINK
  { l1: "0xEa90D8aE0Fe18a8aF72E57EFDDfE819aa96f244E", l2: "0x05e2b3bbf0fe1a2547ba6c55fb5888ee8bd7d7e3e773cdda19d6174749547caf" }, // ENA
  { l1: "0x6F3229B9056bC42F147f309B10877cC5919EeFd5", l2: "0x07a17b56fb56830807c1f59faf8c3e20a1d48292b018b4f5ef5d9e349ae7013e" }, // USR
  { l1: "0x52c65B6795216c4D76fAcACdE8B5f4BAd2c9b9d7", l2: "0x04b61b603821164c38f3f3cf552a24b3d7fd0710d40d84a0dcf765bb625d0f01" }, // ZRO
  { l1: "0x96C8AE2AC9A5cd5fC354e375dB4d0ca75fc0685e", l2: "0x0239eee60e6d0bed42315ac74a1fc43db8074646d4d2a0a9e6fa5272685a0eb5" }, // LBTC
  // Shared StarknetTokenBridge multi-bridge proxy (backs many tokens)
  { l1: "0xF5b6Ee2CAEb6769659f6C091D209DfdCaF3F69Eb", l2: "0x0616757a151c21f9be8775098d591c2807316d992bbc3bb1a5c1821630589256" },
];

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// graph-ts source stored these as Bytes and compared with Bytes.equals. We keep
// them as lowercase 0x hex strings and compare strings (see isL1BridgeAddress).
export const l1BridgesAddresses: string[] = RAW_BRIDGES.map((b) =>
  b.l1.toLowerCase(),
);
export const l2BridgesAddresses: string[] = RAW_BRIDGES.map((b) =>
  b.l2.toLowerCase(),
);
