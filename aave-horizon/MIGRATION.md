# Aave Horizon (Ethereum mainnet) → HyperIndex migration

Aave **Horizon** is the Aave **v3.3** RWA market on Ethereum mainnet — a
permissioned/licensed Aave V3 instance whose collateral is tokenized treasuries
and credit funds (USTB, USCC, USYC, JTRSY, JAAA, VBILL, ACRED, RLUSD) borrowed
against GHO/USDC/RLUSD. It runs on the **same Aave V3 contracts/events/schema**
and is indexed with the same Aave V3 subgraph framework. This port is therefore
based on this repo's **`aave-v3`** port (`envio@3.1.2`, TypeScript): the
`schema.graphql`, the full `src/` handler + effect + registration logic, ray/wad
reserve accounting, oracle, and rewards are **shared verbatim with `aave-v3`**.
Only the entry addresses, start block, project name, and mock env var differ
(exactly the same re-point shape as `sparklend` — see `sparklend/MIGRATION.md`).

- Upstream contracts: https://github.com/aave/aave-v3-horizon (Aave v3.3, a fork
  of `aave-dao/aave-v3-origin`).
- Subgraph logic source: this repo's `aave-v3` port (in turn from
  `aave/protocol-subgraphs`, commit `b3a9928bf8dd24b89819d2d4373df64db78bc479`,
  `templates/v3.subgraph.template.yaml`, `schemas/v3.schema.graphql`).

## What changed vs. the `aave-v3` port

| Aspect | aave-v3 | aave-horizon |
| --- | --- | --- |
| Project name | `aave-v3` | `aave-horizon` |
| Chain | Ethereum mainnet (1) | Ethereum mainnet (1) |
| `start_block` | 16291006 | 23125530 |
| PoolAddressesProviderRegistry | `0xbaA999AC55EAce41CcAE355c77809e68Bb345170` | `0xC6cAB8D39D93DC0Bd5986E7Ce5Bb956E30103A43` |
| AaveOracle (price oracle) | `0x54586bE62E3c3580375aE3723C145253060Ca0C2` | `0x985BcfAB7e0f4EF2606CC5b64FC1A16311880442` |
| RewardsController (incentives) | `0x8164Cc65827dcFe994AB23944CBC90e0aa80bFcb` | `0x1D5D386a90CEA8AcEa9fa75389e97CF5F1AE21D3` |
| Mock env var | `AAVE_V3_CALL_MOCK` | `AAVE_HORIZON_CALL_MOCK` |

Everything else (handlers, effects, helpers, schema, entity-id construction,
ray/wad math, the registry→provider→pool→token registration chain) is identical
to `aave-v3`. See `aave-v3/MIGRATION.md` for the full description of the shared
logic, the eth_call → Effect table, entity-id parity, and the preserved subgraph
quirks/bugs — all of which apply unchanged here.

## Horizon address sourcing (all verified)

Etherscan / docs were not reachable in the build environment (HTTP 403); GitHub
(`raw.githubusercontent.com`, GitHub code search) was. Every address was taken
from GitHub-hosted artifacts and cross-checked across independent sources:

