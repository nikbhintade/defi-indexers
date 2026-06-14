# GMX V2 (synthetics-stats) → HyperIndex migration

Port of the official GMX V2 perps/synthetics stats subgraph
(`gmx-io/gmx-subgraph`, the `synthetics-stats` subgraph) to Envio HyperIndex
(envio `3.1.2`, TypeScript), scoped to **Arbitrum One (chain 42161)**.

- **Source repo:** https://github.com/gmx-io/gmx-subgraph
- **Source commit:** `1049f5c3b731248926e08dc488cedd225a3e73cb`
- **Source manifest:** `synthetics-stats/subgraph-arbitrum.yaml` (the Arbitrum data sources)
- **Source mappings:** `synthetics-stats/src/mapping.ts` + `src/entities/*` + `src/utils/*` + `src/contracts/*` + `src/config/markets.ts`

## What was ported

All Arbitrum data sources and templates from `subgraph-arbitrum.yaml`:

| Subgraph data source | Address (Arbitrum) | Start block | HyperIndex contract |
| --- | --- | --- | --- |
| EventEmitter | `0xC8ee91A54287DB53897056e12D9819156D3822Fb` | 107737756 | `EventEmitter` (EventLog / EventLog1 / EventLog2) |
| Vault (V1) | `0x489ee077994B6658eAfA855C308275EAd8097C4A` | 107737756 | `Vault` (SellUSDG) |
| GlpManager (V1) | `0x3963FfC9dff443c2A94f21b129D429891E32ec18` | 107737756 | `GlpManager` (RemoveLiquidity) |
| BatchSender (V1) | `0x1070f775e8eb466154BBa8FA0076C4Adc7FE17e8` | 107737756 | `BatchSender` (BatchSend) |
| BatchSenderNew (V1) | `0x5384E6cAd96B2877B5B3337A277577053BD1941D` | 150447937 | folded into `BatchSender` (shared signature; both addresses listed) |
| MarketTokenTemplate | dynamic | — | `MarketTokenTemplate` (Transfer) |
| GlvTokenTemplate | dynamic | — | `GlvTokenTemplate` (Transfer) |

Every `eventName` branch from the `mapping.ts` dispatcher is ported: positions
(increase/decrease), orders (created/executed/cancelled/updated/frozen/auto-update),
swaps, deposits/withdrawals, market creation, market pool-value updates,
position/swap fees collected, claimable funding/collateral, collateral claimed,
liquidations (PositionFeesInfo), trade actions, oracle price updates, position
impact pool distribution, and the volume / collected-fees / period stat
aggregations. The incentives stats (liquidity-provider, market, trading,
GLP→GM migration) are ported as well.

### The EventEmitter generic-event decoding (the load-bearing part)

GMX V2's single main data source, **EventEmitter**, emits three generic events:

```
EventLog (address msgSender, string eventName, string indexed eventNameHash, EventLogData eventData)
EventLog1 (... + bytes32 indexed topic1, EventLogData eventData)
EventLog2 (... + bytes32 indexed topic1, bytes32 indexed topic2, EventLogData eventData)
```

`eventData` is a deeply-nested struct (`EventUtils.EventLogData`) holding, per
solidity type, single `items` and `arrayItems` arrays of `(string key, T value)`:
`addressItems / uintItems / intItems / boolItems / bytes32Items / bytesItems /
stringItems`. The subgraph decodes this once and dispatches on `eventName`.

In HyperIndex we register `indexer.onEvent({contract:"EventEmitter", event:"EventLog1"}, …)`
(and `EventLog` / `EventLog2`) **once each**, then inside the handler:

1. envio decodes the ABI tuple into a plain nested object whose shape exactly
   matches the struct (see `.envio/types.d.ts`). No manual ABI decoding needed.
2. We wrap `event.params.eventData` in the `EventData` accessor class
   (`src/utils/eventData.ts`) — a 1:1 port of the subgraph's
   `getAddressItem / getUintItem / getIntItem / getBoolItem / getBytes32Item /
   getBytesItem / getStringItem / get*ArrayItem` helpers. Each does a linear
   scan of the matching `items` array by key, identical to the AssemblyScript
   original.
3. We dispatch on `event.params.eventName` to the ported per-event logic
   (`src/handlers/mapping.ts` → `src/entities/*`).

The `*String` accessors lowercase their hex output (graph-ts `Address.toHexString()`
/ `Bytes.toHexString()` are lowercase), preserving id/field parity.

A reusable test helper (`test/eventDataBuilder.ts`) assembles a realistic
`eventData` struct from readable `key → value` maps so the simulated events in
the offline tests mirror the on-chain layout.

## File map

