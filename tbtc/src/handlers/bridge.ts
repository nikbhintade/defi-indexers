/**
 * Bridge data source — deposit & redemption lifecycle.
 *
 * Faithful port of src/mappingBridge.ts + src/swept.ts. The subgraph used
 * Ethereum *call handlers* (`submitDepositSweepProof`, `submitRedemptionProof`)
 * to mark deposits SWEPT / redemptions COMPLETED. HyperIndex has no call
 * handlers, but those functions each emit an event in the same transaction
 * (DepositsSwept, RedemptionsCompleted). We hook those events and decode
 * `event.transaction.input` to recover the same Bitcoin tx vectors the call
 * handler received — producing identical entity updates. See MIGRATION.md.
 */
import { indexer } from "envio";
import type { EvmOnEventContext } from "envio";
import { decodeFunctionData } from "viem";
import {
  SWEEP_ABI,
  SWEEP_ABI_V2,
  REDEMPTION_PROOF_ABI,
  REDEMPTION_PROOF_ABI_V2,
} from "./proofAbis.js";
import * as Utils from "../utils/utils.js";
import * as BitcoinUtils from "../utils/bitcoin_utils.js";
import { keccak256 } from "../utils/crypto.js";
import * as Const from "../utils/constants.js";
import {
  getOrCreateDeposit,
  getOrCreateRedemption,
  getOrCreateTbtcToken,
  getOrCreateTransaction,
  getOrCreateUser,
  getStats,
  getStatus,
  lc,
} from "../utils/helper.js";
import { getDepositTreasuryFee } from "../effects/calls.js";

const BRIDGE_ADDRESS = "0x5e4861a80b55f035d899f66772117f00fa0e8e7b";

// ---------- DepositRevealed ----------
indexer.onEvent(
  { contract: "Bridge", event: "DepositRevealed" },
  async ({ event, context }) => {
    const fundingTxHash = Utils.hexToBytes(event.params.fundingTxHash);
    const fundingOutputIndex = Number(event.params.fundingOutputIndex);
    // keccak256(fundingTxHash | fundingOutputIndex)
    const id = Utils.calculateDepositKey(fundingTxHash, fundingOutputIndex);

    const txId = Utils.getIDFromEvent(event.transaction.hash, event.logIndex);
    const transaction = await getOrCreateTransaction(context, txId);
    context.Transaction.set({
      ...transaction,
      txHash: lc(event.transaction.hash),
      timestamp: BigInt(event.block.timestamp),
      from: lc(event.transaction.from ?? ""),
      to: event.transaction.to ? lc(event.transaction.to) : undefined,
      amount: event.params.amount,
      description: "Deposit Revealed",
    });

    // Bridge.deposits(depositKey).treasuryFee (block-pinned)
    const depositKey = BigInt(id);
    const treasuryFee = await getDepositTreasuryFee(
      context.effect,
      BRIDGE_ADDRESS,
      depositKey,
      event.block.number,
    );

    const deposit = await getOrCreateDeposit(context, id);
    const depositor = lc(event.params.depositor);
    context.Deposit.set({
      ...deposit,
      status: "REVEALED",
      user_id: depositor,
      amount: event.params.amount,
      treasuryFee,
      walletPubKeyHash: lc(event.params.walletPubKeyHash),
      fundingTxHash: lc(event.params.fundingTxHash),
      fundingOutputIndex: event.params.fundingOutputIndex,
      blindingFactor: lc(event.params.blindingFactor),
      refundPubKeyHash: lc(event.params.refundPubKeyHash),
      refundLocktime: lc(event.params.refundLocktime),
      vault: lc(event.params.vault),
      transactions: [...deposit.transactions, txId],
      depositTimestamp: BigInt(event.block.timestamp),
      updateTimestamp: BigInt(event.block.timestamp),
    });

    const stats = await getStats(context);
    context.StatsRecord.set({ ...stats, numDeposits: stats.numDeposits + 1 });

    const user = await getOrCreateUser(context, depositor);
    const token = await getOrCreateTbtcToken(context);
    context.User.set({
      ...user,
      tbtcToken_id: token.id,
      deposits: [...user.deposits, id],
    });
  },
);

