# M0 `protocol` subgraph → HyperIndex migration

- **Source:** `m0-foundation/subgraphs` — https://github.com/m0-foundation/subgraphs
- **Source commit:** `f856ade5735c565e136691bb3570265e10067abe` (2026-04-13)
- **Ported subgraph:** the **`protocol`** package only (`/protocol`), the canonical
  M0 core (M token + Minter Gateway) on Ethereum mainnet.
- **Target:** envio HyperIndex `3.1.2`, TypeScript, Node 22, pnpm.

## Scope

`m0-foundation/subgraphs` is a monorepo of many subgraphs. **Only the `protocol`
subgraph is ported here.** The other packages are **out of scope** and could be
ported separately as their own HyperIndex projects:

- `ttg` (governance), `stateful-m-token`, `stateful-minter-gateway`,
  `stateful-wrapped-m-token`, `stateful-l2-wrapped-m-token`, `stateful`,
  `wrapped-M` / `erc20`, `minter-module`, `stablecoin`, `superstate`.

In particular, MToken **balance / principal accounting** (holder balances,
earning principal, continuous-index balance math) lives in the separate
`stateful-m-token` subgraph — the `protocol` subgraph's MToken mappings only
record event entities (see "Gaps").

The `protocol` subgraph has exactly two data sources:

| Contract      | Address                                      | Start block |
| ------------- | -------------------------------------------- | ----------- |
| MinterGateway | `0xf7f9638cb444D65e5A40bF5ff98ebE4ff319F04E` | 19818447    |
| MToken        | `0x866A2BF4E572CbcF37D5071A7a58503Bfb36be1b` | 19818438    |

`config.yaml` uses chain `start_block: 19818438` (the earlier of the two) and
pins each contract by address.

## What was ported

All 14 MinterGateway event handlers (incl. the two `BurnExecuted` overloads),
the polling block handler, and all 5 MToken event handlers — 1:1 with the
subgraph manifest:

- **MinterGateway events:** `BurnExecuted` (active-owed-M and
  with-principal/inactive overloads), `CollateralUpdated`, `IndexUpdated`,
  `MintCanceled`, `MintExecuted`, `MintProposed`, `MinterActivated`,
  `MinterDeactivated`, `MinterFrozen`, `MissedIntervalsPenaltyImposed`,
  `RetrievalCreated`, `RetrievalResolved`, `UndercollateralizedPenaltyImposed`.
- **MinterGateway block handler:** `handleNewBlock`, polling `every: 300`.
- **MToken events:** `AuthorizationCanceled`, `AuthorizationUsed`,
  `IndexUpdated`, `StartedEarning`, `StoppedEarning`.

Each minter event stores its immutable event entity and (except `IndexUpdated`
and `MintProposed`, which do **not** in the subgraph) runs
`handleMinterAttributes`: the 5 aggregate timeseries reads + 4 per-minter reads.

### File map

| Source (`protocol/`)        | Port (`m0/`)                                   |
| --------------------------- | ---------------------------------------------- |
| `subgraph.yaml`             | `config.yaml`                                  |
| `schema.graphql`            | `schema.graphql`                               |
| `src/minter-gateway.ts`     | `src/handlers/minter-gateway.ts` (events) + `src/handlers/block.ts` (block handler) + `src/minter-attributes.ts` (shared `handleNewBlock` / `handleMinterAttributes`) |
| `src/m-token.ts`            | `src/handlers/m-token.ts`                      |
| `src/utils.ts`              | `src/utils.ts`                                 |
| `MinterGatewayContract.bind(...)` reads | `src/effects/contracts.ts` + `src/effects/calls.ts` |
| (block hash/ts recovery)    | `src/effects/block.ts`                         |
| `abis/MinterGateway.json`, `abis/MToken.json` | `abis/` (copied verbatim)    |

## eth_call → Effect table

The subgraph used graph-ts `MinterGatewayContract.bind(addr).method()` (plain
`bind`, **not** `try_`). All are **state-dependent** reads and are **pinned to
the event/block number**. A revert surfaces as `null` (see deviation 1).

