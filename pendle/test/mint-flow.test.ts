/**
 * Offline test of the forge MintYieldTokens flow on a seeded yield contract.
 * Asserts the exact accounting on YieldContract (mint/locked volume + tx
 * count), the underlying Token (mintVolume / txCount), the OT/XYT total
 * supplies (refreshed from a mocked, block-pinned totalSupply read) and the
 * MintYieldToken entity (amounts, from, ids).
 *
 * Pricing note: no UniswapPool entities are seeded, so getUnderlyingPrice
 * returns 0 (the legitimate "no pool" path), hence yieldTokenPrice = 0 and all
 * *USD* volumes are 0. The cToken exchangeRateCurrent is still invoked
 * (multiplied into 0) so it is mocked for strict mode.
 */
import { afterEach, describe, expect, it } from "vitest";
import { BigDecimal, createTestIndexer, type Token, type YieldContract } from "envio";
import { setCallMock, type CallMockRule } from "../src/effects/calls";

const FORGE = "0x1234123412341234123412341234123412341234";
const DAI = "0x6b175474e89094c44da98b954eedeac495271d0f"; // underlying
const CDAI = "0x5d3a536e4d6dbd6114cc1ead35777bab948e3643"; // yield-bearing (forgeId "CompoundV2")
const OT = "0xaa00000000000000000000000000000000000001";
const XYT = "0xbb00000000000000000000000000000000000002";

const FORGE_ID = "CompoundV2";
const FORGE_ID_HEX = "0x436f6d706f756e64563200000000000000000000000000000000000000000000";
const EXPIRY = 1672444800n;
const YC_ID = `${FORGE_ID}-${DAI}-${EXPIRY.toString()}`;

const TX = ("0x" + "cc".repeat(32)) as `0x${string}`;
const FROM = "0xfromfromfromfromfromfromfromfromfromfrom";
const USER = "0x9999999999999999999999999999999999999999";
const BLOCK = 12700500;
const TS = 1640500000;

const ZERO = new BigDecimal("0");
const big = (value: bigint) => ({ kind: "bigint", value: value.toString() }) as const;

function seedToken(over: Partial<Token> & { id: string }): Token {
  return {
    symbol: "",
    name: "",
    decimals: 8n,
    forgeId: undefined,
    underlyingAsset: undefined,
    totalSupply: 0n,
    tradeVolume: ZERO,
    tradeVolumeUSD: ZERO,
    mintVolume: ZERO,
    mintVolumeUSD: ZERO,
    redeemVolume: ZERO,
    redeemVolumeUSD: ZERO,
    txCount: 0n,
    totalLiquidity: ZERO,
    type: undefined,
    ...over,
  };
}

afterEach(() => setCallMock(undefined));

describe("forge MintYieldTokens flow", () => {
  it("updates YieldContract / Token volumes and stores MintYieldToken with exact values", async () => {
    setCallMock({
      strict: true,
      rules: [
        // exchangeRateCurrent is invoked by getCTokenCurrentRate (result * 0 = 0)
        { fn: "exchangeRateCurrent", to: CDAI, result: big(2n * 10n ** 26n) },
        // OT / XYT total supply refresh after mint (block-pinned)
        { fn: "totalSupply", to: XYT, result: big(1000n * 10n ** 8n) },
        { fn: "totalSupply", to: OT, result: big(1000n * 10n ** 8n) },
      ] as CallMockRule[],
    });

    const indexer = createTestIndexer();
    // seed the four tokens (as handleNewYieldContracts would have created them)
    indexer.Token.set(seedToken({ id: DAI, symbol: "DAI", name: "Dai Stablecoin", decimals: 18n }));
    indexer.Token.set(seedToken({ id: CDAI, symbol: "cDAI", decimals: 8n, forgeId: FORGE_ID, underlyingAsset: DAI, type: "yieldBearing" }));
    indexer.Token.set(seedToken({ id: OT, symbol: "OT-cDAI", decimals: 8n, forgeId: FORGE_ID, underlyingAsset: CDAI, type: "ot" }));
    indexer.Token.set(seedToken({ id: XYT, symbol: "YT-cDAI", decimals: 8n, forgeId: FORGE_ID, underlyingAsset: CDAI, type: "yt" }));

    const seededYC: YieldContract = {
      id: YC_ID,
      forgeId: FORGE_ID,
      underlyingAsset_id: DAI,
      yieldBearingAsset_id: CDAI,
      xyt_id: XYT,
      ot_id: OT,
      expiry: EXPIRY,
      mintTxCount: 0n,
      redeemTxCount: 0n,
      interestSettledTxCount: 0n,
      lockedVolume: ZERO,
      mintVolume: ZERO,
      redeemVolume: ZERO,
      lockedVolumeUSD: ZERO,
      mintVolumeUSD: ZERO,
      redeemVolumeUSD: ZERO,
      interestSettledVolume: ZERO,
    };
    indexer.YieldContract.set(seededYC);

    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "IPendleForge",
              event: "MintYieldTokens",
              srcAddress: FORGE as `0x${string}`,
              logIndex: 1,
              params: {
                forgeId: FORGE_ID_HEX,
                underlyingAsset: DAI as `0x${string}`,
                expiry: EXPIRY,
                amountToTokenize: 1000n * 10n ** 8n, // 1000 cDAI (8 decimals)
                amountTokenMinted: 1000n * 10n ** 8n, // 1000 XYT (8 decimals)
                user: USER as `0x${string}`,
              },
              block: { number: BLOCK, timestamp: TS },
              transaction: { hash: TX, from: FROM as `0x${string}` },
            },
          ],
        },
      },
    });

    // ---- YieldContract accounting ----
    const yc = await indexer.YieldContract.getOrThrow(YC_ID);
    expect(yc.mintVolume.toString()).toBe("1000");
    expect(yc.lockedVolume.toString()).toBe("1000");
    expect(yc.mintTxCount).toBe(1n);
    expect(yc.mintVolumeUSD.toString()).toBe("0"); // price 0 (no uniswap pools)
    expect(yc.lockedVolumeUSD.toString()).toBe("0");

    // ---- underlying token ----
    const dai = await indexer.Token.getOrThrow(DAI);
    expect(dai.mintVolume.toString()).toBe("1000");
    expect(dai.txCount).toBe(1n);

    // ---- OT / XYT total supplies refreshed from the mocked reads ----
    const xyt = await indexer.Token.getOrThrow(XYT);
    const ot = await indexer.Token.getOrThrow(OT);
    expect(xyt.totalSupply).toBe(1000n * 10n ** 8n);
    expect(ot.totalSupply).toBe(1000n * 10n ** 8n);

    // ---- MintYieldToken entity (id = tx hash) ----
    const m = await indexer.MintYieldToken.getOrThrow(TX);
    expect(m.forgeId).toBe(FORGE_ID);
    expect(m.amountToTokenize.toString()).toBe("1000");
    expect(m.amountMinted.toString()).toBe("1000");
    expect(m.mintedValueUSD.toString()).toBe("0");
    expect(m.expiry).toBe(EXPIRY);
    expect(m.from).toBe(FROM);
    expect(m.underlyingAsset_id).toBe(DAI);
    expect(m.yieldBearingAsset_id).toBe(CDAI);
    expect(m.xytAsset_id).toBe(XYT);
    expect(m.otAsset_id).toBe(OT);
    expect(m.yieldContract_id).toBe(YC_ID);
    expect(m.blockNumber).toBe(BigInt(BLOCK));
    expect(m.timestamp).toBe(BigInt(TS));
  });
});