// ---------- DepositsSwept (decodes submitDepositSweepProof calldata) ----------
function decodeSweepInput(input: string): { inputVector: string } | null {
  for (const abi of [SWEEP_ABI, SWEEP_ABI_V2]) {
    try {
      const { args } = decodeFunctionData({ abi, data: input as `0x${string}` });
      if (!args) continue;
      const sweepTx = args[0] as { inputVector: string };
      return { inputVector: sweepTx.inputVector };
    } catch (_e) {
      /* try next overload */
    }
  }
  return null;
}

// reverse endianness of a 4-byte LE index to a number (mirror swept.ts reverseUint32)
function reverseUint32(b: number): number {
  let v = b >>> 0;
  v = (((v >> 8) & 0x00ff00ff) | ((v & 0x00ff00ff) << 8)) >>> 0;
  v = ((v >>> 16) | (v << 16)) >>> 0;
  return v >>> 0;
}

indexer.onEvent(
  { contract: "Bridge", event: "DepositsSwept" },
  async ({ event, context }) => {
    const decoded = decodeSweepInput(event.transaction.input);
    if (!decoded) return;
    const inputVector = Utils.hexToBytes(decoded.inputVector);

    const parsed = BitcoinUtils.parseVarInt(inputVector);
    const inputsCompactSizeUintLength = parsed.dataLength;
    const inputsCount = Number(parsed.number);

    let inputStartingIndex = inputsCompactSizeUintLength + 1n;

    const status = await getStatus(context);
    const lastMintedInfo = status.lastMintedInfo;

    for (let i = 0; i < inputsCount; i++) {
      const outpointTxHash = BitcoinUtils.extractInputTxIdLEAt(inputVector, inputStartingIndex);
      const outpointIndex = reverseUint32(
        BitcoinUtils.bytesToUint(
          BitcoinUtils.extractTxIndexLEAt(inputVector, inputStartingIndex),
        ),
      );
      const inputLength = BitcoinUtils.determineInputLengthAt(inputVector, inputStartingIndex);

      const depositKey = Utils.calculateDepositKey(outpointTxHash, outpointIndex);
      const deposit = await getOrCreateDeposit(context, depositKey);

      if ((deposit.depositTimestamp ?? Const.ZERO_BI) !== Const.ZERO_BI) {
        const txId = Utils.getIDFromCall(event.transaction.hash, event.logIndex);
        const transaction = await getOrCreateTransaction(context, txId);
        context.Transaction.set({
          ...transaction,
          txHash: lc(event.transaction.hash),
          timestamp: BigInt(event.block.timestamp),
          from: lc(event.transaction.from ?? ""),
          to: event.transaction.to ? lc(event.transaction.to) : undefined,
          amount: Const.ZERO_BI,
          description: "Swept by wallet",
        });

        let actualAmountReceived = Const.ZERO_BI;
        const user = await getOrCreateUser(context, deposit.user_id);
        for (let j = 0; j < lastMintedInfo.length; j++) {
          const mintedData = lastMintedInfo[j]!.split("-");
          const depositorHex = mintedData[0]!;
          const amount = mintedData[1]!;
          if (depositorHex.toLowerCase() === user.id.toLowerCase()) {
            actualAmountReceived = BigInt(amount);
            break;
          }
        }

        context.Deposit.set({
          ...deposit,
          sweptAt: BigInt(event.block.timestamp),
          transactions: [...deposit.transactions, txId],
          updateTimestamp: BigInt(event.block.timestamp),
          status: "SWEPT",
          actualAmountReceived:
            deposit.actualAmountReceived === Const.ZERO_BI
              ? actualAmountReceived
              : deposit.actualAmountReceived,
        });
      }

      if (inputStartingIndex + inputLength > BigInt(inputVector.length)) {
        break;
      }
      inputStartingIndex = inputStartingIndex + inputLength;
    }
  },
);

// ---------- RedemptionRequested ----------
async function reformatRedemptionKeyIfExists(
  context: EvmOnEventContext,
  redeemerOutputScript: Uint8Array,
  walletPubKeyHash: Uint8Array,
): Promise<string> {
  let count = Const.ZERO_BI;
  let id = "";
  for (;;) {
    id = Utils.calculateRedemptionKey(redeemerOutputScript, walletPubKeyHash, count);
    const redemption = await getOrCreateRedemption(context, id);
    if (redemption.updateTimestamp !== Const.ZERO_BI) {
      count = count + Const.ONE_BI;
    } else {
      break;
    }
  }
  return id;
}

