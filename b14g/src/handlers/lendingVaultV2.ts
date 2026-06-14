/**
 * Port of src/mappings/lendingVaultV2.ts — LendingVaultV2 (wBTC lending vault v2).
 * Stake / Redeem / Withdraw / LendingInvest / CoreInvest /
 * ClaimRewardFromStrategy / MigrateStake.
 *
 * eth_calls (block-pinned, via Effects) for ClaimRewardFromStrategy APY:
 *  - LendingVaultV2.fee(), lastRoundClaim(), accPerShareLog(round)
 *  - Pyth.getEmaPriceUnsafe(CORE/BTC).price (read but only used to scale; b14gApy
 *    here is increasedPerShare * 365 — price vars are computed yet unused, mirrored)
 *  - ColendPool.getReserveData(WBTC).currentLiquidityRate
 *  CoreInvest: MarketplaceStrategy(LENDING_VAULT_V2_MKP_STRATEGY).totalStaked()
 */
import { indexer } from "envio";
import {
  B14G_ID,
  BTC_PRICE_ID,
  COLEND_POOL,
  CORE_PRICE_ID,
  LENDING_VAULT_V2,
  LENDING_VAULT_V2_MKP_STRATEGY,
  PYTH,
  WBTC,
  ZERO_BI,
} from "../constants";
import { concatBytes, concatI32, low } from "../utils";
import {
  createTransaction,
  createUser,
  createUserActionCount,
  createVault,
} from "../services/helpers";
import { calculateApy } from "../services/apy";
import {
  accPerShareLog,
  colendCurrentLiquidityRate,
  lastRoundClaim,
  pythEmaPrice,
  strategyTotalStaked,
  vaultFee,
} from "../effects/contracts";

const LV = low(LENDING_VAULT_V2);

indexer.onEvent({ contract: "LendingVaultV2", event: "ClaimRewardFromStrategy" }, async ({ event, context }) => {
  const block = event.block.number;
  const fee = (await vaultFee(context.effect, LV, block)) ?? ZERO_BI;
  // corePrice/btcPrice are read by the source but not used in V2's b14gApy.
  await pythEmaPrice(context.effect, low(PYTH), CORE_PRICE_ID, block);
  await pythEmaPrice(context.effect, low(PYTH), BTC_PRICE_ID, block);

  const last = (await lastRoundClaim(context.effect, LV, block)) ?? ZERO_BI;
  const prev = last - 1n;
  const acc1 = (await accPerShareLog(context.effect, LV, last, block)) ?? ZERO_BI;
  const acc2 = (await accPerShareLog(context.effect, LV, prev, block)) ?? ZERO_BI;

  const daysInYear = 365n;
  const increasedPerShare = acc1 - acc2;
  const b14gApy = increasedPerShare * daysInYear;

  const wbtcApr = ((await colendCurrentLiquidityRate(context.effect, low(COLEND_POOL), low(WBTC), block)) ?? ZERO_BI) / 1000000000n;
  const wbtcApy = calculateApy(wbtcApr);
  const apy = ((b14gApy + wbtcApy) * (10000n - fee)) / 10000n;

  context.LendingVaultApy.set({
    id: concatI32(event.transaction.hash, event.logIndex),
    vault_id: LV,
    apy,
    blockNumber: BigInt(event.block.number),
    timestamp: BigInt(event.block.timestamp),
    boostApy: b14gApy,
    colendApy: wbtcApy,
  });
});

indexer.onEvent({ contract: "LendingVaultV2", event: "Stake" }, async ({ event, context }) => {
  const user = low(event.params.user);
  const id = concatI32(event.transaction.hash, event.logIndex);

  let vaultAsUser = await context.User.get(LV);
  if (!vaultAsUser) await createUser(context, LV, event.block.timestamp);

  let u = await context.User.get(user);
  if (!u) u = await createUser(context, user, event.block.timestamp);

  let actionCount = await context.UserActionCount.get(concatBytes(u.id, LV));
  if (!actionCount) actionCount = createUserActionCount(context, user, LV);

  let lendingVault = await context.Vault.get(LV);
  if (!lendingVault) lendingVault = createVault(context, LENDING_VAULT_V2);

  const stats = await context.Stats.get(B14G_ID);
  if (!stats) return;

  createTransaction(context, id, event.block.number, event.block.timestamp, user, LV, "WbtcVault", "Stake", event.params.amount, event.transaction.hash);

  context.VaultAction.set({
    id,
    transaction_id: id,
    blockNumber: BigInt(event.block.number),
    timestamp: BigInt(event.block.timestamp),
    txHash: low(event.transaction.hash),
    type: "Stake",
    from_id: user,
    amount: event.params.amount,
    toVault_id: LV,
    totalCoreStaked: stats.totalCoreStaked,
    rewardAmount: undefined,
    toLottery_id: undefined,
    receiverAmount: undefined,
    btcAmount: undefined,
    round: undefined,
  });

  context.Vault.set({ ...lendingVault, stake: lendingVault.stake + 1, total: lendingVault.total + 1 });
  context.UserActionCount.set({ ...actionCount, stake: actionCount.stake + 1, total: actionCount.total + 1 });
});

