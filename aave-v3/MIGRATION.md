# Aave V3 (Ethereum mainnet) → HyperIndex migration

Port of the official **aave/protocol-subgraphs** repo to Envio HyperIndex
(`envio@3.1.2`, TypeScript). Scoped to the **Ethereum mainnet V3** market.

- Source repo: https://github.com/aave/protocol-subgraphs
- Source commit: `b3a9928bf8dd24b89819d2d4373df64db78bc479`
- Rendered manifest variant: `templates/v3.subgraph.template.yaml` with
  `config/mainnet-v3.json` (`NETWORK=mainnet VERSION=v3 BLOCKCHAIN=v3`).
- Schema ported 1:1 from `schemas/v3.schema.graphql`.

## Network / start blocks

The mainnet-v3 config has three static data sources:

| Contract | Address | Start block |
| --- | --- | --- |
| AaveOracle | `0x54586bE62E3c3580375aE3723C145253060Ca0C2` | 16291123 |
| PoolAddressesProviderRegistry | `0xbaA999AC55EAce41CcAE355c77809e68Bb345170` | 16291006 |
| RewardsController | `0x8164Cc65827dcFe994AB23944CBC90e0aa80bFcb` | 16291136 |

`chains[].start_block = 16291006` (the earliest). HyperIndex starts every
contract at the chain start; AaveOracle / RewardsController simply have no logs
before their own deployment blocks, so this is behaviorally identical.

## File map (source → port)

| Subgraph file | Port file |
| --- | --- |
| `templates/v3.subgraph.template.yaml` | `config.yaml` |
| `schemas/v3.schema.graphql` | `schema.graphql` |
| `src/utils/id-generation.ts` | `src/common/ids.ts` |
| `src/utils/converters.ts`, `src/utils/constants.ts` | `src/common/constants.ts` |
| `src/helpers/math.ts` | `src/common/math.ts` |
| `src/helpers/reserve-logic.ts` (`calculateUtilizationRate`) | `src/mappingHelpers/initializers.ts` |
| `src/helpers/v3/initializers.ts` | `src/mappingHelpers/initializers.ts` |
| `src/helpers/v3/price-updates.ts` | `src/mappingHelpers/priceUpdates.ts` |
| `src/mapping/address-provider-registry/v3.ts` | `src/handlers/registry.ts` |
| `src/mapping/lending-pool-address-provider/v3.ts` | `src/handlers/addressesProvider.ts` |
| `src/mapping/lending-pool-configurator/v3.ts` | `src/handlers/configurator.ts` |
| `src/mapping/lending-pool/v3.ts` | `src/handlers/pool.ts` |
| `src/mapping/tokenization/{tokenization,initialization}-v3.ts` | `src/handlers/tokens.ts` |
| `src/mapping/proxy-price-provider/v3.ts`, `src/mapping/price-oracle/v3.ts` | `src/handlers/oracle.ts` |
| `src/mapping/incentives-controller/v3.ts` | `src/handlers/rewards.ts` |
| `Contract.bind().try_*()` eth_calls | `src/effects/{calls,contracts}.ts` |

## Dynamic-registration chain

Subgraph `templates:` → address-less HyperIndex contracts +
`indexer.contractRegister`. The chain mirrors the subgraph exactly:

1. `PoolAddressesProviderRegistry.AddressesProviderRegistered`
   - `contractRegister`: `chain.PoolAddressesProvider.add(addressesProvider)`.
   - `onEvent`: create `Pool` entity (id = addressesProvider address).
