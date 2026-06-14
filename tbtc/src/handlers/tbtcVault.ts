/**
 * TBTCVault data source — optimistic minting + mint/unmint supply accounting.
 * Faithful port of src/mappingTBTCVault.ts.
 */
import { indexer } from "envio";
import * as Utils from "../utils/utils.js";
import * as Const from "../utils/constants.js";
import {
  getOrCreateDeposit,
  getOrCreateTbtcToken,
  getOrCreateTransaction,
  getOrCreateUser,
  getStats,
  getStatus,
  lc,
} from "../utils/helper.js";
import { getOptimisticMintingFeeDivisor } from "../effects/calls.js";

const VAULT_ADDRESS = "0x9c070027cdc9dc8f82416b2e5314e11dfb4fe3cd";

indexer.onEvent(
  { contract: "TBTCVault", event: "OptimisticMintingCancelled" },
  async ({ event, context }) => {
    const txId = Utils.getIDFromEvent(event.transaction.hash, event.logIndex);
    const transaction = await getOrCreateTransaction(context, txId);
    context.Transaction.set({
      ...transaction,
      txHash: lc(event.transaction.hash),
      timestamp: BigInt(event.block.timestamp),
      from: lc(event.transaction.from ?? ""),
      to: event.transaction.to ? lc(event.transaction.to) : undefined,
      description: `Guardian ${lc(event.params.guardian)} canceled`,
    });

    const id = Utils.convertDepositKeyToHex(event.params.depositKey);
    const deposit = await getOrCreateDeposit(context, id);
    context.Deposit.set({
      ...deposit,
      status: "CANCELED",
      transactions: [...deposit.transactions, txId],
    });
  },
);

indexer.onEvent(
  { contract: "TBTCVault", event: "OptimisticMintingDebtRepaid" },
  async ({ event, context }) => {
    const user = await getOrCreateUser(context, lc(event.params.depositor));
    context.User.set({ ...user, mintingDebt: event.params.optimisticMintingDebt });
  },
);

indexer.onEvent(
  { contract: "TBTCVault", event: "OptimisticMintingFinalized" },
  async ({ event, context }) => {
    const id = Utils.convertDepositKeyToHex(event.params.depositKey);
    const deposit = await getOrCreateDeposit(context, id);

    const depositor = lc(event.params.depositor);
    const user = await getOrCreateUser(context, depositor);
    context.User.set({ ...user, mintingDebt: event.params.optimisticMintingDebt });

    const feeDivisor = await getOptimisticMintingFeeDivisor(context.effect, VAULT_ADDRESS);

    const amountToMint =
      (deposit.amount - deposit.treasuryFee) * Const.SATOSHI_MULTIPLIER;

    const optimisticMintFee =
      feeDivisor > Const.ZERO_BI ? amountToMint / feeDivisor : Const.ZERO_BI;

    const txId = Utils.getIDFromEvent(event.transaction.hash, event.logIndex);
    const transaction = await getOrCreateTransaction(context, txId);
    context.Transaction.set({
      ...transaction,
      txHash: lc(event.transaction.hash),
      timestamp: BigInt(event.block.timestamp),
      from: lc(event.transaction.from ?? ""),
      to: event.transaction.to ? lc(event.transaction.to) : undefined,
      amount: amountToMint,
      description: "Minting Finalized",
    });

    context.Deposit.set({
      ...deposit,
      status: "MINTING_FINALIZED",
      updateTimestamp: BigInt(event.block.timestamp),
      newDebt: event.params.optimisticMintingDebt,
      actualAmountReceived: amountToMint - optimisticMintFee,
      transactions: [...deposit.transactions, txId],
      user_id: depositor,
    });
  },
);

indexer.onEvent(
  { contract: "TBTCVault", event: "OptimisticMintingPaused" },
  async ({ context }) => {
    const stats = await getStats(context);
    context.StatsRecord.set({ ...stats, mintingStatus: false });
  },
);

indexer.onEvent(
  { contract: "TBTCVault", event: "OptimisticMintingUnpaused" },
  async ({ context }) => {
    const stats = await getStats(context);
    context.StatsRecord.set({ ...stats, mintingStatus: true });
  },
);

indexer.onEvent(
  { contract: "TBTCVault", event: "OptimisticMintingRequested" },
  async ({ event, context }) => {
    const txId = Utils.getIDFromEvent(event.transaction.hash, event.logIndex);
    const transaction = await getOrCreateTransaction(context, txId);
    context.Transaction.set({
      ...transaction,
      txHash: lc(event.transaction.hash),
      timestamp: BigInt(event.block.timestamp),
      from: lc(event.transaction.from ?? ""),
      to: event.transaction.to ? lc(event.transaction.to) : undefined,
      amount: event.params.amount,
      description: "Minting Requested",
    });

    const id = Utils.convertDepositKeyToHex(event.params.depositKey);
    const deposit = await getOrCreateDeposit(context, id);
    context.Deposit.set({
      ...deposit,
      status: "MINTING_REQUESTED",
      updateTimestamp: BigInt(event.block.timestamp),
      transactions: [...deposit.transactions, txId],
    });
  },
);

indexer.onEvent(
  { contract: "TBTCVault", event: "Minted" },
  async ({ event, context }) => {
    const token = await getOrCreateTbtcToken(context);
    context.TBTCToken.set({
      ...token,
      totalMint: token.totalMint + event.params.amount,
      totalSupply: token.totalSupply + event.params.amount,
    });

    // Reset lastMintedInfo when handling a different transaction.
    let status = await getStatus(context);
    const txHash = lc(event.transaction.hash);
    if (status.lastMintedHash.toLowerCase() !== txHash) {
      if (status.lastMintedInfo.length > 0) {
        status = { ...status, lastMintedInfo: [] };
        context.StatusRecord.set(status);
      }
    }

    if (event.params.amount > Const.ZERO_BI) {
      const userDepositAmount = lc(event.params.to) + "-" + event.params.amount.toString();
      const latest = await getStatus(context);
      context.StatusRecord.set({
        ...latest,
        lastMintedInfo: [userDepositAmount],
        lastMintedHash: txHash,
      });
    }
  },
);

indexer.onEvent(
  { contract: "TBTCVault", event: "Unminted" },
  async ({ event, context }) => {
    const token = await getOrCreateTbtcToken(context);
    context.TBTCToken.set({
      ...token,
      totalBurn: token.totalBurn + event.params.amount,
      totalSupply: token.totalSupply - event.params.amount,
    });
  },
);
