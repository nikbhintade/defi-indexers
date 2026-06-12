# compound-v2: subgraph → HyperIndex migration

Port of the official Compound V2 subgraph (**Ethereum mainnet**) to envio
HyperIndex 3.1.2 (TypeScript).

- **Source repo:** https://github.com/graphprotocol/compound-v2-subgraph
- **Commit:** `07817fd87c0dc46c7c2ecadddf10e53ef15ff4c5` ("Merge pull request #16 from juanmardefago/possible-fix", 2021-11-15)
- **Manifest:** Comptroller data source at
  `0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B`, start block 7700000, plus a
  `CToken` template instantiated on `MarketListed`.

## File map (original → ported)

| Original | Ported |
| --- | --- |
| `subgraph.yaml` | `config.yaml` (template → address-less `CToken` contract) |
| `schema.graphql` | `schema.graphql` (Bytes → String lowercase, `@entity` removed, interfaces dropped — see deviations) |
| `src/mappings/comptroller.ts` | `src/handlers/comptroller.ts` |
| `src/mappings/ctoken.ts` | `src/handlers/ctoken.ts` |
| `src/mappings/markets.ts` (`createMarket`, `updateMarket`, price helpers) | `src/services/markets.ts` |
| `src/mappings/helpers.ts` (entity helpers) | `src/services/helpers.ts` |
| `src/mappings/helpers.ts` (numeric helpers) + markets.ts hardcoded addresses | `src/utils/index.ts`, `src/constants/index.ts` |
| `templates:` (subgraph manifest, `CToken.create(...)`) | `indexer.contractRegister` on `Comptroller.MarketListed` (`src/handlers/comptroller.ts`) |
| — | `src/effects/calls.ts`, `src/effects/contracts.ts` (eth_call layer) |

All handlers are ported: Comptroller (`MarketListed`, `MarketEntered`,
`MarketExited`, `NewCloseFactor`, `NewCollateralFactor`,
`NewLiquidationIncentive`, `NewMaxAssets`, `NewPriceOracle`) and CToken
(`Mint`, `Redeem`, `Borrow`, `RepayBorrow`, `LiquidateBorrow`, `Transfer`,
`AccrueInterest`, `NewReserveFactor`, `NewMarketInterestRateModel`).
Hardcoded constants are copied exactly: cUSDC
`0x39aa39c021dfbae8fac545936693ac917d5e7563`, cETH
`0x4ddc2d193948926d02f9b1fe9e1daa0718270ed5`, SAI ("dai")
`0x89d24a6b4ccb1b6faa2625fe562bdd9a23260359`, PriceOracle1
`0x02557a5e05defeffd4cae6d83ea3d173b272c904`, USDC
`0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48`, oracle switch at block
7715908, USD-based oracle switch at block 10678764, 2102400 blocks/year.

## eth_calls → Effects

All calls go through a single cached Effect `ethCall`
(`src/effects/calls.ts`, input `{to, data, block?}`, output nullable hex,
`cache: true`) using viem over `RPC_URL_1`. `try_*` semantics are mirrored:
revert / empty return data → `null`. Typed wrappers live in
`src/effects/contracts.ts`. Block pinning: state-dependent reads are pinned
to `event.block.number`; immutable metadata is unpinned.

| Original call (markets.ts) | Wrapper | Pinned |
| --- | --- | --- |
| `CToken.underlying()` | `cTokenUnderlying` | no (immutable) |
| `CToken.name()` / `symbol()` | `cTokenName` / `cTokenSymbol` | no (immutable) |
| `CToken.try_interestRateModel()` | `cTokenInterestRateModel` | yes |
| `CToken.try_reserveFactorMantissa()` | `cTokenReserveFactorMantissa` | yes |
| `CToken.accrualBlockNumber()` | `cTokenAccrualBlockNumber` | yes |
| `CToken.totalSupply()` | `cTokenTotalSupply` | yes |
| `CToken.exchangeRateStored()` | `cTokenExchangeRateStored` | yes |
| `CToken.borrowIndex()` | `cTokenBorrowIndex` | yes |
| `CToken.totalReserves()` | `cTokenTotalReserves` | yes |
| `CToken.totalBorrows()` | `cTokenTotalBorrows` | yes |
| `CToken.getCash()` | `cTokenGetCash` | yes |
| `CToken.borrowRatePerBlock()` | `cTokenBorrowRatePerBlock` | yes |
| `CToken.try_supplyRatePerBlock()` | `cTokenSupplyRatePerBlock` | yes |
| `ERC20.decimals()` / `name()` / `symbol()` (underlying) | `erc20Decimals` / `erc20Name` / `erc20Symbol` | no (immutable) |
| `PriceOracle.getPrice(token)` (≤ block 7715908) | `oracle1GetPrice` | yes |
| `PriceOracle2.try_getUnderlyingPrice(cToken)` (> 7715908) | `oracle2GetUnderlyingPrice` | yes |

