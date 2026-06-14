/**
 * Port of src/meta-morpho-factory.ts and src/meta-morpho-factory-v1.1.ts.
 * CreateMetaMorpho:
 *  - registers the MetaMorpho vault template (contractRegister)
 *  - creates the MetaMorpho entity + its supply InterestRate
 *
 * The only difference between the v1.0 and v1.1 factories is the stored
 * `version` string ("1.0" vs "1.1").
 */
import { indexer, type InterestRate, type MetaMorpho } from "envio";
import type { Context, Ev } from "../context";
import { getZeroMarket } from "../initializers/markets";
import { getOrCreateAccount } from "../sdk/account";
import { getOrCreateToken } from "../sdk/token";
import { BIGDECIMAL_ZERO, InterestRateSide, InterestRateType } from "../sdk/constants";
import { low } from "../utils/graphBytes";
import { normEvent } from "../context";

type CreateMetaMorphoParams = {
  metaMorpho: string;
  initialOwner: string;
  initialTimelock: bigint;
  asset: string;
  name: string;
  symbol: string;
};

async function handleCreateMetaMorpho(
  context: Context,
  ev: Ev,
  params: CreateMetaMorphoParams,
  version: string,
): Promise<void> {
  const mmId = low(params.metaMorpho);
  const asset = await getOrCreateToken(context, params.asset);
  const owner = await getOrCreateAccount(context, params.initialOwner);
  const account = await getOrCreateAccount(context, params.metaMorpho);

  const zeroMarket = await getZeroMarket(context, ev.block);
  const rateId = mmId + "-supply";
  const rate: InterestRate = {
    id: rateId,
    rate: BIGDECIMAL_ZERO,
    market_id: zeroMarket.id,
    type: InterestRateType.VARIABLE,
    side: InterestRateSide.LENDER,
  };
  context.InterestRate.set(rate);

  const metaMorpho: MetaMorpho = {
    id: mmId,
    name: params.name,
    symbol: params.symbol,
    decimals: 18,
    version,
    asset_id: asset.id,
    owner_id: owner.id,
    curator_id: undefined,
    guardian: undefined,
    timelock: params.initialTimelock,
    fee: 0n,
    feeRecipient_id: undefined,
    feeAccrued: 0n,
    feeAccruedAssets: 0n,
    rate_id: rateId,
    lastTotalAssets: 0n,
    totalShares: 0n,
    idle: 0n,
    supplyQueue: [],
    withdrawQueue: [],
    currentPendingTimelock_id: undefined,
    currentPendingGuardian_id: undefined,
    account_id: account.id,
    hasPublicAllocator: false,
  };
  context.MetaMorpho.set(metaMorpho);
}

// ---- v1.0 factory ----
indexer.contractRegister(
  { contract: "MetaMorphoFactory", event: "CreateMetaMorpho" },
  async ({ event, context }) => {
    context.chain.MetaMorpho.add(event.params.metaMorpho);
  },
);

indexer.onEvent(
  { contract: "MetaMorphoFactory", event: "CreateMetaMorpho" },
  async ({ event, context }) => {
    await handleCreateMetaMorpho(context, normEvent(event), event.params, "1.0");
  },
);

// ---- v1.1 factory ----
indexer.contractRegister(
  { contract: "MetaMorphoFactoryV11", event: "CreateMetaMorpho" },
  async ({ event, context }) => {
    context.chain.MetaMorpho.add(event.params.metaMorpho);
  },
);

indexer.onEvent(
  { contract: "MetaMorphoFactoryV11", event: "CreateMetaMorpho" },
  async ({ event, context }) => {
    await handleCreateMetaMorpho(context, normEvent(event), event.params, "1.1");
  },
);
