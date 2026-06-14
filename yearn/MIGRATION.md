# Yearn V2 Vaults — subgraph → HyperIndex migration

Port of the **yearn-vaults-v2-subgraph** (Ethereum mainnet) to Envio HyperIndex
(envio `3.1.2`, TypeScript). Target: data parity with the original subgraph
(entity ids and field values match so `tools/compare` can diff them).

## Source

- Repo: `yearn/yearn-vaults-v2-subgraph` (clone at `/tmp/sources/yearn-v2-subgraph`)
- Commit: `44ab9a21d762f4be693fe3f5a8d72fb171a62a7e` ("feat: add registry v3 (eth) support", 2023-02-13)
- Mustache-templated subgraph; rendered for **mainnet** from `config/mainnet.json`.

## Scope

In scope — the full Ethereum-mainnet Yearn **V2** vaults representation:

- **Registry** (V1 `0xe154…c18c`, start 11390000) and **RegistryV2** (`0x50c1…3804`,
  start 12045550): in the source these are two data sources that share the same
  ABI + the same `registryMappings.ts` handlers. Folded into one HyperIndex
  contract `Registry` with two static addresses. Events:
  `NewRelease`, `NewVault(token,deployment_id,vault,api_version)`,
  `NewVault(token,vaultId,vaultType,vault,apiVersion)` (V2 overload),
  `NewExperimentalVault`, `VaultTagged`.
- **RegistryV3** (`0xaF1f…3319`, start 16215500): only `NewVault(...,vaultType,...)`.
- **Vault** template + bootstrap vaults: deposit / withdraw / transfer / strategy
  accounting, vault/strategy snapshots (`VaultUpdate`, `StrategyReport`,
  `StrategyReportResult`, `Harvest`, `VaultDayData`), fees, queues, params.
- **Strategy** template: `Harvested`, `Cloned`, `SetHealthCheck`,
  `SetDoHealthCheck`, `EmergencyExitEnabled`, `Updated{Keeper,Strategist,Rewards}`.

### Out of scope (documented, not ported)

- **`yearn/kong`** — the *current* official Yearn data platform (a large
  multi-service V2+V3 TS app, not a subgraph). Not a faithful 1:1 subgraph port
  target; intentionally excluded.
