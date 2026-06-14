/**
 * Port of mappings/position-manager.ts (handleIncreaseLiquidity,
 * handleDecreaseLiquidity, handleCollect, handleTransfer + getPosition,
 * updateFeeVars, savePositionSnapshot).
 *
 * getPosition resolves the pool via two eth_calls (mirroring the subgraph):
 *   1. NonfungiblePositionManager.positions(tokenId)  -> token0/token1/fee/ticks/feeGrowth
 *   2. Factory.getPool(token0, token1, fee)           -> pool address
 * If positions() reverts (position minted+deleted in the same block) the
 * handler bails, exactly like the original `if (positionCall.reverted)` branch.
 *
 * Preserved source bug: handleCollect adds `amount0` to BOTH
 * collectedFeesToken0 and collectedFeesToken1 (the original never reads
 * amount1). Documented in MIGRATION.md.
 */
import { type EvmOnEventContext, indexer, type Position, type PositionSnapshot } from "envio";
import { ADDRESS_ZERO, FACTORY_ADDRESS, NFPM_ADDRESS, ZERO_BD, ZERO_BI, low } from "../utils/constants";
import { convertTokenToDecimal } from "../utils/index";
import { getOrLoadToken } from "../utils/entity";
import { loadTransaction } from "../utils/transaction";
import { factoryGetPool, nfpmPositions } from "../effects/contracts";

type Ctx = EvmOnEventContext;

async function getPosition(
  context: Ctx,
  tokenId: bigint,
  block: { number: number; timestamp: number },
  txHash: string,
  gasPrice: bigint | undefined,
): Promise<Position | null> {
  let position = await context.Position.get(tokenId.toString());
  if (position === undefined) {
    const result = await nfpmPositions(context.effect, NFPM_ADDRESS, tokenId, block.number);
    if (result === null) {
      return null;
    }
    const token0 = low(result[2] as string);
    const token1 = low(result[3] as string);
    const fee = Number(result[4]);
    const tickLower = result[5] as bigint;
    const tickUpper = result[6] as bigint;
    const feeGrowthInside0 = result[8] as bigint;
    const feeGrowthInside1 = result[9] as bigint;

    const poolAddress = await factoryGetPool(context.effect, FACTORY_ADDRESS, token0, token1, fee);
    if (poolAddress === null) {
      return null;
    }
    const poolId = low(poolAddress);

    const transaction = await loadTransaction(
      context,
      txHash,
      BigInt(block.number),
      BigInt(block.timestamp),
      gasPrice,
    );

    position = {
      id: tokenId.toString(),
      owner: ADDRESS_ZERO,
      pool_id: poolId,
      token0_id: token0,
      token1_id: token1,
      tickLower_id: `${poolId}#${tickLower.toString()}`,
      tickUpper_id: `${poolId}#${tickUpper.toString()}`,
      liquidity: ZERO_BI,
      depositedToken0: ZERO_BD,
      depositedToken1: ZERO_BD,
      withdrawnToken0: ZERO_BD,
      withdrawnToken1: ZERO_BD,
      collectedFeesToken0: ZERO_BD,
      collectedFeesToken1: ZERO_BD,
      transaction_id: transaction.id,
      feeGrowthInside0LastX128: feeGrowthInside0,
      feeGrowthInside1LastX128: feeGrowthInside1,
    } satisfies Position;
  }
  return position;
}

async function updateFeeVars(
  context: Ctx,
  position: Position,
  tokenId: bigint,
  blockNumber: number,
): Promise<Position> {
  const result = await nfpmPositions(context.effect, NFPM_ADDRESS, tokenId, blockNumber);
  if (result !== null) {
    return {
      ...position,
      feeGrowthInside0LastX128: result[8] as bigint,
      feeGrowthInside1LastX128: result[9] as bigint,
    };
  }
  return position;
}

