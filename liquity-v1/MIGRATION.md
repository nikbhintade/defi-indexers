# Liquity V1 — subgraph → HyperIndex migration

Full-fidelity port of the **Liquity V1 subgraph** (LUSD troves/CDPs, Stability
Pool, LQTY staking) to **Envio HyperIndex v3.1.2**, TypeScript, Ethereum
mainnet.

- **Source repo:** `liquity/dev`, path `packages/subgraph`
- **Source commit:** `3e64ee1b52c50d51587c64c1cf75e0ba82934979` (2025-11-25)
- **Network:** Ethereum mainnet

## How addresses + start block were resolved

The subgraph manifest is **generated** by `subgraph.yaml.js`, which reads
`@liquity/lib-ethers/deployments/${network}.json` for `addresses` and
`startBlock`. That deployment file is not vendored in the cloned subgraph
package, so it was fetched from npm (`npm pack @liquity/lib-ethers@3.4.0`,
`deployments/default/mainnet.json`). All eight addresses and the start block
below come verbatim from that artifact (`version`
`5174ecd0da4842157aba989499200d690b7e374f`):

| Data source | Address | Source field |
| --- | --- | --- |
| TroveManager | `0xA39739EF8b0231DbFA0DcdA07d7e29faAbCf4bb2` | `addresses.troveManager` |
| BorrowerOperations | `0x24179CD81c9e782A4096035f7eC97fB8B783e007` | `addresses.borrowerOperations` |
| PriceFeed | `0x4c517D4e2C851CA76d7eC94B805269Df0f2201De` | `addresses.priceFeed` |
| StabilityPool | `0x66017D22b0f8556afDd19FC67041899Eb65a21bb` | `addresses.stabilityPool` |
| CollSurplusPool | `0x3D32e8b97Ed5881324241Cf03b2DA5E2EBcE5521` | `addresses.collSurplusPool` |
| LQTYStaking | `0x4f9Fbb3f1E99B56e0Fe2892e623Ed36A76Fc605d` | `addresses.lqtyStaking` |
| LUSDToken | `0x5f98805A4E8be255a32880FDeC7F6728C6568bA0` | `addresses.lusdToken` |
| LQTYToken | `0x6DEA81C8171D0bA574754EF6F8b412F2Ed88c54D` | `addresses.lqtyToken` |

- **Start block:** `12178551` (`startBlock` in the deployment file; all data
  sources share it). Validation range = `12178551 → 12228551` (+50k).

## Verification

```
cd liquity-v1
pnpm install
pnpm codegen      # generates .envio types from config.yaml + schema.graphql
pnpm build        # tsc --noEmit, zero errors
pnpm test         # 3 offline vitest suites, no RPC
```

All pass. Tests run fully offline via `createTestIndexer` + `simulate`; the
single eth_call path (ERC20 name/symbol) is mocked through
`LIQUITY_V1_CALL_MOCK`.

## File map

| Source (subgraph) | Port (HyperIndex) |
| --- | --- |
| `subgraph.yaml.js` (generated manifest) | `config.yaml` |
| `schema.graphql` | `schema.graphql` (directives stripped, interface flattened) |
| `src/mappings/TroveManager.ts` | `src/mappings/TroveManager.ts` |
| `src/mappings/BorrowerOperations.ts` | `src/mappings/BorrowerOperations.ts` |
| `src/mappings/PriceFeed.ts` | `src/mappings/PriceFeed.ts` |
| `src/mappings/StabilityPool.ts` | `src/mappings/StabilityPool.ts` |
| `src/mappings/CollSurplusPool.ts` | `src/mappings/CollSurplusPool.ts` |
| `src/mappings/LqtyStake.ts` | `src/mappings/LqtyStake.ts` |
| `src/mappings/Token.ts` | `src/mappings/Token.ts` (LUSDToken + LQTYToken) |
| `src/entities/*` | `src/entities/*` (1:1 file names) |
| `src/utils/{bignumbers,collateralRatio,constants}.ts` | `src/utils/*` |
| `src/types/TroveOperation.ts` | `src/types/TroveOperation.ts` |
| `abi/ERC20.json` | `abis/ERC20.json` |
| — (new) | `src/effects/calls.ts` (eth_call layer + mock) |

