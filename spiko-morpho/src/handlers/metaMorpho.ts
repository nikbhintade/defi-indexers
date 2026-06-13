/**
 * Port of src/meta-morpho.ts (MetaMorpho vault template handlers).
 *
 * DEVIATION: graph-ts `event.transactionLogIndex` is not exposed by HyperIndex.
 * It only appeared as a uniqueness suffix in NewQueue / PendingTimelock /
 * PendingGuardian / SubmitCap ids; we drop that suffix (logIndex already makes
 * the id unique within a tx). See MIGRATION.md.
 */
import {
  indexer,
  type AllocatorSet,
  type FeeRecipient,
  type MetaMorphoAllocator,
  type MetaMorphoDeposit,
  type MetaMorphoMarket,
  type MetaMorphoPosition,
  type MetaMorphoTransfer,
  type MetaMorphoWithdraw,
  type NewQueue,
  type PendingCap,
  type PendingGuardian,
  type PendingTimelock,
} from "envio";
import {
  loadMetaMorpho,
  loadMetaMorphoMarket,
  loadMetaMorphoMarketFromId,
  PendingValueStatus,
  QueueType,
  updateMMRate,
} from "../sdk/metamorpho";
import { getOrCreateAccount } from "../sdk/account";
import { getAmountUSD, getOrCreateToken } from "../sdk/token";
import { toMetaMorphoAssetsUp } from "../utils/metaMorphoUtils";
import { normEvent, type Ev } from "../context";
import { ADDRESS_ZERO, concatI32, hexConcat, i32Bytes, low } from "../utils/graphBytes";


function eventBase(event: Ev) {
  return {
    hash: event.transaction.hash.toLowerCase(),
    nonce: event.transaction.nonce,
    logIndex: event.logIndex,
    gasPrice: event.transaction.gasPrice,
    gasUsed: undefined,
    gasLimit: event.transaction.gas,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
  };
}

// {tx hash}{fromI32(logIndex)} — used for event entity ids.
function hashLogIndexId(event: Ev): string {
  return hexConcat(event.transaction.hash.toLowerCase(), i32Bytes(event.logIndex));
}

indexer.onEvent(
  { contract: "MetaMorpho", event: "SubmitMarketRemoval" },
  async ({ event, context }) => {
    const ev = normEvent(event);
    const mm = await loadMetaMorpho(context, event.srcAddress);
    const mmMarket = await loadMetaMorphoMarket(context, low(event.srcAddress), low(event.params.id));
    context.MetaMorphoMarket.set({
      ...mmMarket,
      removableAt: ev.block.timestamp + mm.timelock,
    });
  },
);

indexer.onEvent(
  { contract: "MetaMorpho", event: "RevokePendingMarketRemoval" },
  async ({ event, context }) => {
    const ev = normEvent(event);
    const mmMarket = await loadMetaMorphoMarket(context, low(event.srcAddress), low(event.params.id));
    context.MetaMorphoMarket.set({ ...mmMarket, removableAt: 0n });
  },
);

indexer.onEvent({ contract: "MetaMorpho", event: "ReallocateWithdraw" }, async () => {});
indexer.onEvent({ contract: "MetaMorpho", event: "ReallocateSupply" }, async () => {});
indexer.onEvent({ contract: "MetaMorpho", event: "Skim" }, async () => {});
indexer.onEvent({ contract: "MetaMorpho", event: "Approval" }, async () => {});
indexer.onEvent({ contract: "MetaMorpho", event: "EIP712DomainChanged" }, async () => {});
indexer.onEvent({ contract: "MetaMorpho", event: "OwnershipTransferStarted" }, async () => {});
indexer.onEvent({ contract: "MetaMorpho", event: "SetSkimRecipient" }, async () => {});

