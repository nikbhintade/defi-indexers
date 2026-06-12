# compound-v3: subgraph → HyperIndex migration

Port of the official Compound V3 (Comet) subgraph (**Ethereum mainnet**) to
envio HyperIndex 3.1.2 (TypeScript).

- **Source repo:** https://github.com/papercliplabs/compound-v3-subgraph
- **Commit:** `21bb019e578f01dcc6e3e4cd9e9e4fdb504f1572` ("Merge pull request #6 from papercliplabs/fix-westETH-pricing")
- **Manifest (mainnet):** Configurator data source at
  `0x316f9708bB98af7dA9c68C1C3b5e79039cD336E3` (start block 15331590),
  CometRewards data source at `0x1B0e765F6224C21223AeA2af16c1C46E38885a40`
  (start block 15331590), plus a `Comet` template instantiated on
  `Configurator.SetFactory` (markets get created on the Comet proxy's
  `Upgraded` event).

## File map (original → ported)

| Original | Ported |
| --- | --- |
| `subgraph.yaml` | `config.yaml` (template → address-less `Comet` contract) |
| `schema.graphql` | `schema.graphql` (Bytes → String lowercase hex, `@entity` removed, interface dropped — see deviations) |
| `src/mappings/configurator.ts` | `src/handlers/configurator.ts` |
| `src/mappings/comet.ts` | `src/handlers/comet.ts` |
| `src/mappings/cometRewards.ts` | `src/handlers/cometRewards.ts` |
| `src/mappingHelpers/{account,protocol,market,position,collateralBalance,token,usage,interaction}.ts` | `src/mappingHelpers/*` (same file names) |
| `src/common/constants.ts` | `src/common/constants.ts` |
| `src/common/networkSpecific.ts` | `src/common/networkSpecific.ts` (mainnet branch only) |
| `src/common/utils.ts` | `src/common/utils.ts` (+ `getRewardConfigData` made async over effects) |
| graph-ts `Bytes` id construction | `src/common/graphBytes.ts` (`Bytes.fromBigInt` LE layout, `Bytes.fromUTF8`, `concat`) |
| `templates:` (`Comet.create(...)`) | `indexer.contractRegister` on `Configurator.SetFactory` |
| — | `src/effects/calls.ts`, `src/effects/contracts.ts` (eth_call layer) |

All handlers are ported: Configurator (`Upgraded`, `SetFactory`), Comet
(`Upgraded`, `Supply`, `Withdraw`, `AbsorbDebt`, `SupplyCollateral`,
`WithdrawCollateral`, `TransferCollateral`, `AbsorbCollateral`,
`BuyCollateral`, `WithdrawReserves`, `Transfer`) and CometRewards
(`RewardClaimed`).

## Entity ids (byte-for-byte)

The original uses `Bytes` ids built with `.concat`, `Bytes.fromUTF8` and
`Bytes.fromBigInt`. The port stores them as lowercase `0x…` hex strings with
identical byte layout (`src/common/graphBytes.ts`):

- `Bytes.fromBigInt(x)` = graph-node's *minimal two's-complement
  little-endian* representation (num_bigint `to_signed_bytes_le`), e.g. block
  16000000 → `0024f400`, hour 463333 → `e51107`, `0` → `00`.
- `Bytes.fromUTF8("COL")` → `434f4c`, `"BAL"` → `42414c`,
  `"PROTOCOL_CUMULATIVE"` / `"MARKET_CUMULATIVE"` / `"PROTOCOL_HOUR"` /
  `"PROTOCOL_DAY"` → their UTF-8 hex.
- Examples: Position = market ++ account; CollateralToken = market ++ token ++
  `COL`; MarketCollateralBalance = collateralToken ++ `BAL`; interactions =
  txHash ++ logIndexBytes; periodic snapshots = (market ++) hour/day/week
  bytes; per-event snapshots = parent ++ blockBytes ++ logIndexBytes.
- `_ActiveAccount` ids: address ++ utf8(metadata) where metadata for market
  buckets is the string `"MARKET" + market.id.toHexString() + hour/day` —
  the `0x` prefix is part of the UTF-8 metadata, replicated.

Both tests assert hardcoded id hex to lock these layouts in.

## eth_calls → Effects

All calls go through a single cached Effect `ethCall`
(`src/effects/calls.ts`, input `{to, data, block?}`, output nullable hex,
`cache: true`) using viem over `RPC_URL_1`. `try_*` semantics are mirrored:
revert / empty / **undecodable** return data → `null` (graph-node also treats
decode failures as reverts — the rewardConfig V2→V1 fallback depends on it).
Typed wrappers live in `src/effects/contracts.ts`.

Pinning: **every** Comet / Configurator / CometRewards / Chainlink read is
pinned to `event.block.number` (graph-node executes calls at the event block
and all of these are mutable state/config); immutable ERC20 metadata is
unpinned.

