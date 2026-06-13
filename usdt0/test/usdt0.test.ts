import { describe, it } from "vitest";
import { createTestIndexer } from "envio";

const USDT0 = "0x6C96dE32CEa08842dcc4058c14d3aaAD7Fa41dee" as const;
const GUID = ("0x" + "ab".repeat(32)) as `0x${string}`;

const dayOf = (ts: number) => {
  const d = new Date(ts * 1000);
  d.setUTCHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
};

describe("USDT0 OFT transfer indexing (v3)", () => {
  it("OFTSent then OFTReceived merge into one USDT0Transfer keyed by guid, with daily stats", async (t) => {
    const indexer = createTestIndexer();
    const ts = 1_700_000_000;

    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "USDT0",
              event: "OFTSent",
              srcAddress: USDT0,
              params: {
                guid: GUID,
                dstEid: 30110n, // Arbitrum
                fromAddress: "0x1111111111111111111111111111111111111111" as `0x${string}`,
                amountSentLD: 1_000_500_000n,
                amountReceivedLD: 1_000_500_000n,
              },
              block: { number: 23997200, timestamp: ts },
            },
            {
              contract: "USDT0",
              event: "OFTReceived",
              srcAddress: USDT0,
              params: {
                guid: GUID,
                srcEid: 30101n, // mainnet
                toAddress: "0x2222222222222222222222222222222222222222" as `0x${string}`,
                amountReceivedLD: 1_000_500_000n,
              },
              block: { number: 23997300, timestamp: ts + 500 },
            },
          ],
        },
      },
    });

    const merged = await indexer.USDT0Transfer.getOrThrow(GUID);
    t.expect(
      {
        src: merged.srcChain,
        dst: merged.dstChain,
        from: merged.fromAddress,
        to: merged.toAddress,
        sent: merged.amountSent,
        received: merged.amountReceived,
      },
      "both events merge into one entity by guid; OFTReceived keeps srcChain/dstChain set by OFTSent",
    ).toEqual({
      src: 1,
      dst: 42161,
      from: "0x1111111111111111111111111111111111111111",
      to: "0x2222222222222222222222222222222222222222",
      sent: 1000.5,
      received: 1000.5,
    });

    // Faithful to the original indexer: OFTSent records to the dstChain bucket
    // (42161), OFTReceived records to the srcChain bucket (1) — the sent and
    // received sides land in DIFFERENT daily buckets.
    const day = dayOf(ts);
    const sentBucket = await indexer.DailyUSDT0TransferStats.getOrThrow(`42161-${day}`);
    t.expect(
      { sent: sentBucket.totalSentTransfers, recv: sentBucket.totalReceivedTransfers, amtSent: sentBucket.totalAmountSent, amtRecv: sentBucket.totalAmountReceived },
      "OFTSent records to the destination-chain (42161) daily bucket",
    ).toEqual({ sent: 1, recv: 0, amtSent: 1000.5, amtRecv: 0 });

    const recvBucket = await indexer.DailyUSDT0TransferStats.getOrThrow(`1-${day}`);
    t.expect(
      { sent: recvBucket.totalSentTransfers, recv: recvBucket.totalReceivedTransfers, amtSent: recvBucket.totalAmountSent, amtRecv: recvBucket.totalAmountReceived },
      "OFTReceived records to the source-chain (1) daily bucket",
    ).toEqual({ sent: 0, recv: 1, amtSent: 0, amtRecv: 1000.5 });
  });
});
