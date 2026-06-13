# pendle: subgraph → HyperIndex migration

Port of the public Pendle subgraph-v3 (**Ethereum mainnet** deployment) to
envio HyperIndex 3.1.2 (TypeScript).

- **Source repo:** https://github.com/pendle-finance/subgraph-v3
- **Commit:** `edefb02587d9188f60e9434fc871d52d4bc4e5ea` ("Add README.md", 2021-09-14)
- **Manifest ported:** `subgraph-modes/mainnet.yaml` (mainnet addresses /
  start blocks; constants from `src/utils/consts-modes/mainnet_consts.ts`).

## Data sources & templates

| Kind | Name | Address | Start block |
| --- | --- | --- | --- |
| dataSource | PendleRouter | `0x1b6d3E5Da9004668E14Ca39d1553E9a46Fe842B3` | 12638048 |
| dataSource | PendleData | `0xE8A6916576832AA5504092C1cCCC46E3bB9491d6` | 12638042 |
| dataSource | UniswapFactory (V3) | `0x1F98431c8aD98523631AE4a59f267346ea31F984` | 12638048 |
| dataSource | SushiswapFactory | `0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac` | 12638048 |
| dataSource | Directory | `0x702A893f712a59be72722e4078513A1FbA5CAf2D` | 12983704 |
| template | IPendleForge | — (registered on `PendleData.ForgeAdded`) | |
| template | PendleMarket | — (registered on `PendleRouter.MarketCreated`) | |
| template | SushiswapPair | — (registered on `SushiswapFactory.PairCreated`) | |
| template | PendleLiquidityMiningV1 | — (registered on `PendleRouter.MarketCreated`, hardcoded map) | |
| template | PendleLiquidityMiningV2 | — (registered on `Directory.NewAddress`) | |

`config.yaml` chain `start_block` is `12638042` (the minimum of all sources;
PendleData starts there). Uncomment `end_block: 12688042` for bounded runs.

## File map (original → ported)

| Original | Ported |
| --- | --- |
| `subgraph-modes/mainnet.yaml` | `config.yaml` (templates → address-less contracts + `contractRegister`) |
| `schema.graphql` | `schema.graphql` (`@entity` removed, `Bytes`→`String` lowercase, list-field fixes — see deviations) |
| `src/pendle/data.ts` | `src/handlers/data.ts` |
| `src/pendle/forge.ts` | `src/handlers/forge.ts` |
| `src/pendle/router.ts` | `src/handlers/router.ts` |
| `src/pendle/market.ts` | `src/handlers/market.ts` + `updateMarketLiquidityMiningApr`/`redeemLpInterests` in `src/services/liquidity-mining.ts` |
| `src/pendle/directory.ts` | `src/handlers/directory.ts` |
| `src/pendle/liquidity-mining-v1.ts` / `-v2.ts` | `src/handlers/liquidity-mining.ts` (+ shared logic in `src/services/liquidity-mining.ts`) |
| `src/uniswap/factory.ts` | `src/handlers/uniswap.ts` + `src/services/uniswap-pools.ts` |
| `src/uniswap/pricing.ts` | `src/services/pricing.ts` |
| `src/sushiswap/factory.ts` | `src/handlers/sushiswap.ts` + `updateSushiswapPair`/`getOtApr`/`getPendlePrice` in `src/services/{liquidity-mining,pricing}.ts` |
| `src/updates.ts` | `src/services/updates.ts` |
| `src/utils/helpers.ts` | `src/services/helpers.ts` + numeric helpers in `src/utils/index.ts` |
| `src/utils/load-entity.ts` | entity loaders in `src/services/{helpers,tokens,liquidity-mining}.ts` |
| `src/utils/token-fetch.ts` | `src/services/tokens.ts` |
| `src/utils/consts-modes/mainnet_consts.ts` | `src/utils/index.ts` |
| `templates: *.create(addr)` | `indexer.contractRegister` (per the table above) |
| — | `src/effects/calls.ts`, `src/effects/contracts.ts` (eth_call layer) |

**Handlers ported** (event handlers; the two `callHandlers` are omitted — see
deviation 1):
- PendleRouter: `SwapEvent`, `Join`, `Exit`, `MarketCreated`
- PendleData: `ForgeAdded`, `NewMarketFactory`, `MarketFeesSet`
- UniswapFactory: `PoolCreated`
- SushiswapFactory: `PairCreated`
- Directory: `NewAddress`
- IPendleForge (tmpl): `NewYieldContracts`, `MintYieldTokens`, `RedeemYieldToken`
- PendleMarket (tmpl): `Sync`, `Transfer`
- SushiswapPair (tmpl): `Swap`, `Mint`, `Burn`
- PendleLiquidityMiningV1 (tmpl): `Staked`, `Withdrawn`, `PendleRewardsSettled`
- PendleLiquidityMiningV2 (tmpl): `Staked`, `Withdrawn`