| Original call | Wrapper | Pinned |
| --- | --- | --- |
| `Comet.totalsBasic()` | `cometTotalsBasic` | yes |
| `Comet.getReserves()` / `totalSupply()` / `totalBorrow()` | `cometGetReserves` / `cometTotalSupply` / `cometTotalBorrow` | yes |
| `Comet.getUtilization()` / `getSupplyRate(u)` / `getBorrowRate(u)` | `cometGetUtilization` / `cometGetSupplyRate` / `cometGetBorrowRate` | yes |
| `Comet.getPrice(feed)` (try_ and non-try) | `cometGetPrice` | yes |
| `Comet.userBasic(a)` / `userCollateral(a,t)` / `totalsCollateral(t)` | `cometUserBasic` / `cometUserCollateralBalance` / `cometTotalsCollateral` | yes |
| `Comet.try_getCollateralReserves(t)` | `cometGetCollateralReserves` | yes |
| `Comet.numAssets()` / `getAssetInfo(i)` / `getAssetInfoByAddress(t)` | `cometNumAssets` / `cometGetAssetInfo` / `cometGetAssetInfoByAddress` | yes |
| `Comet.name()` / `symbol()` and all config getters (kinks, slopes, speeds, mins, targetReserves, trackingIndexScale, storeFrontPriceFactor) | `cometName` / `cometSymbol` / `cometUint` | yes |
| `Comet.governor()` / `pauseGuardian()` / `extensionDelegate()` / `baseToken()` / `baseTokenPriceFeed()` | `cometAddress` | yes |
| `Configurator.try_factory(comet)` | `configuratorFactory` | yes |
| `CometRewardsV2.try_rewardConfig(m)` / `CometRewardsV1.try_rewardConfig(m)` | `rewardConfigV2` / `rewardConfigV1` (mock names differ; calldata identical) | yes |
| `ChainlinkPriceFeed.try_latestRoundData().value1` | `chainlinkLatestAnswer` | yes |
| `ERC20.try_name()` / `try_symbol()` / `decimals()` | `erc20Name` / `erc20Symbol` / `erc20Decimals` | no (immutable) |
| `event.receipt.logs` topic scan (handleTransfer) | `receiptTopics` effect (`eth_getTransactionReceipt`, cached) | per-tx |

For offline tests, a declarative mock spec is injected via the
`COMPOUND_V3_CALL_MOCK` env var (`setCallMock` in `src/effects/calls.ts`),
with optional `to` / `args` / `block` matchers (block matchers emulate
distinct chain state per block). The env-var transport is needed because the
envio test indexer runs handlers in a worker thread.

## Receipts / transaction fields

The original manifest sets `receipt: true` on every handler and uses it for:

1. **`Transaction.gasUsed` / `gasUsedUsd`** — envio `field_selection`
   provides `gasUsed`, `gasPrice`, `gas` (gas limit), `from`, `to`, `hash`
   directly; no receipt fetch needed. Note: graph-node populates
   `transaction.gasPrice` from the RPC transaction object, which reports the
   *effective* gas price for mined EIP-1559 transactions; HyperSync's
   `gasPrice` is expected to match, but if validation shows drift on type-2
   transactions, switch the field selection to `effectiveGasPrice`.
2. **`logsContainWithdrawOrSupplyOrAbsorbDebtEvents`** (handleTransfer) —
   envio has no receipt-log field selection, so the port fetches the receipt
   topic0 list via the cached `receiptTopics` effect (one
   `eth_getTransactionReceipt` per distinct Comet Transfer tx) and scans it
   for the Supply/Withdraw/AbsorbDebt signatures, identical to the original.

## Intentional deviations

1. **Schema shape:** `Bytes` → `String` (lowercase hex); `@entity` /
   `@deprecated` directives removed; the `CollateralBalance` interface is
   dropped (concrete types unchanged); arrays of entity references
   (`Protocol.markets`, `MarketConfiguration.collateralTokens`,
   `MarketAccounting.collateralBalances`,
   `PositionAccounting.collateralBalances`) become `[String!]!` id arrays
   (HyperIndex has no stored entity-ref arrays); the derived
   `Position.positionAccountingSnapshots` list is `[X!]!` instead of the
   original's `[X!]` (envio requires non-null lists; storage unaffected).
   `Position.account` carries `@index` for the rewards handler's
   `getWhere` lookup (replaces the derived `account.positions.load()`).
2. **Non-`try_` calls don't abort.** graph-node aborts the subgraph when a
   non-`try_` call reverts. The port logs an error and falls back to neutral
   values (`""` / zero address / `0`). These calls never revert for real
   Comet deployments.
3. **AssemblyScript mutate-then-`.save()`** is replicated with mutable
   copies + `context.X.set`, preserving graph-node's store semantics
   (loads see last *saved* state, not in-flight mutations). This keeps the
   original's staleness quirks (see below) bit-exact.
4. **`Transaction.from`** falls back to the zero address if envio ever omits
   the transaction `from` (not expected on mainnet).
5. **`getTokenPriceUsd<T>`** (instanceof dispatch) is split into three
   concrete functions; every call site's entity type is statically known.
