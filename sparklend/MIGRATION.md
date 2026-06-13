# SparkLend (Ethereum mainnet) → HyperIndex migration

SparkLend is a **direct Aave V3 fork** (`sparklend-v1-core`, forked from
`aave-v3-core`) and is indexed with the same Aave V3 subgraph framework. This
port is therefore based on this repo's **`aave-v3`** port (`envio@3.1.2`,
TypeScript): the `schema.graphql`, the full `src/` handler + effect +
registration logic, ray/wad reserve accounting, oracle, and rewards are all
**shared verbatim with `aave-v3`**. Only the entry addresses, start block,
project name, and mock env var differ.

- Upstream contracts: https://github.com/sparkdotfi/sparklend-v1-core (Aave V3 fork)
- Subgraph logic source: this repo's `aave-v3` port (in turn from
  `aave/protocol-subgraphs`, commit `b3a9928bf8dd24b89819d2d4373df64db78bc479`,
  `templates/v3.subgraph.template.yaml`).
- Schema ported 1:1 from the Aave V3 schema (`schemas/v3.schema.graphql`).

## What changed vs. the `aave-v3` port

| Aspect | aave-v3 | sparklend |
| --- | --- | --- |
| Project name | `aave-v3` | `sparklend` |
| Chain | Ethereum mainnet (1) | Ethereum mainnet (1) |
| `start_block` | 16291006 | 16776389 |
| PoolAddressesProviderRegistry | `0xbaA999AC55EAce41CcAE355c77809e68Bb345170` | `0x03cFa0C4622FF84E50E75062683F44c9587e6Cc1` |
| AaveOracle (price oracle) | `0x54586bE62E3c3580375aE3723C145253060Ca0C2` | `0x8105f69D9C41644c6A0803fDA7D03Aa70996cFD9` |
| RewardsController | `0x8164Cc65827dcFe994AB23944CBC90e0aa80bFcb` | `0x4370D3b6C9588E02ce9D22e684387859c7Ff5b34` |
| Mock env var | `AAVE_V3_CALL_MOCK` | `SPARKLEND_CALL_MOCK` |

Everything else (handlers, effects, helpers, schema, entity-id construction,
ray/wad math, the registry→provider→pool→token registration chain) is identical
to `aave-v3`. See `aave-v3/MIGRATION.md` for the full description of the shared
logic, the eth_call → Effect table, entity-id parity, and the preserved subgraph
quirks/bugs — all of which apply unchanged here.

## Spark address sourcing (all verified)

Etherscan and `docs.spark.fi` were not reachable in the build environment (HTTP
403); GitHub (`raw.githubusercontent.com` / `codeload.github.com`) was. All
addresses were taken from GitHub-hosted deployment artifacts and cross-checked
across two independent sources:

1. **`sparkdotfi/sparklend-deployments`**, file
   `script/output/1/primary-latest.json` (chain id 1 = mainnet). This is the
   project's own deployment output and is the primary source of truth:

   | Contract | Address (from primary-latest.json key) |
   | --- | --- |
   | PoolAddressesProvider | `0x02C3eA4e34C0cBd694D2adFa2c690EECbC1793eE` (`poolAddressesProvider`) |
   | PoolAddressesProviderRegistry | `0x03cFa0C4622FF84E50E75062683F44c9587e6Cc1` (`poolAddressesProviderRegistry`) |
   | Pool (proxy) | `0xC13e21B648A5Ee794902342038FF3aDAB66BE987` (`pool`) |
   | PoolConfigurator (proxy) | `0x542DBa469bdE58FAeE189ffB60C6b49CE60E0738` (`poolConfigurator`) |
   | AaveOracle | `0x8105f69D9C41644c6A0803fDA7D03Aa70996cFD9` (`aaveOracle`) |
   | RewardsController (incentives proxy) | `0x4370D3b6C9588E02ce9D22e684387859c7Ff5b34` (`incentives`) |
   | EmissionManager | `0xf09e48dd4CA8e76F63a57ADd428bB06fee7932a4` (`emissionManager`) |

   The USDC reserve addresses used in the offline tests also come from this file
   (`USDC_token`, `USDC_aToken`, `USDC_stableDebtToken`, `USDC_variableDebtToken`,
   `USDC_interestRateStrategy`).

