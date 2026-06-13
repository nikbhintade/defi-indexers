# convex: subgraph → HyperIndex migration

Port of the official Convex Finance core subgraph (**Ethereum mainnet only**)
to envio HyperIndex 3.1.2 (TypeScript).

- **Source repo:** https://github.com/convex-community/convex-subgraph
- **Commit:** `86d06ddf164624bca5dede7d11f350011dfff2da` (2026-02-01)
- **Ported package:** `subgraphs/convex` plus the used parts of the workspace
  packages `packages/const` and `packages/utils` (`pricing.ts`, `maths.ts`,
  `convex.ts`, `time.ts`, `index.ts`).
- Live (legacy) deployment: convex-community/convex on the deprecated
  hosted-service (`https://thegraph.com/hosted-service/subgraph/convex-community/convex`).

## File map (original → ported)

| Original | Ported |
| --- | --- |
| `subgraph.yaml` | `config.yaml` |
| `schema.graphql` | `schema.graphql` (Bytes → String lowercase, `@entity` removed, `@index` on `Pool.crvRewardsPool`) |
| `packages/const/index.ts` | `src/constants/index.ts` (addresses lowercased; `Address`→`string`, `BigInt`→`bigint`, `BigDecimal`→envio `BigDecimal`) |
| `packages/utils/index.ts`, `maths.ts`, `time.ts`, `src/services/utils.ts` | `src/utils/index.ts` |
| `packages/utils/pricing.ts`, `packages/utils/convex.ts` | `src/services/pricing.ts` |
| `src/mapping.ts` (Booster: addPool / shutdownPool / earmarkFees / Deposited / Withdrawn) | `src/handlers/booster.ts` |
| `src/mapping-rewards.ts` (PoolCrvRewards `queueNewRewards`) | `src/handlers/rewards.ts` |
| `src/mapping-bribes.ts` (VotiumBribe) | `src/handlers/bribes.ts` |
| `src/mapping-bribes-v2.ts` (VotiumBribeV2) | `src/handlers/bribes-v2.ts` |
| `src/mapping-3crv.ts` (ThreeCrvRewards) | `src/handlers/three-crv.ts` |
| `src/mapping-treasury.ts` (CvxCrvPol / CvxFpisPol / VoteMarketRewards) | `src/handlers/treasury.ts` |
| `src/mapping-fxs-deposits.ts` (FeeRegistry / FeeDeposit) | `src/services/revenue.ts` (`handleRewardsDistributed` logic preserved; **unreachable**, see Gaps) |
| `src/services/pools.ts` | `src/services/pools.ts` |
| `src/services/apr.ts` | `src/services/apr.ts` |
| `src/services/snapshots.ts` | `src/services/snapshots.ts` |
| `src/services/revenue.ts` | `src/services/revenue.ts` |
| `src/services/platform.ts` | `src/services/platform.ts` |
| `src/services/user.ts` | `src/services/user.ts` |
| — | `src/effects/calls.ts`, `src/effects/contracts.ts` (eth_call layer) |

## Data sources (config.yaml)

| Subgraph data source | envio contract | Address | Events used |
| --- | --- | --- | --- |
| Booster | `Booster` (static) | `0xf403…ae31` | `Deposited`, `Withdrawn` |
| VotiumBribe | `VotiumBribe` (static) | `0x19BB…4595` | `Bribed`, `UpdatedFee` |
| VotiumBribeV2 | `VotiumBribeV2` (static) | `0x6394…2D1e` | `IncreasedIncentive`, `NewIncentive`, `UpdatedFee` |
| ThreeCrvRewards | `ThreeCrvRewards` (static) | `0x7091…d2EA` | `RewardAdded` |
| CvxCrvPol | `CvxCrvPol` (static) | `0xa25B…4316` | `ClaimedReward` |
| CvxFpisPol | `CvxFpisPol` (static) | `0x8588…0361` | `ClaimedReward` |
| VoteMarketRewards | `VoteMarketRewards` (static) | `0x0000…6225` | `Claimed` |
| `PoolCrvRewards` template | `BaseRewardPool` (no address) | dynamic | `RewardAdded` (see deviation) |

