# Dolomite subgraph → Envio HyperIndex migration

Port of **dolomite-exchange/dolomite-subgraph** (Dolomite Margin lending/margin
accounting + the Dolomite AMM) to Envio HyperIndex v3.1.2 (TypeScript), scoped
to **Arbitrum One (chain 42161)**.

- Source repo: https://github.com/dolomite-exchange/dolomite-subgraph
- Source commit: `448c551774f44b41263c3c40914f0b9de0b7ddfe`
- Rendered network: `arbitrum-one`, startBlock `28220369`, from
  `config/arbitrum-one.json` (the subgraph manifest is Mustache-templated).
- Target endpoint for parity (`validation.json`): the public gn endpoint
  `https://subgraph.api.dolomite.io/.../subgraphs/dolomite-arbitrum/v0.1.4/gn`
  (chain 42161 in `config/subgraph-endpoints.json`; no API key — `authEnv: null`).

## File map

| Concern | Subgraph source | This port |
| --- | --- | --- |
| Manifest / data sources | `subgraph.template.yaml` + `config/arbitrum-one.json` | `config.yaml` |
| Schema | `schema.graphql` (896 lines) | `schema.graphql` |
| Constants (rendered) | `src/templates/constants.template.ts` | `src/constants.ts` |
| Math helpers (toDecimal, roundHalfUp, par↔wei structs) | `helpers/token-helpers.ts`, `helpers/amm-helpers.ts`, `helpers/helpers.ts`, `helpers/margin-helpers.ts` | `src/helpers/math.ts` |
| Entity getOrCreate + the par/wei/index balance accounting | `helpers/margin-helpers.ts`, `helpers/user-helpers.ts`, `helpers/isolation-mode-helpers.ts`, `helpers/borrow-position-helpers.ts`, `helpers/amm-helpers.ts`, `helpers/helpers.ts` | `src/helpers/entities.ts` |
| Pricing (oracle + AMM ETH price) | `helpers/pricing.ts` | `src/helpers/pricing.ts` |
| Protocol balance + interest rate | `helpers/margin-helpers.ts` (`changeProtocolBalance*`), `interest-setter.ts` | `src/helpers/protocol-balance.ts` |
| Token creation / metadata | `helpers/token-helpers.ts` | `src/helpers/token.ts` |
| DolomiteMargin core events | `mappings/margin-core.ts` | `src/handlers/margin-core.ts` |
| DolomiteMargin admin (markets/risk) | `mappings/margin-admin.ts` | `src/handlers/margin-admin.ts` |
| AMM factory + pair (Mint/Burn/Swap/Sync/Transfer) | `mappings/amm-factory.ts`, `mappings/amm-core.ts` | `src/handlers/amm.ts` |
| Borrow + margin position proxy + expiry | `mappings/borrow-position-proxy.ts`, `mappings/margin-position-proxy.ts`, `mappings/margin-expiration.ts` | `src/handlers/positions.ts` |
| Isolation-mode vault template (registration only) | `mappings/isolation-mode-vaults.ts` | `src/handlers/isolation-mode.ts` |
| eth_call layer (try_ → effects) | `Contract.bind(...).try_*` | `src/effects/calls.ts`, `src/effects/contracts.ts` |
| Offline tests | `tests/` | `test/deposit-withdraw.test.ts`, `test/amm-swap.test.ts`, `test/fixtures.ts` |

## The par / wei / interest-index accounting (the heart)

Ported byte-for-byte from `margin-helpers.ts`:

- **`BalanceUpdate`** wraps the on-chain `(sign,value)` `deltaWei`/`newPar`
  struct; `valuePar`/`deltaWei` become signed `BigDecimal`s via
  `convertTokenToDecimal(value, decimals)` (negated when `sign === false`).