| Source | Port |
| --- | --- |
| `src/mapping.ts` (dispatcher + V1 + templates) | `src/handlers/mapping.ts` |
| `src/utils/eventData.ts` + `src/utils/eventData/*EventData.ts` | `src/utils/eventData.ts` (accessor; the per-event accessor subclasses are inlined into the handlers since they were thin getters) |
| `src/utils/number.ts`, `src/utils/time.ts` | `src/utils/number.ts`, `src/utils/time.ts` |
| `src/config/markets.ts` | `src/config/markets.ts` |
| `src/contracts/getMarketPoolValueFromContract.ts`, `getMarketTokensSupplyFromContract.ts`, `readerConfigs.ts` | `src/effects/contracts.ts` + `src/effects/calls.ts` |
| `src/entities/common.ts` | `src/entities/common.ts` |
| `src/entities/markets.ts` | `src/entities/markets.ts` |
| `src/entities/orders.ts` | `src/entities/orders.ts` |
| `src/entities/positions.ts` | `src/entities/positions.ts` |
| `src/entities/swaps.ts` | `src/entities/swaps.ts` |
| `src/entities/fees.ts` | `src/entities/fees.ts` |
| `src/entities/trades.ts` | `src/entities/trades.ts` |
| `src/entities/volume.ts` | `src/entities/volume.ts` |
| `src/entities/claims.ts` | `src/entities/claims.ts` |
| `src/entities/priceImpactRebate.ts` | `src/entities/priceImpactRebate.ts` |
| `src/entities/prices.ts` | `src/entities/prices.ts` |
| `src/entities/user.ts` | `src/entities/user.ts` |
| `src/entities/userBalance.ts` | `src/entities/userBalance.ts` |
| `src/entities/distributions.ts` | `src/entities/distributions.ts` |
| `src/entities/incentives/liquidityIncentives.ts` | `src/entities/incentives/liquidityIncentives.ts` |
| `src/entities/incentives/tradingIncentives.ts` | `src/entities/incentives/tradingIncentives.ts` |

## Dynamic-template registration

The subgraph instantiates `MarketTokenTemplate` / `GlvTokenTemplate` from the
`MarketCreated` / `GlvCreated` `EventLog1` events. In HyperIndex this is an
`indexer.contractRegister({contract:"EventEmitter", event:"EventLog1"}, …)`
handler (`src/handlers/mapping.ts`) that decodes the same `eventData`, reads the
`marketToken` (or `glvToken` / fallback `glv`) address, and calls
`context.chain.MarketTokenTemplate.add(...)` / `GlvTokenTemplate.add(...)`. The
follow-on `Transfer` events on those addresses then flow to the
`MarketTokenTemplate` / `GlvTokenTemplate` `Transfer` handlers. The offline
market-creation test asserts the registration end-to-end (a mint Transfer on the
freshly-created market token updates `MarketInfo.marketTokensSupply`).

## eth_call → Effect table

All on-chain reads go through one cached `ethCall` Effect (`src/effects/calls.ts`)
carrying raw calldata; `src/effects/contracts.ts` provides the typed wrappers.
`try_*` semantics: a revert / empty / undecodable result resolves to a sentinel
so the handler can mirror the subgraph's reverted branch.

| Subgraph call | Effect wrapper | Block-pinned? | `try_` fallback |
| --- | --- | --- | --- |
| `Reader.getMarketTokenPrice(dataStore, market, indexPrice, longPrice, shortPrice, MAX_PNL_FACTOR_FOR_TRADERS, true)` → `poolValue` | `getMarketPoolValueFromContract` | yes (`event.block.number`) | reverted → `0` (subgraph also returns ZERO; called only after the Arbitrum Reader deploy block `112723064`, otherwise short-circuits to `0`) |
| `MarketToken.totalSupply()` | `getMarketTokensSupplyFromContract` | yes (`event.block.number`, latest value in block) | reverted → `0`; only called for deposit/withdrawal swap-fee actions |

Reader/DataStore addresses and the post-deploy block gate are the Arbitrum
entries from the source `readerConfigs.ts`. RPC env var: `RPC_URL_42161`.
Offline tests install a mock via `GMX_V2_CALL_MOCK` (the test indexer runs
handlers in a worker thread that copies the parent env).

## Schema / type mapping

- Ported 1:1: same entity names, field names, ids. `@entity(immutable: …)`
  directives removed (HyperIndex types are plain `type X`).
- `Bytes` fields → `String` storing lowercase `0x…` hex (`Order.cancelledReasonBytes`,
  `frozenReasonBytes`, `TradeAction.reasonBytes`).
- Reference fields (`Transaction!`, etc.) stay typed in the schema; in handlers
  the generated field is `<field>_id` (e.g. `createdTxn_id`, `transaction_id`).
