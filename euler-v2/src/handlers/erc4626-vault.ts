/**
 * Port of src/erc4626-vault.ts — ERC4626Vault (EulerEarn) template handler.
 *
 * Transfer -> trackActions(from) then trackActions(to).
 *
 * Note: the source's tracking.ts always binds an `EulerVault` to the event
 * address and calls balanceOf / try_debtOf. EulerEarn (ERC4626) vaults expose
 * balanceOf but not debtOf, so debtOf reverts and debt stays 0 — matched here
 * by the try-call returning null. The subgraph manifest only prefetches
 * balanceOf for this template; debtOf is still attempted (and reverts) inside
 * the shared trackActions, so we attempt it too for parity.
 */
import { indexer } from "envio";
import { trackActions } from "../utils/tracking";

indexer.onEvent(
  { contract: "ERC4626Vault", event: "Transfer" },
  async ({ event, context }) => {
    await trackActions({
      context,
      effect: context.effect,
      account: event.params.from,
      vault: event.srcAddress,
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: event.transaction.hash,
      block: event.block.number,
    });

    await trackActions({
      context,
      effect: context.effect,
      account: event.params.to,
      vault: event.srcAddress,
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: event.transaction.hash,
      block: event.block.number,
    });
  },
);