- **V3-only vaults / RegistryV3 vault internals** beyond what the V2 subgraph
  models. RegistryV3 `NewVault` is ported (it creates a `Vault` entity exactly
  as the source's `handleNewVaultInRegistryV3` does), but V3 vault-specific
  semantics are not added on top of the V2 model.
- **Fantom / Arbitrum / Optimism** networks and the per-vault Fantom bootstrap
  mappings `src/mappings/ftm/*` (six ~886-line near-identical files) and
  `src/mappings/op/*`. These are non-mainnet and were skipped.

## Mainnet rendering

From `config/mainnet.json`:

| Source data source | Address | Start block |
| --- | --- | --- |
| Registry (V1) | `0xe15461b18ee31b7379019dc523231c57d1cbc18c` | 11390000 |
| RegistryV2 | `0x50c1a2eA0a861A967D9d0FFE2AE4012c2E053804` | 12045550 |
| RegistryV3 | `0xaF1f5e1c19cB68B30aAD73846eFfDf78a5863319` | 16215500 |
| Bootstrap `YvWBTCVault` (manualVaults) | `0xA696a63cc78DfFa1a63E9E50587C197387FF6C7E` | 12185980 |
| Bootstrap `YvLinkVault` (manualVaults) | `0x671a912c10bba0cfa74cfc2d6fba9ba1ed9530b2` | 12542630 |
| Bootstrap `CurveSETHVault` (vaultsWithPreregisteredStrategies) | `0x986b4AFF588a109c09B50A03f42E4110E29D353F` | 11870013 |

The three bootstrap vaults are vaults that received Deposit/Strategy events
*before* they were added to a registry. In the source they are separate static
data sources whose mapping file is `vaultMappings.ts` (manualVaults) or a
trimmed copy (vaultsWithPreregisteredStrategies). Here they are folded into the
single `Vault` contract as **static addresses**; the same `Vault` contract also
receives the **dynamically registered** template instances. This matches the
source: each is a Vault using the Vault event handlers.

## File map (source → port)

| Source | Port |
| --- | --- |
| `subgraph.template.yaml` + `config/mainnet.json` | `config.yaml` |
| `schema.graphql` | `schema.graphql` |
| `src/mappings/registryMappings.ts`, `utils/registry/registry.ts` | `src/handlers/registry.ts`, `src/utils/account.ts` (`getOrCreateRegistry`) |
| `src/mappings/vaultMappings.ts` | `src/handlers/vault.ts` |
| `src/mappings/strategyMappings.ts` | `src/handlers/strategy.ts` |
| `templates:` (Vault, Strategy) | `src/handlers/registration.ts` (`contractRegister`) |
| `src/utils/vault/vault.ts` | `src/utils/vault.ts` |
| `src/utils/vault/vault-update.ts` | `src/utils/vault-update.ts` (+ `vault-update-id.ts`) |
| `src/utils/vault/vault-day-data.ts` | `src/utils/vault-day-data.ts` |
| `src/utils/strategy/{strategy,strategy-report,strategy-report-result,strategy-migration}.ts` | `src/utils/strategy.ts` |
| `src/utils/account/{account,vault-position,vault-position-update}.ts` | `src/utils/account.ts`, `src/utils/vault-position.ts` |
| `src/utils/{deposit,withdrawal,transfer}.ts` | `src/utils/{deposit,withdrawal,transfer}.ts` |
| `src/utils/token.ts`, `token-fees.ts`, `healthCheck.ts` | `src/utils/token.ts`, `token-fees.ts`, `account.ts` |
| `src/utils/oracle/usdc-oracle.ts` (+ curve/yShare) | `src/utils/oracle.ts` (yearn-lens path only — see deviations) |
| `src/utils/transaction.ts`, `commons.ts`, `constants.ts` | `src/utils/transaction.ts`, `commons.ts`, `constants.ts` |
| `Contract.bind().try_*()` (graph-ts) | `src/effects/calls.ts` (+ `contracts.ts`) |

## registry → template approach

Subgraph `templates:` map to HyperIndex `contractRegister`:

- **Vault template** is registered in `contractRegister` handlers for
  `Registry`/`RegistryV3` `NewVault`/`NewVaultV2`/`NewVaultV3`,
  `NewExperimentalVault`, and `NewRelease` (the source's `vaultLibrary.release`
  also calls `VaultTemplate.create`). The vault address comes from the event
  params.
- **Strategy template** is registered in `contractRegister` handlers for
  `Vault` `StrategyAdded(V1/V2)`, `StrategyMigrated` (new strategy), and
  `Strategy` `Cloned`. (In the source `StrategyTemplate.create` lives inside
  `strategy.createAndGet` / `strategyCloned`; HyperIndex only allows dynamic
  registration inside `contractRegister`, so it is moved there. The entity
  creation still happens in the onEvent path.)

## eth_call → Effect table

All `Contract.bind(addr).try_foo()` calls go through one cached `ethCall` Effect
(`src/effects/calls.ts`) carrying raw calldata; typed wrappers live in
`src/effects/contracts.ts`. `try_` reverts resolve to `null` so handler logic
mirrors the `reverted` branches. Mock env var: **`YEARN_CALL_MOCK`**. RPC env:
**`RPC_URL_1`**.

Pinning: immutable metadata unpinned; state-dependent reads pinned to the event
block.

| Subgraph call | Wrapper | Pinned? |
| --- | --- | --- |
| `Vault.token()` | `vaultToken` | no (immutable) |
| `Vault.decimals()` | `vaultDecimals` | no |
| `Vault.apiVersion()` / `activation()` | `vaultApiVersion` / `vaultActivation` | no |
| `Vault.managementFee()` / `performanceFee()` | `vaultManagementFee` / `vaultPerformanceFee` | yes |
| `Vault.try_rewards/management/guardian/governance()` | `vaultRewards/...` | yes |
| `Vault.try_depositLimit()` / `try_availableDepositLimit()` | `vaultDepositLimit` / `vaultAvailableDepositLimit` | yes |
| `Vault.try_emergencyShutdown()` | `vaultEmergencyShutdown` | yes |
| `Vault.try_totalAssets()` / `try_pricePerShare()` / `pricePerShare()` | `vaultTotalAssets` / `vaultPricePerShare` | yes |
| `Vault.totalSupply()` / `balanceOf(a)` | `vaultTotalSupply` / `vaultBalanceOf` | yes |
| `ERC20.try_decimals/name/symbol()` | `erc20Decimals/Name/Symbol` | no |
| `Strategy.try_name/apiVersion()` | `strategyName/ApiVersion` | no |
| `Strategy.try_keeper/strategist/rewards/emergencyExit/healthCheck/doHealthCheck()` | `strategy*` | yes |
| `Strategy.delegatedAssets()` / `vault()` | `strategyDelegatedAssets` / `strategyVault` | yes / no |
| `Oracle.try_getPriceUsdcRecommended(t)` | `oracleGetPriceUsdcRecommended` | yes |
| `Oracle.try_getNormalizedValueUsdc(t,a)` | `oracleGetNormalizedValueUsdc` | yes |

## Entity ids (byte-for-byte)

- `Vault` / `Strategy` / `Token` / `Account` / `Registry` / `HealthCheck`: lowercase address.
- `Transaction`: `txHash-logIndex`.
- `VaultUpdate`: `vault-txId-txIndex` = `vault-(txHash-logIndex)-transactionIndex`.
- `Deposit` / `Withdrawal`: `account-txId-txIndex`.
- `Transfer`: `from-to-txId`.
- `AccountVaultPosition`: `account-vault`.
- `AccountVaultPositionUpdate`: `account-vault-order`.
- `StrategyReport`: `txHash-logIndex` (subgraph `buildIdFromEvent`).
- `StrategyReportResult`: `txHash-logIndex` (subgraph `buildIdFromTransaction`, where `transaction.logIndex` was stored on the Transaction).
- `Harvest`: `strategy-txHash-txIndex`.
- `StrategyMigration`: `oldStrategy-newStrategy`.
- `VaultDayData`: `vault-dayIndex` where `dayIndex = timestamp(ms) / 86400000`.
- `TokenFee`: vault address.

All hex lowercased.

## Graph-node semantics / quirks preserved (for parity)

- **Timestamps in milliseconds.** `Transaction.timestamp` = `block.timestamp * 1000`
  (`getTimestampInMillis`). `StrategyReport.timestamp` likewise.
  `Strategy.timestamp` = `getTimeInMillis(transaction.timestamp)` =
  `block.timestamp * 1_000_000` — a *double* ms conversion in the source; kept
  verbatim.
- **`VaultDayData` day bucket** uses `timestamp(ms) / 86400000`, i.e. one bucket
  per 86_400_000 *milliseconds* (≈ 1000 days), not per day — a source quirk; kept.
- BigInt truncating division throughout (e.g. `balancePosition = totalAssets *
  pricePerShare / 10**decimals`, `fromSharesToAmount`).
- `StrategyReportResult.apr/durationPr/duration` are `BigDecimal` computed with
  bignumber.js (envio's `BigDecimal`), mirroring graph-node BigDecimal.
- `Vault.classification` defaults to `Experimental` at creation, then is set by
  the registry path (`Endorsed` / `Experimental` / `Released`).
- Fee recognition: every share `Transfer` records unrecognized treasury/strategy
  fees; `StrategyReported` recognizes them into `totalFees` and subtracts from
  `returnsGenerated`. Order preserved.

## Deviations

1. **Call handlers dropped.** The subgraph had `callHandlers` for
   `deposit()/deposit(uint)/deposit(uint,address)` and the `withdraw(...)`
   overloads (and `setHealthCheck`/`setDoHealthCheck` on strategies). HyperIndex
   has no call handlers. These are **redundant** with the `Deposit`/`Withdraw`
   *events* (both invoke the same `vaultLibrary.deposit/withdraw`) and the
   `SetHealthCheck`/`SetDoHealthCheck` *events* — all of which are ported. The
   only loss is for pre-event vault versions that emitted no Deposit/Withdraw
   event; on mainnet V2 the events exist. `callFilters.ts` skip-lists therefore
   have no analogue and are not ported.
2. **Oracle fallbacks.** `usdc-oracle.ts` tried, in order, the yearn-lens
   Oracle → a PPS oracle → SushiSwap calculations → Curve calculations. Only the
   **yearn-lens Oracle** path (`getNormalizedValueUsdc` /
   `getPriceUsdcRecommended`) is ported; the PPS/SushiSwap/Curve fallbacks
   resolve to `0`, matching the subgraph whenever the oracle reverts (and before
   the oracle deployment block, where the subgraph returns 0 anyway). This
   affects only `Transfer.tokenAmountUsdc`, `VaultDayData.tokenPriceUSDC`, and
   the `*USDC` day-return fields for the rare tokens the lens oracle does not
   price. Documented for `tools/compare` tolerance.
3. **`logIndex` vs `transactionLogIndex`.** The subgraph never used
   `event.transactionLogIndex`; it used `event.logIndex` for the Transaction id
   and `event.transaction.index` (the transaction's position in the block) for
   the `-txIndex` id suffix. Both are available in envio (`event.logIndex`,
   `event.transaction.transactionIndex`) and used identically.
4. **Hard (non-`try_`) calls.** Several reads were hard calls in the source
   (`token()`, `decimals()`, `managementFee()`, `performanceFee()`,
   `totalSupply()`, `balanceOf()`, `pricePerShare()`, `apiVersion()`,
   `activation()`, `delegatedAssets()`, `vault()`). graph-node would abort the
   handler on revert; here they are nullable wrappers with a documented fallback
   (e.g. `decimals → 18`, fees → 0, token → zero address) so a single bad read
   does not crash the batch. For valid mainnet vaults these never revert, so
   parity is unaffected.
5. **Entity/contract names PascalCase.** Schema entities were already PascalCase.
   The schema's `Strategy.address`/`healthCheck` etc. `Bytes` fields → `String`
   (lowercase hex). The schema's `withdrawalQueue`/`strategyIds` were
   `[Strategy!]!` arrays-of-ids in the source (stored as string id arrays); kept
   as `[String!]!` to match the stored representation exactly.
6. **`isTemplateListening`.** The source sets this when `VaultTemplate.create`
   is called. Here template registration happens in `contractRegister`, but the
   field is still driven by the same `createTemplate` flag for parity.

## Bounded run instructions

- `RPC_URL_1` must point at a mainnet archive RPC (state reads are block-pinned).
- Set `end_block` in `config.yaml` (commented; suggested `11440000` =
  earliest registry start `11390000` + 50k) for a bounded validation run.
- `rollback_on_reorg: false` for deterministic bounded runs.
- Effects are cached (`cache: true`) so re-runs are fast and deterministic.

## Verification

- `pnpm install` ✅
- `pnpm codegen` ✅
- `pnpm build` (`tsc --noEmit`) ✅ zero errors
- `pnpm test` ✅ — 3 offline tests (`createTestIndexer` + `simulate` + `YEARN_CALL_MOCK`):
  - `test/registry.test.ts`: Registry `NewVault` → `Vault` entity (exact field
    values) + `Registry` + `Token` + `Transaction`; Vault template registration;
    `NewExperimentalVault` → `Experimental` classification.
  - `test/deposit-harvest.test.ts`: `NewVault` → `StrategyAddedV2` → `Deposit`
    → `StrategyReported` flow, asserting exact `Vault` / `Strategy` /
    `VaultUpdate` / `StrategyReport` / `AccountVaultPosition` / `VaultDayData`
    balances, `pricePerShare`, `returnsGenerated`, and `latestUpdate` linkage.

### Test coverage notes

The registry→template chain cannot be fully exercised offline (dynamic
registration would require the test runner to re-feed events for newly
registered addresses), so the deposit/harvest test **seeds the vault via a real
`Registry.NewVault` event** and then feeds Vault/Strategy events directly to the
(statically-known) vault address. Entity creation, accounting math, snapshot
ids, and eth_call branches are all covered by the asserted values.

## Known gaps

- Oracle fallbacks (deviation 2): `*USDC` fields may differ for tokens not priced
  by the yearn-lens oracle.
- `validation.json` subgraph endpoint is a TODO: the original mainnet deployment
  was on the deprecated hosted service (`rareweasel/yearn-vaults-v2-subgraph-mainnet`);
  no decentralized-network gateway id was found in the repo. Provide one (or a
  self-hosted graph-node deployment of `config/mainnet.json`) to run `tools/compare`.
- Call-handler-only flows (deviation 1) are not reproduced; immaterial for
  mainnet V2 which emits Deposit/Withdraw events.
