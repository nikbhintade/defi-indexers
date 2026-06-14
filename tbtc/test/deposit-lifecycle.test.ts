/**
 * Offline lifecycle test: DepositRevealed -> DepositsSwept.
 *
 * 1. DepositRevealed creates the Deposit entity (status REVEALED) with the
 *    derived deposit key as id and treasuryFee read via a mocked Bridge.deposits
 *    eth_call (TBTC_CALL_MOCK).
 * 2. DepositsSwept carries submitDepositSweepProof calldata in
 *    transaction.input; the handler decodes the sweep inputVector, recomputes
 *    the same deposit key from the outpoint, and flips status to SWEPT.
 *
 * The sweep input's outpoint (txid LE + index) is constructed to hash to the
 * exact same deposit key as the revealed deposit, proving the calldata-decoding
 * path is byte-faithful to the original AssemblyScript call handler.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTestIndexer } from "envio";
import { encodeFunctionData } from "viem";
import { setCallMock } from "../src/effects/calls.js";
import { calculateDepositKey, hexToBytes } from "../src/utils/utils.js";
import { SWEEP_ABI } from "../src/handlers/proofAbis.js";

const BRIDGE = "0x5e4861a80b55f035d899f66772117f00fa0e8e7b";
const DEPOSITOR = "0x1111111111111111111111111111111111111111";
const WALLET_PKH = "0x" + "22".repeat(20);
const VAULT = "0x9c070027cdc9dc8f82416b2e5314e11dfb4fe3cd";

// 32-byte funding tx hash (used verbatim as the LE outpoint id in the sweep).
const FUNDING_TX_HASH = "0x" + "ab".repeat(32);
const FUNDING_OUTPUT_INDEX = 1;

const expectedDepositKey = calculateDepositKey(
  hexToBytes(FUNDING_TX_HASH),
  FUNDING_OUTPUT_INDEX,
);

/**
 * Build a single-input sweep tx inputVector:
 *   01                          (1 input, varint)
 *   <32-byte outpoint txid LE>  = FUNDING_TX_HASH bytes
 *   <4-byte outpoint index LE>  = 0x01000000 -> reversed to index 1
 *   00                          (empty scriptSig length -> witness input)
 *   ffffffff                    (sequence)
 */
function buildSweepCalldata(): string {
  const txid = hexToBytes(FUNDING_TX_HASH); // 32 bytes, used directly as LE id
  const indexLE = new Uint8Array([0x01, 0x00, 0x00, 0x00]); // LE 1
  const inputVector = new Uint8Array([
    0x01,
    ...txid,
    ...indexLE,
    0x00,
    0xff,
    0xff,
    0xff,
    0xff,
  ]);
  const toHex = (b: Uint8Array): `0x${string}` =>
    ("0x" + Buffer.from(b).toString("hex")) as `0x${string}`;
  return encodeFunctionData({
    abi: SWEEP_ABI,
    functionName: "submitDepositSweepProof",
    args: [
      {
        version: "0x01000000",
        inputVector: toHex(inputVector),
        outputVector: "0x00",
        locktime: "0x00000000",
      },
      { merkleProof: "0x", txIndexInBlock: 0n, bitcoinHeaders: "0x" },
      { txHash: ("0x" + "00".repeat(32)) as `0x${string}`, txOutputIndex: 0, txOutputValue: 0n },
      VAULT,
    ],
  });
}

afterEach(() => setCallMock(undefined));

describe("deposit lifecycle (revealed -> swept)", () => {
  it("creates the Deposit on reveal and flips it to SWEPT on sweep", async () => {
    setCallMock({
      strict: true,
      rules: [
        // Bridge.deposits(depositKey).treasuryFee = 1000
        { fn: "deposits", to: BRIDGE, result: { kind: "bigint", value: "1000" } },
      ],
    });

    const indexer = createTestIndexer();

    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "Bridge",
              event: "DepositRevealed",
              srcAddress: BRIDGE as `0x${string}`,
              params: {
                fundingTxHash: FUNDING_TX_HASH as `0x${string}`,
                fundingOutputIndex: BigInt(FUNDING_OUTPUT_INDEX),
                depositor: DEPOSITOR as `0x${string}`,
                amount: 500000n,
                blindingFactor: "0xdeadbeefdeadbeef" as `0x${string}`,
                walletPubKeyHash: WALLET_PKH as `0x${string}`,
                refundPubKeyHash: ("0x" + "33".repeat(20)) as `0x${string}`,
                refundLocktime: "0x00000000" as `0x${string}`,
                vault: VAULT as `0x${string}`,
              },
              block: { number: 16400000, timestamp: 1673000000 },
              transaction: {
                hash: ("0x" + "aa".repeat(32)) as `0x${string}`,
                from: DEPOSITOR as `0x${string}`,
                to: BRIDGE as `0x${string}`,
              },
              logIndex: 0,
            },
          ],
        },
      },
    });

    const revealed = await indexer.Deposit.getOrThrow(expectedDepositKey);
    expect(revealed.status).toBe("REVEALED");
    expect(revealed.user_id).toBe(DEPOSITOR.toLowerCase());
    expect(revealed.amount).toBe(500000n);
    expect(revealed.treasuryFee).toBe(1000n);
    expect(revealed.walletPubKeyHash).toBe(WALLET_PKH);
    expect(revealed.fundingTxHash).toBe(FUNDING_TX_HASH);
    expect(revealed.fundingOutputIndex).toBe(1n);
    expect(revealed.depositTimestamp).toBe(1673000000n);

    // a Transaction was created for the reveal
    const revealTx = await indexer.Transaction.getOrThrow(
      "0x" + "aa".repeat(32) + "-0",
    );
    expect(revealTx.description).toBe("Deposit Revealed");
    expect(revealTx.amount).toBe(500000n);

    // stats incremented
    const stats = await indexer.StatsRecord.getOrThrow("current");
    expect(stats.numDeposits).toBe(1);

    // ---- sweep ----
    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "Bridge",
              event: "DepositsSwept",
              srcAddress: BRIDGE as `0x${string}`,
              params: {
                walletPubKeyHash: WALLET_PKH as `0x${string}`,
                sweepTxHash: ("0x" + "cc".repeat(32)) as `0x${string}`,
              },
              block: { number: 16400100, timestamp: 1673009999 },
              transaction: {
                hash: ("0x" + "bb".repeat(32)) as `0x${string}`,
                from: DEPOSITOR as `0x${string}`,
                to: BRIDGE as `0x${string}`,
                input: buildSweepCalldata() as `0x${string}`,
              },
              logIndex: 0,
            },
          ],
        },
      },
    });

    const swept = await indexer.Deposit.getOrThrow(expectedDepositKey);
    expect(swept.status).toBe("SWEPT");
    expect(swept.sweptAt).toBe(1673009999n);
    expect(swept.updateTimestamp).toBe(1673009999n);
    // transactions array now holds reveal + sweep
    expect(swept.transactions.length).toBe(2);
    expect(swept.transactions).toContain("0x" + "bb".repeat(32) + "-0");
  });
});
