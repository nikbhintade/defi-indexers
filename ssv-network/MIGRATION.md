# SSV Network subgraph → Envio HyperIndex migration

Full-fidelity mainnet port of the official SSV Network subgraph to Envio
HyperIndex (`envio` 3.1.2, TypeScript).

## Source

- Repo: `ssvlabs/ssv-subgraph` (package name `ssv-bapps-subgraph`)
- Commit: `e2f1aa0188d6a987f4f2c5ff590d053091e9862a` (2026-05-22)
- Network: Ethereum mainnet
- Single data source `SSVNetwork` at `0xDD9BC35aE942eF0cFa76930954a156B3fF30a4E1`,
  start block `17507480`. No templates, no additional data sources
  (SSVNetworkViews / DAO / oracle / token are NOT separate contracts — the SSV
  proxy emits oracle/governance/staking events directly).

## File map

| Source (subgraph)                       | Port (HyperIndex)                          |
| --------------------------------------- | ------------------------------------------ |
| `subgraph.yaml`                         | `config.yaml`                              |
| `schema.graphql`                        | `schema.graphql`                           |
| `src/ssv-network.ts` (re-export)        | `src/handlers/index.ts`                    |
| `src/handlers/operator.ts`              | `src/handlers/operator.ts`                 |
| `src/handlers/cluster-validator.ts`     | `src/handlers/cluster-validator.ts`        |
| `src/handlers/dao-governance.ts`        | `src/handlers/dao-governance.ts`           |
| `src/handlers/account.ts`               | `src/handlers/account.ts`                  |
| `src/handlers/staking.ts`               | `src/handlers/staking.ts`                  |
| `src/handlers/oracle-root.ts`           | `src/handlers/oracle-root.ts`              |
| `src/helpers/*` (ids/account/cluster/dao/operator/metadata) | `src/helpers.ts` (consolidated) |
| `abis/SSVNetwork.json`                  | `abis/SSVNetwork.json` (copied verbatim)   |

## eth_call → Effect table

**None.** The SSV subgraph performs no contract reads — there is no
`Contract.bind(...)` / `try_*` anywhere in the mappings. All entity state is
derived purely from event payloads (the SSV contract emits the full cluster
snapshot tuple `(validatorCount, networkFeeIndex, index, active, balance)` and
`effectiveBalance` inline on every cluster/validator event). Consequently this
port ships **no Effects** and needs no RPC / `viem`. The `SSV_CALL_MOCK`
mechanism is therefore not used.

## Event coverage

All 41 `eventHandlers` from the manifest are ported 1:1. Note the manifest
declares two handlers bound to distinct ABI events that share the
`(uint256,uint256)` shape:

- `NetworkFeeUpdated(uint256 oldFee, uint256 newFee)` → `handleNetworkFeeUpdated`
- `NetworkFeeUpdatedSSV(uint256 oldFee, uint256 newFee)` → `handleNetworkFeeUpdatedSSV`

Both are registered as separate `config.yaml` events / `indexer.onEvent`
handlers.

## Type mapping & id rules

- `Bytes` → `String`, stored **lowercase** `0x…` hex (addresses, public keys,
  shares, merkle roots, tx hashes). HyperIndex delivers checksummed addresses;
  every address/bytes value is `.toLowerCase()`d via the `low()` helper so ids
  and field values match the subgraph byte-for-byte.
- `BigInt` → `BigInt` (native `bigint`); `Int`/`uint16` → `Int` (`number`,
  via `Number(...)`); `Boolean` → `Boolean`; enums → enums.
- No `BigDecimal` fields exist in this schema.
- Entity ids replicated exactly:
  - **Operator** id = `operatorId.toString()` (decimal uint64).
  - **Cluster** id = `${owner.toLowerCase()}-${operatorIds.join("-")}`.
  - **Validator** id = public key (lowercase hex).
  - **DAOValues** / **Account** id = contract / owner address (lowercase hex).
  - **Event entities** id = `${txHash.toLowerCase()}-${logIndex.padStart(5,"0")}`
    via `buildEventEntityId`. The subgraph uses `event.logIndex` (NOT
    `event.transactionLogIndex`), so HyperIndex `event.logIndex` maps directly —
    no deviation.

## Cluster-snapshot accounting

`assignClusterMembership` / `assignClusterSnapshot` / `clusterUsesEthFees`,
`vUnits = effectiveBalance * 100000 / 32`, the `DEFAULT_BALANCE = 32`
per-validator accounting, owner `nonce`/`validatorCount`/`effectiveBalance`
bookkeeping, operator `validatorCount` increments, and the DAO running totals
(`totalValidators`, `totalEffectiveBalance`, `effectiveBalanceETH`,
`validatorsAdded/Removed`, `operatorsAdded/Removed`, `totalAccounts`,
`totalOperators`) are reproduced exactly. Graph-node `BigInt` is integer math;
the port uses native `bigint` (truncating `/`), matching `vUnits` division.

## Preserved quirks / bugs (for parity)

