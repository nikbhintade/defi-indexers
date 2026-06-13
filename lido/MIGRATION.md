# Lido subgraph → HyperIndex migration

Port of the official Lido on Ethereum (stETH/wstETH liquid staking) subgraph to
Envio HyperIndex `3.1.2` (TypeScript, mainnet / chain 1).

- **Source:** `https://github.com/lidofinance/lido-subgraph.git`
- **Source commit:** `e2bd77d75ce357acd57841ae71324ec1f5f551ed` (2026-05-07)
- **Published subgraph (validation target):**
  `https://gateway.thegraph.com/api/subgraphs/id/HXfMc1jPHfFQoccWd7VMv66km75FoxVHDMvsJj5vG5vf`

## What was ported

All 16 manifest data sources and their event handlers, the full schema (1:1),
and the core accounting:

- **stETH core token** (`Lido`): submit, transfer share/balance math,
  totalPooledEther / totalShares tracking, holder & share accounting, shares
  burn, approvals, all config events.
- **LegacyOracle** (V1): oracle report → rewards, shares-to-mint, fee
  distribution (treasury/insurance/operators), per-node-operator share split,
  v1 APR (raw / before-fees / after-fees), `PostTotalShares` APR refinement.
- **NodeOperatorsRegistry**: operator add/activate/rename/reward-address,
  signing keys add/remove, keys-op-index, staking limit, stopped validators.
- **Voting** (votes, objections, config, one-off mainnet burnShares fix-up).
- **EasyTrack** (motions, objections, factories, config). Only the
  manifest-registered events are wired (the source file also defines
  `RoleGranted/RoleRevoked/RoleAdminChanged` handlers but the manifest does not
  register them — matched).
- **WithdrawalQueue**, **StakingRouter**, **HashConsensus**,
  **AccountingOracle**, **LidoDAO** (Aragon AppRepo app-versioning),
  **NodeOperatorsRegistry V2 curated/SimpleDVT modules**, **LidoV3** external
  shares.

### File map

| Source (`src/…`)                              | Port (`src/…`)                     |
| --------------------------------------------- | ---------------------------------- |
| `constants.ts`                                | `constants.ts` (mainnet only)      |
| `helpers.ts` (loaders, share math, APR, gating) | `helpers.ts`                     |
| `parser.ts`, `wcKeyCrops.ts`                  | n/a — see *Receipt parsing* below  |
| `Lido.ts`                                     | `handlers/Lido.ts`                 |
| `LegacyOracle.ts`                             | `handlers/LegacyOracle.ts`         |
| `NodeOperatorsRegistry.ts`                    | `handlers/NodeOperatorsRegistry.ts`|
| `Voting.ts`                                   | `handlers/Voting.ts`               |
| `EasyTrack.ts`                                | `handlers/EasyTrack.ts`            |
| `WithdrawalQueue.ts`                          | `handlers/WithdrawalQueue.ts`      |
| `LidoDAO.ts`                                  | `handlers/LidoDAO.ts`              |
| `StakingRouter.ts`, `HashConsensus.ts`, `AccountingOracle.ts`, `NodeOperatorsRegistryV2*Module.ts`, `LidoV3.ts` | `handlers/Misc.ts` |
| eth_calls (`Contract.bind`)                   | `effects.ts`                       |

## eth_call → Effect table