async function getLastRedemptionKey(
  context: EvmOnEventContext,
  scriptOrHash: Uint8Array,
  walletPubKeyHash: Uint8Array,
  calculateByScriptHash: boolean,
): Promise<string> {
  let count = Const.ZERO_BI;
  let id = "";
  let lastId = "";
  for (;;) {
    id = calculateByScriptHash
      ? Utils.calculateRedemptionKeyByScriptHash(scriptOrHash, walletPubKeyHash, count)
      : Utils.calculateRedemptionKey(scriptOrHash, walletPubKeyHash, count);
    const redemption = await getOrCreateRedemption(context, id);
    if (redemption.updateTimestamp !== Const.ZERO_BI) {
      count = count + Const.ONE_BI;
      lastId = id;
    } else {
      break;
    }
  }
  return lastId;
}

indexer.onEvent(
  { contract: "Bridge", event: "RedemptionRequested" },
  async ({ event, context }) => {
    const txId = Utils.getIDFromEvent(event.transaction.hash, event.logIndex);
    const transaction = await getOrCreateTransaction(context, txId);
    context.Transaction.set({
      ...transaction,
      txHash: lc(event.transaction.hash),
      timestamp: BigInt(event.block.timestamp),
      from: lc(event.transaction.from ?? ""),
      to: event.transaction.to ? lc(event.transaction.to) : undefined,
      amount: event.params.requestedAmount,
      description: "Redemption Requested",
    });

    const walletPubKeyHash = Utils.hexToBytes(event.params.walletPubKeyHash);
    const redeemerOutputScript = Utils.hexToBytes(event.params.redeemerOutputScript);

    const id = await reformatRedemptionKeyIfExists(
      context,
      redeemerOutputScript,
      walletPubKeyHash,
    );
    const redemption = await getOrCreateRedemption(context, id);
    const redeemer = lc(event.params.redeemer);

    const user = await getOrCreateUser(context, redeemer);
    const token = await getOrCreateTbtcToken(context);
    context.User.set({
      ...user,
      tbtcToken_id: token.id,
      redemptions: [...user.redemptions, id],
    });

    context.Redemption.set({
      ...redemption,
      status: "REQUESTED",
      amount: event.params.requestedAmount,
      user_id: redeemer,
      treasuryFee: event.params.treasuryFee,
      txMaxFee: event.params.txMaxFee,
      redemptionTxHash: lc(event.transaction.hash),
      redemptionTimestamp: BigInt(event.block.timestamp),
      walletPubKeyHash: lc(event.params.walletPubKeyHash),
      redeemerOutputScript: lc(event.params.redeemerOutputScript),
      updateTimestamp: BigInt(event.block.timestamp),
      transactions: [...redemption.transactions, txId],
    });

    const stats = await getStats(context);
    context.StatsRecord.set({ ...stats, numRedemptions: stats.numRedemptions + 1 });
  },
);

// ---------- RedemptionTimedOut ----------
indexer.onEvent(
  { contract: "Bridge", event: "RedemptionTimedOut" },
  async ({ event, context }) => {
    const walletPubKeyHash = Utils.hexToBytes(event.params.walletPubKeyHash);
    const redeemerOutputScript = Utils.hexToBytes(event.params.redeemerOutputScript);

    const txId = Utils.getIDFromEvent(event.transaction.hash, event.logIndex);
    const transaction = await getOrCreateTransaction(context, txId);
    context.Transaction.set({
      ...transaction,
      txHash: lc(event.transaction.hash),
      timestamp: BigInt(event.block.timestamp),
      from: lc(event.transaction.from ?? ""),
      to: event.transaction.to ? lc(event.transaction.to) : undefined,
      description: "Redemption TimedOut",
    });

    const id = await getLastRedemptionKey(context, redeemerOutputScript, walletPubKeyHash, false);
    const redemption = await getOrCreateRedemption(context, id);
    context.Redemption.set({
      ...redemption,
      status: "TIMEDOUT",
      updateTimestamp: BigInt(event.block.timestamp),
      transactions: [...redemption.transactions, txId],
    });
  },
);

