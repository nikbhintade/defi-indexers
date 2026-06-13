/**
 * Entity ID construction. The Ponder source uses Drizzle composite primary
 * keys; their identity is the ordered tuple of PK columns (see
 * ponder.schema.ts). HyperIndex uses single string ids, so each composite key
 * is collapsed into a `-`-joined string in the SAME column order Ponder declares.
 *
 * Address / bytes values are lowercased (subgraph/Ponder convention). bigint
 * values are decimal strings.
 */

export const lc = (x: string): string => x.toLowerCase();

const join = (...parts: (string | number | bigint)[]): string =>
  parts.map((p) => (typeof p === "string" ? p : String(p))).join("-");

// Pool: [id]
export const poolId = (id: bigint): string => String(id);

// Token: [id]  (scId / bytes16, lowercase)
export const tokenId = (scId: string): string => lc(scId);

// Asset: [id]
export const assetId = (id: bigint): string => String(id);

// Account: [address]
export const accountId = (address: string): string => lc(address);

// PoolSpokeBlockchain: [poolId, centrifugeId]
export const poolSpokeBlockchainId = (pool: bigint, centrifugeId: string): string =>
  join(pool, centrifugeId);

// TokenInstance: [centrifugeId, tokenId]
export const tokenInstanceId = (centrifugeId: string, scId: string): string =>
  join(centrifugeId, lc(scId));

// Vault: [id, centrifugeId]
export const vaultId = (vaultAddress: string, centrifugeId: string): string =>
  join(lc(vaultAddress), centrifugeId);

// Escrow: [address, centrifugeId]
export const escrowId = (address: string, centrifugeId: string): string =>
  join(lc(address), centrifugeId);

// Holding / HoldingEscrow: [tokenId, assetId]
export const holdingId = (scId: string, asset: bigint): string => join(lc(scId), asset);

// HoldingAccount: [id] (raw accountId.toString())
export const holdingAccountId = (id: string): string => id;

// PoolManager: [address, centrifugeId, poolId]
export const poolManagerId = (address: string, centrifugeId: string, pool: bigint): string =>
  join(lc(address), centrifugeId, pool);

// AssetRegistration: [assetId, centrifugeId]
export const assetRegistrationId = (asset: bigint, centrifugeId: string): string =>
  join(asset, centrifugeId);

// InvestorTransaction: [poolId, tokenId, account, type, createdAtTxHash]
export const investorTransactionId = (
  pool: bigint,
  scId: string,
  account: string,
  type: string,
  txHash: string,
): string => join(pool, lc(scId), lc(account), type, lc(txHash));

// VaultInvestOrder / VaultRedeemOrder: [tokenId, centrifugeId, assetId, accountAddress]
export const vaultOrderId = (
  scId: string,
  centrifugeId: string,
  asset: bigint,
  accountAddress: string,
): string => join(lc(scId), centrifugeId, asset, lc(accountAddress));

// PendingInvestOrder / PendingRedeemOrder: [tokenId, assetId, account]
export const pendingOrderId = (scId: string, asset: bigint, account: string): string =>
  join(lc(scId), asset, lc(account));

// InvestOrder / RedeemOrder: [tokenId, assetId, account, index]
export const orderId = (
  scId: string,
  asset: bigint,
  account: string,
  index: number,
): string => join(lc(scId), asset, lc(account), index);

// EpochInvestOrder / EpochRedeemOrder: [tokenId, assetId, index]
export const epochOrderId = (scId: string, asset: bigint, index: number): string =>
  join(lc(scId), asset, index);

// EpochOutstandingInvest / EpochOutstandingRedeem: [tokenId, assetId]
export const epochOutstandingId = (scId: string, asset: bigint): string =>
  join(lc(scId), asset);

// Snapshots
export const poolSnapshotId = (pool: bigint, blockNumber: number, trigger: string): string =>
  join(pool, blockNumber, trigger);
export const tokenSnapshotId = (scId: string, blockNumber: number, trigger: string): string =>
  join(lc(scId), blockNumber, trigger);
export const tokenInstanceSnapshotId = (
  scId: string,
  blockNumber: number,
  trigger: string,
): string => join(lc(scId), blockNumber, trigger);
export const holdingSnapshotId = (
  scId: string,
  asset: bigint,
  blockNumber: number,
  trigger: string,
): string => join(lc(scId), asset, blockNumber, trigger);
export const holdingEscrowSnapshotId = (
  scId: string,
  asset: bigint,
  blockNumber: number,
  trigger: string,
): string => join(lc(scId), asset, blockNumber, trigger);