2. `PoolAddressesProvider.ProxyCreated(id, proxy, impl)`
   - `contractRegister`: decode the `bytes32 id` to its ascii label; `POOL` →
     `chain.Pool.add(proxy)`, `POOL_CONFIGURATOR` →
     `chain.PoolConfigurator.add(proxy)`.
   - `onEvent`: set `Pool.pool` / `Pool.poolConfigurator` and create the
     `ContractToPoolMapping` rows (the subgraph's `createMapContractToPool`).
   - `PoolUpdated` / `PoolConfiguratorUpdated` / `PoolDataProviderUpdated` /
     `PriceOracleUpdated` update the impl fields (no template instantiation).
3. `PoolConfigurator.ReserveInitialized(asset, aToken, sToken, vToken, strategy)`
   - `contractRegister`: `chain.AToken.add`, `chain.VariableDebtToken.add`, and
     `chain.StableDebtToken.add` (skipped when the sToken is the zero address,
     as in v3.2+). All addresses come straight from the event params.
   - `onEvent`: create `Reserve`, read ERC20 metadata + interest-rate strategy
     params (effects), create the three `SubToken`s and their
     `ContractToPoolMapping`s.
4. `AaveOracle.AssetSourceUpdated` → `chain.ChainlinkAggregator.add(source)`;
   `AaveOracle.FallbackOracleUpdated` → `chain.FallbackPriceOracle.add(...)`.

Because `contractRegister` cannot read entities or perform eth_calls, every
template is registered directly from event params (which always carry the
addresses) and the corresponding `onEvent` handler guards against missing
parent state (`getPoolByContract` throws if a contract isn't mapped, exactly
like the subgraph).

### ChainlinkAggregator registration deviation

The subgraph resolves the *aggregator* address from the price-source proxy via
an eth_call (`EACAggregatorProxy.aggregator()`) inside `handleAssetSourceUpdated`
and then `ChainlinkAggregator.create(aggregator)`. `contractRegister` cannot do
eth_calls, so we register the **source proxy** address as the
`ChainlinkAggregator` template and still map the resolved aggregator → asset in
the `onEvent` handler (`ChainlinkAggregator` entity). On mainnet the
`AnswerUpdated` events are emitted by the underlying aggregator the proxy points
at; if a market's source proxy and aggregator differ, some `AnswerUpdated`
price-history updates may be missed. Price-history entities are peripheral to
the core reserve/userReserve accounting and are not part of the validation set.

## eth_call → Effect table

All calls flow through one cached `ethCall` Effect carrying raw calldata
(`src/effects/calls.ts`), wrapped by typed `try_*` helpers
(`src/effects/contracts.ts`). `try_` revert semantics → `null`. State/price
reads are **block-pinned**; immutable metadata is **unpinned**.

| Subgraph call | Wrapper | Pinned | Used by |
| --- | --- | --- | --- |
| `IERC20Detailed.name/symbol/decimals` | `tryName/trySymbol/tryDecimals` | no | ReserveInitialized, rewards |
| `IERC20DetailedBytes.name/symbol` (bytes32) | `tryNameBytes/trySymbolBytes` | no | ReserveInitialized fallback |
| `DefaultReserveInterestRateStrategy.*` (V1, no-arg) | `ratesStrategy.*` | no | updateInterestRateStrategy |
| `DefaultReserveInterestRateStrategyV2.*(asset)` | `ratesStrategy.*V2` | no | strategy V2 fallback |
| `Pool.getReserveData(asset).accruedToTreasury` | `tryReserveDataAccruedToTreasury` | **yes** | aToken Mint |
| `AaveOracle.getAssetPrice(asset)` | `tryGetAssetPrice` | **yes** | price feed / fallback paths |
| `IExtendedPriceAggregator.getTokenType/latestAnswer/getSubTokens` | `tryGetTokenType/tryLatestAnswer/trySubTokens` | no | priceFeedUpdated |
| `EACAggregatorProxy.aggregator()` | `tryAggregator` | no | priceFeedUpdated |
| `RewardsController.getAssetDecimals/getRewardOracle` | `tryRewardAssetDecimals/tryGetRewardOracle` | no | AssetConfigUpdated |

Offline tests install a JSON mock via `setCallMock(...)` →
`AAVE_V3_CALL_MOCK` env var (worker threads copy parent env at creation), so no
RPC is needed.

## Entity-id parity

- `reserve.id = underlyingAsset (lowercase hex) ++ poolId`.
- `userReserve.id = user ++ underlyingAsset ++ poolId`.
- history-entity id (`getHistoryEntityId`): `block:txIndex:txHash:logIndex`.
- aToken/vToken balance history: `userReserve.id ++ txHash`.
- price-history: `assetId ++ blockNumber ++ txIndex`.
- delegated-allowance: `("stable"|"variable") ++ fromUser ++ toUser ++ asset`.
- All addresses are lowercased before use in ids/fields (HyperIndex delivers
  checksummed addresses; subgraphs store lowercase).

### `transactionLogIndex` deviation

`getHistoryEntityId` in the subgraph appends a 5th component,
`event.transactionLogIndex`, joined by `:`. HyperIndex does not expose
`transactionLogIndex`, so the port drops that final component and uses
`block:txIndex:txHash:logIndex`. This is still globally unique per log, but the
**raw id strings differ** from the subgraph by the trailing `:<n>`. `Supply`,
`Borrow`, `Repay`, etc. history-entity ids therefore won't match the subgraph
byte-for-byte; their *field values* do. (The `Supply` handler's `if exists, id
+ "0"` dedupe quirk is preserved.)

## Preserved subgraph quirks / bugs

- `ReserveParamsHistoryItem.priceInUsd = priceInEth.toBigDecimal()` — no USD
  scaling (matches the subgraph's `reserveParamsHistoryItem.priceInEth.toBigDecimal()`).
- `handleUnbackedMintCapChanged` re-saves the reserve without changing any
  field (subgraph does the same).
- `handleChainlinkAnswerUpdated`'s `tokensWithFallback` removal loop is a no-op
  (`for (i=0; i > length; ...)`); preserved (no removal happens).
- aToken Mint to treasury collector addresses routes to
  `lifetimeReserveFactorAccrued` instead of a user reserve (mainnet + polygon
  collector list inlined in `src/common/constants.ts`).
- FlashLoan `flashloanPremiumToProtocol` defaults to `10000` when unset
  (v3.4 deprecation behavior).

## BalanceTransfer index handling

`getUpdateBlock("mainnet")` returns `0` in the subgraph, and the mainnet start
block (16291006) is well past the v3.0.1 update, so `BalanceTransfer.value` is
always `rayMul(value, index)` (the post-update branch). The port hardcodes that
branch (mainnet-only scope) rather than carrying the multi-network
`getUpdateBlock` table.

## Deferred / partial

- **Reward feed oracle / reward config**: ported, but `Reward.precision`,
  `rewardTokenSymbol`, `rewardFeedOracle` depend on eth_calls
  (`getAssetDecimals`, `symbol`, `getRewardOracle`) that are not exercised by
  the offline tests; values fall back to `0`/`""`/zero-address on revert.
- **Composite price assets** (`getSubTokens` dependency graph) are ported but
  untested offline; mainnet V3 uses simple chainlink sources for the validated
  reserves.
- **ENS / GHO / permissioned / incentives-avalanche/matic** mappings are out of
  scope for mainnet V3 and not ported.

## Verification

```bash
cd aave-v3
pnpm install
pnpm codegen
pnpm build      # tsc --noEmit, 0 errors
pnpm test       # 2 offline vitest suites
```

### Bounded validation run (against The Graph)

`validation.json` targets the official ETH-Mainnet-V3 subgraph
(`Cd2gEDVeqnjBn1hSeqFMitw8Q1iiyV9FYUZkLNRcL87g`) over blocks
`16291006 → 16341006`. Uncomment `end_block: 16341006` in `config.yaml`, set
`RPC_URL_1` + the HyperSync env, run `pnpm start` to backfill, then diff with
`tools/compare` (needs `GRAPH_API_KEY`). Network access to HyperSync/RPC is
required for this step and was not run in the offline build environment.

## Test coverage

- `test/registration.test.ts` — full registration chain
  (AddressesProviderRegistered → ProxyCreated POOL/POOL_CONFIGURATOR →
  ReserveInitialized) asserting `Pool`, `ContractToPoolMapping`, `Reserve`
  (metadata + strategy reads), `SubToken`s, and `ReserveConfigurationHistoryItem`.
- `test/supply-borrow.test.ts` — ReserveDataUpdated (rates/indexes) → aToken
  Mint (supply accounting + `getReserveData` effect) → Pool.Supply → vToken
  Mint (borrow accounting + `borrowedReservesCount`) → Pool.Borrow, asserting
  exact `Reserve` / `UserReserve` / `User` / history values.