indexer.onEvent(
  { contract: "MetaMorpho", event: "AccrueInterest" },
  async ({ event, context }) => {
    const ev = normEvent(event);
    let mm = await loadMetaMorpho(context, event.srcAddress);
    mm = { ...mm, lastTotalAssets: event.params.newTotalAssets };
    context.MetaMorpho.set(mm);
    if (event.params.feeShares === 0n) return;

    const token = await getOrCreateToken(context, mm.asset_id);
    const feeAssets = toMetaMorphoAssetsUp(
      event.params.feeShares,
      mm.totalShares,
      mm.lastTotalAssets,
      token.decimals,
    );
    mm = {
      ...mm,
      feeAccrued: mm.feeAccrued + event.params.feeShares,
      feeAccruedAssets: mm.feeAccruedAssets + feeAssets,
    };
    context.MetaMorpho.set(mm);

    if (!mm.feeRecipient_id) throw new Error(`MetaMorpho ${event.srcAddress} has no fee recipient`);
    const feeRecipient = await context.FeeRecipient.get(mm.feeRecipient_id);
    if (!feeRecipient) throw new Error(`FeeRecipient ${mm.feeRecipient_id} not found`);
    context.FeeRecipient.set({
      ...feeRecipient,
      feeAccrued: feeRecipient.feeAccrued + event.params.feeShares,
      feeAccruedAssets: feeRecipient.feeAccruedAssets + feeAssets,
    });

    const positionId = hexConcat(low(event.srcAddress), feeRecipient.account_id);
    let position = await context.MetaMorphoPosition.get(positionId);
    if (!position) {
      position = {
        id: positionId,
        metaMorpho_id: mm.id,
        account_id: feeRecipient.account_id,
        shares: 0n,
        lastAssetsBalance: 0n,
        lastAssetsBalanceUSD: undefined,
      };
    }
    const newBalance = position.lastAssetsBalance + feeAssets;
    context.MetaMorphoPosition.set({
      ...position,
      lastAssetsBalance: newBalance,
      lastAssetsBalanceUSD: getAmountUSD(token, newBalance),
      shares: position.shares + event.params.feeShares,
    });
  },
);

indexer.onEvent(
  { contract: "MetaMorpho", event: "Deposit" },
  async ({ event, context }) => {
    const ev = normEvent(event);
    let mm = await loadMetaMorpho(context, event.srcAddress);
    mm = { ...mm, totalShares: mm.totalShares + event.params.shares };
    context.MetaMorpho.set(mm);

    const positionID = hexConcat(low(event.srcAddress), low(event.params.owner));
    let position = await context.MetaMorphoPosition.get(positionID);
    const ownerAccount = await getOrCreateAccount(context, event.params.owner);
    if (!position) {
      position = {
        id: positionID,
        metaMorpho_id: mm.id,
        account_id: ownerAccount.id,
        shares: 0n,
        lastAssetsBalance: 0n,
        lastAssetsBalanceUSD: undefined,
      };
    }
    const token = await getOrCreateToken(context, mm.asset_id);
    position = {
      ...position,
      shares: position.shares + event.params.shares,
      lastAssetsBalance: event.params.assets,
      lastAssetsBalanceUSD: getAmountUSD(token, event.params.assets),
    };
    context.MetaMorphoPosition.set(position);

    const senderAccount = await getOrCreateAccount(context, event.params.sender);
    const deposit: MetaMorphoDeposit = {
      id: hashLogIndexId(ev),
      ...eventBase(ev),
      account_id: position.account_id,
      accountActor_id: senderAccount.id,
      asset_id: mm.asset_id,
      amount: event.params.assets,
      amountUSD: getAmountUSD(token, event.params.assets),
      shares: event.params.shares,
      metaMorpho_id: mm.id,
      metaMorphoPosition_id: position.id,
    };
    context.MetaMorphoDeposit.set(deposit);
  },
);

indexer.onEvent(
  { contract: "MetaMorpho", event: "OwnershipTransferred" },
  async ({ event, context }) => {
    const ev = normEvent(event);
    const mm = await loadMetaMorpho(context, event.srcAddress);
    // owner is an Account reference; ensure it exists
    const owner = await getOrCreateAccount(context, event.params.newOwner);
    context.MetaMorpho.set({ ...mm, owner_id: owner.id });
  },
);

