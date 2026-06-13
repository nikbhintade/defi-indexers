/**
 * Port of src/meta-morpho-factory.ts. CreateMetaMorpho:
 *  - registers the MetaMorpho vault template (contractRegister)
 *  - creates the MetaMorpho entity + its supply InterestRate
 */
import { indexer, type InterestRate, type MetaMorpho } from "envio";
import { getZeroMarket } from "../initializers/markets";
import { getOrCreateAccount } from "../sdk/account";
import { getOrCreateToken } from "../sdk/token";
import { BIGDECIMAL_ZERO, InterestRateSide, InterestRateType } from "../sdk/constants";
import { low } from "../utils/graphBytes";
import { normEvent } from "../context";

indexer.contractRegister(
  { contract: "MetaMorphoFactory", event: "CreateMetaMorpho" },
  async ({ event, context }) => {
    context.chain.MetaMorpho.add(event.params.metaMorpho);
  },
);

indexer.onEvent(
  { contract: "MetaMorphoFactory", event: "CreateMetaMorpho" },
  async ({ event, context }) => {
    const ev = normEvent(event);
    const mmId = low(event.params.metaMorpho);
    const asset = await getOrCreateToken(context, event.params.asset);
    const owner = await getOrCreateAccount(context, event.params.initialOwner);
    const account = await getOrCreateAccount(context, event.params.metaMorpho);

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
      name: event.params.name,
      symbol: event.params.symbol,
      decimals: 18,
      asset_id: asset.id,
      owner_id: owner.id,
      curator_id: undefined,
      guardian: undefined,
      timelock: event.params.initialTimelock,
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
    };
    context.MetaMorpho.set(metaMorpho);
  },
);
