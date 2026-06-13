/**
 * Shared helpers: mainnet centrifugeId resolution, timestamp/audit-field
 * construction, bytes32→address decoding, assetId decoding, bigint clamp.
 */

/**
 * chainId → centrifugeId. This port is Ethereum mainnet (chainId 1) only, and
 * mainnet's centrifugeId is `1` (see protocol-v3/env/ethereum.json).
 */
export const CENTRIFUGE_ID_BY_CHAIN: Record<number, string> = {
  1: "1",
};

export function getCentrifugeId(chainId: number): string {
  const cid = CENTRIFUGE_ID_BY_CHAIN[chainId];
  if (cid === undefined) throw new Error(`No centrifugeId mapping for chainId ${chainId}`);
  return cid;
}

export const NETWORK_NAMES: Record<string, string> = { "1": "ethereum" };

/** centrifugeId → chainId (inverse of the above). */
export function getChainIdFromCentrifugeId(centrifugeId: string): number | null {
  for (const [chainId, cid] of Object.entries(CENTRIFUGE_ID_BY_CHAIN)) {
    if (cid === centrifugeId) return Number(chainId);
  }
  return null;
}

/** Ponder stores timestamps as `new Date(seconds * 1000)`; HyperIndex Timestamp scalar is a Date. */
export const tsToDate = (seconds: number | bigint): Date => new Date(Number(seconds) * 1000);

/** Optional tx hash for snapshot triggerTxHash (contracts without field_selection). */
export function optTxHash(event: { transaction?: unknown }): string | undefined {
  const h = (event.transaction as { hash?: string } | undefined)?.hash;
  return h ? h.toLowerCase() : undefined;
}

export type EventLike = {
  block: { number: number; timestamp: number };
  transaction?: { hash: string };
};

/** Fields that `insertDefaults` sets on first insert (createdAt == updatedAt). */
export function createdFields(event: EventLike) {
  const d = tsToDate(event.block.timestamp);
  const txHash = (event.transaction?.hash ?? "0x").toLowerCase();
  return {
    createdAt: d,
    createdAtBlock: Number(event.block.number),
    createdAtTxHash: txHash,
    updatedAt: d,
    updatedAtBlock: Number(event.block.number),
    updatedAtTxHash: txHash,
  };
}

/** Fields that `updateDefaults` refreshes on save (createdAt preserved by caller). */
export function updatedFields(event: EventLike) {
  return {
    updatedAt: tsToDate(event.block.timestamp),
    updatedAtBlock: Number(event.block.number),
    updatedAtTxHash: (event.transaction?.hash ?? "0x").toLowerCase(),
  };
}

/** `timestamper(name, event)` — nullable phase timestamps (approved/issued/claimed/revoked). */
export function phaseFields<N extends string>(name: N, event: EventLike | null) {
  if (!event) {
    return {
      [`${name}At`]: undefined,
      [`${name}AtBlock`]: undefined,
      [`${name}AtTxHash`]: undefined,
    } as Record<string, Date | number | string | undefined>;
  }
  return {
    [`${name}At`]: tsToDate(event.block.timestamp),
    [`${name}AtBlock`]: Number(event.block.number),
    [`${name}AtTxHash`]: (event.transaction?.hash ?? "0x").toLowerCase(),
  } as Record<string, Date | number | string | undefined>;
}

/** Truncate a 32-byte (66-char) hex word to a 20-byte address (Ponder `.substring(0,42)`). */
export const truncateToAddress = (x: string): `0x${string}` =>
  x.substring(0, 42).toLowerCase() as `0x${string}`;

/**
 * formatBytes32ToAddress: a 32-byte word may be left- or right-aligned.
 * Mirrors Ponder helpers/formatter.ts.
 */
export function formatBytes32ToAddress(word: string): `0x${string}` {
  const hex = word.toLowerCase().replace(/^0x/, "");
  if (hex.length !== 64) return `0x${hex.slice(0, 40)}` as `0x${string}`;
  const trailing24 = hex.slice(40);
  const leading24 = hex.slice(0, 24);
  if (/^0+$/.test(trailing24)) return `0x${hex.slice(0, 40)}` as `0x${string}`; // left-aligned
  if (/^0+$/.test(leading24)) return `0x${hex.slice(24)}` as `0x${string}`; // right-aligned (CastLib)
  return `0x${hex.slice(0, 40)}` as `0x${string}`;
}

/**
 * Decode the centrifuge chain id from an AssetId (high 16 bits of the uint128).
 * Matches AssetService.centrifugeIdFromAssetId.
 */
export function centrifugeIdFromAssetId(asset: bigint): string | null {
  if (asset === 0n) return null;
  return String(Number((asset >> 112n) & 0xffffn));
}

export const bigintMax = (a: bigint, b: bigint): bigint => (a > b ? a : b);

export const SNAPSHOT_INTERVAL_SECONDS = 86400;
export function getPeriodStart(date: Date): Date {
  const sec = Math.floor(date.getTime() / 1000);
  return new Date((sec - (sec % SNAPSHOT_INTERVAL_SECONDS)) * 1000);
}

/** Share price: matches getSharePrice in vaultHandlers.ts. */
export function getSharePrice(
  assetsAmount: bigint,
  sharesAmount: bigint,
  assetDecimals: number,
  shareDecimals: number,
): bigint | undefined {
  if (sharesAmount === 0n) return undefined;
  return (assetsAmount * 10n ** BigInt(18 - assetDecimals + shareDecimals)) / sharesAmount;
}