indexer.onEvent(
  { contract: "MetaMorpho", event: "RevokePendingCap" },
  async ({ event, context }) => {
    const ev = normEvent(event);
    const mmMarket = await loadMetaMorphoMarket(context, low(event.srcAddress), low(event.params.id));
    if (!mmMarket.currentPendingCap_id) return;
    const pendingCap = await context.PendingCap.get(mmMarket.currentPendingCap_id);
    if (!pendingCap) throw new Error(`PendingCap ${mmMarket.currentPendingCap_id} not found`);
    context.PendingCap.set({ ...pendingCap, status: PendingValueStatus.REJECTED });
    context.MetaMorphoMarket.set({ ...mmMarket, currentPendingCap_id: undefined });
  },
);

indexer.onEvent(
  { contract: "MetaMorpho", event: "RevokePendingGuardian" },
  async ({ event, context }) => {
    const ev = normEvent(event);
    const mm = await loadMetaMorpho(context, event.srcAddress);
    if (!mm.currentPendingGuardian_id) return;
    const pendingGuardian = await context.PendingGuardian.get(mm.currentPendingGuardian_id);
    if (!pendingGuardian) throw new Error(`PendingGuardian ${mm.currentPendingGuardian_id} not found`);
    context.PendingGuardian.set({ ...pendingGuardian, status: PendingValueStatus.REJECTED });
    context.MetaMorpho.set({ ...mm, currentPendingGuardian_id: undefined });
  },
);

indexer.onEvent(
  { contract: "MetaMorpho", event: "RevokePendingTimelock" },
  async ({ event, context }) => {
    const ev = normEvent(event);
    const mm = await loadMetaMorpho(context, event.srcAddress);
    if (!mm.currentPendingTimelock_id) return;
    const pendingTimelock = await context.PendingTimelock.get(mm.currentPendingTimelock_id);
    if (!pendingTimelock) throw new Error(`PendingTimelock ${mm.currentPendingTimelock_id} not found`);
    context.PendingTimelock.set({ ...pendingTimelock, status: PendingValueStatus.REJECTED });
    context.MetaMorpho.set({ ...mm, currentPendingTimelock_id: undefined });
  },
);

indexer.onEvent(
  { contract: "MetaMorpho", event: "SetCap" },
  async ({ event, context }) => {
    const ev = normEvent(event);
    let mm = await loadMetaMorpho(context, event.srcAddress);
    let mmMarket = await loadMetaMorphoMarket(context, low(event.srcAddress), low(event.params.id));

    if (event.params.cap > 0n && !mmMarket.isInWithdrawQueue) {
      mm = {
        ...mm,
        supplyQueue: [...mm.supplyQueue, mmMarket.id],
        withdrawQueue: [...mm.withdrawQueue, mmMarket.id],
      };
      context.MetaMorpho.set(mm);
      mmMarket = {
        ...mmMarket,
        removableAt: 0n,
        isInSupplyQueue: true,
        isInWithdrawQueue: true,
        enabled: true,
      };
    }

    mmMarket = { ...mmMarket, cap: event.params.cap };
    if (mmMarket.currentPendingCap_id) {
      const pendingCap = await context.PendingCap.get(mmMarket.currentPendingCap_id);
      if (!pendingCap) throw new Error(`PendingCap ${mmMarket.currentPendingCap_id} not found`);
      context.PendingCap.set({
        ...pendingCap,
        status:
          pendingCap.cap === event.params.cap
            ? PendingValueStatus.ACCEPTED
            : PendingValueStatus.OVERRIDDEN,
      });
      mmMarket = { ...mmMarket, currentPendingCap_id: undefined };
    }
    context.MetaMorphoMarket.set(mmMarket);
  },
);

indexer.onEvent(
  { contract: "MetaMorpho", event: "SetCurator" },
  async ({ event, context }) => {
    const ev = normEvent(event);
    const mm = await loadMetaMorpho(context, event.srcAddress);
    const curator = await getOrCreateAccount(context, event.params.newCurator);
    context.MetaMorpho.set({ ...mm, curator_id: curator.id });
  },
);

indexer.onEvent(
  { contract: "MetaMorpho", event: "SetFee" },
  async ({ event, context }) => {
    const ev = normEvent(event);
    const mm = await loadMetaMorpho(context, event.srcAddress);
    context.MetaMorpho.set({ ...mm, fee: event.params.newFee });
  },
);

