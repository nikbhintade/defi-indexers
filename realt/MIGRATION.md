# RealT RMM (Aave V2 fork, Gnosis Chain) → HyperIndex migration

Port of the **realtoken-thegraph/protocol-subgraphs** repo (RealT's "RMM" — RealT
Money Market, an Aave V2 fork on Gnosis Chain / xDai, chain id 100) to Envio
HyperIndex (`envio@3.1.2`, TypeScript).

- Source repo: https://github.com/realtoken-thegraph/protocol-subgraphs
- Source commit: `dc4cb196d2642895a9d7adeceaa524577533c0f6`
- Rendered manifest variant: `templates/gnosis.subgraph.template.yaml` with
  `config/gnosis-v2.json` (`NETWORK=gnosis VERSION=v2 BLOCKCHAIN=gnosis`).
- Schema ported 1:1 from `schemas/v2.schema.graphql`.
- Closest reference port in this repo: `../aave-v3` (RealT is an Aave-fork money
  market; the registry → addressesProvider → pool → token-template chain,
  reserve/userReserve accounting, ray/wad math, and the effects/CALL_MOCK
  pattern are the same shape — RealT is Aave **V2** so event names/shapes differ).

## Network / start blocks

The gnosis-v2 config has two enabled static data sources (the AaveOracle block is
present in config but its data source is **commented out** in the source
template, see below):

| Contract | Address | Start block |
| --- | --- | --- |
| LendingPoolAddressesProviderRegistry | `0xae6933231Fb83257696E29B050cA6068D6E6Cc84` | 20206000 |
| AaveOracle | `0x1a88d967936a73326562d2310062eCE226Ed6664` | 20206500 |

`chains[].start_block = 20206000` (the earliest). HyperIndex starts every
contract at the chain start; AaveOracle simply has no logs before its own
deployment block, so this is behaviorally identical.

> NOTE: the source template also declares an `AdminUpgradeabilityProxy` data
> source whose only handler (`initRegistry`) synthesizes a hard-coded
> `AddressesProviderRegistered` event for a specific provider at a fixed block.
> This is a subgraph-specific bootstrap hack tied to a graph-node block;
> HyperIndex indexes the real on-chain `AddressesProviderRegistered` event from
> the registry directly, so this proxy data source is intentionally **not**
> ported. See "Deferred / partial".

## File map (source → port)

| Subgraph file | Port file |
| --- | --- |
| `templates/gnosis.subgraph.template.yaml` | `config.yaml` |
| `schemas/v2.schema.graphql` | `schema.graphql` |
| `src/mapping/address-provider-registry/address-provider-registry.ts` | `src/handlers/registry.ts` |
| `src/mapping/lending-pool-address-provider/lending-pool-address-provider.ts` | `src/handlers/addressesProvider.ts` |
| `src/mapping/lending-pool-configurator/{lending-pool-configurator,gnosis}.ts` | `src/handlers/configurator.ts` |
| `src/mapping/lending-pool/{lending-pool,gnosis}.ts` | `src/handlers/pool.ts` |
| `src/mapping/tokenization/{tokenization,initialization}.ts` | `src/handlers/tokens.ts` |
| `src/helpers/initializers.ts` | `src/mappingHelpers/initializers.ts` |
| `src/helpers/math.ts` + `src/helpers/reserve-logic.ts` | `src/common/math.ts` |
| `src/utils/id-generation.ts` | `src/common/ids.ts` |
| `src/utils/converters.ts` (subset used) | `src/common/constants.ts` |
| `Contract.bind().try_*()` eth_calls | `src/effects/{calls,contracts}.ts` |

## Dynamic-registration chain (Aave V2)

Replicated with `indexer.contractRegister` (template addresses come from event
params, so each can be added directly):

1. `LendingPoolAddressesProviderRegistry.AddressesProviderRegistered(newAddress)`
   → create `Pool` (id = addresses-provider address) + register
   `LendingPoolAddressesProvider` template.
   (V2 event carries only `newAddress`; no `id` param, unlike V3.)
2. `LendingPoolAddressesProvider.ProxyCreated(id, newAddress)` — the `bytes32`
   `id` is a raw ascii label (`LENDING_POOL` / `LENDING_POOL_CONFIGURATOR`),
   decoded from its utf8 bytes (mirrors graph-ts `Bytes.toString()`). Sets
   `Pool.lendingPool` / `Pool.lendingPoolConfigurator`, creates a
   `ContractToPoolMapping`, and registers the `LendingPool` /
   `LendingPoolConfigurator` templates.
3. `LendingPoolConfigurator.ReserveInitialized(asset, aToken, stableDebtToken,
   variableDebtToken, interestRateStrategyAddress)` → create `Reserve` (+ the
   `AToken`/`SToken`/`VToken` entities and their `ContractToPoolMapping`s) and
   register the `AToken` / `StableDebtToken` / `VariableDebtToken` templates per
   reserve. Reads ERC20 metadata + interest-rate strategy params via effects.

