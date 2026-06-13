# EigenLayer Sidecar → HyperIndex migration (on-chain core slice)

- **Source:** [Layr-Labs/sidecar](https://github.com/Layr-Labs/sidecar), commit
  `46e8cf43071ebd4dd0b3263ba3fbf11269ed2fa4` (2026-06-02), cloned at
  `/tmp/sources/eigenlayer-sidecar`.
- **Target:** Envio HyperIndex `3.1.2`, TypeScript, Ethereum mainnet (chain 1).
- **Genesis / start block:** `17445563` (sidecar `internal/config/config.go`
  `GetGenesisBlockNumber()` for `Chain_Mainnet`).

The sidecar is a custom **Go** service (405 Go files + a large Postgres model)
that does on-chain event indexing **plus** heavy off-chain computation (reward
merkle distribution roots, state roots, block-by-block staker/operator share
snapshots, operator-set reward math). HyperIndex is an event-driven EVM indexer,
so this port reproduces the **on-chain, event-derivable core state only** and
**defers** the off-chain computation. This is a deliberate "core slice."

---

## IN-SCOPE (faithfully ported)

Event-derived current state + per-event records:

| Domain | Entities | Sidecar source (SQL table / model) |
|---|---|---|
| Operators | `Operator` | denormalized from `OperatorRegistered`/`OperatorMetadataURIUpdated`/`OperatorDetailsModified`/`DelegationApproverUpdated` logs (sidecar keeps no single operators table; metadata lives in `transaction_logs`) |
| Delegation | `Staker`, `StakerDelegationChange` | `delegated_stakers` (cumulative), `staker_delegation_changes` (delta) |
| Operator shares | `OperatorShares`, `OperatorShareDelta` | `operator_shares` (cumulative), `operator_share_deltas` (delta) |
| Staker shares | `StakerShares`, `StakerShareDelta` | `staker_shares` (cumulative), `staker_share_deltas` (delta) |
| Deposits | `Deposit`, `StrategyWhitelist` | `StrategyManager.Deposit` (feeds `staker_share_deltas`); `StrategyAddedToDepositWhitelist` |
| Withdrawals | `Withdrawal` (queued→completed by root) | `queued_slashing_withdrawals` / `completed_slashing_withdrawals` + legacy `WithdrawalQueued/Completed` logs |
| AVS | `Avs`, `AvsOperator`, `AvsOperatorStateChange` | `registered_avs_operators` (cumulative), `avs_operator_state_changes` (delta) |
| Rewards | `RewardSubmission`, `SubmittedDistributionRoot`, `RewardsClaimed` | `reward_submissions`, `submitted_distribution_roots`, `rewards_claimed` |
| Splits | `OperatorAVSSplit`, `OperatorPISplit`, `DefaultOperatorSplit` | `operator_avs_splits`, `operator_pi_splits`, `default_operator_splits` |
| EigenPods | `EigenPod`, `PodSharesUpdate` | `EigenPodManager.PodDeployed` / `PodSharesUpdated` |

All addresses/hex are stored **lowercase**. Event-record ids are
`txHash-logIndex`; cumulative ids follow the sidecar's natural keys
(operator=address, staker=address, operatorShares=`operator-strategy`,
stakerShares=`staker-strategy`, withdrawal=`withdrawalRoot`,
avsOperator=`operator-avs`, rewardSubmission=`rewardsSubmissionHash-strategyIndex`,
distributionRoot=`rootIndex`).

## DEFERRED (OUT OF SCOPE — not attempted)

These are what make the Sidecar a custom Go service rather than a subgraph. They
require off-chain computation rather than direct event indexing and are **not**
represented in the schema:

- **Reward merkle / distribution-root computation** — `pkg/rewards/*` "gold"
  tables, claimable-rewards calculation, the merkle tree behind
  `DistributionRootSubmitted` (we store the on-chain root event only, not the
  computed tree/leaves).
- **State-root generation** — `pkg/eigenState/stateManager`, `*_state_roots`.
- **Block-by-block snapshot accrual** — all `*_snapshots` tables
  (`staker_share_snapshots`, `operator_share_snapshots`,
  `staker_delegation_snapshots`, `operator_avs_registration_snapshots`,
  `*_split_snapshots`, etc.).
- **Operator-set reward splits math** and operator-set / allocation modeling
  (`AllocationManager` operator-sets, `operator_allocations`,
  `operator_max_magnitudes`, `encumbered_magnitudes`, operator-directed reward
  submissions). `AllocationManager` is intentionally NOT indexed.
- Multichain / TaskMailbox / certificate-verifier / KeyRegistrar contracts.

The split events (`OperatorAVSSplitBipsSet` etc.) ARE indexed as raw event
records, but the off-chain split *snapshots / applied math* are deferred.

---

## Contracts (Ethereum mainnet, from sidecar `config.go` `ContractAddresses` for `Chain_Mainnet`)

| Contract | Address | In config |
|---|---|---|
| DelegationManager | `0x39053D51B77DC0d36036Fc1fCc8Cb819df8Ef37A` | yes |
| StrategyManager | `0x858646372CC42E1A627fcE94aa7A7033e7CF075A` | yes |
| AVSDirectory | `0x135DDa560e946695d6f155dACaFC6f1F25C1F5AF` | yes |
| RewardsCoordinator | `0x7750d328b314EfFa365A0402Ccfd489B80B0adda` | yes |
| EigenPodManager | `0x91E677b07F7AF907ec9a428aafA9fc14a0d3A338` | yes |
| AllocationManager | `0x948a420b8cc1d6bfd0b6087c2e7c344a2cd0bc39` | **no (deferred)** |

These are stable proxy addresses. The implementations behind them have been
upgraded over time (M1 → M2 → "slashing" UX). See deviation 1.

---

## eth_call → Effect

**None.** Every field in scope is directly event-derived (operator details,
delegation target, share deltas, withdrawal struct, reward submission struct,
splits, pod shares are all in event payloads). No Effects / `viem` / RPC reads
are used, so there is no `EIGENLAYER_CALL_MOCK`.

---

## Key deviations (read before validating)

### 1. Contract ABI evolution across the upgrade history
The canonical proxies have had multiple implementations. The signatures differ:

- `OperatorRegistered`: genesis/M2 legacy is
  `OperatorRegistered(address indexed operator, (address earningsReceiver, address delegationApprover, uint32 stakerOptOutWindowBlocks))`;
  the 2025 slashing impl is `OperatorRegistered(address indexed operator, address delegationApprover)`.
  HyperIndex cannot declare two handlers for the same event name on one contract,
  so **the genesis-era (struct) signature is declared** — it is the one live in
  the validation window. `Operator.earningsReceiver` / `stakerOptOutWindowBlocks`
  are therefore populated; on the slashing impl they would be left from the prior
  state (the slashing impl emits `DelegationApproverUpdated`, which IS declared and
  updates `delegationApprover` only).
- `Deposit`: genesis StrategyManager emits
  `Deposit(address staker, address token, address strategy, uint256 shares)`
  (declared). A later impl dropped `token`; that variant is out of the validation
  window.
- `SlashingWithdrawalQueued/Completed`, `OperatorSharesSlashed`,
  `DelegationApproverUpdated`, and the split events are declared (uniquely named)
  but only fire after their respective 2025 upgrades — they are no-ops in the
  genesis+50k validation window.

If you index past the slashing upgrade and need the `OperatorRegistered(operator,
delegationApprover)` flat form to also populate operators, add a second contract
entry with a distinct name pointing at the same address.

### 2. Cumulative vs delta
The sidecar stores both per-event delta tables and cumulative state tables. Both
are reproduced: `*Delta`/`*Change` entities (one row per event) and the
aggregated `Operator`/`Staker`/`OperatorShares`/`StakerShares`/`AvsOperator`
rows. Cumulative `shares` is the running sum of signed deltas (increase positive,
decrease/slash negative), matching the sidecar's accumulation.

### 3. Operator entity is synthetic
The sidecar has no single operators table; operator attributes are scattered
across `transaction_logs`. The `Operator` entity here denormalizes them into one
row keyed by lowercase operator address — a convenience for the port, not a 1:1
sidecar table.

### 4. EigenPod shares accumulation
`PodSharesUpdated` is keyed by `podOwner`. We accumulate the signed `sharesDelta`
into the `EigenPod` previously registered for that owner via `PodDeployed`
(looked up by the `@index`ed `podOwner`). If shares update before a pod deploy is
seen (not expected on mainnet), only the `PodSharesUpdate` delta record is kept.
EigenPod per-pod sub-events are not indexed (no per-pod template needed — all
state is on the manager), so `PodDeployed` does NOT register a dynamic template.

### 5. `bytes32` → lowercase hex `String`; `NUMERIC`/`uint256` → `BigInt`
`shares` values are integer wei-scale and stored as `BigInt`. The withdrawal
`strategies`/`shares` arrays are stored as parallel string arrays (decimal strings
for shares, lowercase hex for strategies), since HyperIndex cannot store arrays
of `BigInt` in a single scalar list field cleanly alongside the lowercase
requirement — strategies are hex, shares are decimal strings.

---

## Validation

- Range: `17445563` → `17495563` (genesis + 50k) — see `validation.json`.
- **Cross-validation target is the Sidecar API, NOT a GraphQL subgraph.** The
  sidecar is a self-hosted Go service with a gRPC + REST API; there is no public
  hosted read endpoint and no The Graph subgraph. `validation.json` documents the
  entity → sidecar-endpoint/table mapping and leaves the URL as
  `TODO_SIDECAR_REST_API_BASE`. To validate, run a sidecar synced to mainnet and
  point `subgraph.url` at its REST base. Many sidecar read endpoints serve
  off-chain *snapshot/computed* values that have no local counterpart by design.

### Bounded run
```bash
cd eigenlayer
pnpm install
pnpm codegen
# uncomment `end_block: 17495563` in config.yaml, then:
pnpm dev   # requires HyperSync/RPC — not available in the offline sandbox
```

---

## Verification (offline, all pass)
```bash
pnpm install      # envio 3.1.2
pnpm codegen      # generates .envio types
pnpm build        # tsc --noEmit, 0 errors
pnpm test         # vitest, 2 offline tests
```

## Known gaps
- All DEFERRED items above (rewards math, state roots, snapshots, operator-sets,
  allocations, multichain).
- `RewardsSubmissionForAllEarnersCreated` (emitted by a separate hopper impl) and
  `OperatorDirectedAVSRewardsSubmissionCreated` are not declared — the former is a
  later-era variant, the latter is operator-set-directed (deferred). Only
  `AVSRewardsSubmissionCreated` and `RewardsSubmissionForAllCreated` are indexed.
- Native-ETH-strategy deltas from `PodSharesUpdated` are tracked on the EigenPod
  entity, not folded into `StakerShares` under the
  `0xbeac0…beac0` sentinel strategy (the sidecar does fold them; doing so here
  would require correlating pod owner → staker, deferred with the snapshot math).
- The legacy (M1) flat `OperatorRegistered`/`Deposit` signatures are not indexed
  (see deviation 1); only relevant past the genesis validation window.
