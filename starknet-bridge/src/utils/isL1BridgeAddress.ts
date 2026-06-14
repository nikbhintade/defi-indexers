/*
 * Port of src/utils/isL1BridgeAddress.ts.
 *
 * A message is a bridge token-transfer iff BOTH its L1 address AND its L2
 * address match the SAME index in the paired bridge-address lists (graph-ts
 * Bytes.equals on both sides). Reproduced exactly with lowercase string compare.
 */
import { l1BridgesAddresses, l2BridgesAddresses } from "./constants";

/**
 * @param fromAddress L1 bridge address (EVM `address`, any case)
 * @param toAddress   L2 bridge address (already a lowercase 0x-hex string from
 *                    bigIntToAddressBytes)
 */
export function isBridgeDepositMessage(fromAddress: string, toAddress: string): boolean {
  const from = fromAddress.toLowerCase();
  const to = toAddress.toLowerCase();
  let equals = false;
  for (let i = 0; i < l1BridgesAddresses.length; i++) {
    equals =
      equals || (l1BridgesAddresses[i] === from && l2BridgesAddresses[i] === to);
  }
  return equals;
}

/**
 * @param fromAddress L2 bridge address (lowercase 0x-hex string from
 *                    bigIntToAddressBytes)
 * @param toAddress   L1 bridge address (EVM `address`, any case)
 */
export function isBridgeWithdrawalMessage(fromAddress: string, toAddress: string): boolean {
  const from = fromAddress.toLowerCase();
  const to = toAddress.toLowerCase();
  let equals = false;
  for (let i = 0; i < l1BridgesAddresses.length; i++) {
    equals =
      equals || (l2BridgesAddresses[i] === from && l1BridgesAddresses[i] === to);
  }
  return equals;
}
