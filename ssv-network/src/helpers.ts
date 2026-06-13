/**
 * Ported from ssv-subgraph src/helpers/* (commit e2f1aa0).
 *
 * Subgraph `Bytes` ids/fields become lowercase 0x hex `string`s. Addresses
 * delivered by HyperIndex are checksummed; we lowercase everywhere a subgraph
 * stored bytes/addresses so ids and field values match byte-for-byte.
 *
 * No eth_calls are used by the SSV subgraph (no Contract.bind/try_*), so there
 * are no Effects in this port.
 */
import { BigDecimal, type EvmOnEventContext } from "envio";
import type {
  Account,
  Cluster,
  DAOValues,
  Operator,
} from "envio";

export type HandlerContext = EvmOnEventContext;

/** lowercase helper for addresses / bytes hex */
export const low = (x: string): string => x.toLowerCase();

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export const ETH_FEE_ASSET = "ETH" as const;
export const SSV_FEE_ASSET = "SSV" as const;

export const DEFAULT_BALANCE = 32n;

// silence unused import warning while keeping parity-ready toolbox available
void BigDecimal;

// -------------------------------------------------------------------------
// ids
// -------------------------------------------------------------------------

/**
 * Subgraph: `${tx.toHexString()}-${logIndex.toString().padStart(5, "0")}`.
 * The subgraph uses `event.logIndex` (NOT transactionLogIndex), so HyperIndex's
 * `event.logIndex` maps directly.
 */
export function buildEventEntityId(
  transactionHash: string,
  logIndex: number | bigint,
): string {
  return `${low(transactionHash)}-${logIndex.toString().padStart(5, "0")}`;
}

/** Subgraph: `${owner.toHexString()}-${operatorIds.join("-")}`. */
export function buildClusterId(owner: string, operatorIds: bigint[]): string {
  return `${low(owner)}-${operatorIds.join("-")}`;
}

// -------------------------------------------------------------------------
// metadata stamp
// -------------------------------------------------------------------------

export interface UpdateStamp {
  lastUpdateBlockNumber: bigint;
  lastUpdateBlockTimestamp: bigint;
  lastUpdateTransactionHash: string;
}

export function stamp(
  blockNumber: number,
  blockTimestamp: number,
  transactionHash: string,
): UpdateStamp {
  return {
    lastUpdateBlockNumber: BigInt(blockNumber),
    lastUpdateBlockTimestamp: BigInt(blockTimestamp),
    lastUpdateTransactionHash: low(transactionHash),
  };
}

// -------------------------------------------------------------------------
// account
// -------------------------------------------------------------------------

export function createDefaultAccount(address: string): Account {
  const id = low(address);
  return {
    id,
    nonce: 0n,
    validatorCount: 0n,
    feeRecipient: id,
    stakedAmount: 0n,
    unstakePendingAmount: 0n,
    effectiveBalance: 0n,
  };
}

/** Synchronous default-account factory (subgraph createDefaultAccount). */
export function newAccount(address: string): Account {
  return createDefaultAccount(address);
}

export async function loadOrCreateAccount(
  context: HandlerContext,
  address: string,
): Promise<Account> {
  const existing = await context.Account.get(low(address));
  if (existing) return existing;
  return createDefaultAccount(address);
}

// -------------------------------------------------------------------------
// DAOValues
// -------------------------------------------------------------------------

export function createDefaultDAOValues(
  address: string,
  blockNumber: number,
  blockTimestamp: number,
  transactionHash: string,
): DAOValues {
  return {
    id: low(address),
    networkFee: 0n,
    networkFeeIndex: 0n,
    networkFeeIndexBlockNumber: 0n,
    liquidationThreshold: 0n,
    minimumLiquidationCollateral: 0n,
    networkFeeSSV: 0n,
    networkFeeIndexSSV: 0n,
    networkFeeIndexBlockNumberSSV: 0n,
    liquidationThresholdSSV: 214800n,
    minimumLiquidationCollateralSSV: 1000000000000000000n,
    operatorFeeIncreaseLimit: 0n,
    declareOperatorFeePeriod: 0n,
    executeOperatorFeePeriod: 0n,
    operatorMaximumFee: 0n,
    operatorMaximumFeeSSV: 0n,
    validatorsPerOperatorLimit: 3000n,
    // updateType has no explicit default in createDefaultDAOValues; the
    // subgraph leaves it unset until the first handler assigns it. Graph-node
    // requires non-null enums, but createDefaultDAOValues is always followed by
    // an updateType assignment in the same handler before save(). We seed
    // INITIALIZATION to satisfy the non-null enum; it is immediately overwritten.
    updateType: "INITIALIZATION",
    accEthPerShare: 0n,
    newFeesWei: 0n,
    quorum: 0,
    version: "v1.2.0",
    latestMerkleRoot: "0x",
    totalAccounts: 0n,
    totalOperators: 0n,
    totalValidators: 0n,
    totalEffectiveBalance: 0n,
    effectiveBalanceETH: 0n,
    validatorsAdded: 0n,
    validatorsRemoved: 0n,
    operatorsAdded: 0n,
    operatorsRemoved: 0n,
    ...stamp(blockNumber, blockTimestamp, transactionHash),
  };
}

/**
 * Replicates the buggy `compareSemver` from the subgraph (helpers/dao.ts).
 * NB: the original only ever compares against "v2.0.0" and, due to a bug,
 * `minor*`/`patch*` are derived from `components[0]` (the major segment),
 * not [1]/[2]. We preserve that bug for parity. With version "v1.2.0":
 *   major1=1, minor1=NaN-ish parseInt("v1")=NaN ... → comparisons fall through.
 * In practice parseInt("v1") === NaN, so minor/patch comparisons are NaN and
 * never true; only the major comparison decides. major(1) < major(2) → -1.
 */
function compareSemver(version1: string, version2: string): number {
  const components1 = version1.split(".");
  const components2 = version2.split(".");

  const major1 = parseInt(components1[0]!.replace("v", ""));
  const major2 = parseInt(components2[0]!.replace("v", ""));
  const minor1 = parseInt(components1[0]!);
  const minor2 = parseInt(components2[0]!);
  const patch1 = parseInt(components1[0]!);
  const patch2 = parseInt(components2[0]!);

  if (major1 > major2) return 1;
  if (major1 < major2) return -1;
  if (minor1 > minor2) return 1;
  if (minor1 < minor2) return -1;
  if (patch1 > patch2) return 1;
  if (patch1 < patch2) return -1;
  return 0;
}

export function usesEthFeeRegime(dao: DAOValues): boolean {
  return compareSemver(dao.version, "v2.0.0") >= 0;
}

export function getInitialClusterFeeAsset(dao: DAOValues): "ETH" | "SSV" {
  return usesEthFeeRegime(dao) ? ETH_FEE_ASSET : SSV_FEE_ASSET;
}

export function legacyDaoFeeEventTargetsPrimaryFields(dao: DAOValues): boolean {
  return usesEthFeeRegime(dao);
}

// -------------------------------------------------------------------------
// cluster
// -------------------------------------------------------------------------

export function clusterUsesEthFees(cluster: Cluster): boolean {
  return cluster.feeAsset === ETH_FEE_ASSET;
}

// -------------------------------------------------------------------------
// operator
// -------------------------------------------------------------------------

export async function loadLoopOperatorOrLog(
  context: HandlerContext,
  operatorId: bigint,
): Promise<Operator | undefined> {
  return context.Operator.get(operatorId.toString());
}