1. **`bgd-labs/aave-address-book`**, file `src/AaveV3EthereumHorizon.sol` (and
   its generated `src/ts/AaveV3EthereumHorizon.ts`, `CHAIN_ID = 1`) — the
   canonical Aave address book and primary source of truth for the Horizon
   Ethereum-mainnet market:

   | Contract | Address (address-book constant) |
   | --- | --- |
   | PoolAddressesProvider | `0x5D39E06b825C1F2B80bf2756a73e28eFAA128ba0` (`POOL_ADDRESSES_PROVIDER`) |
   | PoolAddressesProviderRegistry | `0xC6cAB8D39D93DC0Bd5986E7Ce5Bb956E30103A43` (`POOL_ADDRESSES_PROVIDER_REGISTRY`) |
   | Pool (proxy) | `0xAe05Cd22df81871bc7cC2a04BeCfb516bFe332C8` (`POOL`) |
   | PoolConfigurator (proxy) | `0x83Cb1B4af26EEf6463aC20AFbAC9c0e2E017202F` (`POOL_CONFIGURATOR`) |
   | AaveOracle | `0x985BcfAB7e0f4EF2606CC5b64FC1A16311880442` (`ORACLE`) |
   | RewardsController (incentives) | `0x1D5D386a90CEA8AcEa9fa75389e97CF5F1AE21D3` (`DEFAULT_INCENTIVES_CONTROLLER`) |
   | EmissionManager | `0xC2201708289b2C6A1d461A227A7E5ee3e7fE9A2F` (`EMISSION_MANAGER`) |

   The USDC reserve addresses used in the offline tests also come from this file
   (`AaveV3EthereumHorizonAssets`): `USDC_UNDERLYING` `0xA0b86991…3606eB48`,
   `USDC_A_TOKEN` `0x68215B65…4a62f79e`, `USDC_V_TOKEN` `0x4139EcBe…9D590FC7`,
   `USDC_INTEREST_RATE_STRATEGY` `0x87593272…2F1Ab521`. (Horizon shares one
   interest-rate-strategy contract across reserves; v3.3 has no stable debt
   token, so there is no `USDC_S_TOKEN`.)

   The Pool / PoolAddressesProvider were independently confirmed in
   `aave/interface` (`src/ui-config/marketsConfig.tsx`, the "horizon" market) and
   `anxolin/aave-underlying` (`aave-v3-underlyings.json`, market
   `AaveV3EthereumHorizon`).

2. **Start block** — the address book does not record deployment blocks. The
   start block was taken from an independent indexer's config,
   **`archon-research/stl`**, file
   `stl-verify/internal/pkg/blockchain/protocols.go` (the "Aave V3 RWA" entry):

   | Contract | Address | ActiveAtBlock |
   | --- | --- | --- |
   | PoolAddressesProvider | `0x5D39E06b…128ba0` | 23125530 |
   | Pool | `0xAe05Cd22…E332C8` | 23125535 |

   `chains[].start_block = 23125530` — the PoolAddressesProvider deployment
   block, the earliest Horizon contract block. The registry / oracle / rewards
   contracts have no logs before this block, so starting every contract at the
   chain start is behaviorally identical (same rationale as `aave-v3` /
   `sparklend`). Horizon launched late August 2025, consistent with block
   23125530.

## Registry-vs-static root (no deviation)

The `aave-v3` port roots the dynamic registration chain at
`PoolAddressesProviderRegistry.AddressesProviderRegistered`, which both
instantiates the `PoolAddressesProvider` template and creates the `Pool` entity.
Horizon has its own `PoolAddressesProviderRegistry` (`0xC6cAB8D3…03A43`) in which
the provider is registered, so this port keeps the same static root rather than
configuring the `PoolAddressesProvider` statically. No structural deviation from
`aave-v3` was needed.

> Fallback (prompt-sanctioned, not required for the offline build): if a future
> bounded run shows the `AddressesProviderRegistered` event is not captured in
> the registry's logs, add `PoolAddressesProvider` (`0x5D39E06b…128ba0`) as a
> static contract and seed the `Pool` entity from its first event.

## Aave v3.3 event check

Horizon is Aave **v3.3**. The Pool event signatures the `aave-v3` port indexes
were diffed against the v3.3 / origin `IPool` interface
(`aave-dao/aave-v3-origin`, `aave/aave-v3-horizon`). Result:

- **Unchanged (carry over verbatim):** `Supply`, `Withdraw`, `Borrow`, `Repay`,
  `LiquidationCall`, `ReserveDataUpdated`, `FlashLoan`, `MintedToTreasury`,
  `ReserveUsedAsCollateral{Enabled,Disabled}`, `UserEModeSet`,
  `IsolationModeTotalDebtUpdated`. In particular `LiquidationCall` keeps the same
  7-arg signature `(address indexed collateralAsset, address indexed debtAsset,
  address indexed user, uint256 debtToCover, uint256 liquidatedCollateralAmount,
  address liquidator, bool receiveAToken)`.