Handlers `getPoolByContract` / `getOrInitReserve` resolve the owning pool from
`ContractToPoolMapping`; they `throw` (as the subgraph does) when a contract
isn't yet mapped, so any out-of-order event is surfaced rather than silently
mis-attributed.

## eth_call → Effect table

All `Contract.bind(addr).foo()` / `.try_foo()` calls go through the cached
`ethCall` Effect (`src/effects/calls.ts`); typed wrappers live in
`src/effects/contracts.ts`. Each returns `null` on revert / empty / undecodable
output to mirror graph-node `try_` semantics. RPC env: `RPC_URL_100`.

| Subgraph call | Effect wrapper | Pin | Used in |
| --- | --- | --- | --- |
| `IERC20Detailed(underlying).try_name()` | `tryName` | unpinned | ReserveInitialized |
| `IERC20DetailedBytes(underlying).try_name()` (bytes32 fallback) | `tryNameBytes` | unpinned | ReserveInitialized |
| `IERC20Detailed(aToken).symbol()` | `trySymbol` | unpinned | ReserveInitialized (result `.slice(1)`) |
| `IERC20Detailed(underlying).decimals()` | `tryDecimals` | unpinned | ReserveInitialized |
| `DefaultReserveInterestRateStrategy(s).baseVariableBorrowRate()` | `ratesStrategy.baseVariableBorrowRate` | unpinned | updateInterestRateStrategy |
| `…OPTIMAL_UTILIZATION_RATE()` | `ratesStrategy.optimalUtilizationRate` | unpinned | updateInterestRateStrategy |
| `…variableRateSlope1/2()` | `ratesStrategy.variableRateSlope1/2` | unpinned | updateInterestRateStrategy |
| `…stableRateSlope1/2()` | `ratesStrategy.stableRateSlope1/2` | unpinned | updateInterestRateStrategy + ReserveInterestRateStrategyChanged guard |

All ported eth_calls are immutable config/metadata reads, so none are
block-pinned. (The source's `try_stableRateSlope1/2` in
`handleReserveInterestRateStrategyChanged` is used as a revert guard: if either
reverts the handler bails, exactly as in the source.)

Offline tests install a mock spec via `setCallMock` (serialized into
`REALT_CALL_MOCK`); the test worker thread reads it and resolves calls without
RPC. With `strict: true`, an unmocked call fails the test.

## Entity-id parity

Ids are byte-for-byte (lowercase hex), matching the V2 conventions:

- `Reserve` id = `underlyingAsset(hex) ++ poolId`.
- `UserReserve` id = `user(hex) ++ underlyingAsset(hex) ++ poolId`.
- a/s/v `*Token` id = token address.
- `ReserveConfigurationHistoryItem` id = tx hash (overwrites within a tx).
- `ReserveParamsHistoryItem` id = tx hash ++ reserveId.
- `{AToken/VTokenBalanceHistoryItem...}` id = userReserve id ++ tx hash.
- `StableTokenDelegatedAllowance` id = `"stable" ++ fromUser ++ toUser ++ asset`;
  variable variant uses the `"variable"` prefix.
- history transactions (`Deposit`, `Borrow`, …) — see deviation below.

### `transactionLogIndex` deviation

The subgraph's `getHistoryEntityId` is
`block.number ":" transaction.index ":" transaction.hash ":" logIndex ":" transactionLogIndex`.
HyperIndex does not expose `event.transactionLogIndex`, so the port drops that
final component, yielding `block:txIndex:txHash:logIndex`. This is still globally
unique per log, but the *string value* of these ids differs from the subgraph by
the missing trailing `:<transactionLogIndex>`. Any per-tx-event entity id
(Deposit/Borrow/Repay/Swap/etc.) is affected; field values are identical. These
entities are therefore best diffed by their (reserve, user, amount, timestamp)
content rather than raw id when comparing against The Graph.

## Preserved subgraph quirks / bugs

- **Dead treasury branch on aToken Mint.** The source compares
  `from.toHexString()` (lowercase) against a *checksummed* literal
  `0x2c15338cadd34753ddeCCFc22762DdD981c671A4`, so the inequality is always
  true and the `lifetimeReserveFactorAccrued` branch is dead — every Mint hits
  the user branch. We keep the mixed-case literal verbatim
  (`TREASURY_ADDRESS_CHECKSUM`) and compare lowercased `from` against it, so the
  branch stays dead exactly as in the source.
- **`saveAddressProvider` early-return.** The source builds a
  `PoolConfigurationHistoryItem` only after ALL 10 `POOL_COMPONENTS` are
  populated (it `return`s as soon as any is unset). On a freshly registered pool
  the configurator/lending-pool are set one at a time and several components
  (collateral manager, oracles, admins) are typically never all set together, so
  the history item is rarely (often never) written. This early-return-on-unset
  behavior is preserved. Two of the listed components (`proxyPriceProvider`,
  `ethereumAddress`) are not fields on `PoolConfigurationHistoryItem` in the
  schema, so the source's generic `.set(param, …)` for them was a no-op on a
  typed entity; the port copies only the fields that exist on both entities.
