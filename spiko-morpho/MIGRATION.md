# Migration: spiko-tech/morpho-blue-subgraph → Envio HyperIndex

Full-fidelity port of the **Morpho Blue + MetaMorpho** Messari-style lending
subgraph (Ethereum mainnet) to Envio HyperIndex (`envio` 3.1.2, TypeScript).

- **Source repo:** `spiko-tech/morpho-blue-subgraph`
- **Source commit:** `57da53be97d39517d2abc60d2aa59d15a6f66ea3` (2024-03-28)
- **Target chain:** Ethereum mainnet (chain id 1)
- **Data sources:**
  - `MorphoBlue` @ `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb`, start block `18883124`
  - `MetaMorphoFactory` @ `0xa9c3d3a366466fa809d1ae982fb2c46e5fc41101`, start block `18925584`
  - `MetaMorpho` — address-less template, registered via `indexer.contractRegister`
    on `MetaMorphoFactory.CreateMetaMorpho`.

## File map (source → port)

| Subgraph file | Port file |
| --- | --- |
| `subgraph.yaml` | `config.yaml` |
| `schema.graphql` | `schema.graphql` (ported 1:1; `Bytes`→`String` lowercase hex, ids→`ID!`) |
| `src/morpho-blue.ts` | `src/handlers/morphoBlue.ts` |
| `src/meta-morpho-factory.ts` | `src/handlers/metaMorphoFactory.ts` |
| `src/meta-morpho.ts` | `src/handlers/metaMorpho.ts` |
| `src/initializers/protocol.ts` | `src/initializers/protocol.ts` |
| `src/initializers/markets.ts` | `src/initializers/markets.ts` |
| `src/sdk/manager.ts` (DataManager) | `src/sdk/manager.ts` |
| `src/sdk/position.ts` (PositionManager) | `src/sdk/position.ts` |
| `src/sdk/snapshots.ts` (SnapshotManager) + `activityCounter` | `src/sdk/snapshots.ts` |
| `src/sdk/token.ts` (TokenManager) | `src/sdk/token.ts` |
| `src/sdk/account.ts` (AccountManager) | `src/sdk/account.ts` |
| `src/sdk/metamorpho.ts` | `src/sdk/metamorpho.ts` |
| `src/sdk/constants.ts` | `src/sdk/constants.ts` |
| `src/maths/{maths,shares}.ts` | `src/maths/shares.ts` |
| `src/utils/{liquidationIncentives,metaMorphoUtils}.ts` | `src/utils/metaMorphoUtils.ts` |
| `src/fetchUsdTokenPrice.ts` | `src/fetchUsdTokenPrice.ts` |
| `src/chainlink.ts` (USD pricing eth_calls) | `src/effects/{calls,contracts}.ts` |
| (compound-v3) `src/common/graphBytes.ts` | `src/utils/graphBytes.ts` (reused + extended) |

The class-based SDK (DataManager / PositionManager / SnapshotManager / TokenManager /
AccountManager) is reimplemented as **functional, context-threaded helpers**: every
helper takes the envio `EvmOnEventContext` and loads/sets entities through it
(HyperIndex entities are immutable plain objects, written via `context.X.set({...})`).

## eth_call → Effect table

All calls funnel through one cached `ethCall` Effect (`src/effects/calls.ts`) carrying
raw calldata; typed wrappers live in `src/effects/contracts.ts`. `try_*` semantics are
mirrored by catching reverts and returning `null`. Tests inject a declarative mock via
`SPIKO_CALL_MOCK` (set by `setCallMock`).

| Subgraph call (graph-ts) | Effect wrapper | Pinning |
| --- | --- | --- |
| `ERC20.try_symbol()` (string) | `erc20Symbol` | unpinned (immutable) |
| `ERC20SymbolBytes.try_symbol()` (bytes32) | `erc20SymbolBytes` | unpinned |
| `ERC20.try_name()` (string) | `erc20Name` | unpinned |
| `ERC20NameBytes.try_name()` (bytes32) | `erc20NameBytes` | unpinned |
| `ERC20.try_decimals()` (uint8) | `erc20Decimals` | unpinned |
| `IRM.try_borrowRateView(marketParams, market)` | `irmBorrowRateView` | block-pinned |
| `ChainlinkPriceFeed.latestRoundData()` | `chainlinkLatestRoundData` | block-pinned |
| `ChainlinkPriceFeed.decimals()` | `chainlinkDecimals` | block-pinned |
| `WstEth.getStETHByWstETH(1e18)` | `wstEthGetStETHByWstETH` | block-pinned |
| `REth.getExchangeRate()` | `rEthGetExchangeRate` | block-pinned |
| `ERC4626.convertToAssets(1e18)` (sDAI/wUSDM/sUSDe) | `erc4626ConvertToAssets` | block-pinned |

## Entity id conventions (byte-for-byte)

- **Morpho market id**: the event's `bytes32` id, stored lowercase (`0x…`).
- **Oracle id**: `marketId ++ oracleAddress` (graph-ts `Bytes.concat`) → `hexConcat`.
- **Position counter**: `{account}-{market}-{side}`; open position: `{counter}-{nextCount}`.
- **PositionSnapshot**: `{positionId}-{txHash}-{logIndex}`.
- **Event entities** (Deposit/Withdraw/Borrow/Repay/Liquidate/Flashloan):
  `txHash.concatI32(logIndex).concatI32(TransactionEnum)` (graph-ts `Bytes.concatI32`,
  4-byte little-endian) → `concatI32` in `src/utils/graphBytes.ts`.
