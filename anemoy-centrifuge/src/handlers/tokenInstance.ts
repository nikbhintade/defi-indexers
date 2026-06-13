/**
 * Port of the in-scope subset of src/handlers/tokenInstanceHandlers.ts
 * (ERC20 Transfer on factory-deployed share tokens; template registered in
 * spoke.ts via Spoke:AddShareClass).
 *
 * IN-SCOPE: totalIssuance accounting on mint (from == 0x0) / burn (to == 0x0),
 * applied to both the TokenInstance and its Token. user<->user transfers emit
 * TRANSFER_IN / TRANSFER_OUT InvestorTransactions.
 *
 * DEFERRED (documented in MIGRATION.md): TokenInstancePosition balances,
 * InvestorPositionCheckpoint cost-basis / PnL accounting, and the share-price
 * gating around them — these entities are out of scope for this slice.
 */
import { indexer } from "envio";
import { getCentrifugeId, updatedFields } from "../helpers/common";
import * as id from "../helpers/ids";
import { ensureAccount, writeInvestorTransaction } from "./spoke";

const ZERO = "0x0000000000000000000000000000000000000000";

indexer.onEvent({ contract: "TokenInstance", event: "Transfer" }, async ({ event, context }) => {
  const centrifugeId = getCentrifugeId(event.chainId);
  const { from, to, value: amount } = event.params;
  const address = id.lc(event.srcAddress);

  // Resolve TokenInstance by (address, centrifugeId).
  const candidates = await context.TokenInstance.getWhere({ address: { _eq: address } });
  const ti = candidates.filter((t: any) => t.centrifugeId === centrifugeId).pop();
  if (!ti) return;

  const isMint = id.lc(from) === ZERO;
  const isBurn = id.lc(to) === ZERO;

  if (isMint || isBurn) {
    const delta = isMint ? amount : -amount;
    context.TokenInstance.set({
      ...ti,
      totalIssuance: (ti.totalIssuance ?? 0n) + delta,
      ...updatedFields(event),
    });
    const token = await context.Token.get(id.tokenId(ti.tokenId));
    if (token) {
      context.Token.set({
        ...token,
        totalIssuance: (token.totalIssuance ?? 0n) + delta,
        ...updatedFields(event),
      });
    }
    return;
  }

  // user <-> user transfer
  if (id.lc(from) === id.lc(to)) return;
  const token = await context.Token.get(id.tokenId(ti.tokenId));
  if (!token) return;
  await ensureAccount(context, from, event);
  await ensureAccount(context, to, event);
  const common = {
    poolId: token.poolId,
    tokenId: ti.tokenId,
    centrifugeId,
    tokenAmount: amount,
    fromAccount: from,
    toAccount: to,
    fromCentrifugeId: centrifugeId,
    toCentrifugeId: centrifugeId,
  };
  writeInvestorTransaction(context, event, { ...common, type: "TRANSFER_OUT", account: from });
  writeInvestorTransaction(context, event, { ...common, type: "TRANSFER_IN", account: to });
});
