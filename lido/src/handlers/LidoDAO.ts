/**
 * Ported from src/LidoDAO.ts. Aragon Kernel SetApp -> AppVersion registration.
 *
 * The subgraph reads the implementation's semantic version from the app's
 * AppRepo via Repo.try_getLatestForContractAddress(app). We replicate this as
 * a block-pinned eth_call Effect. APP_REPOS holds the known repo addresses per
 * appId (Lido/NOR/Oracle/Voting); other apps are skipped, exactly as upstream.
 *
 * NB on the brief's "AppRepo-driven registration flow": HyperIndex
 * `contractRegister` cannot read entities or run effects, and the AppRepo
 * addresses are statically known per app on mainnet. So rather than
 * dynamically registering Repo contracts, the version read is done inline via
 * the eth_call Effect, which is faithful to the subgraph's data output.
 */
import { indexer } from "envio";
import {
  APP_REPOS,
  KERNEL_APP_BASES_NAMESPACE,
  ZERO,
  ZERO_ADDRESS,
  low,
} from "../constants";
import { getLatestSemanticVersion } from "../effects";

indexer.onEvent(
  { contract: "LidoDAO", event: "SetApp" },
  async ({ event, context }) => {
    if (low(event.params.namespace) !== KERNEL_APP_BASES_NAMESPACE) return;
    const appId = low(event.params.appId);
    const repoAddr = APP_REPOS.get(appId);
    if (!repoAddr) return; // process only known apps

    let entity = await context.AppVersion.get(appId);
    if (!entity) {
      entity = {
        id: appId,
        major: 0,
        minor: 0,
        patch: 0,
        impl: ZERO_ADDRESS,
        block: ZERO,
        blockTime: ZERO,
        transactionHash: ZERO_ADDRESS,
        logIndex: ZERO,
      };
    }

    const app = low(event.params.app);
    if (entity.impl === app) return; // update only on new contract address

    const semVer = await getLatestSemanticVersion(
      context.effect,
      repoAddr,
      event.params.app
    );
    const [major, minor, patch] = semVer ?? [0, 0, 0];

    context.AppVersion.set({
      ...entity,
      major,
      minor,
      patch,
      impl: app,
      block: BigInt(event.block.number),
      blockTime: BigInt(event.block.timestamp),
      transactionHash: low(event.transaction.hash),
      logIndex: BigInt(event.logIndex),
    });
  }
);
