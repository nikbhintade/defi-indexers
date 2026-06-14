/*
 * Deposit path (L1 -> L2): LogMessageToL2 (create) + ConsumedMessageToL2
 * (finish). 1:1 port of src/mappings/starknetMessages/deposit.ts plus the
 * createDepositEvent / loadOrCreateUnfinishedDeposit / loadDepositEvent /
 * loadUnfinishedDeposit entity helpers, inlined.
 */
import { indexer, type DepositEvent } from "envio";
import {
  ADDRESS_TYPE,
  TransferStatus,
  addUniq,
  addressToHex,
  bigIntToAddressBytes,
  convertUint256ToBigInt,
  getUniqId,
  isBridgeDepositMessage,
  makeIdFromPayload,
} from "../utils";

indexer.onEvent(
  { contract: "StarknetMessaging", event: "LogMessageToL2" },
  async ({ event, context }) => {
    const bridgeL1Address = event.params.from_address; // EVM address
    const bridgeL2Address = bigIntToAddressBytes(
      event.params.to_address,
      ADDRESS_TYPE.STARKNET,
    );

    if (!isBridgeDepositMessage(bridgeL1Address, bridgeL2Address)) {
      return;
    }

    const payload = event.params.payload;
    const l2Recipient = payload[0]!;
    const amountLow = payload[1]!;
    const amountHigh = payload[2]!;

    // createDepositEvent
    const depositEvent: DepositEvent = {
      id: getUniqId(event.transaction.hash, event.logIndex),
      l2Recipient: bigIntToAddressBytes(l2Recipient, ADDRESS_TYPE.STARKNET),
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
    context.DepositEvent.set(depositEvent);

    // loadOrCreateUnfinishedDeposit + addUniq + save
    const unfinishedId = makeIdFromPayload(bridgeL1Address, payload);
    const unfinishedDeposit = await context.UnfinishedDeposit.getOrCreate({
      id: unfinishedId,
      depositEvents: [],
    });
    context.UnfinishedDeposit.set({
      ...unfinishedDeposit,
      depositEvents: addUniq(unfinishedDeposit.depositEvents, depositEvent.id),
    });
  },
);

indexer.onEvent(
  { contract: "StarknetMessaging", event: "ConsumedMessageToL2" },
  async ({ event, context }) => {
    const bridgeL1Address = event.params.from_address;
    const bridgeL2Address = bigIntToAddressBytes(
      event.params.to_address,
      ADDRESS_TYPE.STARKNET,
    );

    if (!isBridgeDepositMessage(bridgeL1Address, bridgeL2Address)) {
      return;
    }

    // loadUnfinishedDeposit (throws if missing — preserved)
    const unfinishedId = makeIdFromPayload(bridgeL1Address, event.params.payload);
    const unfinishedDeposit = await context.UnfinishedDeposit.getOrThrow(
      unfinishedId,
      `UnfinishedDeposit with id ${unfinishedId} not found`,
    );

    // loadDepositEvent(unfinishedDeposit.depositEvents[0]) (throws if missing)
    const firstId = unfinishedDeposit.depositEvents[0]!;
    const depositEvent = await context.DepositEvent.getOrThrow(
      firstId,
      `DepositEvent with id ${firstId} not found`,
    );

    context.DepositEvent.set({
      ...depositEvent,
      status: TransferStatus.FINISHED,
      finishedAtBlock: BigInt(event.block.number),
      finishedAtDate: BigInt(event.block.timestamp),
      finishedTxHash: event.transaction.hash.toLowerCase(),
    });

    context.UnfinishedDeposit.set({
      ...unfinishedDeposit,
      depositEvents: unfinishedDeposit.depositEvents.slice(1),
    });
  },
);
