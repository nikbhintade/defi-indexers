# Rocket Pool subgraph → HyperIndex migration

Port of the community Rocket Pool subgraph (rETH liquid staking, node operators,
minipools) to Envio HyperIndex `3.1.2` (TypeScript, Ethereum mainnet / chain 1).

- **Source:** `https://github.com/rocket-pool/rocket-pool-subgraph.git`
- **Source commit:** `99822b8d7d45ca576cb8775845b9f2d87a78d3eb` (2023-08-22)
- **Published subgraph (validation target):**
  `https://gateway.thegraph.com/api/subgraphs/id/S9ihna8D733WTEShJ1KctSTCvY1VJ7gdVwhUujq4Ejo`
  (The Graph decentralized network; explorer id
  `S9ihna8D733WTEShJ1KctSTCvY1VJ7gdVwhUujq4Ejo`). The original is
  community-maintained (Data Nexus / VGR) and effectively **stale since ~2023** —
  the upstream mappings have not tracked later protocol upgrades, so deep-history
  parity past the validation window is not guaranteed by the source itself.

## What was ported

All manifest data sources + the `rocketMinipoolDelegate` template, the full
schema (1:1), and the complete accounting:

- **rETH token** (`RocketTokenRETH`): `Transfer` (mint/burn/transfer) → `Staker`
  balances, weighted avg-entry rate + entry time, `RocketETHTransaction`,
  protocol staker/active-staker accounting.
- **Network balances** (`RocketNetworkBalances`, legacy + Atlas redeploy):
  `BalancesUpdated` → `NetworkStakerBalanceCheckpoint` (total ETH/rETH supply,
  staker ETH split, rETH/ETH exchange rate), previous/next checkpoint links, and
  the `RocketETHDailySnapshot` time series.
- **Node manager** (`RocketNodeManager`, V1 + Redstone + V3): `NodeRegistered`,
  `NodeTimezoneLocationSet` → `Node`, `NetworkNodeTimezone` counters.
- **Node staking** (`RocketNodeStaking`, legacy/Redstone + Atlas): `RPLStaked`,
  `RPLWithdrawn`, `RPLSlashed` → `NodeRPLStakeTransaction` + node RPL state.
- **Network prices** (`RocketNetworkPrices` legacy 4-arg + `…Atlas` 3-arg):
  `PricesUpdated` → `NetworkNodeBalanceCheckpoint` regenerating a
  `NodeBalanceCheckpoint` per registered node, RPL min/max bounds, average
  RPL/ETH ratio, minipool fee averages.
- **Rewards pool** (`RocketRewardsPool` legacy + `…Redstone`/Atlas):
  `RPLTokensClaimed` → `RPLRewardInterval` lifecycle + `RPLRewardClaim` + node
  reward state; `RewardSnapshot` → `RPLRewardSubmitted`.
- **Minipool manager** (`RocketMinipoolManager`, V1/V2/Redstone/Atlas):
  `MinipoolCreated` (+ dynamic `RocketMinipoolDelegate` registration),
  `MinipoolDestroyed`.
- **Minipool delegate template** (`RocketMinipoolDelegate`): `StatusUpdated`,
  `EtherDeposited` → minipool status timestamps + node minipool counters.
- **Minipool queue** (`RocketMinipoolQueue`): `MinipoolEnqueued`/`Dequeued`.
- **DAO node trusted actions** (`RocketDAONodeTrustedActions`):
  ODAO `ActionJoined`/`Leave`/`Kick`/`ChallengeDecided`.
- **Smoothing pool** (`RocketSmoothingPool`): `NodeSmoothingPoolStateChanged`.

### File map

| Source (`src/…`)                                   | Port (`src/…`)                          |
| -------------------------------------------------- | --------------------------------------- |
| `Constants/{contract,general,enum}constants.ts`    | `constants.ts`                          |
| `entityfactory.ts`, `utilities/*`, `Models/*`      | `helpers.ts`                            |
| eth_calls (`Contract.bind(...)`)                   | `effects.ts`                            |
| `mappings/rocketTokenRETHMapping.ts`               | `handlers/rocketTokenRETH.ts`           |
| `mappings/rocketNetworkBalancesMapping.ts`         | `handlers/rocketNetworkBalances.ts`     |
| `mappings/rocketNodeManager.ts`                    | `handlers/rocketNodeManager.ts`         |
| `mappings/rocketNodeStakingMapping.ts`             | `handlers/rocketNodeStaking.ts`         |
| `mappings/rocketNetworkPricesMapping.ts` + `utilities/nodeutilities.ts` | `handlers/rocketNetworkPrices.ts` |
| `mappings/rocketRewardsPoolMapping.ts`             | `handlers/rocketRewardsPool.ts`         |
| `mappings/rocketMinipoolManager.ts`                | `handlers/rocketMinipoolManager.ts`     |
| `mappings/rocketMinipoolDelegate.ts`               | `handlers/rocketMinipoolDelegate.ts`    |
| `mappings/rocketMinipoolQueueMapping.ts`           | `handlers/rocketMinipoolQueue.ts`       |
| `mappings/rocketDAONodeTrustedActionMapping.ts`    | `handlers/rocketDAONodeTrustedActions.ts` |
| `mappings/rocketSmoothingPool.ts`                  | `handlers/rocketSmoothingPool.ts`       |

