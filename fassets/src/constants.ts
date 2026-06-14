// FAssetType enum ordinals, matching the source `enum FAssetType { FXRP, FBTC, FDOGE, FLTC, FALG, FSIMCOINX }`.
export const FAssetType = {
  FXRP: 0,
  FBTC: 1,
  FDOGE: 2,
  FLTC: 3,
  FALG: 4,
  FSIMCOINX: 5,
} as const;

// Flare mainnet contract addresses (lowercase) from chain/flare.json.
export const AGENT_OWNER_REGISTRY = "0xd2593336c6c4bfd261feef0a23f113cd7d018fa2";

// AssetManager address -> FAssetType. Only FXRP is deployed on mainnet today.
// The source derives this from AssetManagerController.getAssetManagers() (a
// VIEW with no event), so the mapping is pinned here. As new AssetManagers are
// added (FBTC/FDOGE), extend this map and add their static address to config.
export const ASSET_MANAGER_TO_FASSET: Record<string, number> = {
  "0x2a3fe068cd92178554cabcf7c95adf49b4b0b6a8": FAssetType.FXRP,
};

// CoreVaultManager address -> FAssetType.
export const CORE_VAULT_MANAGER_TO_FASSET: Record<string, number> = {
  "0x6c8d96defe4cbee05fa969fc0ac436d94fc21784": FAssetType.FXRP,
};

// Resolution enum ordinals (source `shared.ts`).
export const CollateralReservationResolution = { NONE: 0, EXECUTED: 1, DEFAULTED: 2, DELETED: 3 } as const;
export const RedemptionResolution = { NONE: 0, PERFORMED: 1, DEFAULTED: 2, BLOCKED: 3, FAILED: 4, REJECTED: 5 } as const;
export const ReturnFromCoreVaultResolution = { NONE: 0, CONFIRMED: 1, CANCELLED: 2 } as const;
export const TransferToCoreVaultResolution = { NONE: 0, SUCCESSFUL: 1, DEFAULTED: 2 } as const;
export const UnderlyingWithdrawalResolution = { NONE: 0, CONFIRMED: 1, CANCELLED: 2 } as const;

export const a = (x: string): string => x.toLowerCase();

/** Resolve the FAssetType for an emitting AssetManager address (defaults FXRP). */
export function assetManagerFAsset(addr: string): number {
  return ASSET_MANAGER_TO_FASSET[a(addr)] ?? FAssetType.FXRP;
}

export function coreVaultManagerFAsset(addr: string): number {
  return CORE_VAULT_MANAGER_TO_FASSET[a(addr)] ?? FAssetType.FXRP;
}
