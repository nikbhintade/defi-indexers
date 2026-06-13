/**
 * Port of DssCdpManager + DSProxyFactory handlers (CDP ownership / urn mapping
 * and proxy ownership). These build the _Cdpi / _Urn / _Proxy lookup tables
 * used by getOwnerAddress to translate urn/proxy addresses to EOA owners.
 */
import { indexer } from "envio";
import { toEventInfo } from "../common/event";
import type { EventInfo, Ctx } from "../common/types";
import { BIGINT_ZERO } from "../common/constants";
import {
  bytes32ToAddressHexString,
  bytesToUnsignedBigInt,
} from "../utils/bytes";
import { getOwnerAddress } from "../common/getters";
import { transferPosition } from "../common/helpers";
import { cdpManagerUrns, cdpManagerIlks } from "../effects/contracts";

const sig4 = (s: string): string => s.slice(0, 10).toLowerCase();
const SIG_GIVE = "0xfcafcc68";
const SIG_SHIFT = "0xe50322a2";
const SIG_ENTER = "0x7e348b7d";
const SIG_QUIT = "0x1b0dbf72";

indexer.onEvent({ contract: "CdpManager", event: "NewCdp" }, async ({ event, context }) => {
  const ev = toEventInfo(event, context.effect);
  const cdpi = event.params.cdp;
  const owner = event.params.own.toLowerCase();
  const ownerEOA = await getOwnerAddress(context, owner);
  const urnhandlerAddress = (await cdpManagerUrns(ev.effect, ev.srcAddress, cdpi, Number(ev.blockNumber)))!;
  const ilk = (await cdpManagerIlks(ev.effect, ev.srcAddress, cdpi, Number(ev.blockNumber)))!;

  context._Cdpi.set({
    id: cdpi.toString(),
    urn: urnhandlerAddress,
    ilk: ilk.toLowerCase(),
    ownerAddress: ownerEOA,
  });
  context._Urn.set({ id: urnhandlerAddress, ownerAddress: ownerEOA, cdpi });
});

indexer.onEvent({ contract: "CdpManager", event: "LogNote" }, async ({ event, context }) => {
  const sig = sig4(event.params.sig);
  const ev = toEventInfo(event, context.effect);
  switch (sig) {
    case SIG_GIVE:
      return handleCdpGive(context, ev, event.params.arg1, event.params.arg2);
    case SIG_SHIFT:
      return handleCdpShift(context, ev, event.params.arg1, event.params.arg2);
    case SIG_ENTER:
      return handleCdpEnter(context, ev, event.params.arg1, event.params.arg2);
    case SIG_QUIT:
      return handleCdpQuit(context, ev, event.params.arg1, event.params.arg2);
    default:
      return;
  }
});

async function handleCdpGive(ctx: Ctx, ev: EventInfo, arg1: string, arg2: string): Promise<void> {
  const cdpi = bytesToUnsignedBigInt(arg1);
  const dstAccountAddress = bytes32ToAddressHexString(arg2);
  const dstAccountOwner = await getOwnerAddress(ctx, dstAccountAddress);
  const _cdpi = await ctx._Cdpi.get(cdpi.toString());
  if (!_cdpi) return;
  const srcUrn = _cdpi.urn;
  const ilk = _cdpi.ilk;
  ctx._Cdpi.set({ ..._cdpi, ownerAddress: dstAccountOwner });

  const _urn = await ctx._Urn.get(srcUrn);
  if (!_urn) return;
  const srcAccountAddress = _urn.ownerAddress;
  ctx._Urn.set({ ..._urn, ownerAddress: dstAccountOwner });

  await transferPosition(ctx, ev, ilk, srcUrn, srcUrn, "LENDER", srcAccountAddress, dstAccountOwner);
  await transferPosition(ctx, ev, ilk, srcUrn, srcUrn, "BORROWER", srcAccountAddress, dstAccountOwner);
}

async function handleCdpShift(ctx: Ctx, ev: EventInfo, arg1: string, arg2: string): Promise<void> {
  const srcCdp = bytesToUnsignedBigInt(arg1);
  const dstCdp = bytesToUnsignedBigInt(arg2);
  const srcCdpi = await ctx._Cdpi.get(srcCdp.toString());
  const dstCdpi = await ctx._Cdpi.get(dstCdp.toString());
  if (!srcCdpi || !dstCdpi) return;
  const srcIlk = srcCdpi.ilk;
  const srcUrnAddress = srcCdpi.urn;
  const dstUrnAddress = dstCdpi.urn;

  await transferPosition(ctx, ev, srcIlk, srcUrnAddress, dstUrnAddress, "LENDER");
  await transferPosition(ctx, ev, srcIlk, srcUrnAddress, dstUrnAddress, "BORROWER");
}

async function handleCdpEnter(ctx: Ctx, ev: EventInfo, arg1: string, arg2: string): Promise<void> {
  const src = bytes32ToAddressHexString(arg1);
  const cdpi = bytesToUnsignedBigInt(arg2);
  const _cdpi = await ctx._Cdpi.get(cdpi.toString());
  if (!_cdpi) return;
  const dst = _cdpi.urn;
  const ilk = _cdpi.ilk;
  await transferPosition(ctx, ev, ilk, src, dst, "LENDER");
  await transferPosition(ctx, ev, ilk, src, dst, "BORROWER");
}

async function handleCdpQuit(ctx: Ctx, ev: EventInfo, arg1: string, arg2: string): Promise<void> {
  const cdpi = bytesToUnsignedBigInt(arg1);
  const dst = bytes32ToAddressHexString(arg2);
  const _cdpi = await ctx._Cdpi.get(cdpi.toString());
  if (!_cdpi) return;
  const src = _cdpi.urn;
  const ilk = _cdpi.ilk;
  await transferPosition(ctx, ev, ilk, src, dst, "LENDER");
  await transferPosition(ctx, ev, ilk, src, dst, "BORROWER");
}

// ---------------- DSProxyFactory ----------------

indexer.onEvent({ contract: "DSProxyFactory", event: "Created" }, async ({ event, context }) => {
  const proxy = event.params.proxy.toLowerCase();
  const owner = event.params.owner.toLowerCase();
  context._Proxy.set({ id: proxy, ownerAddress: owner });
});

void BIGINT_ZERO;
