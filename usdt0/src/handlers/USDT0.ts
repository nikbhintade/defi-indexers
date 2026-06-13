/*
 * USDT0 (LayerZero OFT) cross-chain transfer indexer.
 *
 * Upgraded from the original envio v2 indexer (enviodev/usdt0-indexer,
 * envio 2.32.3, `USDT0.OFTReceived.handler(...)` API) to envio 3.1.2
 * (`indexer.onEvent(...)`). Handler logic is preserved 1:1 so indexed data
 * matches the original.
 */
import { indexer, type USDT0Transfer, type DailyUSDT0TransferStats } from "envio";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export function bigIntToDecimal(value: bigint, decimals: number): number {
  const base = 10n ** BigInt(decimals);
  const integer = value / base;
  const fraction = value % base;
  return Number(integer) + Number(fraction) / Number(base);
}

// LayerZero endpoint id -> EVM chain id, as in the original indexer.
const EID_TO_CHAIN_ID: Record<number, number> = {
  30101: 1,
  30110: 42161,
  30109: 137,
  30362: 80094,
  30339: 57073,
  30111: 10,
  30320: 130,
  30331: 21000000,
  30280: 1329,
  30295: 14,
  30367: 999,
  30333: 30,
  30274: 196,
  30383: 9745,
  30212: 1030,
  30181: 5000,
  30390: 143,
  30396: 988,
};

function startOfDayUTC(timestamp: number): number {
  const date = new Date(timestamp * 1000);
  date.setUTCHours(0, 0, 0, 0);
  return Math.floor(date.getTime() / 1000);
}

indexer.onEvent(
  { contract: "USDT0", event: "OFTReceived" },
  async ({ event, context }) => {
    let transfer: USDT0Transfer = await context.USDT0Transfer.getOrCreate({
      id: event.params.guid,
      srcChain: 0,
      dstChain: 0,
      fromAddress: ZERO_ADDRESS, // will be set in OFTSent event
      toAddress: ZERO_ADDRESS,
      amountSent: 0,
      amountReceived: 0,
      txHashReceived: "",
      txHashSent: "",
    });

    // Note: single-chain indexer, so some USDT0Transfer entities can have
    // fromAddress as ZERO_ADDRESS until multi-chain support is added.
    transfer = {
      ...transfer,
      srcChain:
        transfer.srcChain == 0
          ? (EID_TO_CHAIN_ID[Number(event.params.srcEid)] ?? 0)
          : transfer.srcChain,
      dstChain: transfer.dstChain == 0 ? event.chainId : transfer.dstChain,
      toAddress: event.params.toAddress,
      amountReceived: bigIntToDecimal(event.params.amountReceivedLD, 6),
      txHashReceived: event.transaction.hash,
    };
    context.USDT0Transfer.set(transfer);

    const startOfDayTS = startOfDayUTC(event.block.timestamp);
    const dailySnapshotId = `${transfer.srcChain}-${startOfDayTS}`;

    let dailyStats: DailyUSDT0TransferStats =
      await context.DailyUSDT0TransferStats.getOrCreate({
        id: dailySnapshotId,
        date: startOfDayTS,
        totalSentTransfers: 0,
        totalReceivedTransfers: 0,
        totalAmountSent: 0,
        totalAmountReceived: 0,
      });

    dailyStats = {
      ...dailyStats,
      totalReceivedTransfers: dailyStats.totalReceivedTransfers + 1,
      totalAmountReceived: dailyStats.totalAmountReceived + transfer.amountReceived,
    };
    context.DailyUSDT0TransferStats.set(dailyStats);
  },
);

indexer.onEvent(
  { contract: "USDT0", event: "OFTSent" },
  async ({ event, context }) => {
    let transfer: USDT0Transfer = await context.USDT0Transfer.getOrCreate({
      id: event.params.guid,
      srcChain: 0,
      dstChain: 0,
      fromAddress: ZERO_ADDRESS,
      toAddress: ZERO_ADDRESS,
      amountSent: 0,
      amountReceived: 0,
      txHashReceived: "",
      txHashSent: "",
    });

    transfer = {
      ...transfer,
      srcChain: event.chainId,
      dstChain: EID_TO_CHAIN_ID[Number(event.params.dstEid)] ?? 0,
      fromAddress: event.params.fromAddress,
      amountSent: bigIntToDecimal(event.params.amountSentLD, 6),
      amountReceived: bigIntToDecimal(event.params.amountSentLD, 6),
      txHashSent: event.transaction.hash,
    };
    context.USDT0Transfer.set(transfer);

    const startOfDayTS = startOfDayUTC(event.block.timestamp);
    const dailySnapshotId = `${transfer.dstChain}-${startOfDayTS}`;

    let dailyStats: DailyUSDT0TransferStats =
      await context.DailyUSDT0TransferStats.getOrCreate({
        id: dailySnapshotId,
        date: startOfDayTS,
        totalSentTransfers: 0,
        totalReceivedTransfers: 0,
        totalAmountSent: 0,
        totalAmountReceived: 0,
      });

    dailyStats = {
      ...dailyStats,
      totalSentTransfers: dailyStats.totalSentTransfers + 1,
      totalAmountSent: dailyStats.totalAmountSent + transfer.amountSent,
    };
    context.DailyUSDT0TransferStats.set(dailyStats);
  },
);
