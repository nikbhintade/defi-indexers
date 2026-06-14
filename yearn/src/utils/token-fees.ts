/** Ported from src/utils/token-fees.ts. */
import type { Account, TokenFee, Vault } from "envio";
import type { Ctx } from "./types";
import { low } from "./commons";
import { BIGINT_ZERO } from "./constants";

function newTokenFee(vault: Vault): TokenFee {
  return {
    id: vault.id,
    vault_id: vault.id,
    token_id: vault.token_id,
    totalStrategyFees: BIGINT_ZERO,
    totalTreasuryFees: BIGINT_ZERO,
    unrecognizedTreasuryFees: BIGINT_ZERO,
    unrecognizedStrategyFees: BIGINT_ZERO,
    totalFees: BIGINT_ZERO,
  };
}

async function load(context: Ctx, vault: Vault): Promise<TokenFee | undefined> {
  return context.TokenFee.get(vault.id);
}

/** Returns true if the transfer recipient is a strategy (strategist fee). */
export async function isFeeToStrategy(context: Ctx, vault: Vault, toAccount: Account, amount: bigint): Promise<boolean> {
  const strategy = await context.Strategy.get(toAccount.id);
  if (strategy) {
    await addUnrecognizedStrategyFees(context, vault, amount);
    return true;
  }
  return false;
}

/** Returns true if the transfer recipient is the vault's rewards addr (treasury fee). */
export async function isFeeToTreasury(context: Ctx, vault: Vault, toAccount: Account, amount: bigint): Promise<boolean> {
  const isFee = low(toAccount.id) === low(vault.rewards);
  if (isFee) {
    await addUnrecognizedTreasuryFees(context, vault, amount);
    return true;
  }
  return false;
}

export async function recognizeStrategyFees(context: Ctx, vault: Vault): Promise<bigint> {
  let fee = await load(context, vault);
  if (!fee) fee = newTokenFee(vault);
  const newly = fee.unrecognizedStrategyFees;
  const updated: TokenFee = {
    ...fee,
    totalStrategyFees: fee.totalStrategyFees + newly,
    totalFees: fee.totalFees + newly,
    unrecognizedStrategyFees: BIGINT_ZERO,
  };
  context.TokenFee.set(updated);
  return newly;
}

export async function recognizeTreasuryFees(context: Ctx, vault: Vault): Promise<bigint> {
  let fee = await load(context, vault);
  if (!fee) fee = newTokenFee(vault);
  const newly = fee.unrecognizedTreasuryFees;
  const updated: TokenFee = {
    ...fee,
    totalTreasuryFees: fee.totalTreasuryFees + newly,
    totalFees: fee.totalFees + newly,
    unrecognizedTreasuryFees: BIGINT_ZERO,
  };
  context.TokenFee.set(updated);
  return newly;
}

async function addUnrecognizedStrategyFees(context: Ctx, vault: Vault, amount: bigint): Promise<void> {
  let fee = await load(context, vault);
  if (!fee) fee = newTokenFee(vault);
  context.TokenFee.set({ ...fee, unrecognizedStrategyFees: fee.unrecognizedStrategyFees + amount });
}

async function addUnrecognizedTreasuryFees(context: Ctx, vault: Vault, amount: bigint): Promise<void> {
  let fee = await load(context, vault);
  if (!fee) fee = newTokenFee(vault);
  context.TokenFee.set({ ...fee, unrecognizedTreasuryFees: fee.unrecognizedTreasuryFees + amount });
}
