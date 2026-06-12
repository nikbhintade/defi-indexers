# curve-volume: subgraph → HyperIndex migration

Port of the official Curve Finance volume subgraph (**Ethereum mainnet only**)
to envio HyperIndex 3.1.2 (TypeScript).

- **Source repo:** https://github.com/curvefi/volume-subgraphs
- **Commit:** `757fc0e266ac467883cc7d227d92fc724822a010` ("Store tx hash on fee change", 2023-10-11)
- **Ported package:** `subgraphs/volume` (+ used parts of `packages/constants`,
  `packages/utils`), rendered with the mainnet mustache values from
  `config/mainnet.json` (network=mainnet, start block 11153725, USDN/AETH/Lido
  rebase data sources, `unknownMetapoolType=METAPOOL_FACTORY`,
  `rebasingPoolImplementations=['0x55aa9bf126bcabf0bdc17fa9e39ec9239e1ce7a9']`,
  multicall `0xeefba1e63905ef1d7acba5a8513c70307c1ce441`).

## File map (original → ported)

| Original | Ported |
| --- | --- |
| `subgraph.template.yaml` + `config/mainnet.json` | `config.yaml` |
| `schema.graphql` | `schema.graphql` (Bytes → String lowercase, `@entity` removed) |
| `packages/constants/index.template.ts` | `src/constants/index.ts` (mainnet values inlined) |
| `packages/utils/index.ts`, `maths.ts` | `src/utils/index.ts` |
| `packages/utils/time.ts` | `src/utils/time.ts` |
| `packages/utils/pricing.ts` | `src/utils/pricing.ts` |
| `src/mapping.template.ts` (event handlers) | `src/handlers/mapping.ts` + `src/services/registries.ts` (`addAddress`, `getLpToken`, `addRegistryPool`) |
| `src/mappingV2.ts` | `src/handlers/mappingV2.ts` + `src/services/registries.ts` (`addCryptoRegistryPool`) |
| `src/mapping-tricrypto.ts` | `src/handlers/mapping-tricrypto.ts` |
| `src/services/pools.ts` | `src/services/pools.ts` |
| `src/services/swaps.ts` | `src/services/swaps.ts` |
| `src/services/snapshots.ts` | `src/services/snapshots.ts` |
| `src/services/candles.ts` | `src/services/candles.ts` |
| `src/services/pricefeeds.ts` | `src/services/pricefeeds.ts` |
| `src/services/platform.ts` | `src/services/platform.ts` |
| `src/services/factory.ts` | `src/services/factory.ts` |
| `src/services/multicall.ts` | `src/services/multicall.ts` |
| `src/services/catchup.ts` | `src/services/catchup.ts` |
| `src/services/rebase/snapshots.ts` | `src/services/rebase/snapshots.ts` |
| `src/services/rebase/rebase.template.ts` + `rebase/mainnet.ts` | `src/services/rebase/mainnet.ts` |
| `src/services/rebase/mappingUsdn.ts`, `mappingAeth.ts`, `mappingLido.ts` | `src/handlers/rebase.ts` |
| `templates:` (subgraph manifest) | `src/handlers/registration.ts` (`indexer.contractRegister`) |
| — | `src/effects/calls.ts`, `src/effects/contracts.ts` (eth_call layer) |

## Subgraph templates → contractRegister

Template instantiation maps to address-less contracts in `config.yaml` plus
`indexer.contractRegister` handlers (`src/handlers/registration.ts`):

| Subgraph template | envio contract | Registered from |
| --- | --- | --- |
| `RegistryTemplate` (MainRegistry) | `MainRegistry` | AddressProvider id=0 |
| `StableFactoryTemplate` | `StableFactory` | AddressProvider id=3 / id=8 (crvUSD) |
| `CryptoRegistryTemplate` | `CryptoRegistry` | AddressProvider id=5 |
| `CryptoFactoryTemplate` | `CryptoFactory` | AddressProvider id=6 |
| `TriCryptoFactoryTemplate` | `TriCryptoFactory` | AddressProvider id=11 |
| `CurvePoolTemplate` | `CurvePool` | main-registry PoolAdded (non-EARLY_V2), stable-factory deploys, catch-up |
| `CurvePoolTemplateV2` | `CurvePoolV2` | EARLY_V2 registry pools, crypto registry/factory pools, catch-up |
| `TriCryptoOptimizedTemplateV2` | `CurveTricryptoOptimized` | TricryptoPoolDeployed, tricrypto catch-up |

