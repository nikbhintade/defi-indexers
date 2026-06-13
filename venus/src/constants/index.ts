/**
 * Port of src/constants/index.ts + src/constants/addresses.ts + the rendered
 * BSC config (config/index.ts `bsc` block). All addresses lowercase (graph-node
 * stores Bytes ids/fields as lowercase hex).
 */

// EventType enum string values (schema enum)
export const BORROW = "BORROW";
export const MINT = "MINT";
export const MINT_BEHALF = "MINT_BEHALF";
export const REDEEM = "REDEEM";
export const REPAY = "REPAY";
export const LIQUIDATE = "LIQUIDATE";
export const TRANSFER = "TRANSFER";

export const mantissaFactor = 18;

/**
 * NOT_AVAILABLE sentinel returned by valueOrNotAvailableIntIfReverted on a
 * reverted call. graph-node `BigInt.fromString('-1')`.
 */
export const NOT_AVAILABLE_BIG_INT = -1n;

export const zeroBigInt32 = 0n;
export const oneBigInt = 1n;

// ---- BSC mainnet config (config/index.ts `bsc`) ----
/** Unitroller (core-pool Comptroller proxy). bscMainnetCoreDeployments.addresses.Unitroller */
export const comptrollerAddress = "0xfd36e2c2a6789db23113685031d7f16329158384";

export const nullAddress = "0x0000000000000000000000000000000000000000";

/** nativeAddress = Address.fromString('0xEeee...EEeE') — stored lowercase. */
export const nativeAddress = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

/**
 * wbETHAddress: empty in the BSC config block -> Address.fromString of the
 * null-address fallback. So the wbETH special case never matches a real BSC
 * underlying (it would only match address(0)).
 */
export const wbETHAddress = nullAddress;

/** vTRXAddress (bsc): renamed to vTRXOLD on market creation. */
export const vTRXAddress = "0x61edcfe8dd6ba3c891cb9bec2dc7657b3b422e93";

/** vTUSDOldAddress (bsc): renamed to vTUSDOLD on market creation. */
export const vTUSDOldAddress = "0x08ceb3f4a7ed3500ca0982bcd0fc7816688084c3";

/** Hardcoded underlying for the wBETH market special case (getOrCreateWrappedEthToken). */
export const wrappedEthTokenAddress = "0x9c37e59ba22c4320547f00d4f1857af1abd1dd6f";

/** XVS distribution state index initial value (1e36). */
export const initialIndex = 1000000000000000000000000000000000000n;