indexer.onEvent({ contract: "LendingVaultV2", event: "Redeem" }, async ({ event, context }) => {
  const user = low(event.params.user);
  const id = concatI32(event.transaction.hash, event.logIndex);

  const lendingVault = await context.Vault.get(LV);
  if (!lendingVault) return;
  const stats = await context.Stats.get(B14G_ID);
  if (!stats) return;
  const actionCount = await context.UserActionCount.get(concatBytes(user, LV));
  if (!actionCount) return;

  let transaction = createTransaction(context, id, event.block.number, event.block.timestamp, user, LV, "WbtcVault", "ClaimReward", event.params.amount, event.transaction.hash);

  const isClaim = event.params.amount === ZERO_BI;
  const action = {
    id,
    transaction_id: id,
    blockNumber: BigInt(event.block.number),
    timestamp: BigInt(event.block.timestamp),
    txHash: low(event.transaction.hash),
    from_id: user,
    amount: event.params.amount,
    toVault_id: LV,
    totalCoreStaked: stats.totalCoreStaked,
    type: (isClaim ? "ClaimReward" : "Redeem") as "ClaimReward" | "Redeem",
    rewardAmount: undefined,
    toLottery_id: undefined,
    receiverAmount: undefined,
    btcAmount: undefined,
    round: undefined,
  };

  let ac = { ...actionCount };
  let lv = { ...lendingVault };
  if (isClaim) {
    ac.claim += 1;
    lv.claim += 1;
  } else {
    transaction = { ...transaction, type: "Redeem" };
    ac.unbond += 1;
    lv.unbond += 1;
  }
  lv.total += 1;
  ac.total += 1;

  context.Transaction.set(transaction);
  context.VaultAction.set(action);
  context.UserActionCount.set(ac);
  context.Vault.set(lv);
});

indexer.onEvent({ contract: "LendingVaultV2", event: "Withdraw" }, async ({ event, context }) => {
  const user = low(event.params.user);
  const id = concatI32(event.transaction.hash, event.logIndex);

  const lendingVault = await context.Vault.get(LV);
  if (!lendingVault) return;
  const stats = await context.Stats.get(B14G_ID);
  if (!stats) return;
  const actionCount = await context.UserActionCount.get(concatBytes(user, LV));
  if (!actionCount) return;

  createTransaction(context, id, event.block.number, event.block.timestamp, user, LV, "WbtcVault", "Withdraw", event.params.amount, event.transaction.hash);

  context.VaultAction.set({
    id,
    transaction_id: id,
    blockNumber: BigInt(event.block.number),
    timestamp: BigInt(event.block.timestamp),
    txHash: low(event.transaction.hash),
    type: "Withdraw",
    from_id: user,
    amount: event.params.amount,
    toVault_id: LV,
    totalCoreStaked: stats.totalCoreStaked,
    rewardAmount: undefined,
    toLottery_id: undefined,
    receiverAmount: undefined,
    btcAmount: undefined,
    round: undefined,
  });

  context.Vault.set({ ...lendingVault, withdraw: lendingVault.withdraw + 1, total: lendingVault.total + 1 });
  context.UserActionCount.set({ ...actionCount, withdraw: actionCount.withdraw + 1, total: actionCount.total + 1 });
});

