/** Ported from src/utils/vault/vault-day-data.ts. */
import type { Transaction, Vault, VaultDayData, VaultUpdate } from "envio";
import type { Env } from "./types";
import { BIGINT_ZERO } from "./constants";
import { usdcPricePerToken } from "./oracle";

const MS_IN_DAY = 86400000n;

export function getDayIndexFromTimestamp(timestamp: bigint): bigint {
  return timestamp / MS_IN_DAY;
}

export function getDayIDFromIndex(vaultID: string, dayID: bigint): string {
  return vaultID + "-" + dayID.toString();
}

function getDayStartTimestamp(timestamp: bigint): bigint {
  return (timestamp / MS_IN_DAY) * MS_IN_DAY;
}

export async function updateVaultDayData(
  env: Env,
  transaction: Transaction,
  vault: Vault,
  vaultUpdate: VaultUpdate,
): Promise<void> {
  const { context } = env;
  const timestamp = transaction.timestamp;
  const dayIndex = getDayIndexFromTimestamp(timestamp);
  const vaultDayID = getDayIDFromIndex(vault.id, dayIndex);

  let vaultDayData = await context.VaultDayData.get(vaultDayID);
  if (!vaultDayData) {
    vaultDayData = {
      id: vaultDayID,
      timestamp: getDayStartTimestamp(timestamp),
      vault_id: vault.id,
      pricePerShare: vaultUpdate.pricePerShare,
      deposited: BIGINT_ZERO,
      withdrawn: BIGINT_ZERO,
      totalReturnsGenerated: BIGINT_ZERO,
      totalReturnsGeneratedUSDC: BIGINT_ZERO,
      dayReturnsGenerated: BIGINT_ZERO,
      dayReturnsGeneratedUSDC: BIGINT_ZERO,
      blockNumber: transaction.blockNumber,
      tokenPriceUSDC: BIGINT_ZERO,
    };
  }

  const usdcPriceValue = await usdcPricePerToken(env, vault.token_id);

  const underlying = await context.Token.get(vault.token_id);
  const decimals = underlying ? underlying.decimals : 18;
  const priceDivisor = 10n ** BigInt(decimals);

  let tokenPriceUSDC = usdcPriceValue;
  let pricePerShare = vaultUpdate.pricePerShare;
  let deposited = vaultDayData.deposited + vaultUpdate.tokensDeposited;
  let withdrawn = vaultDayData.withdrawn + vaultUpdate.tokensWithdrawn;
  let dayReturnsGenerated = vaultDayData.dayReturnsGenerated + vaultUpdate.returnsGenerated;
  let dayReturnsGeneratedUSDC = (vaultUpdate.returnsGenerated * usdcPriceValue) / priceDivisor;

  let totalReturnsGenerated = vaultDayData.totalReturnsGenerated;
  let totalReturnsGeneratedUSDC = vaultDayData.totalReturnsGeneratedUSDC;

  // Look up to maxSearchDepth days in the past for the running totals.
  let daysInPast = 1;
  const maxSearchDepth = 100;
  while (daysInPast <= maxSearchDepth) {
    const dayToCheck = getDayIDFromIndex(vault.id, dayIndex - BigInt(daysInPast));
    const previous = await context.VaultDayData.get(dayToCheck);
    if (previous) {
      totalReturnsGenerated = previous.totalReturnsGenerated + dayReturnsGenerated;
      totalReturnsGeneratedUSDC =
        previous.totalReturnsGeneratedUSDC + (dayReturnsGenerated * usdcPriceValue) / priceDivisor;
      break;
    } else {
      daysInPast += 1;
      if (daysInPast > maxSearchDepth) {
        totalReturnsGenerated = dayReturnsGenerated;
        totalReturnsGeneratedUSDC = (dayReturnsGenerated * usdcPriceValue) / priceDivisor;
      }
    }
  }

  context.VaultDayData.set({
    ...vaultDayData,
    tokenPriceUSDC,
    pricePerShare,
    deposited,
    withdrawn,
    dayReturnsGenerated,
    dayReturnsGeneratedUSDC,
    totalReturnsGenerated,
    totalReturnsGeneratedUSDC,
  });
}