The subgraph's many *versioned* data sources that share an ABI + event +
handler (e.g. node-manager V1/Redstone/V3) are collapsed into **one** config
contract with **multiple addresses** under the chain entry. This is behaviorally
identical: the same handler runs for every address.

## Dynamic contract registration (templates)

The subgraph instantiates a `rocketMinipoolDelegate` template per minipool
(`rocketMinipoolDelegate.create(minipoolAddress)` inside `handleMinipoolCreated`).
The port mirrors this with `indexer.contractRegister` on
`RocketMinipoolManager.MinipoolCreated` adding `event.params.minipool` to the
address-less `RocketMinipoolDelegate` contract (no static address in config).

**Guard:** `contractRegister` runs separately from the event handler and cannot
read entities/effects. Registration is therefore unconditional for every
`MinipoolCreated`. The delegate handlers (`StatusUpdated`, `EtherDeposited`) load
the `Minipool` entity and bail when it is absent — matching the subgraph's
`Minipool.load(...) === null` guards (the `Minipool` is created in the same
`MinipoolCreated` handler, ordered before any delegate event).

## eth_call → Effect table

All calls funnel through a single cached `ethCall` Effect (raw calldata in,
nullable hex out) so re-runs are deterministic; `tryContractCall<T>` returns
`null` on revert/empty data. The subgraph used **non-`try_`** binds (a revert
would have halted the mapping), so the typed wrappers coerce `null` to the
zero/empty value the AS runtime would have carried — these calls did not revert
for in-scope mainnet blocks. State reads are **block-pinned** to the event
block. Offline tests install a declarative mock via `ROCKET_POOL_CALL_MOCK`
(JSON, crosses into envio's worker thread).

| Subgraph call                                              | Wrapper (`effects.ts`)        | Block pin |
| --------------------------------------------------------- | ----------------------------- | --------- |
| `rocketTokenRETH.getExchangeRate()`                       | `getExchangeRate`             | event block |
| `rocketTokenRETH.getTotalCollateral()`                    | `getTotalCollateral`          | event block |
| `rocketDepositPool.getBalance()`                          | `getDepositPoolBalance`       | event block |
| `rocketDepositPool.getExcessBalance()`                    | `getDepositPoolExcessBalance` | event block |
| `rocketNetworkPrices.getRPLPrice()`                       | `getRPLPrice`                 | event block |
| `rocketNodeStaking.getNodeRPLStake(addr)`                 | `getNodeRPLStake`             | event block |
| `rocketNodeStaking.getNodeEffectiveRPLStake(addr)`        | `getNodeEffectiveRPLStake`    | event block |
| `rocketNodeStaking.getNodeMinimumRPLStake(addr)`          | `getNodeMinimumRPLStake`      | event block |
| `rocketNodeStaking.getNodeMaximumRPLStake(addr)`          | `getNodeMaximumRPLStake`      | event block |
| `rocketNetworkFees.getNodeFee()`                          | `getNodeFee`                  | event block |
| `rocketDAOProtocolSettingsMinipool{V1,V2}.getHalfDepositNodeAmount()` | `getHalfDepositNodeAmount` | event block |
| `rocketDAOProtocolSettingsNode.getMinimumPerMinipoolStake()` | `getMinimumPerMinipoolStake` | event block |
| `rocketDAOProtocolSettingsNode.getMaximumPerMinipoolStake()` | `getMaximumPerMinipoolStake` | event block |
| `rocketNodeManager.getNodeTimezoneLocation(addr)`         | `getNodeTimezoneLocation`     | event block |
| `rocketRewardsPool.getClaimIntervalTimeStart()`           | `getClaimIntervalTimeStart`   | event block |
| `rocketRewardsPool.getClaimIntervalTime()`                | `getClaimIntervalTime`        | event block |
| `rocketRewardsPool.getClaimIntervalRewardsTotal()`        | `getClaimIntervalRewardsTotal`| event block |
| `rocketRewardsPool.getClaimingContractAllowance(name)`    | `getClaimingContractAllowance`| event block |
| `rocketDAONodeTrusted.getMemberIsValid(addr)`             | `getMemberIsValid`            | event block |

`getNodeTimezoneLocation` is called on the **emitting** node-manager contract
(`event.srcAddress`); `getClaimingContractAllowance` / `getClaimInterval*` on the
emitting rewards-pool contract (`event.srcAddress`). All other reads target the
fixed mainnet addresses from `constants.ts`.

## Key deviations (preserve behaviour / parity)

### 1. Contract names PascalCased
HyperIndex PascalCases contract names in the chain config but **not** the
top-level contract definitions, and the two must match by name for events to
bind. All config contract names were therefore renamed to PascalCase
(`rocketTokenRETH` → `RocketTokenRETH`, etc.) and the same names are used in
`indexer.onEvent` / `contractRegister` / `simulate`. Data unaffected — these are
indexer-internal names, not entity ids or field values.

### 2. Entity IDs use `logIndex` (not `transactionLogIndex`)
The subgraph's `generalUtilities.extractIdForEntity` builds ids as
`event.transaction.hash.toHex() + "-" + event.logIndex.toString()`. It already
uses `logIndex` (not `transactionLogIndex`), so the id is reproduced
byte-for-byte with `event.transaction.hash.toLowerCase() + "-" + event.logIndex`.
`transactionLogIndex` is **not** used by any in-scope id.
(`src/mappings/rocketSmoothingPool.ts` references `event.transactionLogIndex` only
inside a re-constructed `NodeRegistered` event whose handler the manifest does
**not** register — omitted, see deviation 4.)

### 3. `Bytes` → `String`
`RocketETHTransaction.transactionHash`, `RPLRewardClaim.transactionHash` and
`RPLRewardSubmitted.merkleRoot` were `Bytes` in the schema; ported to lowercase
`0x…` hex `String` (subgraph stored lowercase). All addresses are lowercased via
the `a()` helper before use in ids/fields.

### 4. Omitted / unwired source code (matches the manifest, not dead code)
- **`handleIncrementNodeFinalisedMinipoolCount`** — a Solidity **call** handler
  in the source, explicitly disabled there ("call handlers don't work on
  goerli") and never active on the deployed subgraph. HyperIndex has no call
  handlers, so it is omitted; `Minipool.finalizedBlockTime` and the
  finalized-minipool node counters stay at their created defaults, matching the
  deployed subgraph.
- **`rocketSmoothingPool` `NodeRegistered` / `NodeRewardNetworkChanged` /
  `NodeTimezoneLocationSet`** — present in the mapping file but the manifest only
  registers `NodeSmoothingPoolStateChanged` for that data source. Only the
  registered event is wired.
- **`stakerUtilities` reward-checkpoint helpers**
  (`updateNetworkStakerBalanceCheckpoint*`, `getETHRewardsSincePreviousStakerBalanceCheckpoint`)
  reference fields (`totalStakerETHRewards`, `totalStakersWithETHRewards`) that
  do **not** exist on the current `NetworkStakerBalanceCheckpoint` schema and are
  never called from any handler — dead code, not ported.
- The duplicate-event dedup in `handleBalancesUpdated`
  (`hasNetworkStakerBalanceCheckpointHasBeenIndexed`) is **commented out** in the
  source (disabled 2023-02-21) — not ported, matching the deployed behavior.

### 5. Preserved upstream quirks/bugs (for parity)
- **Daily-snapshot bug:** in `handleBalancesUpdated`,
  `previousRocketETHDailySnapshot` is loaded with `snapshotId.toString()` rather
  than `previousSnapshotId.toString()`, and the computed `midnightExchange` /
  `priorDayPercentage` are never persisted (the prior snapshot is re-saved
  unchanged). Reproduced exactly.
- **Timezone change does not re-point the node:** `handleNodeTimezoneChanged`
  adjusts old/new `NetworkNodeTimezone` counters but never updates
  `node.timezone` and never saves the node. When old == new timezone, the new
  timezone is re-loaded *before* the decrement is persisted, so the net counter
  change is +0. Reproduced via fresh context loads.
- **graph-node integer/decimal semantics:** all `BigInt` math uses JS `bigint`
  (truncating division, matching graph-node). `BigDecimal` is bignumber.js
  (re-exported by envio); `BigInt.fromString(bd.truncate(0).toString())` is
  reproduced as `bigDecimalToBigInt` (ROUND_DOWN → integer string).
- **`RPLRewardClaim` is dropped when `amount == 0 || ethAmount == 0`** and
  **`NetworkNodeBalanceCheckpoint` is dropped when `rplPrice == 0`** — both
  factory null-guards preserved.

## Known gaps

- **Finalized minipools** are not tracked (deviation 4, call handler) — same as
  the deployed subgraph.
- **Offline test coverage:** the two shipped vitest suites cover the
  network-balances checkpoint/daily-snapshot flow and the rETH transfer/mint
  flow (the two flows the brief requires) with exact asserted values and mocked
  eth_calls. Node / minipool / rewards flows depend on dynamically-created
  `Node`/`Minipool` entities and a long chain of eth_calls that are impractical
  to seed offline; they are covered by the bounded validation run below rather
  than unit tests.
- Deep-history parity past the validation window is bounded by the upstream
  subgraph's own staleness (community-maintained, ~2023).

## Verification

```
cd rocket-pool
pnpm install
pnpm codegen
pnpm build      # tsc --noEmit, zero errors
pnpm test       # offline vitest, 4 tests
```

### Bounded validation run

`config.yaml` pins `start_block: 13325241` (earliest in-scope data source). For a
bounded run, uncomment `end_block: 13375250` (start of the staker/network
sources `13325250` + 50k) in `config.yaml`, then index and diff against the
subgraph with `tools/compare` using `validation.json`
(`blockRange` 13325250 → 13375250, `GRAPH_API_KEY` in env). Set
`RPC_URL_1` so the eth_call Effects can resolve (they are cached).
