# b14g subgraph → HyperIndex migration

Port of the **b14g BTC restaking / dualCORE** subgraph (`b14glabs/b14g-core-subgraph`)
to Envio HyperIndex (envio `3.1.2`, TypeScript). Target chain: **Core Chain, id 1116**.

## Source

- Repo: `https://github.com/b14g-core-subgraph` (cloned at `/tmp/sources/b14g-subgraph`)
- Commit: `20c0293c7d94098a4332bbfcb38120940e711c16` (2026-02-24)
- Network: `core` (chain id 1116); `subgraph.yaml` specVersion 0.0.7, grafted base
  `QmegFjrcWbrkKhKDcU7moYPLaTkUeerfCuE4ce42M8SUmn` @ block 32863140 (graft is a
  graph-node deploy detail; not relevant to a fresh HyperIndex backfill).

## Scope

Full-fidelity Core-Chain port of **all** data sources + handlers in the manifest.
The manifest defines **9 data sources, all with static addresses** — there are **no
`templates:`**, so no dynamic contract registration is required (see "Dynamic
registration" below).

| Data source (config name) | Address | Start block | Source mapping |
|---|---|---|---|
| `DualCoreToken` (ERC20) | `0xc555…0f4F` | 21009080 | `src/mappings/dualCore.ts` |
| `Marketplace` | `0x04EA…8967` | 19942200 | `src/mappings/marketplace.ts` |
| `BitcoinStake` (precompile) | `0x0000…1014` | 19942200 | `src/mappings/bitcoinStake.ts` |
| `CoreVault` | `0xee21…B83F` | 21007765 | `src/mappings/coreVault.ts` |
| `Lottery` | `0x6064…5566` | 23448492 | `src/mappings/lottery.ts` |
| `Yield` (YieldBTC NFT) | `0xaC12…f679` | 23448534 | `src/mappings/yieldBtc.ts` |
| `LendingVault` | `0xa3CD…1C27` | 24169296 | `src/mappings/lendingVault.ts` |
| `FairShare` | `0x13E3…04b1` | 25900000 | `src/mappings/fairShare.ts` |
| `LendingVaultV2` | `0xdf03…2481` | 26875120 | `src/mappings/lendingVaultV2.ts` |

> The orchestrator brief named DualCoreToken/Marketplace/BitcoinStake/CoreVault +
> lending vaults; the manifest additionally has **Lottery, Yield, FairShare**. All
> are ported here for completeness (they are tightly coupled — e.g. ClaimProxy reads
> YieldBTC/Lottery, BitcoinStake fills Order BTC data).

## File map (port → source)

| HyperIndex file | Source |
|---|---|
| `schema.graphql` | `schema.graphql` (1:1, see deviations) |
| `config.yaml` | `subgraph.yaml` |
| `src/constants.ts` | address/enum constants from `src/mappings/helpers.ts` |
| `src/utils/index.ts` | `Bytes` id helpers (`getId`, `concatI32`, `concat`), BigDecimal config |
| `src/services/helpers.ts` | `createUser/createVault/createTransaction/createUserActionCount/createLottery/createLotteryRound/handleVaultAction/handleOrderAction` |
| `src/services/apy.ts` | `aprToApy`/`calculateApy` (lending vault APY math) |
| `src/effects/calls.ts` | eth_call layer + offline mock (`B14G_CALL_MOCK`) |
| `src/effects/contracts.ts` | typed wrappers for every `Contract.bind().fn()` read |
| `src/handlers/dualCore.ts` | `dualCore.ts` |
| `src/handlers/marketplace.ts` | `marketplace.ts` |
| `src/handlers/bitcoinStake.ts` | `bitcoinStake.ts` |
| `src/handlers/coreVault.ts` | `coreVault.ts` |
| `src/handlers/lottery.ts` | `lottery.ts` |
| `src/handlers/yieldBtc.ts` | `yieldBtc.ts` |
| `src/handlers/fairShare.ts` | `fairShare.ts` |
| `src/handlers/lendingVault.ts` | `lendingVault.ts` |
| `src/handlers/lendingVaultV2.ts` | `lendingVaultV2.ts` |

## Dynamic registration

**None used.** Every data source has a static address in `subgraph.yaml`; the source
mappings instantiate no `DataSourceTemplate`. The lending vaults (`LendingVault`,
`LendingVaultV2`) and the marketplace strategy contracts the brief flagged as
"possibly dynamic" are all fixed singletons, registered with static addresses in
`config.yaml`. No `indexer.contractRegister` is needed. (If a future version adds
per-vault templates, the pattern would be an address-less contract entry + a
`contractRegister` keyed off a factory event.)

## eth_call → Effect table

graph-node binds (`Contract.bind(addr).fn()`) are ported to a single cached
`ethCall` Effect (`src/effects/calls.ts`) with typed wrappers in
`src/effects/contracts.ts`. All are **block-pinned to `event.block.number`** (the
source reads contract *state*, which graph-node pins to the event block). RPC env:
`RPC_URL_1116`. Offline mock via `B14G_CALL_MOCK`.

| Handler | Source bind | Wrapper | Pinned | Null handling |
|---|---|---|---|---|
| Marketplace `CreateRewardReceiver` | `Marketplace.fee()` | `marketplaceFee` | yes | `?? 0n` |
| Marketplace `CreateRewardReceiver` (FairShare) | `FairShareOrder.getOwnerOfReceiver(receiver)` | `getOwnerOfReceiver` | yes | keep `from` if null |
| BitcoinStake `delegated` | `BitcoinStake.btcTxMap(txid).lockTime` | `btcTxMapLockTime` | yes | `?? 0` |
| CoreVault `ReInvest` | `CoreVault.totalStaked()` | `coreVaultTotalStaked` | yes | `?? 0n` |
| CoreVault `ClaimReward` | `CoreVault.exchangeCore(1e18)` | `coreVaultExchangeCore` | yes | `?? 0n` |
| Yield `Transfer` (mint) | `Yield.tokenIdToRewardReceiver(tokenId)` | `tokenIdToRewardReceiver` | yes | early-return on null |
| LendingVault/V2 `ClaimRewardFromStrategy` | `fee()`, `lastRoundClaim()`, `rewardDataLog()/accPerShareLog()`, `Pyth.getEmaPriceUnsafe()`, `ColendPool.getReserveData().currentLiquidityRate` | `vaultFee`, `lastRoundClaim`, `rewardDataLogAccPerShare`/`accPerShareLog`, `pythEmaPrice`, `colendCurrentLiquidityRate` | yes | `?? 0n` |
| LendingVault/V2 `CoreInvest` | `MarketplaceStrategy.totalStaked()` | `strategyTotalStaked` | yes | `?? 0n` |

> **try_ semantics.** The source uses *non-*`try_` binds, which in graph-node revert
> the whole handler on a failed call. We do not reproduce a hard revert (it would
> halt the indexer); instead a reverted/empty call resolves to `null` and the handler
> substitutes the documented sentinel (`?? 0n` / early-return). In practice these
> reads target live singletons that don't revert in-range.

## Intentional deviations (for parity / for envio)

1. **Entity type → `String` ids.** Schema `Bytes`/`ID`/`Bytes!` ids → `id: ID!`
   strings; all `Bytes` fields → `String` storing **lowercase** `0x` hex
   (`validator`, `bitcoinLockTx`, `owner`, `txHash`, `to`, `from`, `winners`,
   `endRoundTx`, `randomnessId`, `transaction`). Addresses/hashes are lowercased on
   the way in (`low()`), matching graph-node's lowercase byte storage.
2. **`@derivedFrom` widened to lists.** Two source fields were *single* derived refs
   (`User.fairShareActionCount: FairShareActionCount @derivedFrom`,
   `Order.yieldBtc: YieldBTC! @derivedFrom`). envio requires `@derivedFrom` targets to
   be `[T!]!`, so both are widened to lists. Derived fields are not stored/queried in
   handlers → **no effect on stored entity data**.
3. **`@entity(immutable: …)` removed** (HyperIndex types are plain `type X`).
4. **`event.transactionLogIndex` → `event.logIndex`.** The source `getId` uses
   `event.transaction.hash.concatI32(event.logIndex.toI32())` — it already uses the
   block-level `logIndex`, so no change in semantics. `getId`/`concatI32` are
   reimplemented in `src/utils` (`txHash` bytes + 4-byte big-endian logIndex,
   lowercase hex).
5. **`btcAmount == 0` division guard.** `handleOrderAction` computes
   `realtimeStakeAmount / btcAmount`. graph-ts `BigInt.div(0)` reverts the handler;
   JS `bigint / 0n` throws. We guard `btcAmount === 0n -> realtimeTier = 0n` to avoid
   crashing when an order is staked before its BTC lock is recorded. (In normal flow
   `btcAmount` is set by `BitcoinStake.delegated` before staking, so the guard rarely
   fires.)
6. **PARITY BUG preserved — `ClaimProxy` YieldBTC update is dropped.** The source
   mutates `yieldBtc.roundReward`/`updatedRound` inside `handleClaimProxy` but never
   calls `yieldBtc.save()`, so graph-node **discards** the change. We deliberately do
   **not** persist it (see `src/handlers/marketplace.ts`).
7. **PARITY — `MigrateStake` actionCount.migrate.** The source's
   `actionCount.migrate` starts `undefined`; AssemblyScript `if (migrate == 1)` /
   `migrate += 1` yields `1` on first call. Mirrored explicitly in
   `lendingVaultV2.ts` (`undefined → 1`).
8. **Lottery `Deposit`/`Withdraw` key by raw tx hash.** The source intentionally keys
   the aggregated `VaultAction`/`Transaction` by `event.transaction.hash` (so multiple
   receivers in one tx accumulate) while the `transaction` *reference* field uses
   `getId`. Both preserved exactly.
9. **`Stats` lazy creation.** `handleVaultAction`/`handleOrderAction` are no-ops until
   the `Stats("b14g")` singleton exists (created lazily by `createUser` /
   `CreateRewardReceiver` / `ClaimProxy`). Preserved — this is real subgraph behavior.
10. **`UpdateMaxCap` not indexed.** The source has `handleMaxCapChange`, but the
    CoreVault data source in `subgraph.yaml` registers **no** `UpdateMaxCap` handler,
    so it is not ported (matches the manifest, not the orphan function).
11. **HyperSync endpoint pinned.** `config.yaml` sets
    `hypersync_config.url: https://1116.hypersync.xyz` (codegen requires an explicit
    endpoint for chain 1116). `rollback_on_reorg: false`. `field_selection` is minimal
    (`transaction_fields: [hash]`, plus `from` only where a handler reads
    `event.transaction.from`).

## BigInt / BigDecimal semantics

- All counters/amounts are `BigInt` (JS `bigint`); JS `/` truncates toward zero,
  matching graph-ts `BigInt.div`.
- The lending-vault APY math (`aprToApy` 4-term Taylor series, `calculateApy`) is
  ported with `envio`'s `BigDecimal` (bignumber.js), configured for 34 decimal
  places / no exponential notation (graph-node BigDecimal approximation). Final
  truncation `wbtcApy.toString().split(".")[0]` is preserved byte-for-byte.

## Tests (offline, no network)

`pnpm test` (vitest, `createTestIndexer` + `simulate`, eth_calls mocked via
`B14G_CALL_MOCK`):

- `test/marketplace-flow.test.ts` — `CreateRewardReceiver` (MERGE_ORDER, mocked
  `Marketplace.fee()=500`) → `StakeCoreProxy`. Asserts exact `Order` (fee, portion,
  type, stake=1/total=2, realtimeStakeAmount=1000, tier=0), `OrderAction` ×2,
  `Stats.totalCoreStaked=1000`, `OrderActionCount`, `StakedInOrder`,
  `User.coreStakedInOrder`, `Transaction`.
- `test/corevault-flow.test.ts` — seeded `Stats` → `CoreVault.Stake` (Vault/Stats/
  UserActionCount/VaultAction) → `CoreVault.ClaimReward` (reward>0, mocked
  `exchangeCore(1e18)`) storing `VaultExchangeRate` and adding the reward to
  `Stats.totalCoreStaked` (1000 → 1200). Exact asserted values.

**Coverage notes / seeding.** Tests seed `Stats` where the subgraph would otherwise
have created it lazily upstream (documented in deviation #9). Dynamic creation of the
full Order→YieldBTC→Lottery chain across data sources is impractical to seed in one
offline test; the two flows above cover the order/stake and vault/reward accounting
that the brief required.

## Validation (`validation.json`)

- Chain 1116, block range **19942200 → 19992200** (start + 50k), as configured by the
  commented `end_block` in `config.yaml`.
- **Subgraph endpoint is a TODO.** The b14g subgraph is deployed to **Core DAO's
  self-hosted graph-node** (`https://thegraph.coredao.org/deploy/`, name
  `b14g-core-subgraph`) — *not* The Graph decentralized gateway — so there is no
  `gateway.thegraph.com/api/subgraphs/id/<ID>`. `validation.json` uses the graph-node
  `/subgraphs/name/b14g-core-subgraph` convention (likely unauthenticated). **Confirm
  the exact query path before running `tools/compare`.**
- **Range caveat.** Within 19942200–19992200 only `Marketplace` and `BitcoinStake`
  are live (every other contract deploys at ≥ 21007765). A meaningful diff of the
  vault/lottery/lending entities needs a later range (e.g. ≥ 26875120 for V2). The
  start+50k range primarily validates the order/marketplace + BTC-lock accounting.

## Bounded run (validation)

1. Uncomment `# end_block: 19992200` in `config.yaml` (or set a later range per the
   caveat above).
2. `export RPC_URL_1116=<core-rpc>` (needed only for the eth_call Effects).
3. `pnpm codegen && pnpm dev` (or `pnpm start`) to backfill the bounded range.
4. Point `validation.json.local.url` at the local Hasura endpoint and run
   `tools/compare`.

## Verification

`pnpm install` → `pnpm codegen` → `pnpm build` (tsc --noEmit, 0 errors) →
`pnpm test` (2 files, 2 tests passing).

## Known gaps

- Subgraph query endpoint unverified (see Validation).
- The lending-vault APY values depend on live `Pyth`/`Colend` reads; far-decimal
  `BigDecimal` results may differ slightly from graph-node (compare with tolerance).
- `event.transaction.from` is only available where `field_selection` includes `from`
  (CoreVault.ReInvest, Lottery.Start/EndRound/RequestRandomness/FullfillRandomness);
  configured accordingly.