`start_block` is the Booster deploy block `12450992`; later sources simply have
no events before their own deploy block. `rollback_on_reorg: false` for
deterministic bounded runs. `field_selection.transaction_fields: [hash]` is set
only where handlers build ids from the tx hash (Booster `Deposited`/`Withdrawn`,
BaseRewardPool `RewardAdded`).

## Subgraph templates → contractRegister

The manifest declares two `templates:` — `PoolCrvRewards` (BaseRewardPool ABI)
and `FeeDepositTemplate` (FeeDeposit ABI). The many `ExtraRewardStashV*`,
`CurvePool*`, `Uniswap*`, etc. ABIs in the manifest are used only for `eth_call`s,
**not** as event templates.

- `PoolCrvRewards` → `BaseRewardPool` address-less contract +
  `indexer.contractRegister` on Booster `Deposited`/`Withdrawn`. Since
  `contractRegister` cannot read entities or use `context.effect`, the reward
  pool address is obtained by reading `poolInfo(poolid).crvRewards` through the
  **raw (uncached) eth_call path** of the same call layer (this is the
  "register broadly + read on-chain" approach used by the Pendle/Pancake ports).
  This registers the reward pool the first time any deposit/withdrawal touches
  its pool — at or before the pool's first `queueNewRewards`.
- `FeeDepositTemplate` → **not ported** (see Gaps).

## eth_call → Effect table

All on-chain reads go through one cached `ethCall` Effect (`src/effects/calls.ts`,
`cache: true`, keyed on `(to, calldata, block)`), wrapped by typed helpers in
`src/effects/contracts.ts`. `try_*` semantics are mirrored: a revert / empty
return decodes to `null`. State-dependent reads are **pinned** to the triggering
event's block; immutable metadata is left **unpinned** (latest).

| Subgraph call (`Contract.try_*`) | Effect helper | Pin |
| --- | --- | --- |
| `Booster.poolInfo(pid)` | `boosterPoolInfo` | block |
| `Booster.poolLength()` (added; see deviation) | `boosterPoolLength` | block |
| `Booster.lockIncentive/earmarkIncentive/stakerIncentive/platformFee` | `booster*` | block |
| `CurveRegistry.get_pool_from_lp_token` | `registryGetPoolFromLpToken` | unpinned |
| `CurveRegistry.get_pool_name` | `registryGetPoolName` | unpinned |
| `CurveRegistry.get_virtual_price_from_lp_token` | `registryGetVirtualPriceFromLpToken` | block |
| `CurveToken.minter` | `curveTokenMinter` | unpinned |
| `CurvePool.coins(i)` | `poolCoins` | unpinned |
| `CurvePool.get_virtual_price` | `poolGetVirtualPrice` | block |
| `CurvePool.price_oracle` | `poolPriceOracle` | block |
| `CurvePoolV2.xcp_profit / xcp_profit_a` | `poolXcpProfit`, `poolXcpProfitA` | block |
| `CurveTriCryptoFactoryPool.factory` | `triCryptoPoolFactory` | unpinned |
| `OneWayLendingFactory.vaults_index / amms` | `lendingFactoryVaultsIndex/Amms` | unpinned |
| `LendingVault.collateral_token / borrowed_token` | `lendingVault*Token` | unpinned |
| `LendingVault.lend_apr / pricePerShare` | `lendingVaultLendApr/PricePerShare` | block |
| `ExtraRewardStashV1.tokenInfo()` | `stashV1TokenInfo` | unpinned |
| `ExtraRewardStashV2/V30.tokenCount / tokenInfo(i)` | `stashTokenCount`, `stashV2TokenInfo` | count=block, info=unpinned |
| `ExtraRewardStashV3x.getName / tokenList(i) / tokenInfo(addr)` | `stashGetName`, `stashTokenList`, `stashV3TokenInfo` | unpinned |
| `BaseRewardPool/VirtualBalanceRewardPool.periodFinish / totalSupply / rewardRate` | `rewardPool*` | block |
| `BaseRewardPool.historicalRewards` | `rewardPoolHistoricalRewards` | block |
| `ERC20.decimals / symbol / name` | `erc20Decimals/Symbol/Name` | unpinned |
| `ERC20.totalSupply / balanceOf` | `erc20TotalSupply/BalanceOf` | block |
| `UniswapV2Factory.getPair` / `Pair.getReserves` / `Pair.token0` | `uniV2GetPair/GetReserves/Token0` | getPair+reserves=block, token0=unpinned |
| `UniswapV3Factory.getPool` / `Quoter.quoteExactInputSingle` | `uniV3GetPool`, `uniV3QuoteExactInputSingle` | block |
| `ChainlinkAggregator.latestAnswer` | `chainlinkLatestAnswer` | block |
| `CToken.underlying / exchangeRateStored` | `cTokenUnderlying`, `cTokenExchangeRateStored` | underlying=unpinned, rate=block |
| `YToken.getPricePerFullShare` | `yTokenGetPricePerFullShare` | block |
| `RedeemableKeep3r.discount / price` | `rKp3rDiscount`, `rKp3rPrice` | block |
| `ERC20(CVX).totalSupply` (getCvxMintAmount) | `erc20TotalSupply` | block |
| `FeeDeposit.callIncentive`, `FeeRegistry.cvxIncentive/totalFees/platformIncentive` | `feeDeposit*`, `feeRegistry*` | block |

