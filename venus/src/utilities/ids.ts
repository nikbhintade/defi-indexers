/**
 * Port of src/utilities/ids.ts.
 *
 * graph-ts `Bytes` ids serialize as lowercase 0x hex. We replicate the exact
 * byte layout so entity ids match the deployed subgraph byte-for-byte:
 *  - `a.concat(b)` -> raw byte concatenation -> "0x" + hexA + hexB
 *  - `Bytes.concatI32(x)` -> appends x as a *little-endian* 4-byte i32
 *    (graph-ts ByteArray.fromI32: self[0]=x, self[1]=x>>8, ...).
 */

/** Strip a leading 0x/0X if present. */
function noPrefix(hex: string): string {
  return hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
}

/** graph-ts `a.concat(b).concat(...)` for Bytes -> "0x" + joined hex, lowercased. */
export function hexConcat(...parts: string[]): string {
  return "0x" + parts.map(noPrefix).join("").toLowerCase();
}

/** graph-ts `ByteArray.fromI32(x)` hex (no 0x): 4 bytes little-endian. */
export function i32LeHex(x: number): string {
  const v = x >>> 0; // interpret as unsigned 32-bit pattern (two's complement)
  const b0 = v & 0xff;
  const b1 = (v >>> 8) & 0xff;
  const b2 = (v >>> 16) & 0xff;
  const b3 = (v >>> 24) & 0xff;
  return [b0, b1, b2, b3].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** getMarketPositionId = accountAddress.concat(marketAddress). */
export function getMarketPositionId(accountAddress: string, marketAddress: string): string {
  return hexConcat(accountAddress, marketAddress);
}

/** getTransactionId = transactionHash.concatI32(logIndex). */
export function getTransactionId(transactionHash: string, logIndex: number): string {
  return hexConcat(transactionHash) + i32LeHex(logIndex);
}

/** getMarketPositionTransactionId = marketPositionId.concat(txHash).concatI32(logIndex). */
export function getMarketPositionTransactionId(
  marketPositionId: string,
  transactionHash: string,
  logIndex: number,
): string {
  return hexConcat(marketPositionId, transactionHash) + i32LeHex(logIndex);
}

/** getMarketActionId = vTokenAddress.concatI32(action). */
export function getMarketActionId(vTokenAddress: string, action: number): string {
  return hexConcat(vTokenAddress) + i32LeHex(action);
}

/** getMarketId = vTokenAddress (lowercase). */
export function getMarketId(vTokenAddress: string): string {
  return vTokenAddress.toLowerCase();
}

/** getTokenId = tokenAddress (lowercase). */
export function getTokenId(tokenAddress: string): string {
  return tokenAddress.toLowerCase();
}
