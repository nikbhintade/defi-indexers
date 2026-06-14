/**
 * TBTC token data source — transfers update per-holder balances and the
 * currentTokenHolders count. Faithful port of src/mappingTBTCToken.ts.
 *
 * Note: the subgraph processes `from` before `to`. When from==to or when
 * either is the zero address (mint/burn), the original arithmetic is preserved
 * verbatim (including the holder-count quirks).
 */
import { indexer } from "envio";
import * as Const from "../utils/constants.js";
import { getOrCreateTbtcToken, getOrCreateUser, lc } from "../utils/helper.js";

indexer.onEvent(
  { contract: "TBTC", event: "Transfer" },
  async ({ event, context }) => {
    let token = await getOrCreateTbtcToken(context);
    const from = lc(event.params.from);
    const to = lc(event.params.to);
    const value = event.params.value;

    // ---- from holder ----
    const fromHolder = await getOrCreateUser(context, from);
    const fromHolderPreviousBalance = fromHolder.tokenBalance;
    const fromNewBalance = fromHolder.tokenBalance - value;
    let currentTokenHolders = token.currentTokenHolders;

    if (fromNewBalance === Const.ZERO_BI && fromHolderPreviousBalance > Const.ZERO_BI) {
      currentTokenHolders = currentTokenHolders - Const.ONE_BI;
    } else if (fromNewBalance > Const.ZERO_BI && fromHolderPreviousBalance === Const.ZERO_BI) {
      currentTokenHolders = currentTokenHolders + Const.ONE_BI;
    }
    context.User.set({
      ...fromHolder,
      tokenBalance: fromNewBalance,
      tbtcToken_id: token.id,
    });
    token = { ...token, currentTokenHolders };

    // ---- to holder ----
    // Re-load in case from==to (subgraph loaded a fresh copy reflecting the
    // from write since stores are immediately visible).
    const toHolder = await getOrCreateUser(context, to);
    const toHolderEffective =
      to === from ? { ...toHolder, tokenBalance: fromNewBalance } : toHolder;
    const toHolderPreviousBalance = toHolderEffective.tokenBalance;
    const toNewBalance = toHolderEffective.tokenBalance + value;
    const toTotalHeld = toHolderEffective.totalTokensHeld + value;

    if (toNewBalance === Const.ZERO_BI && toHolderPreviousBalance > Const.ZERO_BI) {
      currentTokenHolders = currentTokenHolders - Const.ONE_BI;
    } else if (toNewBalance > Const.ZERO_BI && toHolderPreviousBalance === Const.ZERO_BI) {
      currentTokenHolders = currentTokenHolders + Const.ONE_BI;
    }
    context.User.set({
      ...toHolderEffective,
      tokenBalance: toNewBalance,
      totalTokensHeld: toTotalHeld,
      tbtcToken_id: token.id,
    });

    context.TBTCToken.set({ ...token, currentTokenHolders });
  },
);