- **`handleDolomiteMarginBalanceUpdateForAccount`** is the core routine: it
  rolls `TotalPar` (supply/borrow) back and forward, recomputes the account's
  `borrowTokens`/`supplyTokens` lists + `hasBorrowValue`/`hasSupplyValue`,
  updates the effective-user `UserParValue` (with the exact "range-bound the
  deltaPar to the prior valuePar" branch), tracks originated borrow volume, and
  returns `deltaPar`. Deletion-when-zero (`deleteTokenValueIfNecessary`,
  `deleteUserParValueIfNecessary`) is preserved via `deleteUnsafe`.
- **`parToWei` / `roundHalfUp`**: `roundHalfUp(value, decimals)` adds (subtracts
  for negatives) `5 * 10^-(decimals+1)` before truncating toward zero;
  `parToWei` multiplies by `supplyIndex` (par > 0) or `borrowIndex` (par < 0).
- **`changeProtocolBalanceApplied`** recomputes per-token + protocol-wide
  borrow/supply liquidity in USD, accrues `totalBorrowVolumeUSD`/
  `totalSupplyVolumeUSD`, and runs the interest-rate update. Index updates
  (`LogIndexUpdate`) set `InterestIndex.{borrow,supply}Index` from the raw
  18-decimal values; the per-block `OraclePrice` is refreshed via the
  `getMarketPrice` effect, cached by `blockHash`.
- Entity ids are byte-for-byte: `MarginAccount = user-accountNumber`,
  `MarginAccountTokenValue = user-accountNumber-marketId`,
  `InterestIndexSnapshot = tokenAddress-lastUpdate`, tx-event ids =
  `txHash-logIndex`, AMM pair = pair address, `AmmPairReverseLookup =
  token0-token1` (and reverse). All addresses/hashes lowercased.

## Dynamic templates → contractRegister

- **AmmPair**: declared address-less in `config.yaml`. The `AmmFactory`
  `PairCreated` handler registers it via `context.chain.AmmPair.add(event.params.pair)`
  (an `indexer.contractRegister` companion to the `onEvent` that creates the
  `AmmPair` + `AmmPairReverseLookup` rows). Mirrors the subgraph's
  `AmmPair.create(pair)`.
- **IsolationModeVault**: declared address-less; its `VaultCreated` handler is a
  no-op (see Deviations). The original registered the template from
  `initializeToken` when a token name contains `"Dolomite Isolation:"`.

Tokens are created in the `MarginAdmin` `LogAddMarket` handler (subgraph
`handleMarketAdded`), so the AMM `PairCreated` handler can `getOrThrow` both
tokens — preserving the original ordering dependency.

## eth_call → Effect table

All calls go through one cached `ethCall` effect (raw calldata) wrapped by
`tryContractCall`, which returns `null` on revert / empty / undecodable output
(mirrors `try_*`). Offline tests short-circuit via the `DOLOMITE_CALL_MOCK` env
var (`setCallMock`). RPC env: `RPC_URL_42161`.

| Subgraph call | Effect wrapper | Block-pinned | revert fallback |
| --- | --- | --- | --- |
| `ERC20.try_symbol/name/decimals` | `erc20Symbol/erc20Name/erc20Decimals` | no (immutable metadata) | `"unknown"` / `0n` |
| `DolomiteMargin.try_getMarketPrice(marketId)` | `getMarketPrice` | yes (`event.block.number`) | keep previous `OraclePrice.price` |
| `DolomiteMargin.getNumMarkets()` | `getNumMarkets` | yes | keep prior `numberOfMarkets` |
| `DolomiteMargin.getMarginRatio/LiquidationSpread/EarningsRate/MinBorrowedValue` | `getMarginRatio` etc. | yes | `ZERO_BD` (init only) |
| `DolomiteMargin.getAccountMaxNumberOfMarketsWithBalances()` | `getAccountMaxNumberOfMarketsWithBalances` | yes | `ZERO_BI` |
| `DolomiteMarginExpiry.try_g_expiryRampTime()` | `gExpiryRampTime` | yes | `ZERO_BI` |
| `AmmPair.balanceOf(owner)` (LP balance for snapshots) | `pairBalanceOf` | yes | `ZERO_BI` |

Block-pinned reads carry `block: Number(event.block.number)`; metadata reads
omit it (latest), per the compound-v3 convention.

## Deviations / parity notes (documented)

1. **`Bytes` → `String`.** Per CONVENTIONS, all `Bytes` schema fields are
   `String` storing lowercase `0x…` hex (`oracleSentinel`, `lastTransactionHash`,
   `oracle`, `to`/`from`/`sender`, settings `key`, etc.). Address/hash values are
   lowercased in handlers (helper `a()`).
2. **`@derivedFrom` virtual fields removed.** Envio rejects nullable derived
   lists (`[X!]`) and singular `@derivedFrom`. All `@derivedFrom` fields (e.g.
   `Token.interestRate/interestIndex/riskInfo/totalPar`, `User.*`,
   `Transaction.*`, `AmmPair.*`) were dropped from the schema; they were
   query-time conveniences and are not read inside mappings, so stored entity
   data is unaffected for `tools/compare`. Reverse navigation is still available
   via the kept relation fields (`X_id`) and `@index`.
3. **`store.loadInBlock` → `context.X.get`.** Envio's in-memory store already
   reflects pending writes within a batch, so the subgraph's `loadInBlock`
   caching (Transaction, InterestIndexSnapshot, IntermediateTrade) collapses to
   `get`.
4. **`event.transactionLogIndex`** is not exposed by envio. The subgraph used
   `event.logIndex` for the `txHash-logIndex` ids already, so no change; tx ids
   use `event.transaction.hash` (selected globally via `field_selection`).
5. **`getTokenOraclePriceUSD` protocol-type branch collapsed.** The subgraph
   bound a different *generated* contract per `ProtocolType` (Core/Admin/Amm/…);
   on-chain it is always `DolomiteMargin.getMarketPrice`, so the branches are a
   single effect call.
6. **POL intermediate-trade path omitted.** `_handleTradeInternal`'s `pol-`
   token recycling (Polygon-zkEVM `IntermediateTrade` two-step) is unreachable on
   Arbitrum (no `pol-` tokens) and is not ported; the `IntermediateTrade` entity
   is retained in the schema but never written.
7. **Interest-setter eth_calls deferred.** `handleSetInterestSetter` stored the
   per-setter `optimalUtilizationRate/lowerOptimalRate/upperOptimalRate` via
   `LinearStepFunctionInterestSetter` / `ModularLinearStepFunctionInterestSetter`
   eth_calls. Those calls are deferred: the handler stores the new
   `interestSetter` address and still runs `updateInterestRate` (the
   double-exponent and linear-step rate math is fully ported in
   `protocol-balance.ts`), but the optimal-rate inputs keep their prior values.
   This affects only `InterestRate.borrow/supplyInterestRate` precision for
   markets whose setter changes; balance/index/liquidity accounting is exact.
8. **Isolation-mode vault resolution deferred.** `getEffectiveUserForAddress`
   follows `User.effectiveUser_id` once (as in the source), but the
   `IsolationModeVault.VaultCreated` handler that re-points a vault's
   effectiveUser to its owner (and maintains `IsolationModeVaultReverseLookup`)
   is a no-op. For EOA flows in the validation window effectiveUser == user, so
   `effectiveUser`/`*EffectiveUser` fields are correct; isolation-mode vault
   ownership rewrites are a known gap.
9. **Peripheral data sources not ported** (documented gaps, build stays green):
   `EventEmitterRegistry` (async deposit/withdrawal, settings, reward-claimed),
   `LiquidityMiningClaimer` / `LiquidityMiningVester`, `Zap`
   (GenericTraderProxy), and `ModularLinearStepInterestSetter.SettingsChanged`.
   The corresponding schema entities (`AsyncDeposit`, `AsyncWithdrawal`, `Zap`,
   `LiquidityMining*`, `*Setting`) remain in the schema but are never written.
   These were lower-priority per the porting scope; the DolomiteMargin core
   accounting + the AMM pair side were prioritised.
10. **`DolomiteMargin` init.** The subgraph populated risk params lazily inside
    `getOrCreateDolomiteMarginForCall(ProtocolType.Admin)`. Here they are
    populated on the first `LogAddMarket` (admin) via the same effect getters
    (`getMarginRatio`, etc.), which is the first admin event in practice.
11. **BigDecimal semantics.** `BigDecimal.config({ DECIMAL_PLACES: 34,
    EXPONENTIAL_AT: [-1000000, 1000000] })` matches graph-node; `truncate(n)` is
    `decimalPlaces(n, ROUND_DOWN)`. Division far-decimals may differ within
    `tools/compare`'s decimal tolerance.

## Verification

```
cd /home/user/defi-indexers/dolomite
pnpm install
pnpm codegen     # generates .envio/types.d.ts
pnpm build       # tsc --noEmit, zero errors
pnpm test        # offline vitest (2 tests), no network
```

### Tests (offline, `createTestIndexer` + simulate + `DOLOMITE_CALL_MOCK`)

- `test/deposit-withdraw.test.ts` — LogAddMarket (effects mocked) → LogDeposit →
  LogWithdraw; asserts exact `MarginAccountTokenValue.valuePar` (60),
  `TotalPar.supplyPar` (60), `Token.supplyLiquidity`/`supplyLiquidityUSD` (60),
  `Deposit`/`Withdrawal` delta wei/par/USD, and `DolomiteMargin` counters
  (userCount 1, actionCount 2, numberOfMarkets 1).
- `test/amm-swap.test.ts` — two markets → `PairCreated` (template registered
  in-process) → `Sync` → `Swap`; asserts pair reserves (100/200), prices
  (0.5/2), volumes (volumeUSD 20, token0 10, token1 20), the `AmmTrade` row, and
  factory counters (pairCount 1, ammTradeCount 1, totalAmmVolumeUSD 20).

## Bounded validation run (against the gn endpoint)

`config.yaml` has a commented `end_block: 28270369` (~startBlock + 50k) and
`rollback_on_reorg: false` for deterministic runs. To validate against the
subgraph: set `RPC_URL_42161`, uncomment `end_block`, `pnpm envio start`, then
run `tools/compare` with `validation.json` (block range 28220369 → 28270369).
Note: the gn endpoint is public; `authEnv` is `null`.
