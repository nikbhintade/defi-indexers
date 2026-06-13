# Migration: Centrifuge api-v3 (Ponder) → Envio HyperIndex

Powers **Anemoy Capital** data. This is a **scoped** port: Ethereum mainnet
(chainId 1, Centrifuge id `1`) only, core pool / share-class / vault / investor
slice of the larger multichain hub-and-spoke RWA platform.

## Source

- **Indexer (Ponder):** `centrifuge/api-v3` @ `6535ca9f6428a59fc9ea29efd8ada91c3f9fa1e0`
  (`/tmp/sources/api-v3`). Event signatures were taken from the protocol
  interfaces in `centrifuge/protocol-v3` @ `a1aeae93c94e8a3dbe078f0fefbe9a1a340ffde1`
  (`src/core/**`, `src/vaults/**`, `src/misc/interfaces/IERC7540.sol`,
  `IERC7575.sol`) and addresses from `protocol-v3/env/ethereum.json`.
- **Target:** envio `3.1.2`, TypeScript, Node 22, pnpm.

## Ponder → Envio mapping notes

- Ponder `ponder.on("Contract:Event", ...)` → `indexer.onEvent({contract, event}, ...)`.
- Ponder `factory({abi, eventName, eventParameter})` contract sources (vaults,
  token instances) → address-less contract templates + `indexer.contractRegister`
  calling `context.chain.<Contract>.add(addr)`. Registered: **Vault** (on
  `Spoke:DeployVault`), **TokenInstance** (on `Spoke:AddShareClass`).
- The Ponder code is built on a generic `Service`/Drizzle base whose entity
  **identity is the ordered tuple of composite-PK columns** (see `ponder.schema.ts`).
  HyperIndex uses single string ids, so every composite key is collapsed into a
  `-`-joined string **in the same column order** Ponder declares. All id
  construction lives in `src/helpers/ids.ts`. Notable asymmetries preserved:
  - `InvestOrder`/`RedeemOrder`/`PendingInvestOrder`/`PendingRedeemOrder` ids are
    `tokenId-assetId-account[-index]` — they do **not** include poolId/centrifugeId.
  - `VaultInvestOrder`/`VaultRedeemOrder` use `tokenId-centrifugeId-assetId-accountAddress`.
  - `Holding`/`HoldingEscrow` identity is just `tokenId-assetId`.
  - `InvestorTransaction` id is `poolId-tokenId-account-type-createdAtTxHash`.
- Ponder `context.db.insert/.update/.find` → `context.Entity.set/.get`. `getOrInit`
  / `upsert` → read-then-set preserving `createdAt*` on conflict.
  `saveOrClear` (delete when amounts hit `0n`) → `context.Entity.deleteUnsafe(id)`.
- Multi-field Ponder queries (e.g. `InvestOrderService.query({tokenId, assetId,
  index, approvedAt_not:null, issuedAt:null})`) → HyperIndex `getWhere` on the
  single most-selective `@index` field (`tokenId`) plus in-memory filtering.
  Equivalent result; documented here because HyperIndex `getWhere` is single-field.
- Audit fields: Ponder stores `createdAt/updatedAt` as `new Date(ts*1000)`,
  `*Block` as `Number(block)`, `*TxHash` as the tx hash. Mirrored in
  `src/helpers/common.ts` (`createdFields`/`updatedFields`/`phaseFields`).
  `Timestamp` GraphQL scalar maps to `Date` in TS.
- Type mapping: `t.hex()`→`String` (lowercase), `t.bigint()`→`BigInt`,
  `t.integer()`→`Int`, `t.boolean()`→`Boolean`, `t.text()`→`String`,
  `t.timestamp()`→`Timestamp`, `onchainEnum`→GraphQL enum.
- Versioning: the Ponder `multiMapper` registers the same handler for v3 and v3.1
  ABIs. This port targets **v3.1** mainnet contracts only, so each event is wired
  once with its v3.1 signature.

## IN-SCOPE contracts (chainId 1)