All calls funnel through a single cached `ethCall` Effect (raw calldata in,
nullable hex out) so re-runs are deterministic; `tryContractCall<T>` mirrors
`try_*` (revert / empty → `null`). Offline tests install a declarative mock via
`LIDO_CALL_MOCK` (JSON, crosses into envio's worker thread).

| Subgraph call                                          | Wrapper (`effects.ts`)        | Block pin | Mirrors |
| ------------------------------------------------------ | ----------------------------- | --------- | ------- |
| `NodeOperatorsRegistry.getRewardsDistribution(shares)` | `getRewardsDistribution`      | event block | `bind(...).getRewardsDistribution` (v1 NO share split) |
| `StakingRouter.getStakingModules()`                    | `getStakingModules`           | event block | `try_getStakingModules` (CSM NO attribution) |
| `AccountingOracle.getLastProcessingRefSlot()`          | `getLastProcessingRefSlot`    | event block | `try_getLastProcessingRefSlot` |
| `AppRepo.getLatestForContractAddress(app)`             | `getLatestSemanticVersion`    | unpinned (latest) | `try_getLatestForContractAddress().getSemanticVersion()` |
| `HashConsensus.getChainConfig()`                       | `getChainConfig`              | event block | `bind(...).getChainConfig()` |
| `Lido.getTotalPooledEther()`                           | `getTotalPooledEther`         | event block | `bind(...).getTotalPooledEther()` (Goerli BeaconValidatorsUpdated) |

State reads are pinned to `event.block.number`; the AppRepo semantic-version
read is left unpinned (immutable per implementation address), matching the
subgraph's intent.

## Key deviations (preserve behaviour / parity) — read before validating

### 1. Transaction-receipt log parsing (the central deviation)

The subgraph relies heavily on `event.receipt.logs` + a generated `parserMap`
(`parser.ts`) to read **sibling events in the same transaction**: it pairs
`Transfer`/`TransferShares`, and finds `TokenRebased`, `SharesBurnt`,
`ETHDistributed`, `Submitted`, `ExternalSharesMinted`, `ELRewardsReceived`,
`MevTxFeeReceived` within a tx. **HyperIndex does not expose the receipt.**

Port strategy: every event the parser needed is registered as a first-class
handler in `config.yaml`, and cross-event data is correlated through
**per-transaction buffer entities** (`TxMevFee`, `TransferSharesLog`) plus the
deterministic in-tx (block, logIndex) ordering of handler execution.

- **MEV fee in `LegacyOracle.Completed` (V1):** `ELRewardsReceived` /
  `MevTxFeeReceived` fire earlier in the tx, so they are buffered into
  `TxMevFee` keyed by tx hash and read back by `Completed`. Faithful.
- **`Submitted` shares (V1):** no `TransferShares` exists pre-block 14860268,
  so shares come from the ether/shares ratio exactly as upstream. Faithful.
- **mint `Transfer` (V1):** reads the `LidoSubmission` at `logIndex-1` for
  shares, or distributes oracle-report fees when a `TotalReward` exists for the
  tx. Faithful.
- **`TransferShares` (V1_SHARES+):** buffered into `TransferSharesLog` keyed by
  the matching `Transfer` id (`logIndex-1`). A same-tx `Transfer` with a
  *higher* logIndex can read it; where the subgraph needed a sibling at a
  *higher* logIndex than the current event (e.g. `Submitted` reading its later
  `TransferShares`), single-pass ordering cannot supply it and the ratio
  fallback is used. **This affects only V2/V3-era reward/rebase fidelity, none
  of which occurs in the validation range** (see below).
- **V2 `ETHDistributed`/`TokenRebased` reward distribution, CSM
  `attachNodeOperatorsEntities…`, and LidoV3 external-shares pooled-ether
  deltas** are the receipt-correlated paths most exposed to this limitation.
  They are stubbed/best-effort and clearly commented in `handlers/Lido.ts` and
  `handlers/Misc.ts`. **Not exercised in the validation range.**

### 2. Validation range is entirely protocol V1

The chosen range **`11473216 → 11523216`** (start + 50k) predates every protocol
upgrade: `TransferShares` (14860268), V2 (17266004), CSM (21043699), V3. So in
the validation window there are **no `TransferShares`, `TokenRebased`,
`ETHDistributed`, or external-shares events** — the receipt-pairing paths above
are dormant and the V1 paths (fully ported) are the ones that run. The two
offline tests target exactly these V1 paths with byte-exact assertions.

### 3. Entity IDs

- The subgraph builds most ids as `tx.hash.concatI32(logIndex)` (packed bytes).
  Bytes ids are not byte-compatible with string ids, so we use the canonical
  string form **`<txHashLower>-<logIndex>`** consistently (same convention as
  the compound-v2 port). `NodeOperatorsShares` uses `<txHashLower>-<addrLower>`
  (source used `tx.hash.concat(addr)`). Singletons (`Totals`, `Stats`,
  `CurrentFees`, `*Config`) keep the empty-string id `""` exactly as upstream.
- The source uses `event.logIndex` (graph-node already aliases
  `transactionLogIndex → logIndex`, per the comment in `parser.ts`), which is
  what HyperIndex exposes. No `event.transactionLogIndex` usage remains.
- Addresses and bytes are stored **lowercase** `0x…` hex (HyperIndex delivers
  checksummed; we `.toLowerCase()` everywhere).

### 4. `Bytes` → `String`

All `Bytes` schema fields become lowercase-hex `String` (per conventions). The
two helper entities `TransferSharesLog` and `TxMevFee` are **additions** (not in
the source schema) implementing the per-tx buffers above; they are internal and
not part of validation.

### 5. Preserved upstream quirks/bugs

- `HashConsensus.FrameConfigSet`: the source assigns `secondsPerSlot =
  chainConfig.getGenesisTime()` (a bug). Preserved for parity.
- `wcKeyCrops`: `WithdrawalCredentialsSet` in the source `store.remove()`s a
  hard-coded 3877-line list of `NodeOperatorSigningKey` ids. Reproduced as a
  no-op (those crops fall outside the V1 validation range); flagged in
  `handlers/Lido.ts`.
- LidoDAO/AppRepo: HyperIndex `contractRegister` cannot read entities or run
  effects, and the AppRepo addresses are statically known per app on mainnet,
  so the version read is done inline via the eth_call Effect rather than via a
  dynamically-registered Repo contract. Same data output.

## Known gaps

- V2/V3 reward distribution, token rebase fee split, CSM node-operator
  attribution, and LidoV3 external-shares pooled-ether tracking are not
  full-fidelity (deviation #1). They are dormant in the validation range.
- `OracleReport.itemsProcessed/itemsCount` and the `RewardDistributionState
  Changed` NO attribution depend on receipt parsing (deviation #1).
- Goerli-only correction branches in `LegacyOracle.handleCompleted` and
  `BeaconValidatorsUpdated` are omitted (mainnet port).

## Verification

```bash
cd lido
pnpm install
pnpm codegen
pnpm build      # tsc --noEmit, zero errors
pnpm test       # 2 offline vitest suites, byte-exact assertions
```

### Bounded validation run

1. In `config.yaml`, uncomment `end_block: 11523216` under chain 1.
2. `export GRAPH_API_KEY=<key>` and an `RPC_URL_1` for the eth_call Effects.
3. `pnpm envio start` to index `[11473216, 11523216]`.
4. Diff against the published subgraph with `tools/compare` using
   `validation.json`.