`RPC_URL_1` selects the JSON-RPC endpoint. Offline tests bypass the network via
`setCallMock` (a declarative mock spec JSON-serialized into the
`CONVEX_CALL_MOCK` env var so the worker thread that runs handlers inherits it).

## Deviations (documented for parity)

1. **Call handlers → events (the big one).** HyperIndex is event-only; the
   Booster emits no event for `addPool` / `shutdownPool` / `earmarkFees`, and
   the reward-pool template used a `queueNewRewards` callHandler. Mapping:
   - **`addPool`** → driven from the Booster `Deposited`/`Withdrawn` events.
     On each event, `ensurePoolsUpTo` reads `poolLength()` (block-pinned) and
     materializes every pool id in `[platform.poolCount, poolLength)` that does
     not exist yet, reconstructing each pool from `poolInfo(pid)`
     (`lptoken / token / gauge / crvRewards / stash`). Pids are assigned
     sequentially (`pid = poolCount`) exactly as the original
     (`pid = platform.poolCount`). **Consequence:** a pool that is added but
     never deposited into before the indexed range ends is not yet created
     (it materializes on its first Booster event). For the full subgraph range
     every pool receives deposits, so the end-state set matches.
   - **`addPool` input `_stashVersion`** is not present in `poolInfo`. It is
     reconstructed by probing the stash interface (`getName()` → v3;
     `tokenCount()` → v2; `tokenInfo()` no-arg → v1; none → 0). The original
     stored the literal call input. Observable effect is limited to
     `Pool.stashVersion` and which `getPoolExtras*` branch runs; the reward
     tokens discovered are the same.
   - **`shutdownPool`** → no event ⇒ **not ported**; pools are never set
     `active = false`. (`takePoolSnapshots` therefore keeps snapshotting them.)
   - **`earmarkFees`** → no event ⇒ **not ported**; `FeeRevenue` entities
     (which stored `BaseRewardPool.historicalRewards` of LOCK_FEES) are never
     created. The `recordFeeRevenue` / `getHistoricalRewards` code is kept in
     `src/services/revenue.ts` but unreferenced.
   - **`queueNewRewards(uint256)`** (PoolCrvRewards template) →
     `RewardAdded(uint256 reward)` event emitted by the same BaseRewardPool;
     `reward == _rewards` and `event.srcAddress == call.to`. The pid (read from
     the template `DataSourceContext` originally) is resolved via the Pool whose
     indexed `crvRewardsPool` equals the emitting address. `PoolReward.id`
     stays `txHash + '-' + rewardPoolAddress`.

2. **`getPlatform` does not persist on creation.** The original `getPlatform`
   `new`s the entity without saving; callers save after mutating. Ported
   identically (callers `context.Platform.set`).