| Contract | Address | Start block | Events handled |
|---|---|---|---|
| HubRegistry | 0x19f46D8130e610C6C0f0116EA40Fb781dEFaDE93 | 24319329 | NewPool, NewAsset, UpdateManager, UpdateCurrency, SetMetadata |
| Hub | 0xA4A7Bb3831958463b3FE3E27A6a160F764341953 | 24319335 | NotifyPool, UpdateBalanceSheetManager |
| ShareClassManager | 0xaFFC269c8fe18EE9C7DDb22301AC2c2507d69BEf | 24319333 | AddShareClass, UpdateMetadata, UpdatePricePoolPerShare |
| Holdings | 0x3f0c8D8d2637881c3f6d8531F51a47c2094C918d | 24319332 | Initialize, Increase, Decrease, Update, UpdateValuation, UpdateIsLiability |
| BatchRequestManager | 0xc52Bd1Bdfa0135147D3F01a0B6D6cd0A831dFe77 | 24319374 | UpdateDepositRequest, UpdateRedeemRequest, ApproveDeposits, ApproveRedeems, IssueShares, RevokeShares, ClaimDeposit, ClaimRedeem |
| Spoke | 0xEC3582fcDc34078a4B7a8c75a5a3AE46f48525aB | 24319323 | RegisterAsset, AddShareClass, DeployVault, LinkVault, UnlinkVault, UpdateSharePrice, UpdateAssetPrice, UpdateMaxAssetPriceAge, InitiateTransferShares |
| BalanceSheet | 0x12a110cE5f0FC871cC72Bc7ECaF35cf39DD0f43e | 24319325 | NoteDeposit, Withdraw, UpdateManager |
| PoolEscrowFactory | 0x5187A505c485E22f0b8a5FBdF69eF1c29C478CE3 | 24319328 | DeployPoolEscrow |
| Vault (template) | factory-deployed via Spoke:DeployVault | — | DepositRequest, RedeemRequest, DepositClaimable, RedeemClaimable, Deposit, Withdraw |
| TokenInstance (template) | factory-deployed via Spoke:AddShareClass | — | Transfer |

`start_block` in config.yaml is the minimum in-scope block (24319323).
A commented `end_block` (24369323 = start + 50000) is provided for bounded runs.

### IN-SCOPE entities

Blockchain (schema only), Pool, PoolSpokeBlockchain, Token, Vault,
InvestorTransaction, VaultInvestOrder, VaultRedeemOrder, PendingInvestOrder,
PendingRedeemOrder, InvestOrder, RedeemOrder, EpochInvestOrder, EpochRedeemOrder,
EpochOutstandingInvest, EpochOutstandingRedeem, AssetRegistration, Asset,
TokenInstance, Holding, HoldingAccount, Escrow, HoldingEscrow, PoolManager,
Account, and the in-scope snapshots: PoolSnapshot, TokenSnapshot,
TokenInstanceSnapshot, HoldingSnapshot, HoldingEscrowSnapshot.

## DEFERRED (intentionally NOT ported — documented per task scope)

These subsystems were dropped. The corresponding handlers, services, entities and
their columns are absent; validating them against the public API will diff.

- **AsyncRequestManager** contract (registered in Ponder config but has **no**
  handler in api-v3; its events feed cross-chain plumbing). Dropped entirely.
- **Crosschain message/adapter plumbing:** CrosschainPayload, CrosschainMessage,
  Adapter, AdapterWiring, PoolAdapter, AdapterParticipation; `gatewayHandlers`,
  `multiAdapterHandlers`, `CrosschainMessageService`, `CrosschainPayloadService`,
  `PoolAdapterService`. The hub events that only set cross-chain "in-progress"
  flags on destination-chain entities (`NotifyAssetPrice`, `NotifySharePrice`,
  `UpdateRestriction`, `UpdateVault`, `UpdateContract`) are not handled; we keep
  the hub events that create local rows (`NotifyPool`, `UpdateBalanceSheetManager`).
- **Basin:** BasinSwap, BasinRedeemRequest, BasinReconciliationWarning,
  `basinHandlers`, `basinQuote`, basin reconciliation links. The basin hooks in
  the vault and batchRequestManager handlers are removed (no-ops).
- **On/off-ramp:** OnOffRampManager, OfframpRelayer, OnRampAsset, OffRampAddress.
- **Other peripheral:** MerkleProofManager, Policy, SmartContract,
  SmartContractWard, WhitelistedInvestor, TokenInstancePosition,
  InvestorPositionCheckpoint, Deployment, the `tokenYields` snapshot columns
  (TokenSnapshot keeps only the base price/issuance columns), the glacis API and
  the `src/api/` HTTP layer.

