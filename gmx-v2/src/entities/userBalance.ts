import type { Transaction, UserGmTokensBalanceChange } from "envio";
import type { handlerContext } from "../types";
import { getOrCreateCollectedMarketFees } from "./fees";
import { ZERO, ONE, pow10 } from "../utils/number";

export async function saveUserGmTokensBalanceChange(
  context: handlerContext,
  account: string,
  marketAddress: string,
  value: bigint,
  transaction: Transaction,
  transactionLogIndex: bigint,
): Promise<void> {
  const prevEntity = await getLatestUserGmTokensBalanceChange(context, account, marketAddress);
  const isDeposit = value > ZERO;
  let entity = createUserGmTokensBalanceChange(
    context,
    account,
    marketAddress,
    transaction,
    transactionLogIndex,
    isDeposit ? "in" : "out",
  );
  const totalFees = await context.CollectedMarketFeesInfo.get(marketAddress + ":total");
  const prevBalance = prevEntity ? prevEntity.tokensBalance : ZERO;
  const prevCumulativeIncome = prevEntity ? prevEntity.cumulativeIncome : ZERO;

  const income = await calcIncomeForEntity(context, prevEntity, isDeposit);

  entity = {
    ...entity,
    tokensBalance: prevBalance + value,
    cumulativeIncome: prevCumulativeIncome + income,
    index: prevEntity ? prevEntity.index + ONE : ZERO,
  };

  if (totalFees) {
    entity = {
      ...entity,
      cumulativeFeeUsdPerGmToken: isDeposit
        ? totalFees.prevCumulativeFeeUsdPerGmToken
        : totalFees.cumulativeFeeUsdPerGmToken,
    };
  }

  context.UserGmTokensBalanceChange.set(entity);
  await saveLatestUserGmTokensBalanceChange(context, entity);
}

async function getLatestUserGmTokensBalanceChange(
  context: handlerContext,
  account: string,
  marketAddress: string,
): Promise<UserGmTokensBalanceChange | null> {
  const id = account + ":" + marketAddress;
  const latestRef = await context.LatestUserGmTokensBalanceChangeRef.get(id);
  if (!latestRef) return null;

  const latestId = latestRef.latestUserGmTokensBalanceChange;
  if (!latestId) {
    context.log.warn(`LatestUserGmTokensBalanceChangeRef.latestUserGmTokensBalanceChange is null: ${id}`);
    throw new Error("LatestUserGmTokensBalanceChangeRef.latestUserGmTokensBalanceChange is null");
  }
  return (await context.UserGmTokensBalanceChange.get(latestId)) ?? null;
}

async function saveLatestUserGmTokensBalanceChange(
  context: handlerContext,
  change: UserGmTokensBalanceChange,
): Promise<void> {
  const id = change.account + ":" + change.marketAddress;
  context.LatestUserGmTokensBalanceChangeRef.set({ id, latestUserGmTokensBalanceChange: change.id });
}

async function calcIncomeForEntity(
  context: handlerContext,
  entity: UserGmTokensBalanceChange | null,
  isDeposit: boolean,
): Promise<bigint> {
  if (!entity) return ZERO;
  if (entity.tokensBalance === ZERO) return ZERO;

  const currentFees = await getOrCreateCollectedMarketFees(context, entity.marketAddress, 0, "total");
  const latestCumulativeFeePerGm = isDeposit
    ? currentFees.prevCumulativeFeeUsdPerGmToken
    : currentFees.cumulativeFeeUsdPerGmToken;
  const feeUsdPerGmToken = latestCumulativeFeePerGm - entity.cumulativeFeeUsdPerGmToken;

  return (feeUsdPerGmToken * entity.tokensBalance) / pow10(18);
}

function createUserGmTokensBalanceChange(
  context: handlerContext,
  account: string,
  marketAddress: string,
  transaction: Transaction,
  transactionLogIndex: bigint,
  postfix: string,
): UserGmTokensBalanceChange {
  const id =
    account + ":" + marketAddress + ":" + transaction.hash + ":" + transactionLogIndex.toString() + ":" + postfix;

  return {
    id,
    account,
    marketAddress,
    index: ZERO,
    tokensBalance: ZERO,
    timestamp: transaction.timestamp,
    cumulativeIncome: ZERO,
    cumulativeFeeUsdPerGmToken: ZERO,
  };
}