// ---------- RedemptionsCompleted (+ submitRedemptionProof calldata) ----------
// In the subgraph, RedemptionsCompleted (event) pushed [redemptionTxHash, blockHash]
// to status.pendingRedemptions, then the submitRedemptionProof *call handler*
// (same tx) consumed it. HyperIndex merges both into this single event handler:
// we push to pendingRedemptions and immediately process the redemption proof
// calldata, preserving the original's `pendingRedemptions[1] == block.hash`
// completion logic.
function decodeRedemptionProofInput(
  input: string,
): { outputVector: string; walletPubKeyHash: string } | null {
  for (const abi of [REDEMPTION_PROOF_ABI, REDEMPTION_PROOF_ABI_V2]) {
    try {
      const { args } = decodeFunctionData({ abi, data: input as `0x${string}` });
      if (!args) continue;
      const redemptionTx = args[0] as { outputVector: string };
      const walletPubKeyHash = args[3] as string;
      return { outputVector: redemptionTx.outputVector, walletPubKeyHash };
    } catch (_e) {
      /* try next overload */
    }
  }
  return null;
}

function calculateOutputScriptHash(
  redemptionTxOutputVector: Uint8Array,
  outputScriptStart: number,
  scriptLength: number,
): Uint8Array {
  const outputScriptData = redemptionTxOutputVector.subarray(
    outputScriptStart,
    outputScriptStart + scriptLength,
  );
  return keccak256(outputScriptData);
}

indexer.onEvent(
  { contract: "Bridge", event: "RedemptionsCompleted" },
  async ({ event, context }) => {
    // (1) RedemptionsCompleted event body: push pending redemption info.
    let status = await getStatus(context);
    const pendingRedemptions = [
      ...status.pendingRedemptions,
      lc(event.params.redemptionTxHash),
      lc(event.block.hash),
    ];
    status = { ...status, pendingRedemptions };
    context.StatusRecord.set(status);

    // (2) submitRedemptionProof call-handler equivalent.
    const decoded = decodeRedemptionProofInput(event.transaction.input);
    if (!decoded) {
      return;
    }
    const outputVector = Utils.hexToBytes(decoded.outputVector);
    const walletPubKeyHash = Utils.hexToBytes(decoded.walletPubKeyHash);

    const redemptionTxOutputVector = BitcoinUtils.parseVarInt(outputVector);
    const outputsCompactSizeUintLength = redemptionTxOutputVector.dataLength;
    const outputsCount = Number(redemptionTxOutputVector.number);

    let outputStartingIndex = outputsCompactSizeUintLength + 1n;
    for (let i = 0; i < outputsCount; i++) {
      const outputLength = BitcoinUtils.determineOutputLengthAt(outputVector, outputStartingIndex);
      const scriptLength = outputLength - 8n;
      const outputScriptStart = outputStartingIndex + 8n;
      const outputScript = calculateOutputScriptHash(
        outputVector,
        Number(outputScriptStart),
        Number(scriptLength),
      );

      const redemptionKey = await getLastRedemptionKey(
        context,
        outputScript,
        walletPubKeyHash,
        true,
      );
      const redemption = await getOrCreateRedemption(context, redemptionKey);

      if (redemption.status !== "UNKNOWN" && redemption.updateTimestamp !== Const.ZERO_BI) {
        const st = await getStatus(context);
        const pending = st.pendingRedemptions;
        if (pending[1] === lc(event.block.hash)) {
          const txId = Utils.getIDFromCall(event.transaction.hash, event.logIndex);
          const transaction = await getOrCreateTransaction(context, txId);
          context.Transaction.set({
            ...transaction,
            txHash: lc(event.transaction.hash),
            timestamp: BigInt(event.block.timestamp),
            from: lc(event.transaction.from ?? ""),
            to: event.transaction.to ? lc(event.transaction.to) : undefined,
            description: "Redemption success",
          });

          context.Redemption.set({
            ...redemption,
            status: "COMPLETED",
            completedTxHash: pending[0],
            updateTimestamp: BigInt(event.block.timestamp),
            transactions: [...redemption.transactions, txId],
          });
        }
      }
      outputStartingIndex = outputStartingIndex + outputLength;
    }

    // Reset pendingRedemptions list.
    const finalStatus = await getStatus(context);
    context.StatusRecord.set({ ...finalStatus, pendingRedemptions: [] });
  },
);
