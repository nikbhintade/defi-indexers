/**
 * Ported from src/initializers/protocol.ts. The protocol singleton id is the
 * Morpho Blue contract address (lowercase). `getProtocol` creates it on first
 * access along with the _MarketList helper entity.
 */
import type { LendingProtocol } from "envio";
import type { Context } from "../context";
import {
  CollateralizationType,
  INT_ZERO,
  LendingType,
  PermissionType,
  ProtocolType,
  RiskType,
  BIGDECIMAL_ZERO,
} from "../sdk/constants";
import { ADDRESS_ZERO } from "../utils/graphBytes";

export const MORPHO_BLUE_ADDRESS =
  "0xbbbbbbbbbb9cc5e90e3b3af64bdaf62c37eeffcb";

export async function getProtocol(context: Context): Promise<LendingProtocol> {
  const existing = await context.LendingProtocol.get(MORPHO_BLUE_ADDRESS);
  if (existing) return existing;
  return initBlue(context);
}

async function initBlue(context: Context): Promise<LendingProtocol> {
  const protocol: LendingProtocol = {
    id: MORPHO_BLUE_ADDRESS,
    protocol: "Morpho",
    name: "Morpho Blue",
    slug: "morpho-blue",
    schemaVersion: "3.0.0",
    subgraphVersion: "0.0.7",
    methodologyVersion: "1.0.0",
    network: "MAINNET",
    type: ProtocolType.LENDING,
    lendingType: LendingType.POOLED,
    lenderPermissionType: undefined,
    borrowerPermissionType: undefined,
    poolCreatorPermissionType: PermissionType.PERMISSIONLESS,
    riskType: RiskType.ISOLATED,
    collateralizationType: CollateralizationType.OVER_COLLATERALIZED,
    cumulativeUniqueUsers: INT_ZERO,
    cumulativeUniqueDepositors: INT_ZERO,
    cumulativeUniqueBorrowers: INT_ZERO,
    cumulativeUniqueLiquidators: INT_ZERO,
    cumulativeUniqueLiquidatees: INT_ZERO,
    totalValueLockedUSD: BIGDECIMAL_ZERO,
    cumulativeSupplySideRevenueUSD: BIGDECIMAL_ZERO,
    cumulativeProtocolSideRevenueUSD: BIGDECIMAL_ZERO,
    cumulativeTotalRevenueUSD: BIGDECIMAL_ZERO,
    fees: undefined,
    revenueDetail_id: undefined,
    totalDepositBalanceUSD: BIGDECIMAL_ZERO,
    cumulativeDepositUSD: BIGDECIMAL_ZERO,
    totalBorrowBalanceUSD: BIGDECIMAL_ZERO,
    cumulativeBorrowUSD: BIGDECIMAL_ZERO,
    cumulativeLiquidateUSD: BIGDECIMAL_ZERO,
    totalPoolCount: INT_ZERO,
    openPositionCount: INT_ZERO,
    cumulativePositionCount: INT_ZERO,
    transactionCount: INT_ZERO,
    depositCount: INT_ZERO,
    withdrawCount: INT_ZERO,
    borrowCount: INT_ZERO,
    repayCount: INT_ZERO,
    liquidationCount: INT_ZERO,
    transferCount: INT_ZERO,
    flashloanCount: INT_ZERO,
    owner: ADDRESS_ZERO,
    feeRecipient: ADDRESS_ZERO,
    irmEnabled: [],
    lltvEnabled: [],
  };
  context.LendingProtocol.set(protocol);
  context._MarketList.set({ id: protocol.id, markets: [] });
  return protocol;
}