- **New in v3.3 (added to the Pool's ABI), NOT indexed:**
  `DeficitCreated(address indexed user, address indexed debtAsset, uint256
  amountCreated)` and `DeficitCovered(address indexed reserve, address caller,
  uint256 amountCovered)` — the v3.3 bad-debt / deficit mechanism. The Aave V3
  subgraph schema this port mirrors has **no Deficit entity** (these events were
  introduced after the subgraph template), so there is nowhere to write them and
  no handler is added; this preserves byte-for-byte data parity with the Aave V3
  subgraph framework. They are documented here so a future schema extension can
  add `Deficit` entities + handlers if deficit tracking becomes in-scope.
- **Removed in v3.3:** stable-rate borrowing. Horizon emits the **zero address**
  for `stableDebtToken` in `PoolConfigurator.ReserveInitialized`; the existing
  `aave-v3` handler already guards `stableDebtToken == ZERO_ADDRESS` (the v3.2+
  path), so it skips the stable `SubToken` and leaves
  `reserve.sToken_id = ZERO_ADDRESS`. No code change needed.

No config or handler change beyond the address / start-block / name / mock swaps
was required; the v3.x event set carries over.

## Entity-id parity

Identical construction to `aave-v3` (see that doc for the full list). IDs embed
the Horizon `poolId` (the PoolAddressesProvider address `0x5d39e06b…128ba0`) and
the Horizon reserve/token addresses, so they differ from `aave-v3` only by those
embedded addresses — which is correct. The same `transactionLogIndex` deviation
on history-entity ids applies (HyperIndex does not expose `transactionLogIndex`,
so history ids are `block:txIndex:txHash:logIndex`; field values match).

## validation.json

Block range = Horizon start → +50k (`23125530 → 23175530`). No public Aave
Horizon subgraph id was discoverable on The Graph from GitHub/WebSearch at port
time (only the canonical Aave V3 mainnet subgraphs were found; Horizon is a
licensed instance), so `subgraph.url` is a **TODO** with a note
(`authEnv: GRAPH_API_KEY`). The entity map is the standard Aave V3 subgraph
schema and applies as-is once a Horizon endpoint is located. Until then
`tools/compare` cannot diff against a reference subgraph.

## Verification

```bash
cd aave-horizon
pnpm install
pnpm codegen
pnpm build      # tsc --noEmit, 0 errors
pnpm test       # 2 offline vitest suites
```

### Bounded validation run (against The Graph)

Once a Horizon subgraph endpoint is set in `validation.json`, uncomment
`end_block: 23175530` in `config.yaml`, set `RPC_URL_1` + the HyperSync env, run
`pnpm start` to backfill blocks `23125530 → 23175530`, then diff with
`tools/compare` (needs `GRAPH_API_KEY`). Network access to HyperSync/RPC is
required for this step and was not run in the offline build environment.

## Test coverage

- `test/registration.test.ts` — full registration chain
  (AddressesProviderRegistered → ProxyCreated POOL/POOL_CONFIGURATOR →
  ReserveInitialized) asserting `Pool`, `ContractToPoolMapping`, `Reserve`
  (metadata + strategy reads), `SubToken`s, and `ReserveConfigurationHistoryItem`,
  using the real Horizon mainnet USDC reserve addresses (stable debt token = zero
  address, per v3.3).
- `test/supply-borrow.test.ts` — ReserveDataUpdated (rates/indexes) → aToken Mint
  (supply accounting + `getReserveData` effect) → Pool.Supply → vToken Mint
  (borrow accounting + `borrowedReservesCount`) → Pool.Borrow, asserting exact
  `Reserve` / `UserReserve` / `User` / history values.

All eth_calls are mocked via `AAVE_HORIZON_CALL_MOCK`; no RPC is used.
</content>
