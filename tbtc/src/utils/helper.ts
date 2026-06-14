/**
 * getOrCreate helpers — faithful port of src/utils/helper.ts.
 * Entities are immutable plain objects in HyperIndex; callers spread-update
 * and `context.X.set(...)`. These helpers return a fully-defaulted entity if
 * one does not exist yet (matching the subgraph constructors).
 */
import type {
  Deposit,
  Redemption,
  Transaction,
  Event,
  User,
  TBTCToken,
  Operator,
  StatsRecord,
  StatusRecord,
  EvmOnEventContext,
} from "envio";
import * as Const from "./constants.js";

export type handlerContext = EvmOnEventContext;

/** Lowercase an address/hex string (subgraphs store lowercase). */
export const lc = (x: string): string => x.toLowerCase();

export async function getOrCreateTransaction(
  context: handlerContext,
  id: string,
): Promise<Transaction> {
  const existing = await context.Transaction.get(id);
  if (existing) return existing;
  return {
    id,
    txHash: "",
    timestamp: Const.ZERO_BI,
    from: "",
    to: undefined,
    amount: Const.ZERO_BI,
    description: undefined,
  };
}

export async function getOrCreateUser(context: handlerContext, id: string): Promise<User> {
  const lid = lc(id);
  const existing = await context.User.get(lid);
  if (existing) return existing;
  // ensure the token singleton exists for the tbtcToken relation
  await getOrCreateTbtcToken(context);
  return {
    id: lid,
    mintingDebt: Const.ZERO_BI,
    tokenBalance: Const.ZERO_BI,
    totalTokensHeld: Const.ZERO_BI,
    tbtcToken_id: "TBTCToken",
    isRedeemerBanned: false,
    deposits: [],
    redemptions: [],
  };
}

export async function getOrCreateDeposit(context: handlerContext, id: string): Promise<Deposit> {
  const existing = await context.Deposit.get(id);
  if (existing) return existing;
  return {
    id,
    status: "UNKNOWN",
    user_id: "",
    amount: Const.ZERO_BI,
    transactions: [],
    treasuryFee: Const.ZERO_BI,
    actualAmountReceived: Const.ZERO_BI,
    newDebt: Const.ZERO_BI,
    depositTimestamp: Const.ZERO_BI,
    sweptAt: Const.ZERO_BI,
    walletPubKeyHash: undefined,
    fundingTxHash: undefined,
    fundingOutputIndex: undefined,
    blindingFactor: undefined,
    refundPubKeyHash: undefined,
    refundLocktime: undefined,
    vault: undefined,
    updateTimestamp: undefined,
  };
}

export async function getOrCreateRedemption(
  context: handlerContext,
  id: string,
): Promise<Redemption> {
  const existing = await context.Redemption.get(id);
  if (existing) return existing;
  return {
    id,
    status: "UNKNOWN",
    user_id: "",
    amount: Const.ZERO_BI,
    transactions: [],
    updateTimestamp: Const.ZERO_BI,
    walletPubKeyHash: undefined,
    redeemerOutputScript: undefined,
    redemptionTxHash: undefined,
    treasuryFee: undefined,
    txMaxFee: undefined,
    completedTxHash: undefined,
    redemptionTimestamp: undefined,
  };
}

export async function getOrCreateTbtcToken(context: handlerContext): Promise<TBTCToken> {
  const existing = await context.TBTCToken.get("TBTCToken");
  if (existing) return existing;
  const token: TBTCToken = {
    id: "TBTCToken",
    decimals: 18,
    name: "tBTC v2",
    symbol: "tBTC",
    totalSupply: Const.ZERO_BI,
    totalMint: Const.ZERO_BI,
    totalBurn: Const.ZERO_BI,
    address: Const.ADDRESS_TBTC,
    currentTokenHolders: Const.ZERO_BI,
  };
  context.TBTCToken.set(token);
  return token;
}

export async function getOrCreateOperatorEvent(
  context: handlerContext,
  id: string,
  from: string,
  txHash: string,
  to: string | undefined,
  timestamp: bigint,
  status: Event["event"],
): Promise<Event> {
  const existing = await context.Event.get(id);
  if (existing) return existing;
  return {
    id,
    from: lc(from),
    txHash: lc(txHash),
    to: to ? lc(to) : undefined,
    timestamp,
    event: status,
    amount: Const.ZERO_BI,
    isRandomBeaconEvent: true,
  };
}

export async function getStats(context: handlerContext): Promise<StatsRecord> {
  const existing = await context.StatsRecord.get("current");
  if (existing) return existing;
  return {
    id: "current",
    numOperators: 0,
    numDeposits: 0,
    numRedemptions: 0,
    totalTBTCAuthorizedAmount: Const.ZERO_BI,
    totalRandomBeaconAuthorizedAmount: Const.ZERO_BI,
    numOperatorsRegisteredNode: 0,
    totalStaked: Const.ZERO_BI,
    mintingStatus: true,
  };
}

export async function getStatus(context: handlerContext): Promise<StatusRecord> {
  const existing = await context.StatusRecord.get("status");
  if (existing) return existing;
  return {
    id: "status",
    pendingRedemptions: [],
    lastMintedInfo: [],
    lastMintedHash: "0x",
  };
}

export async function getOrCreateOperator(
  context: handlerContext,
  address: string,
): Promise<Operator> {
  const id = lc(address);
  const existing = await context.Operator.get(id);
  if (existing) return existing;
  return {
    id,
    address: Const.ADDRESS_ZERO,
    registeredOperatorAddress: 0,
    isBondRegisteredOperatorAddress: false,
    stakedAt: Const.ZERO_BI,
    stakeType: 0,
    randomBeaconAuthorized: false,
    tBTCAuthorized: false,
    tBTCAuthorizedAmount: Const.ZERO_BI,
    randomBeaconAuthorizedAmount: Const.ZERO_BI,
    stakedAmount: Const.ZERO_BI,
    availableReward: Const.ZERO_BI,
    rewardDispensed: Const.ZERO_BI,
    totalSlashedAmount: Const.ZERO_BI,
    misbehavedCount: 0,
    poolRewardBanDuration: Const.ZERO_BI,
    beaconGroupCount: 0,
    owner: undefined,
    beneficiary: undefined,
    authorizer: undefined,
    events: [],
  };
}
