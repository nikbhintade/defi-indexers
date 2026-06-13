/**
 * Offline test of the Pot DSR (DAI Savings Rate) flow:
 *   Pot.LogNote file("vow", addr) -> creates the synthetic "MCD POT" Market
 *                                    and seeds _Chi (Pot.chi/rho mocked)
 *   Pot.LogNote file("dsr", value) -> sets the LENDER stable interest rate
 *   Pot.LogNote drip()             -> accrues supply-side revenue from chi delta
 *
 * Asserts the annualized DSR rate and the supply-side revenue with exact
 * values. No RPC; eth_calls mocked via SKY_CALL_MOCK.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTestIndexer, BigDecimal } from "envio";
import { setCallMock, type CallMockRule } from "../src/effects/calls";

BigDecimal.config({ DECIMAL_PLACES: 34, EXPONENTIAL_AT: [-1000000, 1000000] });

const POT = "0x197e90f9fad81970ba7976f33cbd77088e5d7cf7"; // lowercased
const VOW = "0xa950524441892a31ebddf91d3ceefa04bf454466";
const RAY = 10n ** 27n;

const SIG_FILE_VOW = "0xd4e8be83";
const SIG_FILE_DSR = "0x29ae8114";
const SIG_DRIP = "0x9f678cca";

const pad32 = (h: string) => h.padStart(64, "0");
const bytes32Of = (s: string) => "0x" + pad32(Buffer.from(s, "utf8").toString("hex"));
const uint32 = (v: bigint) => ("0x" + pad32(v.toString(16))) as `0x${string}`;
const addr32 = (a: string) => ("0x" + pad32(a.slice(2).toLowerCase())) as `0x${string}`;

const USER = "0x2222222222222222222222222222222222222222";
const TS = 1668000000;
const B = 16000000;
// dsr ~ 1.00000000627% per second style value: use a representative ray > 1
const DSR = 1000000000627937192491029810n; // ~2% APY style ray

afterEach(() => setCallMock(undefined));

describe("Pot DSR flow", () => {
  it("creates MCD POT market, sets lender rate, and accrues DSR supply-side revenue", async () => {
    // chi grows from 1.05 RAY (prev, set at file vow) to 1.06 RAY (drip)
    const chiPrev = (105n * RAY) / 100n;
    const chiNow = (106n * RAY) / 100n;
    const Pie = 1000n * 10n ** 18n; // 1000 (WAD) total normalized savings

    const rules: CallMockRule[] = [
      // file(vow): Pot.chi()/rho() seed _Chi at chiPrev
      { fn: "chi", to: POT, block: B - 20, result: { kind: "bigint", value: chiPrev.toString() } },
      { fn: "rho", to: POT, block: B - 20, result: { kind: "bigint", value: (TS - 1200).toString() } },
      // drip(): Pot.chi()/Pie() at the drip block
      { fn: "chi", to: POT, block: B, result: { kind: "bigint", value: chiNow.toString() } },
      { fn: "Pie", to: POT, block: B, result: { kind: "bigint", value: Pie.toString() } },
      { fn: "totalSupply", result: { kind: "bigint", value: "5000000000000000000000000000" } },
    ];
    setCallMock({ strict: false, rules });

    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        1: {
          simulate: [
            // file("vow", vowAddr)
            {
              contract: "Pot",
              event: "LogNote",
              srcAddress: POT as `0x${string}`,
              logIndex: 0,
              params: {
                sig: SIG_FILE_VOW as `0x${string}`,
                usr: USER as `0x${string}`,
                arg1: bytes32Of("vow") as `0x${string}`,
                arg2: addr32(VOW),
                data: "0x" as `0x${string}`,
              },
              block: { number: B - 20, timestamp: TS - 1200 },
              transaction: { hash: ("0x" + "1".repeat(64)) as `0x${string}`, from: USER as `0x${string}`, nonce: 1n },
            },
            // file("dsr", DSR)
            {
              contract: "Pot",
              event: "LogNote",
              srcAddress: POT as `0x${string}`,
              logIndex: 0,
              params: {
                sig: SIG_FILE_DSR as `0x${string}`,
                usr: USER as `0x${string}`,
                arg1: bytes32Of("dsr") as `0x${string}`,
                arg2: uint32(DSR),
                data: "0x" as `0x${string}`,
              },
              block: { number: B - 10, timestamp: TS - 600 },
              transaction: { hash: ("0x" + "2".repeat(64)) as `0x${string}`, from: USER as `0x${string}`, nonce: 2n },
            },
            // drip()
            {
              contract: "Pot",
              event: "LogNote",
              srcAddress: POT as `0x${string}`,
              logIndex: 0,
              params: {
                sig: SIG_DRIP as `0x${string}`,
                usr: USER as `0x${string}`,
                arg1: ("0x" + "0".repeat(64)) as `0x${string}`,
                arg2: ("0x" + "0".repeat(64)) as `0x${string}`,
                data: "0x" as `0x${string}`,
              },
              block: { number: B, timestamp: TS },
              transaction: { hash: ("0x" + "3".repeat(64)) as `0x${string}`, from: USER as `0x${string}`, nonce: 3n },
            },
          ],
        },
      },
    });

    // ---- MCD POT market created ----
    const market = await indexer.Market.getOrThrow(POT);
    expect(market.name).toBe("MCD POT");
    expect(market.inputToken_id).toBe("0x6b175474e89094c44da98b954eedeac495271d0f"); // DAI

    // ---- _Chi updated to chiNow / rho=TS after drip ----
    const chi = await indexer._Chi.getOrThrow(POT);
    expect(chi.chi).toBe(chiNow);
    expect(chi.rho).toBe(BigInt(TS));

    // ---- LENDER interest rate set from dsr ----
    const rateID = `LENDER-STABLE-${POT}`;
    const rate = await indexer.InterestRate.getOrThrow(rateID);
    expect(rate.side).toBe("LENDER");
    expect(rate.type).toBe("STABLE");
    // rate per second = DSR/RAY - 1; annualized via binomial expansion * 100
    expect(parseFloat(rate.rate.toString())).toBeGreaterThan(0);

    // ---- supply-side revenue from drip: Pie(WAD) * (chiNow-chiPrev)(RAY) ----
    // = 1000 * (0.01) = 10 USD
    const fin = await indexer.FinancialsDailySnapshot.getOrThrow(
      (BigInt(TS) / 86400n).toString(),
    );
    expect(fin.dailySupplySideRevenueUSD.toString()).toBe("10");
    expect(fin.cumulativeSupplySideRevenueUSD.toString()).toBe("10");

    const protocol = await indexer.LendingProtocol.getOrThrow(
      "0x35d1b3f3d7966a1dfe207aa4514c12a259a0492b",
    );
    expect(protocol.cumulativeSupplySideRevenueUSD.toString()).toBe("10");
  });
});
