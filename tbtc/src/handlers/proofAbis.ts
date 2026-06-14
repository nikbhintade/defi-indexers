/**
 * JSON ABIs for decoding the Bridge proof-submission calldata. These are
 * declared as plain objects (cast to viem `Abi`) rather than via `parseAbi`
 * because viem's compile-time signature parser rejects these deeply-nested
 * tuple structs (runtime parsing is fine, but the type checker is too strict).
 */
import type { Abi } from "viem";

const bitcoinTxInfo = {
  name: "tx",
  type: "tuple",
  components: [
    { name: "version", type: "bytes4" },
    { name: "inputVector", type: "bytes" },
    { name: "outputVector", type: "bytes" },
    { name: "locktime", type: "bytes4" },
  ],
} as const;

const utxo = {
  name: "mainUtxo",
  type: "tuple",
  components: [
    { name: "txHash", type: "bytes32" },
    { name: "txOutputIndex", type: "uint32" },
    { name: "txOutputValue", type: "uint64" },
  ],
} as const;

const proofV1 = (name: string) => ({
  name,
  type: "tuple",
  components: [
    { name: "merkleProof", type: "bytes" },
    { name: "txIndexInBlock", type: "uint256" },
    { name: "bitcoinHeaders", type: "bytes" },
  ],
});

const proofV2 = (name: string) => ({
  name,
  type: "tuple",
  components: [
    { name: "merkleProof", type: "bytes" },
    { name: "txIndexInBlock", type: "uint256" },
    { name: "bitcoinHeaders", type: "bytes" },
    { name: "coinbasePreimage", type: "bytes32" },
    { name: "coinbaseProof", type: "bytes" },
  ],
});

export const SWEEP_ABI: Abi = [
  {
    type: "function",
    name: "submitDepositSweepProof",
    stateMutability: "nonpayable",
    outputs: [],
    inputs: [
      { ...bitcoinTxInfo, name: "sweepTx" },
      proofV1("sweepProof"),
      utxo,
      { name: "vault", type: "address" },
    ],
  },
] as Abi;

export const SWEEP_ABI_V2: Abi = [
  {
    type: "function",
    name: "submitDepositSweepProof",
    stateMutability: "nonpayable",
    outputs: [],
    inputs: [
      { ...bitcoinTxInfo, name: "sweepTx" },
      proofV2("sweepProof"),
      utxo,
      { name: "vault", type: "address" },
    ],
  },
] as Abi;

export const REDEMPTION_PROOF_ABI: Abi = [
  {
    type: "function",
    name: "submitRedemptionProof",
    stateMutability: "nonpayable",
    outputs: [],
    inputs: [
      { ...bitcoinTxInfo, name: "redemptionTx" },
      proofV1("redemptionProof"),
      utxo,
      { name: "walletPubKeyHash", type: "bytes20" },
    ],
  },
] as Abi;

export const REDEMPTION_PROOF_ABI_V2: Abi = [
  {
    type: "function",
    name: "submitRedemptionProof",
    stateMutability: "nonpayable",
    outputs: [],
    inputs: [
      { ...bitcoinTxInfo, name: "redemptionTx" },
      proofV2("redemptionProof"),
      utxo,
      { name: "walletPubKeyHash", type: "bytes20" },
    ],
  },
] as Abi;
