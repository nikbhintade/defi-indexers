/**
 * Typed wrappers around the b14g subgraph's `Contract.bind().<fn>()` reads,
 * ported to envio Effects (see ./calls.ts). Each returns null on revert; the
 * calling handler decides how to handle the null (the original used non-`try_`
 * binds that would have reverted the handler — documented in MIGRATION.md).
 */
import type { EffectCaller } from "envio";
import { contractCall } from "./calls";

/** Marketplace.fee() -> uint256 */
export async function marketplaceFee(
  effectCall: EffectCaller,
  marketplace: string,
  block: number,
): Promise<bigint | null> {
  return contractCall<bigint>(
    effectCall,
    marketplace,
    "function fee() view returns (uint256)",
    "fee",
    [],
    block,
  );
}

/** FairShareOrder.getOwnerOfReceiver(receiver) -> address */
export async function getOwnerOfReceiver(
  effectCall: EffectCaller,
  fairShareOrder: string,
  receiver: string,
  block: number,
): Promise<string | null> {
  return contractCall<string>(
    effectCall,
    fairShareOrder,
    "function getOwnerOfReceiver(address receiver) view returns (address user)",
    "getOwnerOfReceiver",
    [receiver],
    block,
  );
}

/** BitcoinStake.btcTxMap(txid).lockTime (struct field index 3) -> uint32 */
export async function btcTxMapLockTime(
  effectCall: EffectCaller,
  bitcoinStake: string,
  txid: string,
  block: number,
): Promise<number | null> {
  const res = await contractCall<readonly [bigint, number, bigint, number, number]>(
    effectCall,
    bitcoinStake,
    "function btcTxMap(bytes32) view returns (uint64 amount, uint32 outputIndex, uint64 blockTimestamp, uint32 lockTime, uint32 usedHeight)",
    "btcTxMap",
    [txid],
    block,
  );
  if (res === null) return null;
  // In mocks the tuple comes back as an array; viem returns an object/array too.
  const arr = res as unknown as Array<unknown>;
  return Number(arr[3]);
}

/** CoreVault.totalStaked() -> uint256 */
export async function coreVaultTotalStaked(
  effectCall: EffectCaller,
  coreVault: string,
  block: number,
): Promise<bigint | null> {
  return contractCall<bigint>(
    effectCall,
    coreVault,
    "function totalStaked() view returns (uint256)",
    "totalStaked",
    [],
    block,
  );
}

/** CoreVault.exchangeCore(dualCore) -> uint256 (nonpayable; read via eth_call) */
export async function coreVaultExchangeCore(
  effectCall: EffectCaller,
  coreVault: string,
  dualCore: bigint,
  block: number,
): Promise<bigint | null> {
  return contractCall<bigint>(
    effectCall,
    coreVault,
    "function exchangeCore(uint256 _dualCore) returns (uint256)",
    "exchangeCore",
    [dualCore],
    block,
  );
}

/** Yield.tokenIdToRewardReceiver(tokenId) -> address */
export async function tokenIdToRewardReceiver(
  effectCall: EffectCaller,
  yieldContract: string,
  tokenId: bigint,
  block: number,
): Promise<string | null> {
  return contractCall<string>(
    effectCall,
    yieldContract,
    "function tokenIdToRewardReceiver(uint256) view returns (address)",
    "tokenIdToRewardReceiver",
    [tokenId],
    block,
  );
}

/** Generic vault.fee() -> uint256 (LendingVault / LendingVaultV2) */
export async function vaultFee(
  effectCall: EffectCaller,
  vault: string,
  block: number,
): Promise<bigint | null> {
  return contractCall<bigint>(
    effectCall,
    vault,
    "function fee() view returns (uint256)",
    "fee",
    [],
    block,
  );
}

/** vault.lastRoundClaim() -> uint256 */
export async function lastRoundClaim(
  effectCall: EffectCaller,
  vault: string,
  block: number,
): Promise<bigint | null> {
  return contractCall<bigint>(
    effectCall,
    vault,
    "function lastRoundClaim() view returns (uint256)",
    "lastRoundClaim",
    [],
    block,
  );
}

/** LendingVault.rewardDataLog(round).accPerShare (struct field 0) -> uint256 */
export async function rewardDataLogAccPerShare(
  effectCall: EffectCaller,
  vault: string,
  round: bigint,
  block: number,
): Promise<bigint | null> {
  const res = await contractCall<readonly [bigint, bigint]>(
    effectCall,
    vault,
    "function rewardDataLog(uint256) view returns (uint256 accPerShare, uint256 liquidityIndex)",
    "rewardDataLog",
    [round],
    block,
  );
  if (res === null) return null;
  const arr = res as unknown as Array<unknown>;
  return BigInt(arr[0] as string | bigint);
}

/** LendingVaultV2.accPerShareLog(round) -> uint256 */
export async function accPerShareLog(
  effectCall: EffectCaller,
  vault: string,
  round: bigint,
  block: number,
): Promise<bigint | null> {
  return contractCall<bigint>(
    effectCall,
    vault,
    "function accPerShareLog(uint256 round) view returns (uint256 accPerShare)",
    "accPerShareLog",
    [round],
    block,
  );
}

/** Pyth.getEmaPriceUnsafe(id).price (struct field 0, int64) -> bigint */
export async function pythEmaPrice(
  effectCall: EffectCaller,
  pyth: string,
  id: string,
  block: number,
): Promise<bigint | null> {
  const res = await contractCall<readonly [bigint, bigint, number, bigint]>(
    effectCall,
    pyth,
    "function getEmaPriceUnsafe(bytes32 id) view returns (int64 price, uint64 conf, int32 expo, uint256 publishTime)",
    "getEmaPriceUnsafe",
    [id],
    block,
  );
  if (res === null) return null;
  const arr = res as unknown as Array<unknown>;
  return BigInt(arr[0] as string | bigint);
}

/** ColendPool.getReserveData(asset).currentLiquidityRate (struct field 2, uint128) -> bigint */
export async function colendCurrentLiquidityRate(
  effectCall: EffectCaller,
  pool: string,
  asset: string,
  block: number,
): Promise<bigint | null> {
  const res = await contractCall<Record<string, unknown>>(
    effectCall,
    pool,
    "function getReserveData(address asset) view returns ((uint256 data) configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt)",
    "getReserveData",
    [asset],
    block,
  );
  if (res === null) return null;
  // mock path passes a plain object; viem decodes the tuple as an object too.
  const obj = res as Record<string, unknown>;
  if ("currentLiquidityRate" in obj) {
    return BigInt(obj["currentLiquidityRate"] as string | bigint);
  }
  // mock tuple-as-array fallback
  const arr = res as unknown as Array<unknown>;
  return BigInt(arr[2] as string | bigint);
}

/** MarketplaceStrategy.totalStaked() -> uint256 */
export async function strategyTotalStaked(
  effectCall: EffectCaller,
  strategy: string,
  block: number,
): Promise<bigint | null> {
  return contractCall<bigint>(
    effectCall,
    strategy,
    "function totalStaked() view returns (uint256)",
    "totalStaked",
    [],
    block,
  );
}