`Sync(uint256 reserve0, uint256 weight0, uint256 reserve1)` — note the middle
param `weight0` (the manifest writes it positionally as `Sync(uint256,uint256,
uint256)`); the mapping reads `event.params.weight0`.

## eth_calls → Effects

All calls go through a single cached Effect `ethCall` (`src/effects/calls.ts`,
input `{to, data, block?}`, output nullable hex, `cache: true`) using viem over
`RPC_URL_1`. `try_*` semantics are mirrored: revert / empty / undecodable
return data → `null`. Typed wrappers live in `src/effects/contracts.ts`.
State-dependent reads are pinned to `event.block.number`; immutable metadata is
unpinned.

| Original call | Wrapper | Pinned |
| --- | --- | --- |
| `ERC20.try_symbol()` / `ERC20SymbolBytes.try_symbol()` | `erc20Symbol` / `erc20SymbolBytes32` | no |
| `ERC20.try_name()` / `ERC20NameBytes.try_name()` | `erc20Name` / `erc20NameBytes32` | no |
| `ERC20.try_decimals()` | `erc20Decimals` | no |
| `ERC20.totalSupply()` (non-try; OT/XYT supply after mint/redeem) | `erc20TotalSupply` | yes |
| `ERC20.balanceOf(addr)` (non-try; `getBalanceOf`) | `erc20BalanceOf` | yes |
| `ICToken.exchangeRateCurrent()` (non-try) | `cTokenExchangeRate` | yes |
| `UniswapPool.token0()` / `token1()` | `uniToken0` / `uniToken1` | no |
| `UniswapPool.slot0().sqrtPriceX96` (non-try) | `uniSlot0SqrtPrice` | yes |
| `PendleMarket.getReserves()` (non-try) | `marketGetReserves` | yes |
| `PendleMarket.totalSupply()` (non-try) | `marketTotalSupply` | yes |
| `PendleMarket.expiry()` (non-try) | `marketExpiry` | no |
| `SushiswapPair.token0()` | `sushiToken0` | no |
| `SushiswapPair.totalSupply()` / `getReserves().reserve0` | `sushiTotalSupply` / `sushiReserve0` | yes |
| `LMv1.startTime()` / `epochDuration()` | `lm1StartTime` / `lm1EpochDuration` | no |
| `LMv1.try_startTime()` ("deployed?" probe) | `lm1TryStartTime` | no |
| `LMv1.readExpiryData()` / `readEpochData()` | `lm1ReadExpiryData` / `lm1ReadEpochData` | yes |
| `LMv1.latestSetting()` / `allocationSettings()` | `lm1LatestSetting` / `lm1AllocationSettings` | yes |
| `LMv2.stakeToken()` | `lm2StakeToken` | no |
| `LMv2.startTime()` / `epochDuration()` / `totalStake()` | `lm2StartTime` / `lm2EpochDuration` / `lm2TotalStake` | yes |
| `LMv2.readEpochData(epoch,user)` | `lm2ReadEpochData` | yes |
| `PendleLpHolder.pendleMarket()` | `lpHolderPendleMarket` | no |

For offline tests, a declarative mock spec is injected via the
`PENDLE_CALL_MOCK` env var (`setCallMock` in `src/effects/calls.ts`) — needed
because the envio test indexer runs handlers in a worker thread (the spec is
JSON-serialized into the env, which the worker copies). The mock spec supports
a `tuple` result kind for struct/multi-return functions (getReserves, the LM
read* functions, slot0).

## Intentional deviations

1. **`callHandlers` omitted.** HyperIndex indexes events, not call traces. The
   manifest declares two: `PendleRouter.redeemLpInterests(address,address)`
   (`handleRedeemLpInterests` — a **no-op** in the source) and
   `PendleLiquidityMiningV1.redeemLpInterests(uint256,address)`
   (`handleRedeemLpInterests` → `redeemLpInterests`, which updates
   `UserMarketData.yieldClaimed{Raw,Usd}`). The first is a no-op so dropping it
   is exact; the second means `UserMarketData.yieldClaimed*` fields are not
   populated from LP-interest redemptions. The `redeemLpInterests` logic is
   still ported (`src/services/liquidity-mining.ts`) for completeness but has no
   event trigger. No event-derived entity is affected.
