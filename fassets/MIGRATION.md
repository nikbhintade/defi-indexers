# FAssets (Flare mainnet) → HyperIndex migration (core EVM slice)

- **Source:** [flare-foundation/fasset-indexer](https://github.com/flare-foundation/fasset-indexer),
  commit `ff9370f02160a7df937115f193b402a663788ff1` (2026-06-02), cloned at
  `/tmp/sources/fasset-indexer`. Ported package: `packages/fasset-indexer-core`.
- **Target:** Envio HyperIndex `3.1.2`, TypeScript, **Flare mainnet (EVM chain id 14)**.
- **Start block:** `22000000` (approximate FAssets-FXRP mainnet launch). The
  source has no hard-coded start block — it discovers the AssetManagerController
  creation block at runtime via the Flare block-explorer API (`run/integrity.ts`),
  which is unavailable offline. **TODO:** replace with the exact
  AssetManagerController (`0x097B93eE…`) deployment block before a production run.

The source is a multi-package custom **MikroORM** indexer (Postgres/SQLite) that
indexes the FAssets EVM events **and** runs separate monitors for the underlying
non-EVM chains (Bitcoin / Dogecoin / XRP), plus a NestJS query API. HyperIndex is
an event-driven EVM indexer, so this port reproduces the **EVM event-indexing
core** (`fasset-indexer-core`) only. This is a deliberate "core EVM slice", like
the EigenLayer sidecar port in this repo.

---

## IN-SCOPE (faithfully ported)

The per-event records and event-derived state maintained by
`indexer/eventlib/store-logic/event-storer.ts` + `state-updater.ts` for the
in-scope FAsset system contracts:

| Domain | HyperIndex entities | Source (MikroORM entity / handler) |
|---|---|---|
| Agent identity/state | `AgentManager`, `AgentOwner`, `AgentVault`, `AgentVaultSettings` | `entities/agent.ts`, `entities/state/agent.ts`, `onAgentVaultCreated` + `StateUpdater` |
| Agent lifecycle events | `AgentVaultCreated`, `AgentVaultDestroyed`, `AgentDestroyAnnounced`, `AgentSettingChanged`, `SelfClose`, `VaultCollateralWithdrawalAnnounced`, `PoolTokenRedemptionAnnounced` | `entities/events/agent.ts` |
| Underlying tracking | `UnderlyingWithdrawalAnnounced`/`Confirmed`/`Cancelled`, `UnderlyingBalanceToppedUp`/`Changed`, `DustChanged`, `ConfirmedClosedMintingPayment` | `entities/events/agent.ts` |
| Settings / collateral types | `AssetManagerSettings`, `ContractChanged`, `CollateralTypeAdded`, `CollateralRatiosChanged` | `entities/state/settings.ts`, `entities/events/{system,token}.ts` |
| Minting | `CollateralReserved`, `MintingExecuted`, `MintingPaymentDefault`, `CollateralReservationDeleted`, `SelfMint` | `entities/events/minting.ts` |
| Direct minting | `DirectMintingExecuted`, `DirectMintingExecutedToSmartAccount`, `DirectMintingPaymentTooSmallForFee`, `DirectMintingDelayed`, `LargeDirectMintingDelayed`, `DirectMintingsUnblocked` | `entities/events/direct-minting.ts` |
| Redemption | `RedemptionRequested` (plain + tagged via `kind`), `RedemptionPerformed`, `RedemptionDefault`, `RedemptionRejected`, `RedemptionPaymentBlocked`, `RedemptionPaymentFailed`, `RedemptionRequestIncomplete`, `RedemptionAmountIncomplete`, `RedemptionPoolFeeMinted`, `RedeemedInCollateral` | `entities/events/redemption.ts` |
| Redemption tickets | `RedemptionTicketCreated`/`Updated`/`Deleted`, `RedemptionTicket` (state) | `entities/events/redemption-ticket.ts` |
| Liquidation | `LiquidationStarted`, `FullLiquidationStarted`, `LiquidationPerformed`, `LiquidationEnded` | `entities/events/liquidation.ts` |
| Challenges | `IllegalPaymentConfirmed`, `DuplicatePaymentConfirmed`, `UnderlyingBalanceTooLow` | `entities/events/challenge.ts` |
| Agent ping / system | `AgentPing`, `AgentPingResponse`, `CurrentUnderlyingBlockUpdated` | `entities/events/{agent,system}.ts` |
| Core vault (AssetManager side) | `TransferToCoreVaultStarted`/`Successful`/`Defaulted`, `ReturnFromCoreVaultRequested`/`Confirmed`/`Cancelled`, `CoreVaultRedemptionRequested`, `CoreVaultFundsAdded` | `entities/events/core-vault.ts` |
| Core vault manager | `CoreVaultManagerSettings` (state) + `CoreVaultManagerSettingsUpdated`, `CoreVaultManagerCustodianAddressUpdated`, `CoreVaultManagerPaymentConfirmed`, `CoreVaultManagerPaymentInstructions`, `CoreVaultManagerEscrowInstructions`, `CoreVaultManagerTransferRequested`/`Canceled`, `CoreVaultManagerNotAllEscrowsProcessed`, `EscrowExpired`, `EscrowFinished` | `entities/events/core-vault-manager.ts` |
| Emergency pause | `EmergencyPauseTriggered`, `EmergencyPauseCancelled` | `entities/events/emergency-pause.ts` |
| Collateral pool (post-Flare CP* set) | `CPClaimedReward`, `CPEntered`, `CPExited`, `CPFeesWithdrawn`, `CPFeeDebtChanged`, `CPFeeDebtPaid`, `CPPaidOut`, `CPSelfCloseExited`, `CollateralPoolMap` (pool→fasset/vault lookup) | `entities/events/collateral-pool-v2.ts` |
| Price publisher | `PricesPublished` | `entities/events/price.ts` |

All addresses/hex stored **lowercase**. `fasset` is the source `FAssetType`
enum ordinal (FXRP=0, FBTC=1, FDOGE=2 …) stored as `Int`.

### Contracts indexed (Flare mainnet, from `chain/flare.json`)

| Contract | Address | In config |
|---|---|---|
| AssetManager_FXRP | `0x2a3Fe068cD92178554cabcf7c95ADf49B4B0B6A8` | yes (static) |
| CoreVaultManager_FXRP | `0x6c8d96dEfE4cbEE05FA969Fc0Ac436d94Fc21784` | yes (static) |
| PriceReader (FtsoV2PriceStore) | `0x3eF12dF4f91D6168b353B0Ae8195Cc8642D8a411` | yes (static) |
| CollateralPool (per agent) | — | yes (dynamic template) |
| AgentOwnerRegistry | `0xD2593336C6C4Bfd261FEEf0A23F113cD7d018fa2` | eth_call only (not indexed) |
| AssetManagerController | `0x097B93eEBe9b76f2611e1E7D9665a9d7Ff5280B3` | not indexed (see registration) |

## Registry → AssetManager dynamic registration (and why it is partly static)

The task brief asked for `AssetManagerController` → `AssetManager` dynamic
registration. **The source does NOT do this.** It resolves the set of
AssetManagers via `AssetManagerController.getAssetManagers()` — a **view
function with no event** — and persists their addresses in a static
`chain/<network>.json`. On Flare mainnet today there is exactly one FAsset live
(**FXRP**), so `AssetManager_FXRP` and `CoreVaultManager_FXRP` are the only
manager/vault addresses, and they are pinned statically in `config.yaml`
(matching the source's `chain/flare.json`).

`contractRegister` cannot perform eth_calls, so it cannot read
`getAssetManagers()` to register managers dynamically. The honest, faithful
mapping is therefore:

- **AssetManager / CoreVaultManager** → static addresses (one per FAsset; extend
  `config.yaml` + `ASSET_MANAGER_TO_FASSET`/`CORE_VAULT_MANAGER_TO_FASSET` in
  `src/constants.ts` when FBTC/FDOGE go live).
- **CollateralPool** → genuinely dynamic: registered via
  `indexer.contractRegister` on `AssetManager.AgentVaultCreated`, whose
  `creationData.collateralPool` carries the new pool address (fully
  event-derived, no state read). The matching `CollateralPoolMap` row
  (pool → fasset + agentVault) is written in the `onEvent` handler so pool
  handlers can resolve their FAsset (the source looks the agent vault up by its
  `collateralPool` address; `CollateralPoolMap` is the HyperIndex equivalent of
  that `@index`ed reverse lookup).

`assetManagerFAsset(srcAddress)` maps the emitting AssetManager address to its
FAssetType, defaulting to FXRP (the only mainnet deployment).

## MikroORM-entity → schema id mapping

The source keys every event row on an **auto-increment `EvmLog` PK**
(`OneToOne`), whose natural unique key is `(block.index, log.index)`. HyperIndex
needs string ids, so:

- **Per-event records** → `id = ${chainId}_${blockNumber}_${logIndex}`
  (lowercase), the faithful chain-scoped equivalent of `(block, logIndex)`.
  envio exposes `event.logIndex` (NOT `transactionLogIndex`) — used throughout.
- **State / lookup entities** keep the source's natural keys so the storer's
  `findOneOrFail({ fasset, <naturalId> })` lookups stay id-addressable:
  - `AgentVault`, `AgentVaultSettings` → lowercase agent vault address
  - `AgentManager` → lowercase management address; `AgentOwner` → lowercase work address
  - `AssetManagerSettings`, `CoreVaultManagerSettings` → fasset ordinal (string)
  - `CollateralReserved` → `${fasset}_${collateralReservationId}`
  - `RedemptionRequested` → `${fasset}_${requestId}`
  - `UnderlyingWithdrawalAnnounced` → `${fasset}_${announcementId}`
  - `RedemptionTicketCreated`/`RedemptionTicket` → `${fasset}_${redemptionTicketId}`
  - `TransferToCoreVaultStarted` → `${fasset}_${transferRedemptionRequestId}`
  - `ReturnFromCoreVaultRequested` → `${fasset}_${requestId}`
  - `CollateralTypeAdded` → `${fasset}_${token}`
  - `CoreVaultManagerPaymentConfirmed` → `${fasset}_${transactionId}`
  - `CollateralPoolMap` → lowercase pool address

The source's single-table-inheritance `RedemptionRequested`/`RedemptionWithTagRequested`
collapses to one `RedemptionRequested` entity with a `kind` discriminator
(`"plain"` | `"tagged"`) and a nullable `destinationTag`, mirroring the source
`@Entity({ discriminatorColumn: 'kind' })`.

Resolution enums (`CollateralReservationResolution`, `RedemptionResolution`,
`TransferToCoreVaultResolution`, `ReturnFromCoreVaultResolution`,
`UnderlyingWithdrawalResolution`) are stored as `Int` ordinals matching
`src/shared.ts`. The resolution **state machine is preserved**: e.g.
`CollateralReserved.resolution` starts at `NONE` and is flipped to
`EXECUTED`/`DEFAULTED`/`DELETED` by the corresponding follow-up event (asserted
in the tests).

## eth_call → Effect (`src/effects.ts`, mock env `FASSETS_CALL_MOCK`)

`StateUpdater.onAgentVaultCreated` reads chain state that is not in the event
payload. These are ported as a single cached `ethCall` Effect (viem,
`RPC_URL_14`), with `tryCall()` mirroring try_ semantics (revert/empty → `null`):

| Read | Contract | Pin | Falls back to |
|---|---|---|---|
| `getAgentName` / `getAgentDescription` / `getAgentIconUrl` | AgentOwnerRegistry | unpinned (metadata) | `undefined` |
| `getWorkAddress(manager)` | AgentOwnerRegistry | unpinned | the manager address (so an AgentOwner row always exists) |
| `symbol()` | collateral pool token (ERC20) | unpinned (metadata) | `undefined` |

These are the only eth_calls. Everything else is event-derived. Offline tests
install a declarative mock via `setCallMock()` (JSON-serialized into
`FASSETS_CALL_MOCK`, copied into the envio test worker's env).

## DEFERRED (OUT OF SCOPE — documented, not ported)

- **Underlying-chain monitors** `packages/fasset-indexer-{btc,doge,xrp}` — they
  watch non-EVM Bitcoin/Dogecoin/XRP chains for payment confirmations; entirely
  outside HyperIndex's EVM scope.
- **Query API** `packages/fasset-indexer-api` (NestJS) — read/aggregation layer;
  HyperIndex auto-exposes a GraphQL API over the schema instead.
- **`AgentVaultInfo`** — the per-agent live snapshot (status, collateral ratios,
  minted/reserved/redeeming UBA, liquidation factors, etc.) is rebuilt every
  watchdog cycle from `AssetManager.getAgentInfo()` (dozens of fields, fully
  state-read-driven, mutated by ~every agent event). It is **not** an event
  record and would require a large block-pinned multicall on every relevant
  event. Deferred. Consequently `AvailableAgentExited` / `AgentAvailable`
  handlers (which only flip `AgentVaultInfo.publiclyAvailable`) are **no-ops** —
  matching the source, which writes no event row for them either.
- **`PricePublished` per-symbol rows** — the source's `PricesPublished` event
  only carries `votingRoundId`; the individual `(symbol, price, decimals)` rows
  are populated by a separate FTSO state read (`PricePublished` entity). Only
  the `PricesPublished` event record is ported; the price-read rows are deferred.
- **ERC20 `Transfer` + `TokenBalance`** — the source tracks FAsset/collateral/
  WNat token balances by indexing ERC20 `Transfer` on every relevant token. This
  requires registering each token contract; on mainnet the FAsset token (FXRP)
  and collateral/pool tokens are dynamic. The `TokenBalance` schema entity and an
  ERC20 ABI are shipped, but no ERC20 `Transfer` handler is wired (no token
  contract is declared in `config.yaml`). Deferred — re-enable by adding the
  token contracts + a `Transfer` handler doing the signed-balance accumulation
  from `onERC20Transfer`.
- **Smart accounts** (`MasterAccountController` / `IPersonalAccount`),
  **OFT adapter** (`FAssetOFTAdapter`), **MintingTagManager** — peripheral
  sub-storers (`store-logic/{smart-accounts,oft-adapter,minting-tag-manager}.ts`).
  Deferred; their contracts are not declared.
- **Pre-upgrade CollateralPool event set** (`Entered`/`Exited`/`PaidOut`/
  `ClaimedReward`) and the `collateral-pool-migrations` that rewrite old rows
  into the new `CP*` shape. Only the current `CP*` events are indexed (the
  validation window starts well after the Flare upgrade).
- **Old AssetManager ABI variants** (`IAssetManager__initial`) and the
  `asset-manager-migration` topic-rewrites for the pre-upgrade
  `CollateralTypeAdded` / `AgentVaultCreated` / `EmergencyPauseTriggered`
  signatures. Only the `__latest` signatures are declared.

## Deviations / quirks preserved

- **`AgentSettingChanged` "handshakeType" is a silent no-op** and unknown
  settings are ignored (the source `throw`s on unknown names inside a DB
  transaction that is rolled back; here the handler ignores them to stay
  idempotent under preloading). Documented divergence.
- **`SettingChanged` only updates state for `lotSizeAMG`** — exactly the
  source's single-case switch. Other setting names are not persisted (the source
  keeps only `lotSizeAmg` on `AssetManagerSettings`). No per-event
  `SettingChanged` record exists in the source, so none is created here.
- **No EvmAddress / EvmBlock / EvmTransaction / EvmLog tables.** The source
  normalizes addresses/blocks/txs/logs into their own tables (referenced by FK).
  HyperIndex inlines them as lowercase string fields + `blockNumber`/`timestamp`/
  `logIndex` columns on each record — values are identical, the normalization is
  dropped.
- **`AgentOwner` keying.** The source has `AgentOwner` as an autoincrement row
  (one per manager) joined to a work `EvmAddress`. Here `AgentOwner.id` is the
  lowercase work address (or the manager address when `getWorkAddress` reverts).
- **`int256` underlying-balance / spent values** (`UnderlyingBalanceChanged`,
  `RedemptionPerformed.spentUnderlyingUBA`, etc.) are stored as `BigInt`
  (HyperIndex BigInt is signed), matching the source `uint256`/`int256` columns.

## Validation

- Range: `22000000` → `22050000` (start + 50k) — see `validation.json`.
- **Cross-validation target is the FAssets indexer's own API**
  (`fasset-indexer-api`), not a subgraph. No public hosted endpoint is documented
  in the source README, so `subgraph.url` is `TODO_FASSET_INDEXER_API_BASE` and
  `authEnv` is `null`. To validate, run `fasset-indexer-core` (Flare mainnet) +
  `fasset-indexer-api` and point the URL at its REST base. Note many API
  endpoints serve eth_call-derived state (AgentVaultInfo, prices, aggregates)
  that this port intentionally does not reproduce.

### Bounded run
```bash
cd fassets
pnpm install
pnpm codegen
# set RPC_URL_14 (needed for the AgentVaultCreated eth_calls / effects),
# uncomment `end_block: 22050000` in config.yaml, then:
pnpm dev   # requires HyperSync/RPC — not available in the offline sandbox
```

## Verification (offline, all pass)
```bash
pnpm install   # envio 3.1.2
pnpm codegen   # generates .envio types
pnpm build     # tsc --noEmit, 0 errors
pnpm test      # vitest, 3 offline tests (agent-created flow; minting + redemption lifecycle)
```

## Known gaps
- All DEFERRED items above (underlying-chain monitors, API, AgentVaultInfo,
  per-symbol prices, ERC20 balances, smart accounts / OFT / minting-tag-manager,
  pre-upgrade event sets, old ABI variants).
- Start block is approximate (see top). FBTC/FDOGE AssetManagers are not yet
  deployed on mainnet; add their addresses + a constants-map entry when live.
- `AssetManagerController`-driven dynamic AssetManager registration is not
  possible via `contractRegister` (it needs an eth_call); managers are pinned
  statically, matching the source's static `chain/flare.json`.
