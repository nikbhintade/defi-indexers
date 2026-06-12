/** Port of src/services/rebase/snapshots.ts */
import { BigDecimal, type EvmOnEventContext } from "envio";
import { DAY, getIntervalFromTimestamp } from "../../utils/time";
import { toBigDecimal } from "../../utils";
import { AETH_TOKEN, BIG_DECIMAL_ZERO, BIG_INT_ZERO, LIDO_STETH_CONTRACT, USDN_TOKEN } from "../../constants";
import { aTokenScaledTotalSupply, erc20TotalSupply } from "../../effects/contracts";

// Used to calculate rebase APR of aTokens
// We store the total supply / total supply scaled ratio as price
export async function getATokenSnapshotPrice(
  context: EvmOnEventContext,
  block: number,
  token: string,
  timestamp: bigint,
): Promise<BigDecimal> {
  const day = getIntervalFromTimestamp(timestamp, DAY);
  const snapshotId = token + "-" + day.toString() + "-rebase";
  let snapshot = await context.TokenSnapshot.get(snapshotId);
  if (!snapshot) {
    const totalSupplyResult = await erc20TotalSupply(context.effect, token, block);
    const scaledTotalSupplyResult = await aTokenScaledTotalSupply(context.effect, token, block);
    let price: BigDecimal;
    if (totalSupplyResult === null || scaledTotalSupplyResult === null) {
      price = BIG_DECIMAL_ZERO;
    } else {
      price =
        scaledTotalSupplyResult == BIG_INT_ZERO
          ? BIG_DECIMAL_ZERO
          : toBigDecimal(totalSupplyResult).div(toBigDecimal(scaledTotalSupplyResult));
    }
    snapshot = {
      id: snapshotId,
      price,
      token,
      timestamp,
    };
    context.TokenSnapshot.set(snapshot);
  }
  return snapshot.price;
}

// Used to calculate rebase APR of USDN
export async function getUsdnSnapshotPrice(context: EvmOnEventContext, timestamp: bigint): Promise<BigDecimal> {
  const day = getIntervalFromTimestamp(timestamp, DAY);
  const snapshotId = USDN_TOKEN + "-" + day.toString() + "-rebase";
  const snapshot = await context.TokenSnapshot.get(snapshotId);
  if (!snapshot) {
    return BIG_DECIMAL_ZERO;
  }
  return snapshot.price;
}

// Used to calculate rebase APR of Lido steth
export async function getLidoSnapshotPrice(context: EvmOnEventContext, timestamp: bigint): Promise<BigDecimal> {
  const day = getIntervalFromTimestamp(timestamp, DAY);
  const snapshotId = LIDO_STETH_CONTRACT + "-" + day.toString() + "-rebase";
  const snapshot = await context.TokenSnapshot.get(snapshotId);
  if (!snapshot) {
    return BIG_DECIMAL_ZERO;
  }
  return snapshot.price;
}

// Used to calculate rebase APR of AETH
export async function getAethSnapshotPrice(context: EvmOnEventContext, timestamp: bigint): Promise<BigDecimal> {
  const day = getIntervalFromTimestamp(timestamp, DAY);
  const snapshotId = AETH_TOKEN + "-" + day.toString() + "-rebase";
  const snapshot = await context.TokenSnapshot.get(snapshotId);
  if (!snapshot) {
    return BIG_DECIMAL_ZERO;
  }
  return snapshot.price;
}