indexer.onEvent(
  { contract: "MetaMorpho", event: "SetFeeRecipient" },
  async ({ event, context }) => {
    const ev = normEvent(event);
    const mm = await loadMetaMorpho(context, event.srcAddress);
    if (mm.feeRecipient_id) {
      const current = await context.FeeRecipient.get(mm.feeRecipient_id);
      if (current) {
        context.FeeRecipient.set({ ...current, isCurrentFeeRecipient: false });
      }
    }
    const newId = low(event.params.newFeeRecipient);
    let feeRecipient = await context.FeeRecipient.get(newId);
    if (!feeRecipient) {
      const account = await getOrCreateAccount(context, event.params.newFeeRecipient);
      feeRecipient = {
        id: newId,
        account_id: account.id,
        isCurrentFeeRecipient: true,
        metaMorpho_id: mm.id,
        feeAccrued: 0n,
        feeAccruedAssets: 0n,
      };
      context.FeeRecipient.set(feeRecipient);
    }
    context.MetaMorpho.set({ ...mm, feeRecipient_id: feeRecipient.id });
  },
);

indexer.onEvent(
  { contract: "MetaMorpho", event: "SetGuardian" },
  async ({ event, context }) => {
    const ev = normEvent(event);
    const mm = await loadMetaMorpho(context, event.srcAddress);
    let pendingCleared = mm.currentPendingGuardian_id;
    if (pendingCleared) {
      const pendingGuardian = await context.PendingGuardian.get(pendingCleared);
      if (!pendingGuardian) throw new Error(`PendingGuardian ${pendingCleared} not found`);
      context.PendingGuardian.set({
        ...pendingGuardian,
        status:
          pendingGuardian.guardian === low(event.params.guardian)
            ? PendingValueStatus.ACCEPTED
            : PendingValueStatus.OVERRIDDEN,
      });
    }
    context.MetaMorpho.set({
      ...mm,
      currentPendingGuardian_id: pendingCleared ? undefined : mm.currentPendingGuardian_id,
      guardian: low(event.params.guardian),
    });
  },
);

indexer.onEvent(
  { contract: "MetaMorpho", event: "SetIsAllocator" },
  async ({ event, context }) => {
    const ev = normEvent(event);
    const mm = await loadMetaMorpho(context, event.srcAddress);
    const allocatorId = hexConcat(low(event.params.allocator), low(event.srcAddress));
    let allocator = await context.MetaMorphoAllocator.get(allocatorId);
    if (!allocator) {
      const acc = await getOrCreateAccount(context, event.params.allocator);
      allocator = {
        id: allocatorId,
        account_id: acc.id,
        metaMorpho_id: mm.id,
        isCurrentAllocator: event.params.isAllocator,
      };
    } else {
      allocator = { ...allocator, isCurrentAllocator: event.params.isAllocator };
    }
    context.MetaMorphoAllocator.set(allocator);

    const ownerAccount = await getOrCreateAccount(context, mm.owner_id);
    const allocatorSet: AllocatorSet = {
      id: hashLogIndexId(ev),
      ...eventBase(ev),
      accountActor_id: ownerAccount.id,
      metaMorpho_id: mm.id,
      isAllocator: event.params.isAllocator,
      allocator_id: allocator.id,
    };
    context.AllocatorSet.set(allocatorSet);
  },
);