## The global sequential change-counter

The subgraph keeps a single `Global` entity (id `"only"`) holding every
sequential counter: `systemStateCount`, `transactionCount`, **`changeCount`**,
`liquidationCount`, `redemptionCount`, plus aggregate trove/stake stats and the
internal temp pointers (`currentSystemState`, `currentLiquidation`,
`currentRedemption`, `tmpDepositUpdate`).

Every `Change` entity (TroveChange / StabilityDepositChange / PriceChange /
CollSurplusChange / LqtyStakeChange) takes its **id and `sequenceNumber` from a
single global counter** via `beginChange()` → `getChangeSequenceNumber()` →
`increaseCounter("changeCount")` (post-increment: returns the value *before*
incrementing). So the first change ever created has id `"0"`, the next `"1"`,
etc., **regardless of which contract/handler created it**. This is replicated
exactly: `src/entities/Global.ts increaseCounter` does a `context.Global.get` →
`context.Global.set({...global, [key]: count+1})` and returns `count`.

`SystemState` ids come from the *separate* `systemStateCount` counter, and a
`SystemState` is "bumped" (re-keyed to a fresh sequence number) on every state
mutation, freezing the prior snapshot under its old id. `getLastChangeSequenceNumber`
(= `changeCount - 1`) is used by `LUSDBorrowingFeePaid` to back-patch the
`borrowingFee` of the immediately-preceding TroveChange.

Because envio's entity cache makes a `get` after a `set` within the same handler
return the just-written value, the subgraph's synchronous read-modify-write loop
on `Global` is reproduced by `await`-ing every mutation in order.

## eth_call → Effect

The subgraph performs exactly **one** kind of eth_call, in `entities/Token.ts`:

| Subgraph call | Effect | Pinning | try_? |
| --- | --- | --- | --- |
| `ERC20.bind(addr).name()` | `erc20Name` (via `ethCall` Effect) | unpinned (immutable) | no (subgraph would throw on revert) |
| `ERC20.bind(addr).symbol()` | `erc20Symbol` (via `ethCall` Effect) | unpinned (immutable) | no |

These are issued the first time each token (LUSD / LQTY) is seen. They are
routed through a single cached `ethCall` Effect carrying raw calldata
(`src/effects/calls.ts`), mockable offline via `LIQUITY_V1_CALL_MOCK`. The
subgraph did **not** use `try_` here, so a real revert would crash the handler;
to keep offline runs from crashing we fall back to `""` only when the call
returns `null` (mock revert / RPC failure). No other handler reads contract
state, so no other effects exist.

## Deviations (parity-preserving)

1. **GraphQL `interface Change` dropped.** HyperIndex has no interface support.
   Each implementing entity (TroveChange, StabilityDepositChange, PriceChange,
   CollSurplusChange, LqtyStakeChange) is a standalone `type` carrying the same
   five interface fields (`id`, `sequenceNumber`, `transaction`,
   `systemStateBefore`, `systemStateAfter`). The query-only derived field
   `SystemState.cause: Change @derivedFrom` is therefore removed. Stored ids and
   values are unaffected.

2. **Enums → `String`.** `TroveStatus`, `TroveOperation`,
   `StabilityDepositOperation`, `LQTYStakeOperation` are stored as `String!`.
   The enum value `open` (in `TroveStatus`) is a **reserved keyword** in envio's
   schema parser, which crashes codegen. The exact string values are preserved
   byte-for-byte (`"open"`, `"closedByLiquidation"`, `"openTrove"`,
   `"liquidateInNormalMode"`, `"depositTokens"`, `"stakeCreated"`, …).

3. **`Bytes` → `String`** (lowercase `0x` hex). All addresses `.toLowerCase()`d
   before use in ids/fields (HyperIndex delivers checksummed addresses).

4. **Relation fields → `<field>_id`** strings (`owner_id`, `trove_id`,
   `currentSystemState_id`, etc.). `@derivedFrom` reverse collections that the
   mappings never read are dropped.

5. **`@entity` / `@entity(immutable:)` directives removed** (HyperIndex types
   are plain `type X`).

