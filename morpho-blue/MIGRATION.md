# Migration: morpho-org/morpho-blue-subgraph → Envio HyperIndex

Full-fidelity port of the canonical **Morpho Blue + MetaMorpho** Messari-style
lending subgraph (Ethereum mainnet) to Envio HyperIndex (`envio` 3.1.2,
TypeScript).

- **Source repo:** `morpho-org/morpho-blue-subgraph`
- **Source commit:** `0be2526ba9a77f8ecbcb413919727e2309e63d60` (2025-03-11)
- **Target chain:** Ethereum mainnet (chain id 1)
- **Based on:** this port was bootstrapped from the in-repo `spiko-morpho` port
  (a port of `spiko-tech/morpho-blue-subgraph`, a fork of the canonical repo) and
  then **reconciled to the canonical morpho-org behaviour** (see
  "Reconciliation vs the Spiko fork" below).

## Why this project exists

This is the shared "Morpho Blue once" port. It corresponds to **Morpho Blue
(#11)** and is the target several curator migration rows point to — Steakhouse,
and later Gauntlet / Sentora / etc. Those curators' vaults are **MetaMorpho
vaults** indexed by this subgraph, so this single port serves all of them.

## Data sources (config.yaml, chain 1)

| Contract | Address | Start block |
| --- | --- | --- |
| `MorphoBlue` | `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb` | 18883124 |
| `MetaMorphoFactory` (v1.0) | `0xa9c3d3a366466fa809d1ae982fb2c46e5fc41101` | 18925584 |
| `MetaMorphoFactoryV11` (v1.1) | `0x1897A8997241C1cD4bD0698647e4EB7213535c24` | 21439510 |
| `PublicAllocator` | `0xfd32fA2ca22c76dD6E550706Ad913FC6CE91c75D` | 19375099 |
| `MetaMorpho` (template) | address-less — registered via `indexer.contractRegister` on both factories' `CreateMetaMorpho` | — |

`rollback_on_reorg: false`. `field_selection` is minimal (only the
`transaction_fields` the handlers actually read: `hash, nonce, gasPrice, gas`).
`config.yaml` carries a commented `end_block: 18933124` (start + 50k) for bounded
validation runs.

The canonical `subgraph.yaml` is multi-network templated (its default rendering
is arbitrum-one); `networks.json` provides the mainnet addresses used above. The
unused `ChainlinkAggregatorProxy` / `ChainlinkPriceFeed` template data sources
(empty/`confirmAggregator` call handlers, `src/chainlink.ts`) are **not** ported
— same dead-code decision as the Spiko port (see "Dead code" below).

## File map (canonical source → port)

| Subgraph file | Port file |
| --- | --- |
| `subgraph.yaml` (mainnet rendering) | `config.yaml` |
| `schema.graphql` | `schema.graphql` (1:1; `Bytes`→`String` lowercase hex, ids→`ID!`) |
| `src/morpho-blue.ts` | `src/handlers/morphoBlue.ts` |
| `src/meta-morpho-factory.ts` + `src/meta-morpho-factory-v1.1.ts` | `src/handlers/metaMorphoFactory.ts` (shared helper, `version` param) |
| `src/meta-morpho.ts` | `src/handlers/metaMorpho.ts` |
| `src/public-allocator.ts` | `src/handlers/publicAllocator.ts` |
| `src/initializers/{protocol,markets}.ts` | `src/initializers/{protocol,markets}.ts` |
| `src/sdk/manager.ts` (DataManager) | `src/sdk/manager.ts` |
| `src/sdk/position.ts` / `snapshots.ts` / `token.ts` / `account.ts` / `metamorpho.ts` / `constants.ts` | `src/sdk/*.ts` |
| `src/maths/shares.ts` | `src/maths/shares.ts` |
| `src/utils/rate.ts` (`cloneRate`/`cloneRates`) | `src/utils/rate.ts` |
| `src/utils/{liquidationIncentives,metaMorphoUtils}.ts` | `src/utils/metaMorphoUtils.ts` |
| `src/utils/publicAllocator.ts` | `src/utils/publicAllocator.ts` (mainnet address fixed) |
| `src/fetchUsdTokenPrice.ts` | `src/fetchUsdTokenPrice.ts` |
| eth_calls (token metadata, IRM, chainlink, wstETH/rETH/ERC4626) | `src/effects/{calls,contracts}.ts` |
| (compound-v3) `src/common/graphBytes.ts` | `src/utils/graphBytes.ts` |

The class-based SDK (DataManager / PositionManager / SnapshotManager /
TokenManager / AccountManager) is reimplemented as **functional, context-threaded
helpers**: every helper takes the envio `EvmOnEventContext` and loads/sets
entities through it (HyperIndex entities are immutable plain objects, written via
`context.X.set({...})`).

## Reconciliation vs the Spiko fork

The Spiko fork had stripped several features from the canonical morpho-org code.
These were **reverted to the canonical behaviour** in this port:

| Area | Spiko fork (base) | Canonical morpho-org (this port) |
| --- | --- | --- |
| `MetaMorpho.version` | absent | added; set to `"1.0"` (v1.0 factory) / `"1.1"` (v1.1 factory) |
| `MetaMorpho.hasPublicAllocator` | absent | added; `false` at create, `true` once the public-allocator address is set as an allocator |
| `MetaMorphoFactoryV11` data source | absent | added (mainnet `0x1897…5c24`, start 21439510) → `version "1.1"` |
| `PublicAllocator` data source + 6 entities + handlers | absent | added (`MetaMorphoPublicAllocator`, `…Market`, `SetFlowCapsEvent`, `PublicAllocatorReallocationToEvent`, `PublicAllocatorWithdrawalEvent`, `MarketFlowCapsSet`) |
| `Deposit/Withdraw/Borrow/Repay.rates` | absent | added; cloned from `market.rates` at the event timestamp via `cloneRates` (`{rateId}-{timestamp}`) |
| `MetaMorphoDeposit/Withdraw/Transfer.rate` | absent | added; cloned from the vault's supply `InterestRate` via `cloneRate` |
| `MetaMorphoAllocator.isPublicAllocator` (+ `publicAllocatorConfig`) | absent | added; set in `SetIsAllocator` |
| `MetaMorpho` SetName / SetSymbol events | absent | added (non-critical load → update name/symbol) |
| `Network` enum | 23 values | + `BASE, CORN, FRAXTAL, HEMI, INK, MODE, SCROLL, SONIC, UNICHAIN` |
| `Account` public-allocator derived fields, `Position.{liquidations,transfers}`, `MetaMorpho.publicAllocator`, `MetaMorphoMarket.publicAllocatorMarket` | absent | added as `@derivedFrom` reverse lookups |

Everything else (Morpho Blue market/position accounting, shares↔assets math,
snapshots, USD pricing, MetaMorpho ERC4626 accounting, entity ids) already
matched the canonical code in the Spiko port and was carried over unchanged.

## eth_call → Effect table

All calls funnel through one cached `ethCall` Effect (`src/effects/calls.ts`)
carrying raw calldata; typed wrappers live in `src/effects/contracts.ts`.
`try_*` semantics are mirrored by catching reverts and returning `null`. Tests
inject a declarative mock via **`MORPHO_BLUE_CALL_MOCK`** (set by `setCallMock`).

| Subgraph call (graph-ts) | Effect wrapper | Pinning |
| --- | --- | --- |
| `ERC20.try_symbol()` (string) | `erc20Symbol` | unpinned (immutable) |
| `ERC20SymbolBytes.try_symbol()` (bytes32) | `erc20SymbolBytes` | unpinned |
| `ERC20.try_name()` (string) | `erc20Name` | unpinned |
| `ERC20NameBytes.try_name()` (bytes32) | `erc20NameBytes` | unpinned |
| `ERC20.try_decimals()` (uint8) | `erc20Decimals` | unpinned |
| `IRM.try_borrowRateView(marketParams, market)` | `irmBorrowRateView` | block-pinned |
| `ChainlinkPriceFeed.latestRoundData()` | `chainlinkLatestRoundData` | block-pinned |
| `ChainlinkPriceFeed.decimals()` | `chainlinkDecimals` | block-pinned |
| `WstEth.getStETHByWstETH(1e18)` | `wstEthGetStETHByWstETH` | block-pinned |
| `REth.getExchangeRate()` | `rEthGetExchangeRate` | block-pinned |
| `ERC4626.convertToAssets(1e18)` (sDAI/wUSDM/sUSDe) | `erc4626ConvertToAssets` | block-pinned |

The `PublicAllocator` handlers and the `cloneRate(s)` machinery perform **no
eth_calls** — they only read state already on-chain in entities.

## Entity id conventions (byte-for-byte)

- **Morpho market id**: the event's `bytes32` id, stored lowercase (`0x…`).
- **Oracle id**: `marketId ++ oracleAddress` (`hexConcat`).
- **InterestRate ids**: `{marketId}-supply` / `{marketId}-borrow`; MetaMorpho vault
  rate `{vaultId}-supply`; cloned snapshots `{rateId}-{timestamp}`.
- **Position counter**: `{account}-{market}-{side}`; open position `{counter}-{nextCount}`.
- **PositionSnapshot**: `{positionId}-{txHash}-{logIndex}`.
- **Morpho event entities** (Deposit/Withdraw/Borrow/Repay/Liquidate/Flashloan):
  `txHash.concatI32(logIndex).concatI32(TransactionEnum)`.
- **MetaMorpho market id**: `vaultAddress ++ marketId`.
- **MetaMorpho event ids**: `txHash ++ Bytes.fromI32(logIndex)`.
- **Public allocator vault id**: `publicAllocatorAddress ++ vaultAddress`.
- **Public allocator market id**: `vaultAddress ++ marketId`.
- **Public allocator event ids**: `txHash ++ Bytes.fromI32(logIndex)`;
  per-market `MarketFlowCapsSet` for `SetFlowCaps`: `{eventId} ++ marketId`.

`src/utils/graphBytes.ts` reproduces graph-ts `Bytes.fromI32` / `Bytes.fromBigInt`
/ `Bytes.concat*` byte layouts.

## Morpho shares math (exact rounding preserved)

`src/maths/shares.ts`: `toAssetsUp`/`toAssetsDown` with `VIRTUAL_SHARES = 1e6`,
`VIRTUAL_ASSETS = 1`, integer `mulDivUp`/`mulDivDown`. MetaMorpho ERC4626
conversion (`toMetaMorphoAssetsUp`) uses the `18 - underlyingDecimals` share
offset. All integer math is `bigint`, matching graph-node `BigInt`.

## Intentional deviations / preserved quirks (for parity)

1. **`Liquidate` entity id uses `Transaction.DEPOSIT` (0)**, not `LIQUIDATE`.
   This is a bug in the canonical source (`createLiquidate` concatenates
   `Transaction.DEPOSIT`); preserved verbatim for data parity.
2. **`createDeposit` prices the supply using the *collateral* (`inputToken`)
   price**, not the loan token — canonical quirk preserved.
3. **`gasUsed` is always `null`/undefined.** The subgraph manifest does not
   request receipts (`event.receipt` was always null), so `gasUsed = null`.
   HyperIndex likewise does not expose receipt gas here.
4. **`event.transactionLogIndex` dropped.** graph-ts exposed it as a uniqueness
   suffix in `NewQueue` / `PendingTimelock` / `PendingGuardian` / `SubmitCap`
   ids. HyperIndex does not expose it; `logIndex` already disambiguates within a
   transaction, so the suffix is omitted. The remaining id components are identical.
5. **`MetaMorpho.guardian` stored as `String`** (lowercase address) rather than
   the canonical `Account` reference. The canonical handler stores the raw
   address bytes too (`mm.guardian = event.params.guardian`), and an Account's id
   *is* its lowercase address, so the stored value is identical; only the schema
   declares it as a scalar instead of a relation. (`PendingGuardian.guardian` is
   likewise stored as the lowercase account id, matching the canonical
   `AccountManager(...).id`.)
6. **Singular `@derivedFrom` → non-null list.** Several canonical fields use a
   singular `@derivedFrom` (`Oracle.market`, `MetaMorpho.{pendingGuardian,
   publicAllocator}`, `MetaMorphoMarket.publicAllocatorMarket`,
   `MetaMorphoAllocator.publicAllocatorConfig`, the `flowCaps` on the public
   reallocation/withdrawal events). HyperIndex requires `@derivedFrom` targets to
   be `[Entity!]!` lists, so these are declared as non-null lists. Reverse-lookup
   semantics are equivalent; only the cardinality of the (non-stored, derived)
   GraphQL field differs.
7. **Entity-list reference fields flattened to `[String!]`** (e.g. `market.rates`,
   `Deposit.rates`, `Liquidate.positions`, `MetaMorpho.{supplyQueue,withdrawQueue}`,
   `NewQueue.*`). These hold id strings; values match the canonical ids.
8. **`fetchPriceFromFeed` revert handling.** The graph-ts version would throw on a
   reverted `latestRoundData()`/`decimals()`; we treat a revert as `0` (these feeds
   do not revert in the indexed range), so behaviour matches in practice while
   staying total.
9. **Dead code not ported:** the `ChainlinkAggregatorProxy` / `ChainlinkPriceFeed`
   template data sources and their empty `src/chainlink.ts` handlers, the
   `src/constants/chainlinkDatabase.ts` map (never imported), and the DataManager
   revenue/fee helpers (`getOrUpdateRate`, `getOrUpdateFee`, `addProtocolRevenue`,
   `addSupplyRevenue`, `getOrCreateRevenueDetail`) which are unreachable from the
   active mainnet Morpho handlers. The `_ChainlinkProxy` / `_ChainlinkAggregator`
   schema entities are kept for schema parity. The live pricing path is the
   hardcoded maps in `fetchUsdTokenPrice.ts`, ported in full.
10. **BigDecimal semantics:** `bignumber.js` configured to 34 significant digits,
    no exponential notation (graph-node parity). `tools/compare` tolerates
    far-decimal drift.

## Bounded validation run

`config.yaml` has `start_block: 18883124` and a commented `end_block: 18933124`
(start + 50k). To run a bounded historical index:

1. Uncomment `end_block: 18933124` in `config.yaml`.
2. Provide an RPC/HyperSync source and `RPC_URL_1` for the eth_call effects.
3. `pnpm codegen && pnpm start` (or `pnpm dev`).
4. Diff against the subgraph with `tools/compare` using `validation.json`.

Note: `MetaMorphoFactoryV11` (start 21439510) and `PublicAllocator` (start
19375099) only begin emitting after the +50k validation window (which ends at
18933124), so a bounded validation run exercises the v1.0 MetaMorpho path only.
Their handlers are still built and type-checked, and are needed for a full
historical index.

## Known gaps

- **Subgraph gateway id unconfirmed.** `validation.json.subgraph.url` is a `TODO`
  (`GRAPH_API_KEY` auth). Mainnet deploy target in the repo is `morpho-blue`
  (`graph deploy morpho-blue --network mainnet`); local id `morpho-org/morpho-blue`.
  Set the concrete `gateway.thegraph.com/api/subgraphs/id/<ID>` URL before comparing.
- **Protocol/market `cumulativeUnique*` counters:** the canonical code bumps them
  in `DataManager._updateUsageData` via `activityCounter`. In this port the
  `_ActiveAccount` markers and the daily/hourly snapshot active-user counts are
  produced via `updateSnapshotUsageData`; the per-snapshot active counts match.
  Some market/protocol `cumulativeUnique{Depositors,Borrowers,…}` aggregate bumps
  were on dead branches (e.g. `LIQUIDATOR`/`TRANSFER` never fire from Morpho
  events) and are not separately re-applied. Verify these aggregate counters
  during a bounded run.

## Verification

- `pnpm install` ✓
- `pnpm codegen` ✓
- `pnpm build` (`tsc --noEmit`) ✓ — zero errors
- `pnpm test` ✓ — 2 offline tests:
  - `test/create-market.test.ts` — CreateMarket → Market + LendingProtocol +
    Oracle + InterestRate + `_MarketList`.
  - `test/supply-flow.test.ts` — CreateMarket + Supply → Market totals, Position
    (exact `toAssetsDown` shares math), Deposit (incl. cloned `rates`),
    PositionSnapshot, Account, protocol counts.