- **`Repay` / `LiquidationCall` re-save reserves unchanged.** The source calls
  `poolReserve.save()` with no mutation in `handleRepay` and saves both
  reserves in `handleLiquidationCall` (only `lifetimeLiquidated` changes on the
  collateral side). Preserved.
- **`BalanceTransfer` = burn(from) then mint(to)** at the same `index`, then a
  collateral-total adjustment based on the two users' collateral flags.
  Replicated; `BurnAndMintByGovernance` re-emits the same logic synthetically
  using `reserve.liquidityIndex` as the index (as the source does).
- **`borrowedReservesCount` quirks.** On variable/stable Mint the source
  increments using one user but checks the userReserve of another in some paths;
  these exact user choices are preserved (variable Mint increments
  `event.params.from`'s counter while keying the userReserve on `onBehalfOf`).

## Lowercased-name parity note

`Reserve.symbol` comes from `aToken.symbol().slice(1)` (drops the leading "a"),
matching the source. `Reserve.name` is the underlying's `name()` (string, with
bytes32 fallback). Both are stored verbatim.

## Deferred / partial

The following source data sources/handlers are **out of scope** here and not
ported (they are commented out in the source template, deal with incentives, or
are subgraph bootstrap hacks):

- **AaveOracle handlers / price tracking.** The oracle data source is *entirely
  commented out* in `gnosis.subgraph.template.yaml`, and the V2 schema's
  `PriceOracle*` entities are commented out too. No price/oracle entities exist
  in the source's effective schema, so there is nothing to port. AaveOracle is
  declared as a static data source in `config.yaml` (its `AssetSourceUpdated` /
  `FallbackOracleUpdated` events) for completeness, but no handler is attached —
  matching the source, which records no oracle state. GAP: USD/ETH price fields
  do not exist in this market's data model.
- **Incentives (`AaveIncentivesController`) + token `Initialized`.** The token
  `Initialized` handlers in the source only create an `IncentivesController` and
  `MapAssetPool` and register the incentives template; the incentives mappings
  themselves (`handleAssetConfigUpdated`, rewards accrual, etc.) drive only the
  incentives entities, which are not part of the core reserve/userReserve
  accounting in scope. These handlers and the incentives template are not
  ported. GAP: `IncentivizedAction` / `ClaimIncentiveCall` / `IncentivesController`
  rows and the reserve/user `*incentives*` fields stay at their initialized
  zero/default values. The entities remain in the schema for shape parity.
- **`UniswapRepayAdapter` / `UniswapLiquiditySwapAdapter` (`SwapHistory`).**
  These adapter data sources are not in the gnosis template's enabled sources;
  the `SwapHistory` entity is kept in the schema but no handler is attached.
- **`AdminUpgradeabilityProxy.initRegistry`** bootstrap hack — see Network note.
- **`Paused` / `Unpaused`** — ported (set `Pool.paused`).
- **`OriginationFeeLiquidation`** — the entity exists in the schema but the V2
  source never writes it (no handler emits it); kept for schema parity.

## Verification

```
cd realt
pnpm install
pnpm codegen     # generates .envio/types.d.ts
pnpm build       # tsc --noEmit, zero errors
pnpm test        # 2 offline vitest suites, no network
```

All four pass.

### Bounded validation run (against The Graph)

1. Uncomment `end_block: 20256000` in `config.yaml` (start + 50k).
2. Set `RPC_URL_100` (a Gnosis RPC) for the eth_call effects and
   `GRAPH_API_KEY` for the gateway.
3. `pnpm dev` to index the bounded range into local Postgres.
4. Fill in the subgraph gateway `url` in `validation.json` (TODO — the source
   repo deploys slug `rmm-realt-v2-gnosis` but pins no decentralized deployment
   id) and run `tools/compare`.

## Test coverage

- `test/registration.test.ts` — full registration chain:
  `AddressesProviderRegistered` → two `ProxyCreated` (LENDING_POOL,
  LENDING_POOL_CONFIGURATOR) → `ReserveInitialized`. Asserts the `Pool`,
  `ContractToPoolMapping` (pool + configurator), `Reserve` (name/symbol/decimals
  + strategy reads, all exact), the three sub-token entities, and the
  tx-hash-keyed `ReserveConfigurationHistoryItem`. ERC20 + strategy reads mocked
  (strict).
- `test/deposit-borrow.test.ts` — seeds the chain, then `ReserveDataUpdated`
  (rates/indexes) → aToken `Mint` (deposit accounting) → `Deposit` history →
  variable-debt `Mint` (borrow accounting + `borrowedReservesCount`) → `Borrow`
  history. Asserts `Reserve` totals/liquidity, `UserReserve` scaled/current
  balances and debt, `ATokenBalanceHistoryItem`, `User.borrowedReservesCount`,
  and both history entities (ids in the deviation format) with exact values.

The full registration chain runs live in both tests (no seeding needed); only
the external eth_calls are mocked.
