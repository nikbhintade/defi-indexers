import type { handlerContext } from "../types";
import { getTokenPrice } from "./prices";

export async function saveDistribution(
  context: handlerContext,
  receiver: string,
  token: string,
  amount: bigint,
  typeId: number,
  txHash: string,
  blockNumber: number,
  timestamp: number,
): Promise<void> {
  const id = receiver + ":" + txHash + ":" + typeId.toString();
  let entity = await context.Distribution.get(id);

  let tokens: string[];
  let amounts: bigint[];
  let amountsInUsd: bigint[];

  if (entity == null) {
    tokens = [];
    amounts = [];
    amountsInUsd = [];
  } else {
    tokens = [...entity.tokens];
    amounts = [...entity.amounts];
    amountsInUsd = [...entity.amountsInUsd];
  }

  tokens.push(token);
  amounts.push(amount);
  amountsInUsd.push(await getAmountInUsd(context, token, amount));

  context.Distribution.set({
    id,
    tokens,
    amounts,
    amountsInUsd,
    typeId,
    receiver,
    blockNumber,
    transactionHash: txHash,
    timestamp,
  });
}

async function getAmountInUsd(context: handlerContext, token: string, amount: bigint): Promise<bigint> {
  const tokenPrice = await getTokenPrice(context, token);
  return tokenPrice * amount;
}