| Subgraph call (`MinterGateway`)        | Effect wrapper (`src/effects/contracts.ts`) | Returns | Pinned |
| -------------------------------------- | ------------------------------------------- | ------- | ------ |
| `principalOfTotalActiveOwedM()`        | `principalOfTotalActiveOwedM`               | uint112 | yes    |
| `totalOwedM()`                         | `totalOwedM`                                | uint240 | yes    |
| `totalActiveOwedM()`                   | `totalActiveOwedM`                          | uint240 | yes    |
| `totalInactiveOwedM()`                 | `totalInactiveOwedM`                        | uint240 | yes    |
| `excessOwedM()`                        | `excessOwedM`                               | uint240 | yes    |
| `activeOwedMOf(minter)`                | `activeOwedMOf`                             | uint240 | yes    |
| `inactiveOwedMOf(minter)`              | `inactiveOwedMOf`                           | uint240 | yes    |
| `principalOfActiveOwedMOf(minter)`     | `principalOfActiveOwedMOf`                  | uint112 | yes    |
| `collateralOf(minter)`                 | `collateralOf`                              | uint240 | yes    |

All calls route through one cached `ethCall` effect carrying raw calldata
(`cache: true`), so each `(to, data, block)` tuple is memoised. Offline tests
mock them via the `M0_CALL_MOCK` env var (`setCallMock`) — the mock matcher is
block-aware (M0 reads are block-pinned, so the same `fn` differs per block).

`src/effects/block.ts` adds a `getBlockMeta` effect (`eth_getBlockByNumber`)
used only by the polling block handler to recover `block.hash` / `block.timestamp`
(see deviation 2).

## Key deviations (preserve behaviour / parity)

### 1. `bind().method()` revert semantics → `null`

The subgraph used **non-`try_`** `bind().method()` calls. In graph-node a revert
would abort the whole handler (and effectively halt indexing). We surface a
revert as `null` and **skip** the corresponding write, which is consistent with
the subgraph's own write guards:

- `createTimeseriesEntity`: writes only when `amount && amount.gt(0)` → port:
  `amount !== null && amount > 0n`.
- `createMinterAttributeEntity`: writes when `if (amount)`. In graph-ts `amount`
  is a non-null `BigInt` **object**, so this is **truthy even for `BigInt(0)`** —
  i.e. a zero amount **does** write the entity. The port mirrors this: it writes
  whenever `amount !== null` (only a revert/`null` skips). The minter-flow test
  asserts the `amount = 0` case writes (`MinterActiveOwedMOf` at block B1).

On mainnet at the indexed blocks these reads do not revert, so this branch is
not expected to trigger in a real run.

### 2. Polling block handler (`handleNewBlock`, every 300 blocks)

envio's `indexer.onBlock` handler receives only `{ number }` — block
`timestamp`/`hash` are **not** exposed to block handlers (unlike subgraph block
handlers, which get the full `ethereum.Block`). The subgraph keys its timeseries
entities by `block.hash` and stores `block.timestamp`, so the port recovers both
via a cached `eth_getBlockByNumber` effect (`getBlockMeta`). This path requires
RPC and is exercised only during live indexing.

The **same** timeseries entities are *also* written by every minter event (via
`handleMinterAttributes` → `handleNewBlock`), where `block.hash` / `block.timestamp`
arrive natively on the event. The offline tests cover that per-event path
exactly. Polling alignment uses `_gte: 19818447` (MinterGateway startBlock) +
`_every: 300`, matching the subgraph's startBlock-relative polling stride.

### 3. Entity IDs — `concatI32` (byte-for-byte)

Event-entity ids are `event.transaction.hash.concatI32(event.logIndex.toI32())`.
graph-ts `Bytes#concatI32` appends the i32 as **4 big-endian bytes** and the id
serialises as lowercase `0x` hex. The port replicates this exactly
(`txHashConcatLogIndex`): `txhash_hex + logIndex.toString(16).padStart(8,"0")` —
e.g. logIndex `3` → suffix `00000003` appended to the 32-byte hash (a 36-byte /
72-hex-digit id). This is **not** the dash-joined `txhash-logIndex` form used by
some other ports.

Per-minter entity ids are `minter.toString() + "-" + blockNumber` — graph-ts
`Address.toString()` is lowercase hex, so the port lowercases the minter address.

