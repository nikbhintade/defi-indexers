/**
 * Ported from liquity/dev packages/subgraph/src/entities/Frontend.ts.
 * Frontend id = owner address (lowercase hex).
 */
import type { EvmOnEventContext as handlerContext } from "envio";

import { decimalize } from "../utils/bignumbers";
import { a } from "../utils/constants";
import { getUser } from "./User";

export async function registerFrontend(
  context: handlerContext,
  ownerAddress: string,
  kickbackRate: bigint,
): Promise<void> {
  const owner = await getUser(context, ownerAddress);
  context.Frontend.set({
    id: owner.id,
    owner_id: owner.id,
    kickbackRate: decimalize(kickbackRate),
  });
}

export async function assignFrontendToDepositor(
  context: handlerContext,
  depositorAddress: string,
  frontendAddress: string,
): Promise<void> {
  const frontend = await context.Frontend.get(a(frontendAddress));

  if (frontend != null) {
    const depositor = await getUser(context, depositorAddress);
    context.User.set({ ...depositor, frontend_id: frontend.id });
  }
}