async function savePositionSnapshot(
  context: Ctx,
  position: Position,
  block: { number: number; timestamp: number },
  txHash: string,
  gasPrice: bigint | undefined,
): Promise<void> {
  const transaction = await loadTransaction(
    context,
    txHash,
    BigInt(block.number),
    BigInt(block.timestamp),
    gasPrice,
  );
  const snapshot: PositionSnapshot = {
    id: position.id.concat("#").concat(block.number.toString()),
    owner: position.owner,
    pool_id: position.pool_id,
    position_id: position.id,
    blockNumber: BigInt(block.number),
    timestamp: BigInt(block.timestamp),
    liquidity: position.liquidity,
    depositedToken0: position.depositedToken0,
    depositedToken1: position.depositedToken1,
    withdrawnToken0: position.withdrawnToken0,
    withdrawnToken1: position.withdrawnToken1,
    collectedFeesToken0: position.collectedFeesToken0,
    collectedFeesToken1: position.collectedFeesToken1,
    transaction_id: transaction.id,
    feeGrowthInside0LastX128: position.feeGrowthInside0LastX128,
    feeGrowthInside1LastX128: position.feeGrowthInside1LastX128,
  };
  context.PositionSnapshot.set(snapshot);
}

indexer.onEvent(
  { contract: "NonfungiblePositionManager", event: "IncreaseLiquidity" },
  async ({ event, context }) => {
    let position = await getPosition(
      context,
      event.params.tokenId,
      event.block,
      event.transaction.hash,
      event.transaction.gasPrice,
    );
    if (position === null) return;

    const token0 = await getOrLoadToken(context, position.token0_id);
    const token1 = await getOrLoadToken(context, position.token1_id);
    const amount0 = convertTokenToDecimal(event.params.amount0, token0.decimals);
    const amount1 = convertTokenToDecimal(event.params.amount1, token1.decimals);

    position = {
      ...position,
      liquidity: position.liquidity + event.params.liquidity,
      depositedToken0: position.depositedToken0.plus(amount0),
      depositedToken1: position.depositedToken1.plus(amount1),
    };
    position = await updateFeeVars(context, position, event.params.tokenId, event.block.number);
    context.Position.set(position);
    await savePositionSnapshot(context, position, event.block, event.transaction.hash, event.transaction.gasPrice);
  },
);

indexer.onEvent(
  { contract: "NonfungiblePositionManager", event: "DecreaseLiquidity" },
  async ({ event, context }) => {
    let position = await getPosition(
      context,
      event.params.tokenId,
      event.block,
      event.transaction.hash,
      event.transaction.gasPrice,
    );
    if (position === null) return;

    const token0 = await getOrLoadToken(context, position.token0_id);
    const token1 = await getOrLoadToken(context, position.token1_id);
    const amount0 = convertTokenToDecimal(event.params.amount0, token0.decimals);
    const amount1 = convertTokenToDecimal(event.params.amount1, token1.decimals);

    position = {
      ...position,
      liquidity: position.liquidity - event.params.liquidity,
      withdrawnToken0: position.withdrawnToken0.plus(amount0),
      withdrawnToken1: position.withdrawnToken1.plus(amount1),
    };
    position = await updateFeeVars(context, position, event.params.tokenId, event.block.number);
    context.Position.set(position);
    await savePositionSnapshot(context, position, event.block, event.transaction.hash, event.transaction.gasPrice);
  },
);

indexer.onEvent(
  { contract: "NonfungiblePositionManager", event: "Collect" },
  async ({ event, context }) => {
    let position = await getPosition(
      context,
      event.params.tokenId,
      event.block,
      event.transaction.hash,
      event.transaction.gasPrice,
    );
    if (position === null) return;

    const token0 = await getOrLoadToken(context, position.token0_id);
    const amount0 = convertTokenToDecimal(event.params.amount0, token0.decimals);
    // preserved source bug: amount0 added to BOTH token0 and token1 collected fees
    position = {
      ...position,
      collectedFeesToken0: position.collectedFeesToken0.plus(amount0),
      collectedFeesToken1: position.collectedFeesToken1.plus(amount0),
    };
    position = await updateFeeVars(context, position, event.params.tokenId, event.block.number);
    context.Position.set(position);
    await savePositionSnapshot(context, position, event.block, event.transaction.hash, event.transaction.gasPrice);
  },
);

indexer.onEvent(
  { contract: "NonfungiblePositionManager", event: "Transfer" },
  async ({ event, context }) => {
    let position = await getPosition(
      context,
      event.params.tokenId,
      event.block,
      event.transaction.hash,
      event.transaction.gasPrice,
    );
    if (position === null) return;

    position = { ...position, owner: low(event.params.to) };
    context.Position.set(position);
    await savePositionSnapshot(context, position, event.block, event.transaction.hash, event.transaction.gasPrice);
  },
);