indexer.onEvent(
  { contract: "MetaMorpho", event: "SetSupplyQueue" },
  async ({ event, context }) => {
    const ev = normEvent(event);
    const mm = await loadMetaMorpho(context, event.srcAddress);
    const newSupplyQueue: string[] = [];
    const addedMarkets: string[] = [];
    const seen = new Set<string>();
    for (const marketId of event.params.newSupplyQueue) {
      const mmMarket = await loadMetaMorphoMarket(context, low(event.srcAddress), low(marketId));
      if (!mmMarket.isInSupplyQueue) {
        addedMarkets.push(mmMarket.id);
        context.MetaMorphoMarket.set({ ...mmMarket, isInSupplyQueue: true });
      }
      seen.add(mmMarket.id);
      newSupplyQueue.push(mmMarket.id);
    }
    const removedMarkets: string[] = [];
    for (const qid of mm.supplyQueue) {
      if (!seen.has(qid)) {
        const mmMarket = await loadMetaMorphoMarketFromId(context, qid);
        context.MetaMorphoMarket.set({ ...mmMarket, isInSupplyQueue: false });
        removedMarkets.push(mmMarket.id);
      }
    }
    const caller = await getOrCreateAccount(context, event.params.caller);
    const newQueue: NewQueue = {
      id: hexConcat(low(event.srcAddress), i32Bytes(Number(ev.block.timestamp)), i32Bytes(event.logIndex)),
      queueType: QueueType.SUPPLY_QUEUE,
      caller_id: caller.id,
      metaMorpho_id: mm.id,
      submittedAt: ev.block.timestamp,
      removedMarkets,
      previousQueue: mm.supplyQueue,
      newQueue: newSupplyQueue,
      addedMarkets,
    };
    context.NewQueue.set(newQueue);
    context.MetaMorpho.set({ ...mm, supplyQueue: newSupplyQueue });
  },
);

indexer.onEvent(
  { contract: "MetaMorpho", event: "SetTimelock" },
  async ({ event, context }) => {
    const ev = normEvent(event);
    const mm = await loadMetaMorpho(context, event.srcAddress);
    let cleared = false;
    if (mm.currentPendingTimelock_id) {
      const pendingTimelock = await context.PendingTimelock.get(mm.currentPendingTimelock_id);
      if (!pendingTimelock) throw new Error(`PendingTimelock ${mm.currentPendingTimelock_id} not found`);
      context.PendingTimelock.set({
        ...pendingTimelock,
        status:
          pendingTimelock.timelock === event.params.newTimelock
            ? PendingValueStatus.ACCEPTED
            : PendingValueStatus.OVERRIDDEN,
      });
      cleared = true;
    }
    context.MetaMorpho.set({
      ...mm,
      currentPendingTimelock_id: cleared ? undefined : mm.currentPendingTimelock_id,
      timelock: event.params.newTimelock,
    });
  },
);

indexer.onEvent(
  { contract: "MetaMorpho", event: "SetWithdrawQueue" },
  async ({ event, context }) => {
    const ev = normEvent(event);
    const mm = await loadMetaMorpho(context, event.srcAddress);
    const newWithdrawQueue: string[] = [];
    const seen = new Set<string>();
    for (const marketId of event.params.newWithdrawQueue) {
      const mmMarket = await loadMetaMorphoMarket(context, low(event.srcAddress), low(marketId));
      seen.add(mmMarket.id);
      newWithdrawQueue.push(mmMarket.id);
    }
    const removedMarkets: string[] = [];
    for (const qid of mm.withdrawQueue) {
      if (!seen.has(qid)) {
        const mmMarket = await loadMetaMorphoMarketFromId(context, qid);
        context.MetaMorphoMarket.set({
          ...mmMarket,
          enabled: false,
          isInWithdrawQueue: false,
        });
        removedMarkets.push(mmMarket.id);
      }
    }
    const caller = await getOrCreateAccount(context, event.params.caller);
    const newQueue: NewQueue = {
      id: hexConcat(low(event.srcAddress), i32Bytes(Number(ev.block.timestamp)), i32Bytes(event.logIndex)),
      queueType: QueueType.WITHDRAW_QUEUE,
      caller_id: caller.id,
      metaMorpho_id: mm.id,
      submittedAt: ev.block.timestamp,
      removedMarkets,
      previousQueue: mm.withdrawQueue,
      newQueue: newWithdrawQueue,
      addedMarkets: [],
    };
    context.NewQueue.set(newQueue);
    context.MetaMorpho.set({ ...mm, withdrawQueue: newWithdrawQueue });
  },
);

