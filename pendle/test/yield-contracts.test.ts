/**
 * Offline test of the forge yield-contract creation flow:
 * IPendleForge.NewYieldContracts with mocked ERC20 metadata (name / symbol /
 * decimals / totalSupply) for the four tokens (underlying, yield-bearing, OT,
 * XYT). Asserts the Token entities (forgeId / underlyingAsset / type wiring)
 * and the YieldContract entity (byte-for-byte id, expiry, zeroed volumes).
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTestIndexer } from "envio";
import { setCallMock, type CallMockRule } from "../src/effects/calls";

// CompoundV2 forge id as a bytes32 hex (decodes to "CompoundV2")
const FORGE_ID_HEX = "0x436f6d706f756e64563200000000000000000000000000000000000000000000";
const FORGE = "0x1234123412341234123412341234123412341234";

const DAI = "0x6b175474e89094c44da98b954eedeac495271d0f"; // underlying
const CDAI = "0x5d3a536e4d6dbd6114cc1ead35777bab948e3643"; // yield-bearing
const OT = "0xaa00000000000000000000000000000000000001";
const XYT = "0xbb00000000000000000000000000000000000002";

const EXPIRY = 1672444800n;
const BLOCK = 12700000;
const TS = 1640000000;

const str = (value: string) => ({ kind: "string", value }) as const;
const num = (value: number) => ({ kind: "number", value }) as const;
const big = (value: bigint) => ({ kind: "bigint", value: value.toString() }) as const;

afterEach(() => setCallMock(undefined));

describe("forge NewYieldContracts flow", () => {
  it("creates the four Tokens and the YieldContract with exact ids and wiring", async () => {
    const rules: CallMockRule[] = [
      // DAI
      { fn: "name", to: DAI, result: str("Dai Stablecoin") },
      { fn: "symbol", to: DAI, result: str("DAI") },
      { fn: "decimals", to: DAI, result: num(18) },
      { fn: "totalSupply", to: DAI, result: big(1000n * 10n ** 18n) },
      // cDAI (yield bearing)
      { fn: "name", to: CDAI, result: str("Compound Dai") },
      { fn: "symbol", to: CDAI, result: str("cDAI") },
      { fn: "decimals", to: CDAI, result: num(8) },
      { fn: "totalSupply", to: CDAI, result: big(5000n * 10n ** 8n) },
      // OT
      { fn: "name", to: OT, result: str("OT cDAI 29DEC2022") },
      { fn: "symbol", to: OT, result: str("OT-cDAI") },
      { fn: "decimals", to: OT, result: num(8) },
      { fn: "totalSupply", to: OT, result: big(0n) },
      // XYT
      { fn: "name", to: XYT, result: str("YT cDAI 29DEC2022") },
      { fn: "symbol", to: XYT, result: str("YT-cDAI") },
      { fn: "decimals", to: XYT, result: num(8) },
      { fn: "totalSupply", to: XYT, result: big(0n) },
    ];
    setCallMock({ strict: true, rules });

    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "IPendleForge",
              event: "NewYieldContracts",
              srcAddress: FORGE as `0x${string}`,
              logIndex: 1,
              params: {
                forgeId: FORGE_ID_HEX,
                underlyingAsset: DAI as `0x${string}`,
                expiry: EXPIRY,
                ot: OT as `0x${string}`,
                xyt: XYT as `0x${string}`,
                yieldBearingAsset: CDAI as `0x${string}`,
              },
              block: { number: BLOCK, timestamp: TS },
            },
          ],
        },
      },
    });

    // ---- XYT token ----
    const xyt = await indexer.Token.getOrThrow(XYT);
    expect(xyt.symbol).toBe("YT-cDAI");
    expect(xyt.name).toBe("YT cDAI 29DEC2022");
    expect(xyt.decimals).toBe(8n);
    expect(xyt.forgeId).toBe("CompoundV2");
    expect(xyt.underlyingAsset).toBe(CDAI); // yt.underlyingAsset = yieldBearing
    expect(xyt.type).toBe("yt");
    expect(xyt.totalSupply).toBe(0n);

    // ---- OT token ----
    const ot = await indexer.Token.getOrThrow(OT);
    expect(ot.symbol).toBe("OT-cDAI");
    expect(ot.forgeId).toBe("CompoundV2");
    expect(ot.underlyingAsset).toBe(CDAI);
    expect(ot.type).toBe("ot");

    // ---- yield-bearing token (cDAI) ----
    const cdai = await indexer.Token.getOrThrow(CDAI);
    expect(cdai.forgeId).toBe("CompoundV2");
    expect(cdai.underlyingAsset).toBe(DAI); // yieldBearing.underlyingAsset = underlying
    expect(cdai.type).toBe("yieldBearing");
    expect(cdai.decimals).toBe(8n);

    // ---- underlying token (DAI): created, no forge wiring ----
    const dai = await indexer.Token.getOrThrow(DAI);
    expect(dai.symbol).toBe("DAI");
    expect(dai.forgeId).toBe(undefined);
    expect(dai.underlyingAsset).toBe(undefined);
    expect(dai.type).toBe(undefined);

    // ---- YieldContract: id = forgeId-underlying-expiry ----
    const ycId = `CompoundV2-${DAI}-${EXPIRY.toString()}`;
    const yc = await indexer.YieldContract.getOrThrow(ycId);
    expect(yc.forgeId).toBe("CompoundV2");
    expect(yc.underlyingAsset_id).toBe(DAI);
    expect(yc.yieldBearingAsset_id).toBe(CDAI);
    expect(yc.xyt_id).toBe(XYT);
    expect(yc.ot_id).toBe(OT);
    expect(yc.expiry).toBe(EXPIRY);
    expect(yc.mintTxCount).toBe(0n);
    expect(yc.redeemTxCount).toBe(0n);
    expect(yc.lockedVolume.toString()).toBe("0");
    expect(yc.mintVolume.toString()).toBe("0");
    expect(yc.redeemVolume.toString()).toBe("0");
    expect(yc.lockedVolumeUSD.toString()).toBe("0");
    expect(yc.mintVolumeUSD.toString()).toBe("0");
    expect(yc.redeemVolumeUSD?.toString()).toBe("0");
    expect(yc.interestSettledVolume.toString()).toBe("0");
  });
});