- `ClaimableCollateralGroup.claimables` was `[ClaimableCollateral!]!` (a list of
  entity references) in the subgraph but is populated/read as a plain id-string
  array, so it is `[String!]!` here (the ids are identical).
- Added `@index` to `UserGmTokensBalanceChange.account` / `marketAddress` (looked
  up indirectly via the latest-ref entity, kept indexable).

All entity type names are already PascalCase in the source, so no PascalCase
renames were needed.

## Deviations / quirks preserved

- **`ClaimAction.isLongOrders` is `Json!` (was `[Boolean!]!`).** envio's schema
  parser rejects arrays of booleans ("Arrays of booleans are not yet
  supported"). The field is stored as a JSON array of booleans (e.g.
  `[true,false]`) — same values, serialized as JSON. This is the only schema
  type change with a representational difference; `tools/compare` should treat
  it accordingly. (`ClaimCollateralAction` has no boolean array and is unchanged.)
- **`logIndex`:** the subgraph used `event.logIndex` for `getIdFromEvent`
  (`txHash:logIndex`) and `event.logIndex` for the GM-balance-change postfix.
  envio exposes `event.logIndex` directly (there is no `transactionLogIndex`),
  used verbatim.
- **Graph-node BigInt semantics:** all arithmetic uses native JS `bigint`
  (integer truncating division matches graph-node `BigInt.div`). No
  `BigDecimal` is used by this subgraph — every monetary value is `BigInt`
  (1e30 USD precision etc.), so there is no decimal-precision drift to worry
  about.
- **`getMarketTokenPrice` revert → ZERO** and the pre-Reader-deploy ZERO
  short-circuit are preserved (documented in the source as a deliberate
  anti-crash fallback).
- **Preload idempotency:** envio runs handlers in a concurrent *preload* pass
  before the sequential real pass. Same-batch cross-event dependencies (e.g. a
  `MarketInfo` created by `MarketCreated` and read by a later `PositionFees…`
  in the same batch) are not visible during preload. To avoid spurious
  preload-time crashes while keeping the subgraph's sequential
  throw-on-missing behavior, `getMarketInfo` and the trade/deposit handlers
  return a transient placeholder / early-return when `context.isPreload` and a
  dependency is missing; the sequential pass (which has committed state) runs
  the real logic and the original throws still fire there. This does not change
  committed output.
- **`getOrCreateTransaction`:** `transaction.to == null → ""`, addresses
  lowercased — matches the subgraph.

## Known gaps / not ported

- **Non-Arbitrum networks** (Avalanche / Fuji / Goerli / Botanix / MegaEth):
  out of scope. Only the Arbitrum manifest + the `"arbitrum"` reader config are
  ported.
- **`GlvCreated` → MarketInfo:** the subgraph's `GlvCreated` branch only logs +
  registers the GLV template (the `saveMarketInfo` call is commented out
  upstream); we likewise only register the `GlvTokenTemplate`.
- **`AffiliateRewardUpdate` / `PoolAmountUpdate`:** these entity types exist in
  the schema but are **not written by any handler in the source mapping**
  (no `eventName` branch creates them). They are kept in the schema for parity
  but, as in the subgraph, are never populated.
- **Reader binding (`src/contracts/Reader.ts`):** the 3624-line generated
  binding is not ported; the single `getMarketTokenPrice` call is issued via a
  viem human-readable ABI in the Effect layer instead.

## Verification

```
cd gmx-v2
pnpm install
pnpm codegen      # generates .envio/types.d.ts
pnpm build        # tsc --noEmit, zero errors
pnpm test         # offline vitest (createTestIndexer + simulate + GMX_V2_CALL_MOCK)
```

All four pass. Tests:
- `test/market-creation.test.ts` — `EventLog1` "MarketCreated" decodes the
  nested `eventData`, creates `MarketInfo`, and registers the `MarketToken`
  template (proven by a follow-on mint `Transfer` bumping
  `marketTokensSupply`).
- `test/position-flow.test.ts` — a full OraclePriceUpdate → MarketCreated →
  OrderCreated → PositionIncrease → PositionFeesCollected → OrderExecuted flow,
  asserting exact values on `Order`, `PositionIncrease`, `PositionFeesInfo`,
  `CollectedMarketFeesInfo`, `PositionFeesInfoWithPeriod`, `VolumeInfo`,
  `PositionVolumeInfo`, `UserStat`, and the OrderCreated / OrderExecuted
  `TradeAction`s.

## Bounded validation run

`config.yaml` has a commented `end_block` (`107737756 + 50000 = 107787756`) and
`rollback_on_reorg: false` for deterministic bounded runs. To run against the
gateway with `tools/compare`, fill in the subgraph deployment id in
`validation.json` (see the `_note` there), set `GRAPH_API_KEY` and
`RPC_URL_42161`, uncomment the `end_block`, then `pnpm start`.