`event.transactionLogIndex` is not used by this subgraph; `event.logIndex` is
used directly (and is exposed by envio), so no substitution was needed.

### 4. `Bytes` → `String`

Per CONVENTIONS.md, schema `Bytes` fields (minter/payer/caller/destination/
authorizer addresses, `metadataHash`, `nonce`, `transactionHash`, and the
block-hash ids) became `String` storing **lowercase** `0x` hex. `@entity(immutable: …)`
directives were removed. Entity type names were already PascalCase. The two
`BurnExecuted` event overloads are distinct config events (`BurnExecuted`,
`BurnExecutedWithPrincipal`) but write the **same** `BurnExecuted` entity, as in
the subgraph (the with-principal/inactive overload sets `principalAmount`; the
active overload leaves it null).

### 5. Preserved quirk — daily snapshot has no `>0` guard

`createTotalActiveOwedMDailySnapshot` writes unconditionally (no `>0` guard,
last-write-wins per UTC day). The port preserves this; it only skips on the
live-only revert (`null`) case.

## Known gaps

- **MToken balances / principal accounting are not in this subgraph.** The
  `protocol` MToken mappings only emit event entities (`MTokenStartedEarning`,
  `MTokenStoppedEarning`, `MTokenIndexUpdated`, `MTokenAuthorization*`). There is
  **no** Transfer handler and no holder/balance entity. Holder-balance /
  continuous-index balance math lives in the separate `stateful-m-token`
  subgraph (out of scope). The MToken offline test therefore walks the
  earning-enable + index-update path rather than a balance-mutating transfer.
- **Continuous-indexing math:** the `protocol` subgraph itself performs **no**
  principal×index arithmetic in its mappings — it reads already-computed owed-M
  / collateral / index values straight from MinterGateway via `bind()` (ported
  as effects). There were no index/principal helper functions in `src/utils.ts`
  to port beyond `dayFromTimestamp` / `SECONDS_PER_DAY`. (The principal×index
  math lives in the `stateful-*` subgraphs.)
- **Polling-block timeseries coverage** may differ from the subgraph because the
  port's polling path depends on the `getBlockMeta` RPC effect; the per-event
  writes of those same `block.hash`-keyed entities match. See `validation.json`
  `_timeseriesNote`.
- **Validation endpoint** is the M0 `protocol` subgraph on Alchemy/Satsuma
  (playground: `https://subgraph.satsuma-prod.com/the-things-team--3422500/protocol/playground`).
  There is **no** The-Graph-gateway `subgraphs/id/<ID>` URL. The `/api` query URL
  in `validation.json` is the conventional Satsuma form derived from the
  playground path and is **unverified** — confirm the endpoint and whether it
  needs a key before trusting a diff.

## Verification

```
cd m0
pnpm install
pnpm codegen      # passes
pnpm build        # tsc --noEmit, 0 errors
pnpm test         # vitest, 2 files / 2 tests pass (offline, M0_CALL_MOCK)
```

Tests (`test/`):
- `minter-flow.test.ts` — MinterActivated + MintExecuted: asserts the
  `MinterActivated` / `MintExecuted` event entities, the `block.hash`-keyed
  timeseries (`TotalOwedM`, `TotalActiveOwedM`, `PrincipalOfTotalActiveOwedM`,
  `TotalExcessOwedM`), the `>0`-guard skips (zero/inactive totals not written),
  the day-keyed `TotalActiveOwedMDailySnapshot` (last-write-wins), and the 4
  per-minter `Minter*OwedMOf` / `MinterCollateralOf` entities (incl. the
  `amount = 0` write-anyway quirk). All 9 eth_calls mocked, block-pinned.
- `mtoken-flow.test.ts` — StartedEarning + IndexUpdated: asserts
  `MTokenStartedEarning` and `MTokenIndexUpdated` (pure handlers, no eth_calls).

### Bounded validation run

`config.yaml` has a commented `end_block: 19868438` (= 19818438 + 50k). Uncomment
it (and keep `rollback_on_reorg: false`) for a deterministic bounded run, then
`tools/compare` against `validation.json` (block range 19818438 → 19868438).
```
# config.yaml: uncomment `end_block: 19868438`, set RPC_URL_1, then:
pnpm dev
```