6. **Rewards-claim position inference order:** `getWhere` may return the
   account's positions in a different order than graph-node's derived
   loader. The result is order-independent except for *which* of several
   matching positions is picked — and that case is discarded (`> 1` found →
   null) in the original too.

## Preserved quirks (bug-for-bug)

- `InteractionType.TRANSFER_COLLATERAL` is the string
  `"TRANSFER_COLLATERAL_TO"`.
- `getCollateralTokenPriceUsd` returns the **stale** price when it refreshes
  (inner `let price` shadows the outer in the original), while saving the
  fresh price to the entity. Market/position collateral USD values therefore
  use the fresh price only from the second read in a block onward.
- `updatePositionAccounting` computes `baseBalance` from the **last saved**
  market accounting indices (the handler saves its updated market accounting
  at the end), so a position updated in block N uses block N-1's indices.
- `updateProtocolAccounting` similarly aggregates the last *saved* market
  accountings — protocol totals lag the triggering market by one event.
  During market creation the new market isn't in `protocol.markets` yet, so
  the first protocol accounting is all zeros.
- Market accounting hourly-copy id is `market ++ (market ++ hourBytes)` (the
  market id appears twice); the protocol accounting copy is created with the
  hourly id even when only the daily/weekly buckets are missing, and all
  missing buckets share that copy.
- `MarketConfigurationSnapshot` ids are `blockBytes ++ logIndexBytes` with no
  market prefix (as in the original).
- Comet `Upgraded` runs `updateMarketConfiguration` twice on market creation
  (once inside `getOrCreateMarketConfiguration`, once explicitly),
  overwriting the same snapshot ids.
- `handleSupply`/`handleWithdraw`'s second `updatePositionAccounting` is a
  same-block no-op (guard), so only cumulatives change after the interaction
  is recorded; the per-event snapshot is then manually overwritten in place.
- The rewards-claim loop saves each market accounting but deliberately not
  the per-position accounting ("could make a useless snapshot").
- `handleWithdrawCollateral` negates the amount twice (interaction amount is
  positive).
- `createClaimRewardsInteraction`'s `u8(u8(decimals))` double cast is a no-op
  and ported as a plain decimals read.

## Verification

- `pnpm install`, `pnpm codegen`, `pnpm build` (tsc --noEmit), `pnpm test`
  (vitest, offline) all pass.
- Offline tests (`test/`, all eth_calls mocked via `COMPOUND_V3_CALL_MOCK`):
  - `market-creation.test.ts` — SetFactory → Comet Upgraded creates
    Market/Configuration/RewardConfiguration/Accounting/Token/BaseToken/
    CollateralToken/Protocol/Usage/snapshot entities; asserts exact values
    and hardcoded byte-exact ids (incl. the V2→V1 rewardConfig fallback and
    the zero first protocol accounting).
  - `supply-withdraw.test.ts` — Supply + Withdraw on the created market;
    asserts Position/PositionAccounting (incl. the stale-index baseBalance
    quirk), Transaction gas math, interactions, market & protocol accounting
    (incl. the one-event protocol lag), hourly/daily snapshot buckets, usage
    counters and `_ActiveAccount` markers with exact values.

## Bounded validation run

1. Uncomment `end_block: 15381590` in `config.yaml` (chain 1).
2. `export RPC_URL_1=<mainnet archive RPC>` — all Comet reads are
   block-pinned, so an archive node is required; effects are cached
   (`cache: true`), so re-runs are cheap. The `receiptTopics` effect uses the
   same RPC.
3. `pnpm codegen && pnpm dev` (or `envio start` with a configured database)
   and wait for the indexer to reach the end block.
4. `GRAPH_API_KEY=<key>` and run `tools/compare` against `validation.json`.

Block range rationale: 15331590 is the subgraph's start block (Configurator /
CometRewards deployment, Aug 2022). The +50k window covers the Configurator
bootstrap (`Upgraded`, `SetFactory` → cUSDCv3 template registration), the
cUSDCv3 Comet proxy `Upgraded` (market + full config creation) and the
team's pre-launch seeding interactions. If the window proves too quiet for
interaction entities, extend `end_block`/`blockRange.end` to 15431590 — the
public launch (2022-08-26, ≈ block 15415000) adds organic
Supply/Withdraw/Collateral traffic.

## Known gaps

- envio cannot deliver receipt logs, so `handleTransfer` performs one cached
  `eth_getTransactionReceipt` per Comet Transfer transaction (exact-parity
  behaviour, extra RPC cost only).
- `Transaction.gasPrice` for EIP-1559 transactions may need
  `effectiveGasPrice` instead of `gasPrice` if validation shows drift (see
  Receipts section).
- Offline tests cover market creation and the supply/withdraw flow; the
  collateral, absorb/liquidation, buy-collateral, base-transfer and
  reward-claim handlers share the same helper code paths and are exercised
  by the bounded validation run against a live archive RPC.
- Only the Ethereum mainnet deployment is ported (`networkSpecific.ts`
  contains just the mainnet branch, including the WETH and wstETH market
  unit-of-account price feeds).