3. **Pool state lag quirk preserved.** In `handleDeposited`/`handleWithdrawn`
   the original loads the pool, calls `takePoolSnapshots` (which loads a *fresh*
   pool copy, mutates `lpTokenUSDPrice`/`crvApr`/`cvxApr` and saves it), then
   re-saves its *stale* pool reference setting only `lpTokenBalance`,
   `curveTvlRatio`, `tvl`, `baseApr`, `rawBaseApr`. The pool's
   `lpTokenUSDPrice`/`crvApr`/`cvxApr` therefore reflect the *previous* event,
   not the just-created snapshot. We reproduce this: `getDailyPoolSnapshot`
   returns the passed-in pool unchanged when the day's snapshot already exists,
   so the handler's final write carries the same stale fields.

4. **Non-`try_` calls made tolerant.** A handful of original calls were not
   `try_` and would have aborted the subgraph on revert (`get_pool_name`,
   `getPair`, `getReserves`, `token0`, `RedeemableKeep3r.discount`, and the
   Booster fee getters in `updateDailyRevenueSnapshotForCrv`). Here they fall
   back to the same default the surrounding logic would have used (empty string
   / zero price / `0n`) instead of crashing.

5. **`getCvxMintAmount` totalSupply** was `try_` in the original (returns 0 on
   revert) and is ported as such.

6. **graph-node BigDecimal.** `bignumber.js` is configured with
   `DECIMAL_PLACES: 34` and no exponential notation to approximate graph-node's
   34-significant-digit BigDecimal (`src/utils/index.ts`). `tools/compare`
   tolerates far-decimal differences. The integer division quirk in
   `getV2LpTokenPrice` (`pool.coins.length / missingCoins`, AssemblyScript i32
   division) is reproduced with `Math.trunc`.

7. **Entity id construction is byte-for-byte.** Pool id = pid string; snapshot
   id = `name + '-' + pid + '-' + dayBucket`; revenue snapshot id = day bucket;
   deposit/withdrawal id = `txHash + '-' + logIndex`; `ExtraReward` id =
   `pid + rewardContract + rewardToken` (no separators); `FeeRevenue` id =
   timestamp; user id = lowercase address. Addresses are lowercased everywhere.

## Gaps

- **FeeDepositTemplate / FXS revenue (mapping-fxs-deposits).** The FeeDeposit
  contract is registered in the subgraph only via the `FeeRegistry.setDepositAddress`
  **callHandler**, and `FeeRegistry` emits **no events at all**. With no event to
  hook and no on-chain way to recover the deposit address inside a
  `contractRegister`, this template cannot be ported. It is omitted from
  `config.yaml`; the revenue math (`handleRewardsDistributed`) is preserved in
  `src/services/revenue.ts` for reference but is unreachable. Effect:
  `DailyRevenueSnapshot.fxs*` / `Platform.totalFxs*` fields stay at their initial
  zero values, and no `FeeDeposit` `RewardsDistributed` events are processed.
- **`shutdownPool` / `earmarkFees`** — see Deviation 1 (no events). `Pool.active`
  is always `true`; `FeeRevenue` is never populated.
- **`validation.json` subgraph URL** is `TODO` — the convex-community/convex
  subgraph README only lists the deprecated hosted-service endpoint and no
  decentralized-network id was confirmable offline (same as curve-volume).

## Build / test / bounded run

```bash
cd convex
pnpm install
pnpm codegen      # envio codegen (reads config.yaml + schema.graphql)
pnpm build        # tsc --noEmit, zero errors
pnpm test         # vitest, offline simulated events (2 tests)
```

Offline tests (`test/`):
- `add-pool.test.ts` — a `Deposited` on a new pid drives `ensurePoolsUpTo` →
  `processAddPool`, creating the `Pool` (and registering the BaseRewardPool
  template via the same `poolInfo` read) and recording the deposit. All
  eth_calls mocked.
- `deposit-withdraw.test.ts` — deposit + withdraw on a seeded pool; asserts
  exact `Pool.tvl` / `curveTvlRatio` and `DailyPoolSnapshot` deposit/withdrawal
  counts, volumes and (raw, un-decimal-adjusted) values, plus the virtual /
  USD price.

For a bounded validation run against a live RPC + the original subgraph,
uncomment `end_block: 12500992` in `config.yaml` (= start + 50_000), set
`RPC_URL_1` and `GRAPH_API_KEY`, fill the `validation.json` subgraph URL, then:

```bash
pnpm dev
node ../tools/compare/compare.mjs --config validation.json
```