2. **Dynamic template registration moved to `contractRegister`.** The original
   calls `Template.create(addr)` from inside mapping bodies. envio requires
   template-address registration in `indexer.contractRegister`, which has no
   entity access. Consequences:
   - IPendleForge / PendleMarket / SushiswapPair / PendleLiquidityMiningV2 are
     registered from the same event whose `params` carry the address — exact.
   - PendleLiquidityMiningV1 is registered on `MarketCreated` using the
     **hardcoded market→LM map** (`hardcodedLmV1Address`, mainnet entries only),
     mirroring `hardcodedLiquidityMining`. The `LiquidityMining` entity is still
     created in the `onEvent` path via `loadLiquidityMiningV1`.
   - **SushiswapPair over-registration:** the original registers the template
     only for OT markets (`Token.type == "ot"`), which `contractRegister` can't
     test. We register **every** Sushiswap `PairCreated` pair and instead guard
     the SushiswapPair `Swap`/`Mint`/`Burn` handlers with a `SushiswapPair.get`
     existence check (non-OT pairs have no entity → skipped). The persisted
     entity set is identical; only the set of *registered* contracts is a
     superset (more events scanned, none stored).
3. **Non-`try_` calls don't abort.** graph-node aborts on a non-`try_` revert;
   the port returns `null` and substitutes a neutral value: `ERC20.totalSupply`
   / `balanceOf` → `0`, `exchangeRateCurrent` → `0`, `PendleMarket.getReserves`/
   `totalSupply`/`expiry` → `0`, `UniswapPool.slot0`/`token0`/`token1` → `0`/`""`,
   the LM read* functions → zeroed structs, `PendleLpHolder.pendleMarket` /
   `LMv2.stakeToken` → `""`. `getExpiryMarket` returning null (a revert) causes
   `PendleRewardsSettled` to skip rather than crash. These calls don't revert
   for real Pendle state, so stored data is unaffected.
4. **Missing-entity crash semantics** (AssemblyScript `Entity.load(...)!` null
   deref) are mirrored with `getOrThrow`; the original's explicit null checks
   (e.g. `getMarketLiquidityMining`, the LMv2 stake/withdraw `otpair`/`ytpair`
   loads) are kept as `.get` + `undefined` checks.
