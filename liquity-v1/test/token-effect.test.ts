/**
 * Offline test of the ERC20 Token path, which is the only place the subgraph
 * issued eth_calls (ERC20.name()/symbol() the first time a token is seen).
 * Those reads go through the ethCall Effect; here they are mocked via
 * LIQUITY_V1_CALL_MOCK (no RPC).
 *
 *   LUSDToken.Transfer(0x0 -> USER, 100)  -> mint: creates Token (name/symbol
 *                                            from the mock), totalSupply += 100,
 *                                            TokenBalance(USER) = 100
 *   LUSDToken.Transfer(USER -> OTHER, 40) -> TokenBalance(USER)=60, OTHER=40
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTestIndexer } from "envio";
import { setCallMock, type CallMockRule } from "../src/effects/calls";

const LUSD = "0x5f98805A4E8be255a32880FDeC7F6728C6568bA0";
const ZERO = "0x0000000000000000000000000000000000000000";
const USER = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
const e18 = (n: bigint) => n * 10n ** 18n;
const hash = (c: string) => ("0x" + c.repeat(64)) as `0x${string}`;

afterEach(() => setCallMock(undefined));

describe("Token transfer + ERC20 metadata effect", () => {
  it("mints then transfers LUSD, reading name/symbol via the mocked effect", async () => {
    const rules: CallMockRule[] = [
      { fn: "name", to: LUSD, result: { kind: "string", value: "LUSD Stablecoin" } },
      { fn: "symbol", to: LUSD, result: { kind: "string", value: "LUSD" } },
    ];
    setCallMock({ strict: false, rules });

    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "LUSDToken",
              event: "Transfer",
              srcAddress: LUSD as `0x${string}`,
              logIndex: 0,
              params: { from: ZERO as `0x${string}`, to: USER as `0x${string}`, value: e18(100n) },
              block: { number: 200, timestamp: 2000 },
              transaction: { hash: hash("a"), from: USER as `0x${string}` },
            },
            {
              contract: "LUSDToken",
              event: "Transfer",
              srcAddress: LUSD as `0x${string}`,
              logIndex: 0,
              params: { from: USER as `0x${string}`, to: OTHER as `0x${string}`, value: e18(40n) },
              block: { number: 201, timestamp: 2100 },
              transaction: { hash: hash("b"), from: USER as `0x${string}` },
            },
          ],
        },
      },
    });

    const token = await indexer.Token.getOrThrow(LUSD.toLowerCase());
    expect(token.name).toBe("LUSD Stablecoin");
    expect(token.symbol).toBe("LUSD");
    expect(token.totalSupply).toBe(e18(100n)); // minted 100, no burns

    const balUser = await indexer.TokenBalance.getOrThrow(
      LUSD.toLowerCase() + "-" + USER.toLowerCase(),
    );
    expect(balUser.balance).toBe(e18(60n)); // 100 - 40

    const balOther = await indexer.TokenBalance.getOrThrow(
      LUSD.toLowerCase() + "-" + OTHER.toLowerCase(),
    );
    expect(balOther.balance).toBe(e18(40n));
  });
});