indexer.onEvent(
  { contract: "MetaMorpho", event: "SubmitCap" },
  async ({ event, context }) => {
    const ev = normEvent(event);
    const mm = await loadMetaMorpho(context, event.srcAddress);
    const id = hexConcat(
      low(event.srcAddress),
      low(event.params.id),
      bytesFromHex(ev.block.timestamp),
      i32Bytes(event.logIndex),
    );
    const mmMarketId = hexConcat(low(event.srcAddress), low(event.params.id));
    let metaMorphoMarket = await context.MetaMorphoMarket.get(mmMarketId);

    const pendingCap: PendingCap = {
      id,
      metaMorpho_id: mm.id,
      cap: event.params.cap,
      isNewMarket: !metaMorphoMarket || metaMorphoMarket.cap === 0n,
      validAt: ev.block.timestamp + mm.timelock,
      submittedAt: ev.block.timestamp,
      status: PendingValueStatus.PENDING,
      metaMorphoMarket_id: mmMarketId,
    };
    context.PendingCap.set(pendingCap);

    if (!metaMorphoMarket) {
      metaMorphoMarket = {
        id: mmMarketId,
        metaMorpho_id: mm.id,
        cap: 0n,
        removableAt: 0n,
        market_id: low(event.params.id),
        enabled: false,
        isInSupplyQueue: false,
        isInWithdrawQueue: false,
        currentPendingCap_id: pendingCap.id,
      };
    } else {
      metaMorphoMarket = { ...metaMorphoMarket, currentPendingCap_id: pendingCap.id };
    }
    context.MetaMorphoMarket.set(metaMorphoMarket);
  },
);

indexer.onEvent(
  { contract: "MetaMorpho", event: "SubmitGuardian" },
  async ({ event, context }) => {
    const ev = normEvent(event);
    const mm = await loadMetaMorpho(context, event.srcAddress);
    if (mm.currentPendingGuardian_id) {
      throw new Error(`MetaMorpho ${event.srcAddress} already has a pending guardian`);
    }
    const id = hexConcat(
      low(event.srcAddress),
      bytesFromHex(ev.block.timestamp),
      i32Bytes(event.logIndex),
    );
    const guardianAccount = await getOrCreateAccount(context, event.params.newGuardian);
    const pendingGuardian: PendingGuardian = {
      id,
      metaMorpho_id: mm.id,
      guardian: guardianAccount.id,
      submittedAt: ev.block.timestamp,
      validAt: ev.block.timestamp + mm.timelock,
      status: PendingValueStatus.PENDING,
    };
    context.PendingGuardian.set(pendingGuardian);
    context.MetaMorpho.set({ ...mm, currentPendingGuardian_id: pendingGuardian.id });
  },
);

indexer.onEvent(
  { contract: "MetaMorpho", event: "SubmitTimelock" },
  async ({ event, context }) => {
    const ev = normEvent(event);
    const mm = await loadMetaMorpho(context, event.srcAddress);
    if (mm.currentPendingTimelock_id) {
      const prev = await context.PendingTimelock.get(mm.currentPendingTimelock_id);
      if (!prev) throw new Error(`PendingTimelock ${mm.currentPendingTimelock_id} not found`);
      context.PendingTimelock.set({ ...prev, status: PendingValueStatus.REJECTED });
    }
    const pendingTimelock: PendingTimelock = {
      id: hexConcat(low(event.srcAddress), i32Bytes(Number(ev.block.timestamp)), i32Bytes(event.logIndex)),
      timelock: event.params.newTimelock,
      metaMorpho_id: mm.id,
      submittedAt: ev.block.timestamp,
      validAt: ev.block.timestamp + mm.timelock,
      status: PendingValueStatus.PENDING,
    };
    context.PendingTimelock.set(pendingTimelock);
    context.MetaMorpho.set({ ...mm, currentPendingTimelock_id: pendingTimelock.id });
  },
);

