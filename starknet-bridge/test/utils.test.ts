import { describe, it, expect } from "vitest";
import {
  bigIntToHex,
  bigIntToAddressBytes,
  convertUint256ToBigInt,
  makeIdFromPayload,
  getUniqId,
  addUniq,
  ADDRESS_TYPE,
} from "../src/utils/graphTs";
import {
  isBridgeDepositMessage,
  isBridgeWithdrawalMessage,
} from "../src/utils/isL1BridgeAddress";

// ETH bridge pair (index 0 of the rendered mainnet registry).
const ETH_L1 = "0xae0Ee0A63A2cE6BaeEFFE56e7714FB4EFE48D419";
const ETH_L2 =
  "0x073314940630fd6dcda0d772d4c972c4e0a9946bef9dabf4ef84eda8ef542b82";
const ETH_L2_FELT =
  0x073314940630fd6dcda0d772d4c972c4e0a9946bef9dabf4ef84eda8ef542b82n;

describe("graph-ts BigInt.toHex() parity (typeConversion.bigIntToHex)", () => {
  it("zero encodes as 0x0; positives are minimal lowercase hex (uneven length ok)", () => {
    expect(bigIntToHex(0n)).toBe("0x0");
    expect(bigIntToHex(1n)).toBe("0x1");
    expect(bigIntToHex(255n)).toBe("0xff");
    expect(bigIntToHex(256n)).toBe("0x100");
    expect(bigIntToHex(1_000_000_000_000_000_000n)).toBe("0xde0b6b3a7640000");
  });
});

describe("bigIntToAddressBytes parity (fixed-width zero padding)", () => {
  it("STARKNET pads to 64 nibbles, preserving leading zero", () => {
    expect(bigIntToAddressBytes(ETH_L2_FELT, ADDRESS_TYPE.STARKNET)).toBe(ETH_L2);
  });
  it("ETHEREUM pads to 40 nibbles", () => {
    expect(
      bigIntToAddressBytes(0x00000000000000000000000000000000cafe0001n, ADDRESS_TYPE.ETHEREUM),
    ).toBe("0x00000000000000000000000000000000cafe0001");
  });
});

describe("convertUint256ToBigInt parity (high<<128 + low)", () => {
  it("combines low/high words", () => {
    expect(convertUint256ToBigInt(1_000_000_000_000_000_000n, 0n)).toBe(
      1_000_000_000_000_000_000n,
    );
    expect(convertUint256ToBigInt(0n, 1n)).toBe(1n << 128n);
    expect(convertUint256ToBigInt(5n, 2n)).toBe((2n << 128n) + 5n);
  });
});

describe("makeIdFromPayload parity (load-bearing entity id)", () => {
  it("[bridgeL1.toHex(), ...payload.map(toHex())].join('-') with lowercase address", () => {
    const id = makeIdFromPayload(ETH_L1, [
      0x01abc0000000000000000000000000000000000000000000000000000000beefn,
      1_000_000_000_000_000_000n,
      0n,
    ]);
    expect(id).toBe(
      "0xae0ee0a63a2ce6baeeffe56e7714fb4efe48d419-0x1abc0000000000000000000000000000000000000000000000000000000beef-0xde0b6b3a7640000-0x0",
    );
  });
});

describe("getUniqId parity", () => {
  it("txHash(lowercase)-logIndex", () => {
    expect(
      getUniqId(
        "0xDEADBEEF00000000000000000000000000000000000000000000000000000001",
        7,
      ),
    ).toBe(
      "0xdeadbeef00000000000000000000000000000000000000000000000000000001-7",
    );
  });
});

describe("addUniq parity", () => {
  it("appends only when absent; does not mutate input", () => {
    const a = ["x"];
    const b = addUniq(a, "y");
    expect(b).toEqual(["x", "y"]);
    expect(addUniq(b, "y")).toEqual(["x", "y"]);
    expect(a).toEqual(["x"]); // unchanged
  });
});

describe("isL1BridgeAddress filters (both L1 and L2 must match same index)", () => {
  it("deposit: matches a real ETH bridge pair", () => {
    expect(isBridgeDepositMessage(ETH_L1, ETH_L2)).toBe(true);
    // case-insensitive on the L1 (HyperIndex delivers checksummed)
    expect(isBridgeDepositMessage(ETH_L1.toLowerCase(), ETH_L2)).toBe(true);
  });
  it("deposit: rejects when L1 right but L2 wrong (and vice versa)", () => {
    expect(isBridgeDepositMessage(ETH_L1, "0x" + "0".repeat(64))).toBe(false);
    expect(
      isBridgeDepositMessage("0x0000000000000000000000000000000000000000", ETH_L2),
    ).toBe(false);
  });
  it("withdrawal: argument order is (l2From, l1To)", () => {
    expect(isBridgeWithdrawalMessage(ETH_L2, ETH_L1)).toBe(true);
    expect(isBridgeWithdrawalMessage(ETH_L1, ETH_L2)).toBe(false);
  });
});
