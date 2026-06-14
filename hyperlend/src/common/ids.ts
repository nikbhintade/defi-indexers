/**
 * Entity id construction, byte-for-byte compatible with the Ponder source.
 *
 * Every handler in the Ponder `src/index.ts` keys its row by `event.log.id`.
 * In Ponder 0.8.x `event.log.id` is built by `encodeLog` as:
 *
 *     `${log.blockHash}-${log.logIndex}`
 *
 * (see ponder-sh/ponder dist `encodeLog`), i.e. the lowercase 0x block hash, a
 * literal "-", then the decimal log index. HyperIndex exposes the block hash on
 * `event.block.hash` (lowercase) and the log index on `event.logIndex`, so the
 * id reproduces exactly.
 */
export type LogIdEvent = {
  readonly block: { readonly hash: string };
  readonly logIndex: number;
};

export function logId(event: LogIdEvent): string {
  return `${event.block.hash.toLowerCase()}-${event.logIndex}`;
}

/** lowercase an address/hex string (HyperIndex delivers checksummed). */
export const low = (x: string): string => x.toLowerCase();