6. **`Global` entity type name collision.** envio exports both an entity
   `type Global` and an `interface Global {}` (its indexer global-config
   registry) from the `"envio"` module. `import type { Global }` resolves to the
   config interface, losing all entity fields, so `src/entities/Global.ts`
   derives the row type from the context accessor:
   `type Global = NonNullable<Awaited<ReturnType<ctx["Global"]["get"]>>>`. No
   schema/data impact.

## Preserved subgraph quirks / bugs

- **`tmpDepositUpdate` mailbox.** Stability-pool deposit accounting relies on a
  single-slot mailbox on `Global` shared between the `ETHGainWithdrawn` and
  `UserDepositChanged` events emitted in the same provide/withdraw call. graph-node
  treats `BigInt 0` as non-null, so the `BIGINT_ZERO` dummy written by
  `ETHGainWithdrawn` is "set" (not null). Replicated with `?? null` (only
  `undefined` counts as null; `0n` is a real value).

- **First price event initializes silently.** The first `LastGoodPriceUpdated`
  sets `SystemState.price` without creating a `PriceChange` or a `Transaction`
  (the `oldPrice == null` early-return). Preserved.

- **`getCurrentPrice` non-null assertion.** Trove/SP/stake changes assume a
  price has already been recorded (`systemState.price!`). The Liquity backend
  always emits `LastGoodPriceUpdated` first, so this holds on mainnet from the
  start block. Preserved as a non-null assertion.

- **Liquidation `accrueRewards` no-op.** `TroveLiquidated` calls
  `applyRedistributionToTroveBeforeLiquidation`, which re-`updateTrove`s with
  the same collateral/debt when there is no pending redistribution; `updateTrove`
  early-returns when nothing changed. Preserved.

- **`collateralRatioSortKey` integer division** uses truncate-toward-zero
  semantics identical between graph-node `BigInt` and JS `bigint`.

## BigDecimal / BigInt semantics

`decimalize(x) = BigDecimal(x) / 1e18`. graph-node `BigDecimal.truncate(n)` →
`bignumber.js .decimalPlaces(n, ROUND_DOWN)` (see `src/utils/bignumbers.ts`).
Tests configure `BigDecimal.config({ DECIMAL_PLACES: 34, EXPONENTIAL_AT:
[-1e6, 1e6] })` to match graph-node's 34-significant-digit, non-exponential
serialization. `collateralRatio` truncates to 18 dp exactly as the subgraph
does. `tools/compare` compares decimal fields with a tolerance for far-decimal
division drift.

## Tests (offline, no RPC)

| Suite | Flow | Key assertions |
| --- | --- | --- |
| `test/trove-open.test.ts` | price seed → BorrowerOperations open trove | Trove (collateral/debt/status/`collateralRatioSortKey`), TroveChange (`collateralRatioAfter = 10`), Global counters, SystemState (TCR = 10) |
| `test/stability-liquidation.test.ts` | price → open trove → SP deposit (ETHGainWithdrawn+UserDepositChanged) → normal-mode liquidation | StabilityDeposit (1000), StabilityDepositChange (id from global counter), partial SP offset math (gas comp = coll/200, TCR = 9.95), Liquidation entity, Global liquidation counters |
| `test/token-effect.test.ts` | LUSD mint + transfer | Token name/symbol via mocked `LIQUITY_V1_CALL_MOCK` effect, totalSupply, TokenBalance |

## Bounded validation run

1. Uncomment `end_block: 12228551` in `config.yaml`.
2. Provide `RPC_URL_1` (and HyperSync token if used) and run `pnpm start`.
3. Fill in `<SUBGRAPH_ID>` in `validation.json` (see gap below) + `GRAPH_API_KEY`.
4. `tools/compare` diffs the in-scope entities over `12178551 → 12228551`.

## Known gaps

- **Subgraph endpoint id unknown.** The repo only references the legacy
  hosted-service slug `liquity/liquity` (`packages/subgraph/package.json` deploy
  script). No decentralized-network subgraph deployment id is present in the
  repo, so `validation.json.subgraph.url` carries a `<SUBGRAPH_ID>` TODO and
  `authEnv: GRAPH_API_KEY`.
- **`event.transactionLogIndex` not used.** The subgraph never relied on it; ids
  are tx-hash / sequence-number / address based, so no `event.logIndex`
  substitution was needed.
