/**
 * Port of src/utils/publicAllocator.ts. Mainnet-only: the canonical helper
 * switched on dataSource.network(); this port targets Ethereum mainnet, so the
 * public allocator address is fixed.
 */
export const PUBLIC_ALLOCATOR_ADDRESS =
  "0xfd32fa2ca22c76dd6e550706ad913fc6ce91c75d";

export function getPublicAllocatorAddress(): string {
  return PUBLIC_ALLOCATOR_ADDRESS;
}
