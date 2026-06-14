/**
 * Offline test (a): AgentVaultCreated flow.
 *
 * Simulates an AgentVaultCreated on AssetManager_FXRP and asserts the created
 * AgentVault, AgentVaultSettings, AgentManager, AgentOwner, CollateralPoolMap
 * and the AgentVaultCreated event record with exact values. The
 * AgentOwnerRegistry / collateral-pool-token-symbol eth_calls are mocked via
 * FASSETS_CALL_MOCK. Also covers a CollateralPool CPEntered event whose
 * fasset is resolved from the CollateralPoolMap written by the agent-created
 * handler (mirrors the source's pool->agentVault association).
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createTestIndexer } from "envio";
import { setCallMock } from "../src/effects.js";

const ASSET_MANAGER_FXRP = "0x2a3Fe068cD92178554cabcf7c95ADf49B4B0B6A8";
const OWNER = "0xAaaA000000000000000000000000000000000001";
const WORK = "0xbBbB000000000000000000000000000000000002";
const AGENT_VAULT = "0xCccc000000000000000000000000000000000003";
const POOL = "0xDddD000000000000000000000000000000000004";
const POOL_TOKEN = "0xeEEe000000000000000000000000000000000005";
const VAULT_COLLATERAL = "0xFffF000000000000000000000000000000000006";
const HOLDER = "0x1111000000000000000000000000000000000007";

const lc = (x: string) => x.toLowerCase();

describe("agent vault created flow", () => {
  beforeEach(() => {
    setCallMock({
      strict: false,
      rules: [
        { fn: "getAgentName", result: { kind: "string", value: "Acme Agent" } },
        { fn: "getAgentDescription", result: { kind: "string", value: "desc" } },
        { fn: "getAgentIconUrl", result: { kind: "string", value: "https://icon" } },
        { fn: "getWorkAddress", result: { kind: "string", value: WORK } },
        { fn: "symbol", result: { kind: "string", value: "FXRP-POOL" } },
      ],
    });
  });
  afterEach(() => setCallMock(undefined));

  it("creates AgentVault + settings + manager/owner + pool map with exact values", async () => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        14: {
          simulate: [
            {
              contract: "AssetManager",
              event: "AgentVaultCreated",
              srcAddress: ASSET_MANAGER_FXRP,
              logIndex: 3,
              params: {
                owner: OWNER,
                agentVault: AGENT_VAULT,
                creationData: {
                  collateralPool: POOL,
                  collateralPoolToken: POOL_TOKEN,
                  underlyingAddress: "rUnderlyingXRPAddr",
                  vaultCollateralToken: VAULT_COLLATERAL,
                  poolWNatToken: "0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d",
                  feeBIPS: 25n,
                  poolFeeShareBIPS: 4000n,
                  mintingVaultCollateralRatioBIPS: 15000n,
                  mintingPoolCollateralRatioBIPS: 24000n,
                  buyFAssetByAgentFactorBIPS: 9900n,
                  poolExitCollateralRatioBIPS: 26000n,
                  redemptionPoolFeeShareBIPS: 100n,
                },
              },
              block: { number: 22000100, timestamp: 1720000000 },
            },
            {
              contract: "CollateralPool",
              event: "CPEntered",
              srcAddress: POOL,
              logIndex: 0,
              params: {
                tokenHolder: HOLDER,
                amountNatWei: 1000000000000000000n,
                receivedTokensWei: 990000000000000000n,
                timelockExpiresAt: 1720003600n,
              },
              block: { number: 22000200, timestamp: 1720001000 },
            },
          ],
        },
      },
    });

    const av = await indexer.AgentVault.getOrThrow(lc(AGENT_VAULT));
    expect(av.fasset).toBe(0); // FXRP
    expect(av.collateralPool).toBe(lc(POOL));
    expect(av.collateralPoolToken).toBe(lc(POOL_TOKEN));
    expect(av.collateralPoolTokenSymbol).toBe("FXRP-POOL");
    expect(av.underlyingAddress).toBe("rUnderlyingXRPAddr");
    expect(av.owner_id).toBe(lc(WORK));
    expect(av.destroyed).toBe(false);

    const settings = await indexer.AgentVaultSettings.getOrThrow(lc(AGENT_VAULT));
    expect(settings.feeBIPS).toBe(25n);
    expect(settings.poolFeeShareBIPS).toBe(4000n);
    expect(settings.mintingVaultCollateralRatioBIPS).toBe(15000n);
    expect(settings.redemptionPoolFeeShareBIPS).toBe(100n);
    expect(settings.collateralToken_id).toBe(`0_${lc(VAULT_COLLATERAL)}`);

    const manager = await indexer.AgentManager.getOrThrow(lc(OWNER));
    expect(manager.name).toBe("Acme Agent");
    expect(manager.iconUrl).toBe("https://icon");

    const owner = await indexer.AgentOwner.getOrThrow(lc(WORK));
    expect(owner.manager_id).toBe(lc(OWNER));

    const map = await indexer.CollateralPoolMap.getOrThrow(lc(POOL));
    expect(map.fasset).toBe(0);
    expect(map.agentVault_id).toBe(lc(AGENT_VAULT));

    const created = await indexer.AgentVaultCreated.getOrThrow("14_22000100_3");
    expect(created.agentVault_id).toBe(lc(AGENT_VAULT));
    expect(created.fasset).toBe(0);

    // CollateralPool event resolved fasset via CollateralPoolMap
    const cpEntered = await indexer.CPEntered.getOrThrow("14_22000200_0");
    expect(cpEntered.fasset).toBe(0);
    expect(cpEntered.tokenHolder).toBe(lc(HOLDER));
    expect(cpEntered.amountNatWei).toBe(1000000000000000000n);
    expect(cpEntered.receivedTokensWei).toBe(990000000000000000n);
  });
});