## eth_call → Effect table

Reads go through `src/effects/calls.ts` (`ethCall` Effect, `cache: true`,
`try_`-semantics → `null`). Mock with `ANEMOY_CALL_MOCK` (see tests).

| Source read | Effect wrapper | Block pin | Notes |
|---|---|---|---|
| ERC20 `totalSupply()` on share token (Spoke:AddShareClass) | `erc20TotalSupply` | event block | state read; null → treated as `0n` |
| ERC20 `balanceOf(account)` (TokenInstancePosition init) | `erc20BalanceOf` | event block | DEFERRED path (positions out of scope); wrapper kept for completeness |

Deferred reads not ported: vault `baseManager()`/`manager()` on DeployVault (the
`Vault.manager` field is left `null`, matching `try_`-null; not load-bearing for
the in-scope investor flows). IPFS metadata fetch in `HubRegistry:SetMetadata`
(IPFS unreachable; the raw/`ipfs://` string is stored, pool `name` left as-is).

## Deviations / known gaps

1. **`HoldingService.increase/decrease/update` operator-precedence bug replicated.**
   The source writes `field ?? 0n + amount` (`??` binds looser than `+`), so when
   `assetQuantity`/`totalValue` are already non-null (they default to `0n`), the
   amount fields never accumulate — Holdings.Increase/Decrease/Update are effectively
   no-ops on those amounts. This port mirrors that exactly so the data matches the
   production api-v3 output. `HoldingEscrowService.increase/decreaseAssetAmount`
   are correctly parenthesized in the source and DO accumulate (BalanceSheet path).
2. **Single-field `getWhere` + in-memory filter** replaces multi-field SQL queries
   (see mapping notes). Results are equivalent for the in-scope data.
3. **Multichain pools won't fully populate** from mainnet-only indexing: pools whose
   spoke side lives on another chain will have missing `PoolSpokeBlockchain`,
   `TokenInstance`, `Vault`, `Holding` rows. This is expected for a chain-1 slice.
4. **Cross-chain "in-progress" flags** (`crosschainInProgress` columns) are only
   ever cleared/local here; the hub→spoke notification lifecycle that sets them
   mid-flight is deferred.
5. **Token-yield columns** on TokenSnapshot are omitted (deferred subsystem).
6. **No live indexing performed** — network access in the porting sandbox is
   limited to github + npm. Verification is offline only.

## Bounded validation run

1. Uncomment `end_block: 24369323` in `config.yaml`.
2. Point `RPC_URL_1` at an Ethereum archive node and run `pnpm dev` (or `pnpm start`)
   to index blocks 24319323→24369323.
3. Diff against the public API via `tools/compare` using `validation.json`. The
   public endpoint is multichain/superset — filter to `centrifugeId = "1"` and the
   in-scope block range, and only compare the IN-SCOPE entities (deferred entities
   and the deferred columns will diff by construction). Confirm the live endpoint
   URL and filter argument names against the running api-v3 GraphQL schema first.

## Verification (all pass, offline)

```
pnpm install
pnpm codegen
pnpm build      # tsc --noEmit, zero errors
pnpm test       # vitest, 2 offline tests
```

Tests (`createTestIndexer` + `simulate` + `ANEMOY_CALL_MOCK`):
- `test/pool-shareclass.test.ts` — HubRegistry NewAsset/NewPool + ShareClassManager
  AddShareClass → Pool, Asset(ISO), AssetRegistration, Account, PoolManager, Token,
  with exact asserted values.
- `test/vault-deposit.test.ts` — full event-driven flow: NewPool/NewAsset/
  AddShareClass → RegisterAsset → Spoke.AddShareClass (mocked totalSupply) →
  DeployVault (contractRegister) → Vault.DepositRequest → Vault +
  InvestorTransaction + VaultInvestOrder, with exact asserted values.

> Test note: pre-seeding an entity via `indexer.<Entity>.set(...)` and then having a
> handler that both `get`s and `set`s that same entity while also invoking an Effect
> crashes the v3.1.2 test worker. Both tests therefore drive all setup through
> simulated events rather than manual seeding.