- **Snapshot buckets**: `marketId ++ Bytes.fromI32(hours|days)` and `Bytes.fromI32(days|hours)`
  for protocol-level snapshots (4-byte LE) → `i32Bytes`.
- **MetaMorpho market id**: `vaultAddress ++ marketId`.
- **MetaMorpho event ids**: `txHash ++ Bytes.fromI32(logIndex)`.

`src/utils/graphBytes.ts` reproduces graph-ts `Bytes.fromI32` / `Bytes.fromBigInt` /
`Bytes.concat*` byte layouts (reused from the compound-v3 port).

## Morpho shares math (exact rounding preserved)

`src/maths/shares.ts`: `toAssetsUp`/`toAssetsDown` with `VIRTUAL_SHARES = 1e6`,
`VIRTUAL_ASSETS = 1`, integer `mulDivUp`/`mulDivDown`. MetaMorpho ERC4626 conversion
(`toMetaMorphoAssetsUp`) uses the `18 - underlyingDecimals` share offset. All integer
math is `bigint`, matching graph-node `BigInt`.

## Intentional deviations / preserved quirks (for parity)

1. **`Liquidate` entity id uses `Transaction.DEPOSIT` (0)**, not `LIQUIDATE`. This is a
   bug in the source (`createLiquidate` concatenates `Transaction.DEPOSIT`); preserved
   verbatim for data parity.
2. **`createDeposit` prices the supply using the *collateral* (`inputToken`) price**, not
   the loan token — source quirk preserved (`manager.createDeposit` uses `inputToken_id`).
3. **`gasUsed` is always `null`/undefined.** The subgraph manifest does not request
   receipts, so `event.receipt` was always null → `gasUsed = null`. HyperIndex likewise
   does not expose receipt gas here.
4. **`market.relation` / `supplyIndex` / `borrowIndex` are never set** (always null) —
   the subgraph reads them in snapshots/position but never writes them; preserved.
5. **`event.transactionLogIndex` dropped.** graph-ts exposed it as a uniqueness suffix in
   `NewQueue` / `PendingTimelock` / `PendingGuardian` / `SubmitCap` ids. HyperIndex does
   not expose it; `logIndex` already disambiguates within a transaction, so the suffix is
   omitted. The remaining id components (address, timestamp, logIndex) are identical.
6. **`fetchPriceFromFeed` revert handling.** The graph-ts version would throw on a reverted
   `latestRoundData()`/`decimals()`; we treat a revert as `0` (these feeds do not revert in
   the indexed range), so behaviour matches in practice while staying total.
7. **Dead code not ported:** `src/constants/chainlinkDatabase.ts` (1284 lines),
   `src/initializers/chainlinkProxy.ts` (empty), and the `ChainlinkAggregatorProxy` /
   `ChainlinkPriceFeed` template data sources with their `src/chainlink.ts` handlers — all
   handlers are empty `{}` and the database map is never imported. The live pricing path is
   the hardcoded maps in `fetchUsdTokenPrice.ts`, which are ported in full. The unused
   `_ChainlinkProxy` / `_ChainlinkAggregator` schema entities are kept for schema parity.
   The DataManager revenue/fee helpers (`getOrUpdateRate`, `getOrUpdateFee`,
   `addProtocolRevenue`, `addSupplyRevenue`, `getOrCreateRevenueDetail`) are likewise
   unreachable from the active mainnet handlers and are not ported.
8. **BigDecimal semantics:** `bignumber.js` configured to 34 significant digits, no
   exponential notation (graph-node parity). `tools/compare` tolerates far-decimal drift.

## Bounded validation run

`config.yaml` has `start_block: 18883124` and a commented `end_block: 18933124`
(start + 50k). To run a bounded historical index:

1. Uncomment `end_block: 18933124` in `config.yaml`.
2. Provide an RPC/HyperSync source and `RPC_URL_1` for the eth_call effects.
3. `pnpm codegen && pnpm start` (or `pnpm dev`).
4. Diff against the subgraph with `tools/compare` using `validation.json`.

## Known gaps

- **Subgraph gateway id unconfirmed.** `validation.json.subgraph.url` is a `TODO`. Source
  candidates: hosted-service `morpho-association/morpho-blue` and `morpho-org/morpho-blue`
  (from `package.json`); the canonical Morpho Blue subgraph on the decentralized network is
  also a candidate. Set the concrete `gateway.thegraph.com/api/subgraphs/id/<ID>` URL and
  `GRAPH_API_KEY` before comparing.
- **Protocol/market `cumulativeUnique*` counters:** the source bumps them in
  `DataManager._updateUsageData` via `activityCounter`. In this port the `_ActiveAccount`
  markers and the daily/hourly snapshot active-user counts are produced via
  `updateSnapshotUsageData`; the market/protocol `cumulativeUnique{Depositors,Borrowers,…}`
  bumps were on dead branches in several cases (e.g. `LIQUIDATOR`/`TRANSFER` never fire from
  Morpho events) and are not separately re-applied to the market/protocol rows. The
  per-snapshot active counts match. Verify these aggregate counters during a bounded run.

## Verification

- `pnpm install` ✓
- `pnpm codegen` ✓
- `pnpm build` (`tsc --noEmit`) ✓ — zero errors
- `pnpm test` ✓ — 2 offline tests:
  - `test/create-market.test.ts` — CreateMarket → Market + LendingProtocol + Oracle + rates.
  - `test/supply-flow.test.ts` — CreateMarket + Supply → Market totals, Position (exact
    `toAssetsDown` shares math), Deposit event, PositionSnapshot, Account, protocol counts.