- **`compareSemver` bug**: the subgraph derives `minor`/`patch` from
  `components[0]` (the major segment) rather than `[1]`/`[2]`, and `parseInt`s
  the raw `"vN"` string (→ `NaN`). The net effect is that only the major version
  decides `usesEthFeeRegime` (`>= v2.0.0`). With the default `version = "v1.2.0"`
  this evaluates to `false` (SSV-fee regime) until an `SSVNetworkUpgradeBlock`
  raises the version. The buggy function is reproduced verbatim.
- **Legacy fee-event field swap**: `handleLiquidationThresholdPeriodUpdated` and
  `handleMinimumLiquidationCollateralUpdated` write the *opposite*
  field/`updateType` of what their names suggest when on the ETH-fee regime
  (e.g. the legacy event writes `liquidationThreshold` but tags `updateType =
  LIQUIDATION_THRESHOLD_SSV`). Preserved exactly.
- **`OperatorFeeDeclared`/`OperatorFeeExecuted.blockNumber`**: the subgraph
  assigns `event.params.blockNumber` then immediately overwrites it with
  `event.block.number`; the stored value is `event.block.number`. Preserved.
- **`OperatorAdded` default ETH fee**: in the SSV-fee regime a new operator with
  a non-zero declared fee gets `fee = 1_778_800_000` (default ETH fee) while
  `feeSSV` holds the declared value. Preserved.
- **Required-DAO bail-outs**: handlers that `DAOValues.load(...)` and `return`
  on miss (QuorumUpdated, SSVNetworkUpgradeBlock, FeesSynced, RootCommitted,
  cluster/validator handlers) are mirrored with `if (!dao) return;`. Handlers
  that load-or-create the DAO (DAO governance fee/period handlers, OperatorAdded)
  do so identically.
- **`ValidatorAdded` early-return**: if any operator in the loop is missing, the
  subgraph `return`s out of the whole handler *before* saving the final
  `dao.save()` (so the `effectiveBalanceETH` adjustment + persisted DAO counters
  are skipped). Reproduced with an early `return` inside the loop.
- **`ClusterBalanceUpdated` partial cluster**: when the cluster is absent the
  subgraph instantiates a partial cluster seeding only `effectiveBalance = 32`
  and `feeAsset = SSV`; the remaining fields take their zero defaults.
  Reproduced.

## Intentional deviations

- **`Validator.operators` and `Operator.whitelisted`** were `[Operator!]!` /
  `[Account!]!` (arrays of entity references) in the subgraph. HyperIndex cannot
  store arrays of entity references, so both are stored as `[String!]!` holding
  the exact id strings the subgraph stored (operator-id decimal strings /
  lowercase account addresses). Field values are byte-for-byte identical.
- **`Operator.validators @derivedFrom(field: "operators")`** was dropped:
  HyperIndex cannot derive a reverse relation from an array-of-strings field.
  This relation is query-only and never read inside any mapping, so no written
  entity values change.
- `@derivedFrom` list fields on `Account` (`clusters`, `validators`,
  `operators`) and `Cluster.validators` were made non-nullable `[X!]!` as
  HyperIndex requires; they remain derived from real reference fields.
- `@entity(immutable: …)` directives removed (HyperIndex types are plain
  `type X`); `Bytes` ids became `ID!` strings.
- `DAOValues.updateType` is seeded to `INITIALIZATION` in `createDefaultDAOValues`
  (graph-node leaves the enum unset until the first assignment, but a non-null
  enum needs a value; every code path that creates the DAO assigns the real
  `updateType` in the same handler before persisting).

## Validation

- `validation.json` covers block range `17507480 → 17557480` (start + 50k) and
  maps the core stateful entities (Operator, Account, Cluster, Validator,
  DAOValues, Oracle) plus representative immutable event entities.
- **Subgraph endpoint is a TODO**: the source repo publishes no concrete The
  Graph gateway subgraph id (README only documents `graph deploy --studio`).
  Set `subgraph.url` to SSV's official mainnet deployment id and provide
  `GRAPH_API_KEY` before running `tools/compare`.

## Bounded run instructions

```sh
cd ssv-network
pnpm install
pnpm codegen
pnpm build          # tsc --noEmit, zero errors
pnpm test           # offline vitest (createTestIndexer + simulate)
```

For a bounded live indexing run for validation, uncomment the `end_block` in
`config.yaml` (`17557480`) and run `pnpm dev` / `pnpm start` against a HyperSync
endpoint. `rollback_on_reorg: false` keeps the run deterministic.

## Known gaps

- No live index / parity diff was executed (network restricted to npm +
  github). Offline simulated-event tests verify the operator and
  cluster/validator/snapshot flows with exact asserted values.
- A handful of schema entities are declared but never written by any mapping in
  the source (`Upgraded`, `RootProposed`, `DelegationUpdated`) — carried over
  verbatim for schema parity; they will simply be empty, as in the subgraph.
- The `ClusterMigratedToETH` / `ClusterBalanceUpdated` events are post-v2 (ETH
  regime) features; they are ported faithfully but only exercise the
  `usesEthFeeRegime`/`clusterUsesEthFees` true-branches once the network has
  upgraded past the default `v1.2.0`.