2. **Messari `messari/subgraphs`**, file
   `subgraphs/aave-forks/protocols/spark-lend/config/deployments/spark-lend-ethereum/configurations.json`
   — an independent indexer's config. It confirms the same
   PoolAddressesProvider / Pool / PoolConfigurator addresses **and supplies the
   start blocks**:

   | Contract | Address | startBlock |
   | --- | --- | --- |
   | PoolAddressesProvider (`factory`) | `0x02C3eA4e…1793eE` | 16776389 |
   | Pool (`lendingPool`) | `0xC13e21B6…6BE987` | 16776401 |
   | PoolConfigurator (`lendingPoolConfigurator`) | `0x542DBa46…0E0738` | 16776402 |

`chains[].start_block = 16776389` — the earliest of the launch blocks. The
registry / oracle / rewards contracts have no logs before this block, so
starting every contract at the chain start is behaviorally identical (same
rationale as the `aave-v3` port).

## Registry-vs-static root (no deviation)

The `aave-v3` port roots the dynamic registration chain at
`PoolAddressesProviderRegistry.AddressesProviderRegistered`, which both
instantiates the `PoolAddressesProvider` template and creates the `Pool`
entity. SparkLend **is** registered in its own immutable
`PoolAddressesProviderRegistry` (`0x03cFa0C4…`), so this port keeps the same
static root rather than configuring the `PoolAddressesProvider` statically. No
structural deviation from `aave-v3` was needed.

> Note: Messari roots its config at the `PoolAddressesProvider` directly (its
> "factory") at block 16776389, which is the same block at which the registry
> registered the provider. If a future bounded run shows the
> `AddressesProviderRegistered` event is not captured, the fallback is to add
> `PoolAddressesProvider` (`0x02C3eA4e…1793eE`) as a static contract and seed the
> `Pool` entity from its first event — this is the prompt-sanctioned alternative
> and would be the only deviation. It was not required for the offline build.

## RewardsController note

The sparkdotfi deployment includes an `incentives` proxy
(`0x4370D3b6…`), which is wired as the static `RewardsController` here to keep
the rewards handlers from `aave-v3` functional. Messari's config lists the
RewardsController as the zero address (i.e. it treats SparkLend mainnet rewards
as absent). Rewards entities are peripheral to the core
reserve/userReserve/supply/borrow accounting that the validation set targets and
are not exercised by the offline tests (same status as `aave-v3`).

## Entity-id parity

Identical construction to `aave-v3` (see that doc for the full list). IDs embed
the Spark `poolId` (the SparkLend PoolAddressesProvider address
`0x02c3ea4e…1793ee`) and the Spark reserve/token addresses, so they differ from
`aave-v3` only by those embedded addresses — which is correct. The same
`transactionLogIndex` deviation on history-entity ids applies (HyperIndex does
not expose `transactionLogIndex`, so history ids are
`block:txIndex:txHash:logIndex`; field values match).

## Verification

```bash
cd sparklend
pnpm install
pnpm codegen
pnpm build      # tsc --noEmit, 0 errors
pnpm test       # 2 offline vitest suites
```

### Bounded validation run (against The Graph)

`validation.json` targets the "Spark Lend Ethereum" subgraph on The Graph
decentralized network (subgraph id
`GbKdmBe4ycCYCQLQSjqGg6UHYoYfbyJyq5WrG35pv1si`, discovered via Graph Explorer
search; confirm it resolves to the mainnet SparkLend market before diffing) over
blocks `16776389 → 16826389`. Uncomment `end_block: 16826389` in `config.yaml`,
set `RPC_URL_1` + the HyperSync env, run `pnpm start` to backfill, then diff with
`tools/compare` (needs `GRAPH_API_KEY`). Network access to HyperSync/RPC is
required for this step and was not run in the offline build environment.

## Test coverage

- `test/registration.test.ts` — full registration chain
  (AddressesProviderRegistered → ProxyCreated POOL/POOL_CONFIGURATOR →
  ReserveInitialized) asserting `Pool`, `ContractToPoolMapping`, `Reserve`
  (metadata + strategy reads), `SubToken`s, and `ReserveConfigurationHistoryItem`,
  using the real Spark mainnet USDC reserve addresses.
- `test/supply-borrow.test.ts` — ReserveDataUpdated (rates/indexes) → aToken
  Mint (supply accounting + `getReserveData` effect) → Pool.Supply → vToken Mint
  (borrow accounting + `borrowedReservesCount`) → Pool.Borrow, asserting exact
  `Reserve` / `UserReserve` / `User` / history values.

All eth_calls are mocked via `SPARKLEND_CALL_MOCK`; no RPC is used.
```
