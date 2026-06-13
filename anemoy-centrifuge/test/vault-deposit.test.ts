/**
 * Offline test (b): vault deployment + investor deposit-request flow, driven
 * end-to-end by events (no manual entity seeding).
 *   HubRegistry.NewPool          -> Pool
 *   HubRegistry.NewAsset (ISO)   -> Asset(USD) so the pool currency resolves
 *   ShareClassManager.AddShareClass -> Token
 *   Spoke.RegisterAsset          -> Asset (the vault asset; tokenId 0)
 *   Spoke.AddShareClass          -> TokenInstance  (mocks ERC20 totalSupply)
 *   Spoke.DeployVault            -> Vault  (+ contractRegister registers vault addr)
 *   Vault.DepositRequest         -> InvestorTransaction + VaultInvestOrder
 * Asserts exact values; the only eth_call (totalSupply) is mocked via ANEMOY_CALL_MOCK.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTestIndexer } from "envio";
import { setCallMock, type CallMockRule } from "../src/effects/calls";

const MANAGER = "0x6666666666666666666666666666666666666666";
const POOL_ID = 281474976710663n;
const SC_ID = "0x00010000000000070000000000000001";
const TOKEN_ADDR = "0x1111111111111111111111111111111111111111";
const USDC = "0x2222222222222222222222222222222222222222";
const VAULT = "0x3333333333333333333333333333333333333333";
const FACTORY = "0x4444444444444444444444444444444444444444";
const INVESTOR = "0x5555555555555555555555555555555555555555";
// vault asset uses an ISO-like id < 1000 so decimals resolve without extra reads
const ASSET_ID = 840n; // also the pool currency
const BLOCK = 24319400;
const TS = 1769001000;
const TX = "0x" + "22".repeat(32);

afterEach(() => setCallMock(undefined));

describe("vault deploy + deposit request", () => {
  it("produces Vault + InvestorTransaction + VaultInvestOrder with exact values", async () => {
    const rules: CallMockRule[] = [
      { fn: "totalSupply", to: TOKEN_ADDR, result: { kind: "bigint", value: "0" } },
    ];
    setCallMock({ strict: true, rules });

    const indexer = createTestIndexer();

    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "HubRegistry",
              event: "NewAsset",
              logIndex: 0,
              params: { assetId: ASSET_ID, decimals: 6n },
              block: { number: BLOCK, timestamp: TS },
            },
            {
              contract: "HubRegistry",
              event: "NewPool",
              logIndex: 1,
              params: { poolId: POOL_ID, manager: MANAGER as `0x${string}`, currency: ASSET_ID },
              block: { number: BLOCK, timestamp: TS },
            },
            {
              contract: "ShareClassManager",
              event: "AddShareClass",
              logIndex: 2,
              params: {
                poolId: POOL_ID,
                scId: SC_ID as `0x${string}`,
                index: 1n,
                name: "Anemoy AAA CLO",
                symbol: "JAAA",
                salt: ("0x" + "00".repeat(32)) as `0x${string}`,
              },
              block: { number: BLOCK, timestamp: TS },
            },
            {
              contract: "Spoke",
              event: "RegisterAsset",
              logIndex: 3,
              params: {
                assetId: ASSET_ID,
                asset: USDC as `0x${string}`,
                tokenId: 0n,
                name: "USD Coin",
                symbol: "USDC",
                decimals: 6n,
                centrifugeId: 1n,
                isInitialization: true,
              },
              block: { number: BLOCK, timestamp: TS },
            },
            {
              contract: "Spoke",
              event: "AddShareClass",
              logIndex: 4,
              params: { poolId: POOL_ID, scId: SC_ID as `0x${string}`, token: TOKEN_ADDR as `0x${string}` },
              block: { number: BLOCK, timestamp: TS },
            },
            {
              contract: "Spoke",
              event: "DeployVault",
              logIndex: 5,
              params: {
                poolId: POOL_ID,
                scId: SC_ID as `0x${string}`,
                asset: USDC as `0x${string}`,
                tokenId: 0n,
                factory: FACTORY as `0x${string}`,
                vault: VAULT as `0x${string}`,
                kind: 0n, // Async
              },
              block: { number: BLOCK, timestamp: TS },
            },
            {
              contract: "Vault",
              event: "DepositRequest",
              srcAddress: VAULT as `0x${string}`,
              logIndex: 6,
              params: {
                controller: INVESTOR as `0x${string}`,
                owner: INVESTOR as `0x${string}`,
                requestId: 0n,
                sender: INVESTOR as `0x${string}`,
                assets: 1_000_000n, // 1 USDC (6 decimals)
              },
              block: { number: BLOCK, timestamp: TS },
              transaction: { hash: TX },
            },
          ],
        },
      },
    });

    // ---- Asset (vault asset, from Spoke.RegisterAsset; overwrites the ISO row) ----
    const asset = await indexer.Asset.getOrThrow(String(ASSET_ID));
    expect(asset.address).toBe(USDC.toLowerCase());
    expect(asset.assetTokenId).toBe(0n);
    expect(asset.decimals).toBe(6);
    expect(asset.symbol).toBe("USDC");

    // ---- TokenInstance (from Spoke.AddShareClass) ----
    const ti = await indexer.TokenInstance.getOrThrow(`1-${SC_ID.toLowerCase()}`);
    expect(ti.address).toBe(TOKEN_ADDR.toLowerCase());
    expect(ti.isActive).toBe(true);
    expect(ti.totalIssuance).toBe(0n);

    // ---- Vault (from DeployVault) ----
    const vault = await indexer.Vault.getOrThrow(`${VAULT.toLowerCase()}-1`);
    expect(vault.poolId).toBe(POOL_ID);
    expect(vault.tokenId).toBe(SC_ID.toLowerCase());
    expect(vault.assetId).toBe(ASSET_ID);
    expect(vault.assetAddress).toBe(USDC.toLowerCase());
    expect(vault.factory).toBe(FACTORY.toLowerCase());
    expect(vault.kind).toBe("Async");
    expect(vault.status).toBe("Unlinked");
    expect(vault.isActive).toBe(true);
    expect(vault.maxReserve).toBe(2n ** 128n - 1n);

    // ---- InvestorTransaction (DEPOSIT_REQUEST_UPDATED) ----
    const itId = `${POOL_ID}-${SC_ID.toLowerCase()}-${INVESTOR.toLowerCase()}-DEPOSIT_REQUEST_UPDATED-${TX}`;
    const it = await indexer.InvestorTransaction.getOrThrow(itId);
    expect(it.type).toBe("DEPOSIT_REQUEST_UPDATED");
    expect(it.account).toBe(INVESTOR.toLowerCase());
    expect(it.currencyAmount).toBe(1_000_000n);
    expect(it.currencyAssetId).toBe(ASSET_ID);
    expect(it.centrifugeId).toBe("1");
    expect(it.tokenId).toBe(SC_ID.toLowerCase());

    // ---- VaultInvestOrder ----
    const vioId = `${SC_ID.toLowerCase()}-1-${ASSET_ID}-${INVESTOR.toLowerCase()}`;
    const vio = await indexer.VaultInvestOrder.getOrThrow(vioId);
    expect(vio.requestedAssetsAmount).toBe(1_000_000n);
    expect(vio.claimableAssetsAmount).toBe(0n);
    expect(vio.poolId).toBe(POOL_ID);
    expect(vio.assetId).toBe(ASSET_ID);
  });
});