5. **`bytes32` decoding.** `Bytes32.toString()` (forgeId, marketFactoryId,
   contractType) is reproduced by `bytes32ToString` (UTF-8 decode, stop at the
   first NUL — matching AssemblyScript's null-terminated decode). Event
   `bytes32` params arrive as `0x…` hex; the test call-mock can also inject an
   already-decoded string.
6. **`fetchTokenDecimals` never returns null** — preserved quirk. In
   AssemblyScript `BigInt.fromI32(null as i32)` coerces a reverted
   `try_decimals()` to `0`, so `generateNewToken`'s `if (decimals === null)
   return` branch is dead code (never returns null). The port returns `0n` on
   revert and never null.
7. **Schema list fields.** envio forbids nullable list elements and models
   one-to-many only via `@derivedFrom`. `Transaction.{lpMints,lpBurns,swaps,
   mintYieldTokens,redeemYieldTokens}` were `[X]` (nullable-element reference
   arrays); they are now `[String!]!` id arrays. The `Transaction` entity is
   **never written by any handler** in subgraph-v3 (dead schema artifact), so
   this is moot for parity. `User.liquidityPositions` was `[LiquidityPosition!]`
   (nullable list) → `[LiquidityPosition!]!` (derived, computed). All `@entity`
   directives dropped; `Bytes` fields stored as lowercase hex.
8. **`event.transactionLogIndex` not used.** Pendle uses `event.transaction.hash`
   for `Swap`/`MintYieldToken`/`RedeemYieldToken`/`LiquidityPool` ids (one per
   tx, so collisions across logs in a tx would overwrite — preserved) and
   `event.logIndex` for `Swap.logIndex` (already block-level in the original).
   No per-transaction log index is needed.
9. **`handleSwap` YT/baseToken volume branch.** The original tests
   `inToken.underlyingAsset != ""`. In AssemblyScript a **null** string is
   `!= ""` (true), and `underlyingAsset` is only ever null or a real address
   (never `""`), so the "YT" branch is effectively *always* taken (the `else`
   is dead). Reproduced as `inToken.underlyingAsset !== ""`
   (`undefined !== ""` is true). See the comment in `src/handlers/router.ts`.
10. **`handleSync` price multiplier on `decimals0 < decimals1`.** The original
    computes `BigInt.fromI32(10).pow((xytDecimal - baseDecimal) as u8)`; a
    negative difference would wrap through the `u8` cast (undefined-ish). For
    mainnet markets `xytDecimal == baseDecimal` (multiplier `1`), so this never
    triggers; the port applies the mathematically sensible reciprocal
    (`1 / 10^|diff|`) for `diff < 0` and documents it inline.
11. **`MarketFeesSet` quirk preserved.** `protocolSwapFee` is set from
    `_swapFee` (not `_protocolSwapFee`), exactly as the original. Both
    `swapFee` and `protocolSwapFee` therefore equal `_swapFee / RONE`.
12. **`printDebug` / `DebugLog`.** Ported faithfully (sequentially-keyed
    `DebugLog` rows via a root row `"0"` counter). DebugLog is diagnostic-only
    and **excluded from `validation.json`**; under HyperIndex's parallel
    preload the sequential ids may not match graph-node, which is acceptable
    since the entity is never compared. Writes only via `context.DebugLog.*`,
    so handlers stay preload-safe.
13. **BigDecimal precision & division-by-zero.** graph-node keeps 34
    significant digits; bignumber.js (envio's `BigDecimal`) is configured to 34
    decimal places for division and non-exponential serialization
    (`src/utils/index.ts`). Far decimals of divisions may differ; `tools/compare`
    tolerates this. One semantic gap: graph-node **aborts** the handler on a
    `BigDecimal.div(0)` (so that event's writes are dropped), whereas
    bignumber.js yields `NaN`/`Infinity` and the handler continues. This can
    surface in `getLpPrice` (`reserveUSD/totalSupply`) for an empty-market
    `Sync` (totalSupply 0) and in the `impliedYield` denominator
    (`yieldBearingAssetPrice - yieldTokenPriceUSD == 0`) inside
    `updatePair{Hour,Daily}Data`. These are rare (non-empty markets with
    distinct prices avoid them); reproducing graph-node's abort-and-skip on
    every division was judged not worth wrapping every `.div`.
14. **Constants are the mainnet mode** (`mainnet_consts.ts`): `STABLE_USD_TOKENS`
    = DAI/USDC/USDT, `USDC_WETH_03_POOL` `0x8ad5…e6d8`, `WETH` `0xc02a…6cc2`,
    `PENDLE` `0x8085…a827`, `PENDLE_ETH_SUSHISWAP` `0x3792…8e43`, `RONE = 2^40`,
    `LM_ALLOC_DENOM = 1e9`, `isMainnet = true`. The kovan price branches in
    `pricing.ts` are unreachable on mainnet but kept verbatim for fidelity.

## Validation run

1. Uncomment `end_block: 12688042` in `config.yaml` (chain 1).
2. `export RPC_URL_1=<mainnet archive RPC>` — most pricing/LM/supply calls are
   block-pinned, so an archive node is required. Effects are cached
   (`cache: true`), so re-runs are cheap.
3. `pnpm codegen && pnpm dev` (or `envio start` against a configured database)
   and wait for the indexer to reach the end block.
4. Fill in the subgraph gateway URL in `validation.json` (see the note there)
   and run `tools/compare`.

Block range rationale: `12638042` is the earliest source start block; the
+50k window (~9 days, June 2021) covers Pendle's mainnet launch — the first
`ForgeAdded` (Compound/Aave forges → `initializeUniswapPools`),
`NewMarketFactory`, `MarketFeesSet`, the first `NewYieldContracts`
(YieldContract + Token creation), `MintYieldTokens`/`RedeemYieldToken` traffic,
`MarketCreated` + the first `Sync`/`Join`/`Exit` on the new markets, and the
Sushiswap OT-pair pricing path.

## Known gaps

- **`validation.json` subgraph URL is a TODO.** The subgraph-v3 README only
  links the deprecated legacy-explorer deployment
  `https://thegraph.com/legacy-explorer/subgraph/ngfam/pendle` (the legacy
  explorer is shut down). Pendle now runs newer subgraphs; the current
  decentralized-network endpoint for *this* schema must be supplied before
  `tools/compare` can run (the URL could not be resolved offline). The
  `blockRange` and entity field lists are filled in and ready.
- **LP-interest accounting (`UserMarketData.yieldClaimed*`)** is not populated
  (the source fed it from a `callHandler` — deviation 1).
- The `Directory` data source starts at block 12983704 (> the +50k validation
  window), so LMv2 / OT-APR paths are exercised only by a longer run.
- Offline tests (`PENDLE_CALL_MOCK`) cover (a) yield-contract creation
  (`NewYieldContracts`), (b) the mint flow (`MintYieldTokens`) with exact
  volume accounting, and (c) the market `Sync` reserve/weight/spot-price flow.
  Router swap/join/exit, sushiswap swap and the LM APR paths share the same
  helper code and are exercised by the bounded validation run against a live
  archive RPC.
