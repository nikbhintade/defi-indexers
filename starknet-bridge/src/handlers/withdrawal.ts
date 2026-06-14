/*
 * Withdrawal path (L2 -> L1): LogMessageToL1 (create) + ConsumedMessageToL1
 * (finish). 1:1 port of src/mappings/starknetMessages/withdrawal.ts plus the
 * createWithdrawalEvent / loadOrCreateUnfinishedWithdrawal / loadWithdrawalEvent
 * / loadUnfinishedWithdrawal helpers, inlined.
 *
 * Note: for these events from_address is the L2 (uint256) sender and to_address
 * is the L1 (address) recipient — so bridgeL1Address = to_address.
 */
import { indexer, type WithdrawalEvent } from "envio";
import {
  ADDRESS_TYPE,
  TransferStatus,
  addUniq,
  addressToHex,
  bigIntToAddressBytes,
  convertUint256ToBigInt,
  getUniqId,
  isBridgeWithdrawalMessage,
  makeIdFromPayload,
} from "../utils";

indexer.onEvent(
  { contract: "StarknetMessaging", event: "LogMessageToL1" },
  async ({ event, context }) => {
    const bridgeL1Address = event.params.to_address; // EVM address
    const bridgeL2Address = bigIntToAddressBytes(
      event.params.from_address,
      ADDRESS_TYPE.STARKNET,
    );

    if (!isBridgeWithdrawalMessage(bridgeL2Address, bridgeL1Address)) {
      return;
    }

    const payload = event.params.payload;
    const l1Recipient = payload[1]!;
    const amountLow = payload[2]!;
    const amountHigh = payload[3]!;

    // createWithdrawalEvent
    const withdrawalEvent: WithdrawalEvent = {
      id: getUniqId(event.transaction.hash, event.logIndex),
      l1Recipient: bigIntToAddressBytes(l1Recipient, ADDRESS_TYPE.ETHEREUM),
      bridgeAddressL1: addressToHex(bridgeL1Address),
      bridgeAddressL2: bridgeL2Address,
      amount: convertUint256ToBigInt(amountLow, amountHigh),
      status: TransferStatus.PENDING,
      createdAtBlock: BigInt(event.block.number),
      createdTxHash: event.transaction.hash.toLowerCase(),
      finishedAtBlock: undefined,
      finishedAtDate: undefined,
      finishedTxHash: undefined,
    };
    context.WithdrawalEvent.set(withdrawalEvent);

    const unfinishedId = makeIdFromPayload(bridgeL1Address, payload);
    const unfinishedWithdrawal = await context.UnfinishedWithdrawal.getOrCreate({
      id: unfinishedId,
      withdrawalEvents: [],
    });
    context.UnfinishedWithdrawal.set({
      ...unfinishedWithdrawal,
      withdrawalEvents: addUniq(
        unfinishedWithdrawal.withdrawalEvents,
        withdrawalEvent.id,
      ),
    });
  },
);

indexer.onEvent(
  { contract: "StarknetMessaging", event: "ConsumedMessageToL1" },
  async ({ event, context }) => {
    const bridgeL1Address = event.params.to_address;
    const bridgeL2Address = bigIntToAddressBytes(
      event.params.from_address,
      ADDRESS_TYPE.STARKNET,
    );

    if (!isBridgeWithdrawalMessage(bridgeL2Address, bridgeL1Address)) {
      return;
    }

    const unfinishedId = makeIdFromPayload(bridgeL1Address, event.params.payload);
    const unfinishedWithdrawal = await context.UnfinishedWithdrawal.getOrThrow(
      unfinishedId,
      `UnfinishedWithdrawal with id ${unfinishedId} not found`,
    );

    const firstId = unfinishedWithdrawal.withdrawalEvents[0]!;
    const withdrawalEvent = await context.WithdrawalEvent.getOrThrow(
      firstId,
      `WithdrawalEvent with id ${firstId} not found`,
    );

    context.WithdrawalEvent.set({
      ...withdrawalEvent,
      status: TransferStatus.FINISHED,
      finishedAtBlock: BigInt(event.block.number),
      finishedAtDate: BigInt(event.block.timestamp),
      finishedTxHash: event.transaction.hash.toLowerCase(),
    });

    context.UnfinishedWithdrawal.set({
      ...unfinishedWithdrawal,
      withdrawalEvents: unfinishedWithdrawal.withdrawalEvents.slice(1),
    });
  },
);
