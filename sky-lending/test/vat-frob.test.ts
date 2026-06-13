/**
 * Offline test of the core CDP flow:
 *   Vat.rely(join)  -> creates Market / _Ilk / Token (full data-source chain,
 *                      GemJoin.ilk/gem + ERC20 metadata mocked via SKY_CALL_MOCK)
 *   Spot.Poke(ilk)  -> seeds the collateral price (so USD values are non-zero)
 *   Vat.frob(...)   -> open vault: deposit collateral (dink>0) + draw DAI (dart>0)
 *                      creating Position(LENDER+BORROWER) / Account / Deposit /
 *                      Borrow and updating Market/Protocol balances.
 *
 * All eth_calls are mocked; no RPC. Exact values are asserted.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTestIndexer, BigDecimal } from "envio";
import { setCallMock, type CallMockRule } from "../src/effects/calls";

BigDecimal.config({ DECIMAL_PLACES: 34, EXPONENTIAL_AT: [-1000000, 1000000] });

const VAT = "0x35d1b3f3d7966a1dfe207aa4514c12a259a0492b";
const SPOT = "0x65c79fcb50ca1594b025960e539ed7a9a6d434a3";
const JOIN = "0x2f0b23f53734252bda2277357e97e1517d6b042a"; // ETH-A GemJoin (lowercased)
const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
// ilk "ETH-A" as bytes32
const ILK_ETH_A = "0x4554482d41000000000000000000000000000000000000000000000000000000";
// arg1 of rely = join address right-padded into bytes32 (last 20 bytes)
const RELY_ARG = "0x000000000000000000000000" + JOIN.slice(2);

const FROB_SIG = "0x76088703";
const RELY_SIG = "0x65fae35e";

// pad a hex (no 0x) to 32 bytes (64 chars)
const pad32 = (h: string) => h.padStart(64, "0");
const addr32 = (a: string) => pad32(a.slice(2).toLowerCase());
// signed int256 -> 32-byte hex
function int256Hex(v: bigint): string {
  const mod = 1n << 256n;
  const u = ((v % mod) + mod) % mod;
  return pad32(u.toString(16));
}

// frob(bytes32 i, address u, address v, address w, int256 dink, int256 dart)
function frobData(u: string, v: string, w: string, dink: bigint, dart: bigint): string {
  return (
    FROB_SIG +
    pad32(ILK_ETH_A.slice(2)) + // i
    addr32(u) +
    addr32(v) +
    addr32(w) +
    int256Hex(dink) +
    int256Hex(dart)
  );
}

const USER = "0x1111111111111111111111111111111111111111";
const TS = 1668000000;
const B = 16000000;

afterEach(() => setCallMock(undefined));

describe("Vat.frob CDP flow", () => {
  it("creates Market/Token via rely, prices via Poke, then opens a vault via frob", async () => {
    const rules: CallMockRule[] = [
      // GemJoin.ilk() / gem()
      { fn: "ilk", to: JOIN, result: { kind: "string", value: ILK_ETH_A } },
      { fn: "gem", to: JOIN, result: { kind: "string", value: WETH } },
      // ERC20 metadata for WETH
      { fn: "name", to: WETH, result: { kind: "string", value: "Wrapped Ether" } },
      { fn: "symbol", to: WETH, result: { kind: "string", value: "WETH" } },
      { fn: "decimals", to: WETH, result: { kind: "number", value: 18 } },
      // DAI.totalSupply() (any block) — updateProtocol
      { fn: "totalSupply", result: { kind: "bigint", value: "5000000000000000000000000000" } },
    ];
    setCallMock({ strict: false, rules });

    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        1: {
          simulate: [
            // 1) Vat.rely(join) -> market creation
            {
              contract: "Vat",
              event: "LogNote",
              srcAddress: VAT as `0x${string}`,
              logIndex: 0,
              params: {
                sig: RELY_SIG as `0x${string}`,
                arg1: RELY_ARG as `0x${string}`,
                arg2: ("0x" + "0".repeat(64)) as `0x${string}`,
                arg3: ("0x" + "0".repeat(64)) as `0x${string}`,
                data: "0x" as `0x${string}`,
              },
              block: { number: B - 10, timestamp: TS - 600 },
              transaction: { hash: ("0x" + "a".repeat(64)) as `0x${string}`, from: USER as `0x${string}`, nonce: 1n },
            },
            // 2) Spot.Poke(ilk, val=2000e18, spot) -> price the collateral at $2000
            {
              contract: "Spot",
              event: "Poke",
              srcAddress: SPOT as `0x${string}`,
              logIndex: 0,
              params: {
                ilk: ILK_ETH_A as `0x${string}`,
                val: ("0x" + (2000n * 10n ** 18n).toString(16).padStart(64, "0")) as `0x${string}`,
                spot: 0n,
              },
              block: { number: B - 5, timestamp: TS - 300 },
              transaction: { hash: ("0x" + "b".repeat(64)) as `0x${string}`, from: USER as `0x${string}`, nonce: 2n },
            },
            // 3) Vat.frob: dink = +3 WETH, dart = +1000 DAI
            {
              contract: "Vat",
              event: "LogNote",
              srcAddress: VAT as `0x${string}`,
              logIndex: 0,
              params: {
                sig: FROB_SIG as `0x${string}`,
                arg1: ILK_ETH_A as `0x${string}`,
                arg2: RELY_ARG_FOR(USER) as `0x${string}`,
                arg3: RELY_ARG_FOR(USER) as `0x${string}`,
                data: frobData(USER, USER, USER, 3n * 10n ** 18n, 1000n * 10n ** 18n) as `0x${string}`,
              },
              block: { number: B, timestamp: TS },
              transaction: { hash: ("0x" + "c".repeat(64)) as `0x${string}`, from: USER as `0x${string}`, nonce: 3n },
            },
          ],
        },
      },
    });

    // ---- Market created by rely ----
    const market = await indexer.Market.getOrThrow(JOIN);
    expect(market.inputToken_id).toBe(WETH);
    expect(market.name).toBe("ETH-A");
    // after frob: inputTokenBalance = 3 WETH
    expect(market.inputTokenBalance).toBe(3n * 10n ** 18n);
    // priced at $2000 -> totalDepositBalanceUSD = 6000
    expect(market.totalDepositBalanceUSD.toString()).toBe("6000");
    expect(market.inputTokenPriceUSD.toString()).toBe("2000");
    // drew 1000 DAI
    expect(market.totalBorrowBalanceUSD.toString()).toBe("1000");
    expect(market.cumulativeDepositUSD.toString()).toBe("6000");
    expect(market.cumulativeBorrowUSD.toString()).toBe("1000");
    expect(market.lendingPositionCount).toBe(1);
    expect(market.borrowingPositionCount).toBe(1);
    expect(market.openPositionCount).toBe(2);

    // ---- Token ----
    const token = await indexer.Token.getOrThrow(WETH);
    expect(token.symbol).toBe("WETH");
    expect(token.decimals).toBe(18);
    expect(token.lastPriceUSD!.toString()).toBe("2000");

    // ---- Account ----
    const account = await indexer.Account.getOrThrow(USER);
    expect(account.positionCount).toBe(2);
    expect(account.openPositionCount).toBe(2);
    expect(account.depositCount).toBe(1);
    expect(account.borrowCount).toBe(1);

    // ---- Positions (id = {urn}-{market}-{side}-{counter}) ----
    const lenderPos = await indexer.Position.getOrThrow(`${USER}-${JOIN}-LENDER-0`);
    expect(lenderPos.balance).toBe(3n * 10n ** 18n);
    expect(lenderPos.side).toBe("LENDER");
    expect(lenderPos.isCollateral).toBe(true);
    expect(lenderPos.depositCount).toBe(1);

    const borrowPos = await indexer.Position.getOrThrow(`${USER}-${JOIN}-BORROWER-0`);
    expect(borrowPos.balance).toBe(1000n * 10n ** 18n);
    expect(borrowPos.side).toBe("BORROWER");
    expect(borrowPos.borrowCount).toBe(1);

    // ---- Deposit / Borrow events (id = hash-logIndex) ----
    const eventID = "0x" + "c".repeat(64) + "-0";
    const deposit = await indexer.Deposit.getOrThrow(eventID);
    expect(deposit.amount).toBe(3n * 10n ** 18n);
    expect(deposit.amountUSD.toString()).toBe("6000");
    expect(deposit.position_id).toBe(lenderPos.id);
    const borrow = await indexer.Borrow.getOrThrow(eventID);
    expect(borrow.amount).toBe(1000n * 10n ** 18n);
    expect(borrow.amountUSD.toString()).toBe("1000");
    expect(borrow.position_id).toBe(borrowPos.id);

    // ---- Protocol ----
    // NB: preserved subgraph quirk — getOrCreateMarket appends marketID to
    // protocol.marketIDList AND handleVatRely appends it again, so the market
    // appears twice and updateProtocol (which sums per list entry) double-counts.
    // 6000 deposit * 2 = 12000, 1000 borrow * 2 = 2000.
    const protocol = await indexer.LendingProtocol.getOrThrow(VAT);
    expect(protocol.totalDepositBalanceUSD.toString()).toBe("12000");
    expect(protocol.totalBorrowBalanceUSD.toString()).toBe("2000");
    expect(protocol.cumulativeUniqueUsers).toBeGreaterThanOrEqual(1);
    expect(protocol.openPositionCount).toBe(2);
    expect(protocol.mintedTokenSupplies).toEqual([5000000000000000000000000000n]);
  });
});

// helper: address right-padded into a bytes32 (matches Vat frob arg encoding for u/v)
function RELY_ARG_FOR(a: string): string {
  return "0x000000000000000000000000" + a.slice(2).toLowerCase();
}