For offline tests, a declarative mock spec can be injected via the
`COMPOUND_V2_CALL_MOCK` env var (`setCallMock` in `src/effects/calls.ts`) —
necessary because the envio test indexer runs handlers in a worker thread
(the spec is JSON-serialized into the env, which the worker copies).

## Intentional deviations

1. **`event.transactionLogIndex` → `event.logIndex`.** The original builds
   MintEvent / RedeemEvent / BorrowEvent / RepayEvent / LiquidationEvent /
   TransferEvent ids as `txHash-transactionLogIndex`. envio only provides the
   absolute (block-level) `event.logIndex`. In practice graph-node's Ethereum
   adapter populates `transactionLogIndex` with the receipt's block-level
   `logIndex` anyway (it has no per-transaction log counter), so ids are
   expected to match the deployed subgraph byte-for-byte; if a deployment
   exists where they differ, ids of these six event entities deviate.
   `AccountCTokenTransaction` ids already used `event.logIndex` in the
   original and are unaffected.
2. **Non-`try_` calls don't abort.** graph-node aborts the subgraph when a
   non-`try_` call reverts (`underlying`, `name`, `symbol`, `decimals`,
   `accrualBlockNumber`, `totalSupply`, `exchangeRateStored`, `borrowIndex`,
   `totalReserves`, `totalBorrows`, `getCash`, `borrowRatePerBlock`,
   `PriceOracle.getPrice`). The port logs an error and falls back to neutral
   values (`0x0` address / `""` / `0`). These calls never revert for real
   listed markets, so stored data is unaffected.
3. **Missing-entity crash semantics** (`Market.load(...)!`,
   `Comptroller.load('1')!` on AssemblyScript null deref) are mirrored with
   `getOrThrow`; `MarketEntered`/`MarketExited`/`NewCollateralFactor` keep
   the original's explicit null checks.
4. **USDC literal trailing space.** The original's oracle-1 USDC address
   literal is `'0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48 '` (trailing
   space) which graph-ts tolerated; the port uses the trimmed address
   (`src/constants/index.ts`).
5. **Schema interfaces dropped.** `CTokenTransfer` and `UnderlyingTransfer`
   are GraphQL interfaces with no storage of their own; HyperIndex schemas
   don't support `interface`/`implements`, so only the concrete entity types
   are kept (same names, same fields). `Bytes` fields are stored as lowercase
   hex strings.
6. **BigDecimal precision:** graph-node keeps 34 significant digits;
   bignumber.js (envio's BigDecimal) is configured to 34 decimal places for
   division and non-exponential serialization (`src/utils/index.ts`).
   graph-node's `.truncate(n)` is replicated as
   `decimalPlaces(n, ROUND_DOWN)` (truncation toward zero, never rounding).
   Far decimals of division results may differ; `tools/compare` tolerates
   this.
7. **Faithfully-preserved quirks:** the `AccrueInterest` signature is the
   original 3-param one (post-2020 upgraded cTokens emit a 4-param variant
   the subgraph never indexed); `TransferEvent.amount` is *not* truncated
   while the AccountCToken balance deltas are; `totalUnderlyingBorrowed` /
   `totalUnderlyingRepaid` accumulate the *untruncated* amounts;
   transfers *to* a cToken contract are ignored (original TODO); the
   `underlyingPrice.div(usdPriceInEth)` division is not guarded against a
   zero USDC price, exactly like the original.

## Validation run

1. Uncomment `end_block: 7750000` in `config.yaml` (chain 1).
2. `export RPC_URL_1=<mainnet archive RPC>` (most calls are block-pinned; an
   archive node is required). Effects are cached (`cache: true`), so re-runs
   are cheap.
3. `pnpm codegen && pnpm dev` (or `envio start` with a configured database)
   and wait for the indexer to reach the end block.
4. Fill in the subgraph gateway URL in `validation.json` (see the note there —
   the repo README only references the deprecated hosted-service deployment
   `graphprotocol/compound-v2`) and run `tools/compare`.

Block range rationale: 7700000 is the subgraph's start block; the +50k window
(~9 days, May 2019) covers the Comptroller bootstrap (NewPriceOracle,
NewCloseFactor, NewLiquidationIncentive, NewMaxAssets), the initial market
listings (cBAT/cSAI/cETH/cREP/cUSDC/cZRX incl. the documented cZRX
`supplyRatePerBlock` revert), both sides of the PriceOracle1 → PriceOracle2
switch at block 7715908, and live mint/redeem/borrow/repay/transfer traffic.

## Known gaps

- `validation.json` subgraph URL is a TODO (decentralized-network ID for
  `graphprotocol/compound-v2` could not be resolved offline).
- The offline tests cover market creation (cERC20 / cETH / SAI special
  cases) and the accrue→mint→transfer flow with mocked eth_calls
  (`COMPOUND_V2_CALL_MOCK`); redeem/borrow/repay/liquidate handlers share
  the same helper code paths and are exercised by the bounded validation run
  against a live archive RPC instead.
- Markets upgraded to the 4-param `AccrueInterest` event (post-2020) stop
  updating, exactly like the original subgraph (deviation 7).