Duplicate registration is guarded the same way as the original on the entity
side (Registry/Factory/Pool existence checks in `addAddress` /
`createNewRegistryPool`); on the registration side envio deduplicates
addresses, plus an in-memory `caughtUp` set avoids re-enumerating registries.

`contractRegister` handlers have no `context.effect` and no entity access, so:

- registry/factory catch-up enumerates `pool_count`/`pool_list` via raw
  (uncached) eth_calls pinned to the event block;
- stable/crypto factory deploy events (which don't carry the pool address)
  use an in-memory per-factory cursor + `pool_count` at the event block
  instead of the original's entity-tracked `poolCount`. End-of-block state
  covers same-block multi-deploys; on process restart the cursor resets and
  pools are re-registered from index 0 (idempotent, just extra RPC).

The entity side (`createNewFactoryPool`) keeps the original's
`Factory.poolCount` accounting and resolves the deployed pool with
`pool_list(poolCount)` pinned to the event block, exactly like graph-node did.

## eth_calls → Effects

All calls go through a single cached Effect `ethCall`
(`src/effects/calls.ts`, input `{to, data, block?}`, output nullable hex,
`cache: true`) using viem over `RPC_URL_1`. `try_*` semantics are mirrored:
revert / empty return data → `null`. Typed wrappers live in
`src/effects/contracts.ts`. Block pinning policy: pinned to
`event.block.number` for state-dependent reads, unpinned for immutable
metadata:

| Original call | Wrapper | Pinned |
| --- | --- | --- |
| `ERC20.try_decimals/try_symbol/name` | `erc20Decimals/erc20Symbol/erc20Name` | no (immutable) |
| `ERC20.try_totalSupply/try_balanceOf` | `erc20TotalSupply/erc20BalanceOf` | yes |
| `CurvePool(.Coin128).try_coins` | `poolCoins/poolCoins128` | no (immutable) |
| `CurveLendingPool(.Coin128).try_underlying_coins` | `poolUnderlyingCoins(128)` | no (immutable) |
| `MetaPool.try_base_pool` | `metaPoolBasePool` | no (immutable) |
| `CurvePoolV2.try_get_virtual_price/try_balances/try_A/try_fee/try_admin_fee/try_xcp_profit(_a)/try_price_oracle` | `poolVirtualPrice/poolBalances(128)/poolA/poolFee/poolAdminFee/poolXcpProfit(A)/poolPriceOracle` | yes |
| `CurveTricryptoOptimized.try_ADMIN_FEE` | `poolAdminFeeNg` | yes |
| `CurveLendingPool.try_offpeg_fee_multiplier` | `poolOffPegFeeMultiplier` | yes |
| `MainRegistry.try_get_lp_token/try_pool_count/try_pool_list` | `registryGetLpToken/registryPoolCount/registryPoolList` | yes |
| `StableFactory.pool_list/try_get_implementation_address` | `registryPoolList/factoryGetImplementationAddress` | yes |
| `CryptoFactory.pool_list/get_token` | `registryPoolList/cryptoFactoryGetToken` | yes |
| `TriCryptoFactory.try_pool_count/try_pool_list` | `registryPoolCount/registryPoolList` | yes |
| `UniswapV2Factory.getPair`, `Pair.getReserves` | `uniV2GetPair/uniV2GetReserves` | yes |
| `Pair.token0` | `uniV2Token0` | no (immutable) |
| `UniswapV3Factory.try_getPool`, `Quoter.try_quoteExactInputSingle` | `uniV3GetPool/uniV3QuoteExactInputSingle` | yes |
| `ChainlinkAggregator.try_latestAnswer` | `chainlinkLatestAnswer` | yes |
| `CToken.try_underlying` | `cTokenUnderlying` | no (immutable) |
| `CToken.try_exchangeRateStored`, `YToken.try_getPricePerFullShare` | `cTokenExchangeRateStored/yTokenGetPricePerFullShare` | yes |
| `AToken.try_totalSupply/try_scaledTotalSupply` | `erc20TotalSupply/aTokenScaledTotalSupply` | yes |
| `LidoOracle.try_getLastCompletedReportDelta` | `lidoGetLastCompletedReportDelta` | yes |
| `Multicall.aggregate(...)` (`fillV2PoolParamsSnapshot`) | `multicallAggregate` (atomic `aggregate` call, same raw selectors) | yes |
| `USDN.try_totalSupply` | `erc20TotalSupply` | yes |

For offline tests, a declarative mock spec can be injected via the
`CURVE_VOLUME_CALL_MOCK` env var (`setCallMock` in `src/effects/calls.ts`) —
necessary because the envio test indexer runs handlers in a worker thread.

## Intentional deviations

1. **Call handler not ported.** The original registered a mainnet call
   handler `handleAddExistingMetaPools` (`add_existing_metapools(address[10])`
   on StableFactory templates) that only bumps `Factory.poolCount`. envio has
   no call handlers. If `add_existing_metapools` is invoked on a factory
   *after* it was added to the address provider, `Factory.poolCount` (and
   thereby the `pool_list(poolCount)` lookups for subsequent deploys) can
   drift versus the subgraph. Calls made *before* the factory was indexed are
   covered by the catch-up's initial `pool_count`. The address registration
   side is unaffected (it uses on-chain `pool_count`). Not relevant in the
   chosen validation range.
2. **Non-`try` calls that would crash graph-node** are mapped to
   nullable-effect fallbacks instead of aborting:
   `ERC20.name()/symbol()` → `""`; `factory.pool_list(poolCount)` → log error
   and skip pool; `CryptoFactory.get_token` (catch-up) → skip pool;
   `getPair/getReserves/token0` failures → zero price.
3. **`admin_fee` truthy-check bug:** the original tested
   `if (adminFeeResult)` on a `CallResult` (always true), so a reverted
   `admin_fee()` would have trapped before reaching the tricrypto-NG
   `ADMIN_FEE()` fallback. The port follows the intent: revert →
   try `ADMIN_FEE()`.
4. **BigDecimal precision:** graph-node keeps 34 significant digits;
   bignumber.js (envio's BigDecimal) is configured to 34 decimal places for
   division and non-exponential serialization (`src/utils/index.ts`). Far
   decimals of division results may differ; `tools/compare` tolerates this.
5. **Stale-pool overwrite preserved:** `handleExchange` loads the pool before
   `takePoolSnapshots` and writes cumulative volume from that stale copy at
   the end (overwriting virtualPrice/baseApr/cumulativeFeesUSD updates made
   by the snapshot pass for the swapped pool in the same handler) — exactly
   like the AssemblyScript original.
6. **Other faithfully-preserved quirks:** `DailyPlatformSnapshot` is re-zeroed
   on every `takePoolSnapshots` invocation (so intra-day swaps overwrite it
   with zeros, as in the original); `Platform.latestPoolSnapshot` is never
   updated (so the early-exit never fires); the AETH deductible APR always
   computes to zero (both snapshot reads use the same day, original bug);
   `getName` returns the token *symbol*; the `offPegFeeMultiplier` snapshot
   field is only refreshed when the previous day's value was non-null.
7. **Lido/AETH/USDN data sources** start at the chain start block (11153725)
   instead of their individual subgraph start blocks (11473216 / 14487995 /
   11153725) — they emit no relevant events before deployment, so stored data
   is identical.

## Validation run

1. Uncomment `end_block: 11193725` in `config.yaml` (chain 1).
2. `export RPC_URL_1=<mainnet archive RPC>` (calls are block-pinned; an
   archive node is required). Effects are cached (`cache: true`), so re-runs
   are cheap.
3. `pnpm codegen && pnpm dev` (or `envio start` with a configured database)
   and wait for the indexer to reach the end block.
4. Fill in the subgraph gateway URL in `validation.json` (see the note there —
   the README only lists the deprecated hosted-service endpoint for
   `convex-community/volume-mainnet`) and run `tools/compare`.

Block range rationale: 11153725 is the subgraph's mainnet start block; the
+40k window (~6 days) covers the main registry being added to the address
provider, registry pool additions and live swap volume/snapshot/candle math.

## Known gaps

- `add_existing_metapools` call-handler accounting (deviation 1).
- `validation.json` subgraph URL is a TODO (decentralized-network ID for
  `volume-mainnet` could not be resolved offline).
- The offline tests cover the registration flow and the swap flow
  (snapshots/candles/pricefeeds) with mocked eth_calls; the
  `takePoolSnapshots` daily-snapshot path and the Uniswap-based pricing
  ladder execute real (cached) eth_calls and are exercised by the bounded
  validation run instead.
- `LiquidityVolumeSnapshot` exists in the schema (as in the original) but no
  handler writes it — the original volume subgraph doesn't track liquidity
  events either (see repo README).