indexer.onEvent({ contract: "LendingVaultV2", event: "LendingInvest" }, async ({ event, context }) => {
  const id = concatI32(event.transaction.hash, event.logIndex);
  const lendingVault = await context.Vault.get(LV);
  if (!lendingVault) return;
  const stats = await context.Stats.get(B14G_ID);
  if (!stats) return;

  const isBorrow: boolean = event.params.isBorrow;
  createTransaction(context, id, event.block.number, event.block.timestamp, LV, LV, "WbtcVault", isBorrow ? "BorrowCore" : "RepayCore", event.params.amount, event.transaction.hash);

  context.VaultAction.set({
    id,
    transaction_id: id,
    blockNumber: BigInt(event.block.number),
    timestamp: BigInt(event.block.timestamp),
    txHash: low(event.transaction.hash),
    type: isBorrow ? "BorrowCore" : "RepayCore",
    from_id: LV,
    amount: event.params.amount,
    toVault_id: LV,
    totalCoreStaked: stats.totalCoreStaked,
    rewardAmount: undefined,
    toLottery_id: undefined,
    receiverAmount: undefined,
    btcAmount: undefined,
    round: undefined,
  });

  let lv = { ...lendingVault };
  if (isBorrow) {
    lv.borrowCore = lv.borrowCore ? lv.borrowCore + 1 : 1;
  } else {
    lv.repayCore = lv.repayCore ? lv.repayCore + 1 : 1;
  }
  lv.total += 1;
  context.Vault.set(lv);
});

indexer.onEvent({ contract: "LendingVaultV2", event: "CoreInvest" }, async ({ event, context }) => {
  const id = concatI32(event.transaction.hash, event.logIndex);
  const lendingVault = await context.Vault.get(LV);
  if (!lendingVault) return;
  const stats = await context.Stats.get(B14G_ID);
  if (!stats) return;

  const amount = (await strategyTotalStaked(context.effect, low(LENDING_VAULT_V2_MKP_STRATEGY), event.block.number)) ?? ZERO_BI;
  createTransaction(context, id, event.block.number, event.block.timestamp, LV, LV, "WbtcVault", "CoreInvest", amount, event.transaction.hash);

  context.VaultAction.set({
    id,
    transaction_id: id,
    blockNumber: BigInt(event.block.number),
    timestamp: BigInt(event.block.timestamp),
    txHash: low(event.transaction.hash),
    type: "CoreInvest",
    from_id: LV,
    amount,
    toVault_id: LV,
    totalCoreStaked: stats.totalCoreStaked,
    rewardAmount: undefined,
    toLottery_id: undefined,
    receiverAmount: undefined,
    btcAmount: undefined,
    round: undefined,
  });

  context.Vault.set({ ...lendingVault, total: lendingVault.total + 1, reInvest: lendingVault.reInvest + 1 });
});

indexer.onEvent({ contract: "LendingVaultV2", event: "MigrateStake" }, async ({ event, context }) => {
  const user = low(event.params.user);
  const id = concatI32(event.transaction.hash, event.logIndex);

  let vaultAsUser = await context.User.get(LV);
  if (!vaultAsUser) await createUser(context, LV, event.block.timestamp);

  let u = await context.User.get(user);
  if (!u) u = await createUser(context, user, event.block.timestamp);

  let actionCount = await context.UserActionCount.get(concatBytes(u.id, LV));
  if (!actionCount) actionCount = createUserActionCount(context, user, LV);

  let lendingVault = await context.Vault.get(LV);
  if (!lendingVault) lendingVault = createVault(context, LENDING_VAULT_V2);

  const stats = await context.Stats.get(B14G_ID);
  if (!stats) return;

  createTransaction(context, id, event.block.number, event.block.timestamp, user, LV, "WbtcVault", "Migrate", event.params.amount, event.transaction.hash);

  context.VaultAction.set({
    id,
    transaction_id: id,
    blockNumber: BigInt(event.block.number),
    timestamp: BigInt(event.block.timestamp),
    txHash: low(event.transaction.hash),
    type: "Migrate",
    from_id: user,
    amount: event.params.amount,
    toVault_id: LV,
    totalCoreStaked: stats.totalCoreStaked,
    rewardAmount: undefined,
    toLottery_id: undefined,
    receiverAmount: undefined,
    btcAmount: undefined,
    round: undefined,
  });

  let lv = { ...lendingVault };
  lv.migrate = lv.migrate ? lv.migrate + 1 : 1;
  lv.total += 1;

  let ac = { ...actionCount };
  // PARITY: source uses `if (actionCount.migrate == 1) { migrate = 1 } else { migrate += 1 }`
  // with migrate initially undefined → `undefined + 1` = NaN in AS becomes 1 on first call.
  // Mirror: first time (undefined) -> 1; if already 1 -> stays 1; otherwise increment.
  if (ac.migrate === 1) {
    ac.migrate = 1;
  } else if (ac.migrate === undefined || ac.migrate === null) {
    ac.migrate = 1;
  } else {
    ac.migrate += 1;
  }
  ac.total += 1;

  context.UserActionCount.set(ac);
  context.Vault.set(lv);
});
