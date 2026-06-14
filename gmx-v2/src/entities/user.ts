import type { User, UserStat } from "envio";
import type { handlerContext } from "../types";
import { timestampToPeriodStart } from "../utils/time";

export async function saveUserStat(
  context: handlerContext,
  type: string,
  account: string,
  timestamp: number,
): Promise<void> {
  let totalUserStats = await getOrCreateUserStat(context, timestamp, "total");
  let dailyUserStats = await getOrCreateUserStat(context, timestamp, "1d");

  let userData = await context.User.get(account);

  if (userData == null) {
    userData = {
      id: account,
      account,
      totalSwapCount: 0,
      totalPositionCount: 0,
      totalDepositCount: 0,
      totalWithdrawalCount: 0,
    };
    if (account) {
      totalUserStats = { ...totalUserStats, uniqueUsers: totalUserStats.uniqueUsers + 1 };
      dailyUserStats = { ...dailyUserStats, uniqueUsers: dailyUserStats.uniqueUsers + 1 };
    }
  }

  if (type === "swap") {
    totalUserStats = { ...totalUserStats, totalSwapCount: totalUserStats.totalSwapCount + 1 };
    dailyUserStats = { ...dailyUserStats, totalSwapCount: dailyUserStats.totalSwapCount + 1 };
    userData = { ...userData, totalSwapCount: userData.totalSwapCount + 1 };
  }
  if (type === "margin") {
    totalUserStats = { ...totalUserStats, totalPositionCount: totalUserStats.totalPositionCount + 1 };
    dailyUserStats = { ...dailyUserStats, totalPositionCount: dailyUserStats.totalPositionCount + 1 };
    userData = { ...userData, totalPositionCount: userData.totalPositionCount + 1 };
  }
  if (type === "deposit") {
    totalUserStats = { ...totalUserStats, totalDepositCount: totalUserStats.totalDepositCount + 1 };
    dailyUserStats = { ...dailyUserStats, totalDepositCount: dailyUserStats.totalDepositCount + 1 };
    userData = { ...userData, totalDepositCount: userData.totalDepositCount + 1 };
  }
  if (type === "withdrawal") {
    totalUserStats = { ...totalUserStats, totalWithdrawalCount: totalUserStats.totalWithdrawalCount + 1 };
    dailyUserStats = { ...dailyUserStats, totalWithdrawalCount: dailyUserStats.totalWithdrawalCount + 1 };
    userData = { ...userData, totalWithdrawalCount: userData.totalWithdrawalCount + 1 };
  }

  context.UserStat.set(totalUserStats);
  context.UserStat.set(dailyUserStats);
  context.User.set(userData);
}

async function getOrCreateUserStat(
  context: handlerContext,
  timestamp: number,
  period: string,
): Promise<UserStat> {
  const timestampGroup = timestampToPeriodStart(timestamp, period);
  const userId = period === "total" ? "total" : timestampGroup.toString();
  let user = await context.UserStat.get(userId);
  if (user == null) {
    user = {
      id: userId,
      period,
      totalPositionCount: 0,
      totalSwapCount: 0,
      totalDepositCount: 0,
      totalWithdrawalCount: 0,
      uniqueUsers: 0,
      timestamp: timestampGroup,
    };
  }
  return user;
}