indexer.onEvent(
  { contract: "MetaMorpho", event: "Transfer" },
  async ({ event, context }) => {
    const ev = normEvent(event);
    await updateMMRate(context, event.srcAddress);
    if (low(event.params.from) === ADDRESS_ZERO || low(event.params.to) === ADDRESS_ZERO) {
      return; // mint / burn
    }
    const mm = await loadMetaMorpho(context, event.srcAddress);
    const fromPositionID = hexConcat(low(event.srcAddress), low(event.params.from));
    const fromPosition = await context.MetaMorphoPosition.get(fromPositionID);
    if (!fromPosition) throw new Error(`MetaMorphoPosition ${fromPositionID} not found`);
    const token = await getOrCreateToken(context, mm.asset_id);
    const fromShares = fromPosition.shares - event.params.value;
    const fromAssets = toMetaMorphoAssetsUp(
      fromShares,
      mm.totalShares,
      mm.lastTotalAssets,
      token.decimals,
    );
    context.MetaMorphoPosition.set({
      ...fromPosition,
      shares: fromShares,
      lastAssetsBalance: fromAssets,
      lastAssetsBalanceUSD: getAmountUSD(token, fromAssets),
    });

    const toPositionID = hexConcat(low(event.srcAddress), low(event.params.to));
    let toPosition = await context.MetaMorphoPosition.get(toPositionID);
    const toAccount = await getOrCreateAccount(context, event.params.to);
    if (!toPosition) {
      toPosition = {
        id: toPositionID,
        metaMorpho_id: mm.id,
        account_id: toAccount.id,
        shares: 0n,
        lastAssetsBalance: 0n,
        lastAssetsBalanceUSD: undefined,
      };
    }
    context.MetaMorphoPosition.set({
      ...toPosition,
      shares: toPosition.shares + event.params.value,
      lastAssetsBalance: fromAssets,
      lastAssetsBalanceUSD: getAmountUSD(token, fromAssets),
    });

    const transfer: MetaMorphoTransfer = {
      id: hashLogIndexId(ev),
      ...eventBase(ev),
      from_id: fromPosition.account_id,
      to_id: toPosition.account_id,
      shares: event.params.value,
      amount: fromAssets,
      amountUSD: getAmountUSD(token, fromAssets),
      metaMorphoPositionFrom_id: fromPosition.id,
      metaMorphoPositionTo_id: toPosition.id,
      metaMorpho_id: mm.id,
    };
    context.MetaMorphoTransfer.set(transfer);
  },
);

indexer.onEvent(
  { contract: "MetaMorpho", event: "UpdateLastTotalAssets" },
  async ({ event, context }) => {
    const ev = normEvent(event);
    const mm = await loadMetaMorpho(context, event.srcAddress);
    context.MetaMorpho.set({ ...mm, lastTotalAssets: event.params.updatedTotalAssets });
  },
);

indexer.onEvent(
  { contract: "MetaMorpho", event: "Withdraw" },
  async ({ event, context }) => {
    const ev = normEvent(event);
    let mm = await loadMetaMorpho(context, event.srcAddress);
    mm = { ...mm, totalShares: mm.totalShares - event.params.shares };
    context.MetaMorpho.set(mm);

    const positionID = hexConcat(low(event.srcAddress), low(event.params.owner));
    const position = await context.MetaMorphoPosition.get(positionID);
    if (!position) throw new Error(`MetaMorphoPosition ${positionID} not found`);
    const asset = await getOrCreateToken(context, mm.asset_id);
    const newShares = position.shares - event.params.shares;
    const totalAssets = toMetaMorphoAssetsUp(
      newShares,
      mm.totalShares,
      mm.lastTotalAssets,
      asset.decimals,
    );
    context.MetaMorphoPosition.set({
      ...position,
      shares: newShares,
      lastAssetsBalance: totalAssets,
      lastAssetsBalanceUSD: getAmountUSD(asset, totalAssets),
    });

    const senderAccount = await getOrCreateAccount(context, event.params.sender);
    const withdraw: MetaMorphoWithdraw = {
      id: hashLogIndexId(ev),
      ...eventBase(ev),
      account_id: position.account_id,
      accountActor_id: senderAccount.id,
      asset_id: mm.asset_id,
      amount: event.params.assets,
      amountUSD: getAmountUSD(asset, event.params.assets),
      shares: event.params.shares,
      metaMorpho_id: mm.id,
      metaMorphoPosition_id: position.id,
    };
    context.MetaMorphoWithdraw.set(withdraw);
  },
);

// graph-ts `Bytes.fromHexString(timestamp.toHexString())` for SubmitCap/Guardian ids.
function bytesFromHex(value: bigint): string {
  let hex = value.toString(16);
  if (hex.length % 2 !== 0) hex = "0" + hex;
  return hex;
}

void (null as unknown as MetaMorphoMarket);
void (null as unknown as MetaMorphoPosition);
void concatI32;
