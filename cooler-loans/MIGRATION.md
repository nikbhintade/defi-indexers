# OlympusDAO Cooler Loans — subgraph → HyperIndex migration

Port of the **OlympusDAO Cooler Loans subgraph** (`OlympusDAO/cooler-loans-subgraph`,
Ethereum mainnet) to **Envio HyperIndex v3.1.2**, TypeScript.

- **Source repo:** `OlympusDAO/cooler-loans-subgraph`
- **Source commit:** `bca7365c9ac93e51486d7124bcf0f7fe89416969` (2026-05-13)
- **Network:** Ethereum mainnet (`subgraph.yaml`, `network: mainnet`).

## Verification

```
cd cooler-loans
pnpm install
pnpm codegen      # generates .envio types from config.yaml + schema.graphql
pnpm build        # tsc --noEmit, zero errors
pnpm test         # 2 offline vitest suites, no RPC
```

All four pass. Tests run fully offline via `createTestIndexer` + `simulate`
with every eth_call mocked through `COOLER_CALL_MOCK`.

## Data sources (rendered mainnet addresses + start blocks)

| Subgraph data source | Address | Start block | Port |
| --- | --- | --- | --- |
| `Clearinghouse_V1` | `0xd6a6e8d9e82534bd65821142fccd91ec9cf31880` | 18185779 | `Clearinghouse` (multi-address) |
| `ClearinghouseV1_1` | `0xE6343ad0675C9b8D3f32679ae6aDbA0766A2ab4c` | 18234505 | `Clearinghouse` |
| `ClearinghouseV1_2` | `0x1e094fE00E13Fd06D64EeA4FB3cD912893606fE0` | 21216656 | `Clearinghouse` |
| `CoolerFactory_V1` | `0xDE3e735d37A8498AD2F141F603A6d0F976A6F772` | 18185633 | `CoolerFactory` (multi-address) |
| `CoolerFactory_V1_1` | `0x30Ce56e80aA96EbbA1E1a74bC5c0FEB5B0dB4216` | 18234504 | `CoolerFactory` |
| `MonoCooler` | `0xdb591Ea2e5Db886dA872654D58f6cc584b68e7cC` | 22423121 | `MonoCooler` |

The three Clearinghouse versions and two CoolerFactory versions share identical
event signatures and handlers in the subgraph, so each maps to a single
HyperIndex contract entry (`Clearinghouse`, `CoolerFactory`) carrying multiple
static addresses. Chain `start_block` is the earliest source (CoolerFactory_V1
@ 18185633). All contract names are PascalCase (per CONVENTIONS.md).

## No dynamic Cooler templates

The subgraph does **not** use `templates:` / `Cooler.create()`. Per-borrower
Cooler instances are never indexed directly — the **CoolerFactory re-emits**
every Cooler lifecycle event (`RequestLoan`/`RescindRequest`/`ClearRequest`/
`DefaultLoan`/`RepayLoan`/`ExtendLoan`) carrying the `cooler` address as a
parameter, and the mapping reads per-loan state by binding the Cooler via
`eth_call` (`Cooler.bind(event.params.cooler).getLoan(...)`). The port keeps
this exactly: those reads are Effects (no `contractRegister`, no address-less
contract). This is documented at the top of `src/handlers/coolerFactory.ts`.

## File map

| Source (subgraph) | Port (HyperIndex) |
| --- | --- |
| `subgraph.yaml` | `config.yaml` |
| `schema.graphql` | `schema.graphql` (Bytes→String, directives stripped, timeseries/aggregation reworked) |
| `src/clearinghouse.ts` (handlers) | `src/handlers/clearinghouse.ts` |
| `src/clearinghouse.ts` (Clearinghouse record + snapshot) + `src/bophades.ts` + `src/price.ts` | `src/services/clearinghouse.ts` |
| `src/cooler-factory.ts` | `src/handlers/coolerFactory.ts` |
| `src/monocooler.ts` | `src/handlers/monocooler.ts` |
| `src/stats.ts` | `src/services/stats.ts` |
| `src/numberHelper.ts` + `src/dateHelper.ts` | `src/utils/index.ts` |
| `src/constants.ts` + `src/token.ts` (addresses) | `src/constants.ts` |
| `Contract.bind().try_*()` eth_calls | `src/effects/{calls,contracts}.ts` |
| `abis/*.json` | `abis/*.json` (copied verbatim) |

## Schema changes (timeseries / aggregation)

The subgraph uses graph-node **timeseries** and **aggregation** entity types,
which HyperIndex does not have. Handled as follows:

1. **`@entity(timeseries: true)`** entities — `ClearinghouseSnapshot`,
   `ClaimDefaultedLoanEvent`, `RepayLoanEvent`, `ExtendLoanEvent`,
   `MonoCoolerAccountSnapshot`, `MonoCoolerGlobalSnapshot`,
   `MonoCoolerLoanOrigination`, `MonoCoolerLiquidation` — become **plain
   entities**. graph-node gives them an auto-incrementing `Int8 id` and an
   auto-set `timestamp`. The port assigns a **deterministic String id** and an
   explicit `timestamp: BigInt` (= block timestamp):
   - `ClearinghouseSnapshot` id = `{clearinghouse}-{block}-{logIndex}` (the
     subgraph's own — unused — `getSnapshotRecordId` helper shape).
   - `RepayLoanEvent` / `ClaimDefaultedLoanEvent` / `ExtendLoanEvent` id =
     `{txHash}-{logIndex}`.
   - MonoCooler snapshots id = `{txHash}-{logIndex}-acct` / `-global`;
     origination / liquidation id = `{txHash}-{logIndex}`.
2. **`@aggregation` types** — `DefaultStats`, `RepaymentStats`,
   `ExtensionStats`, `ClearinghouseSnapshotStats`, `MonoCoolerLtvStats`,
   `MonoCoolerOriginationStats`, `MonoCoolerLiquidationStats`,
   `MonoCoolerGlobalStats` — are **dropped**. They are pure read-time rollups
   (count/sum/min/max/first/last) of the timeseries source entities, all of
   which are ported, so no source data is lost; an equivalent rollup can be
   produced with a GraphQL query / view over the ported entities.
3. `Bytes` → `String` (lowercase `0x` hex). `@entity(immutable: …)` stripped.
   `@derivedFrom` kept. `Clearinghouse.singleton` gets `@index` so the treasury
   accounting can enumerate all clearinghouses via `getWhere`.
4. All entity type names are PascalCase already (no lowercase-first renames
   needed).

## eth_call → Effect table

All calls go through one cached `ethCall` Effect (`src/effects/calls.ts`),
wrapped by typed helpers (`src/effects/contracts.ts`). `try_` semantics are
preserved: a revert / undecodable output → `null`, mirroring the subgraph's
`.reverted` branches. Offline tests bypass RPC via `COOLER_CALL_MOCK`.

| Subgraph call | Effect wrapper | Pinned to block? |
| --- | --- | --- |
| `Cooler.owner/collateral/debt()` | `coolerOwner/Collateral/Debt` | no (immutable) |
| `Cooler.getRequest(id)` / `getLoan(id)` | `coolerGetRequest` / `coolerGetLoan` | yes (state) |
| `Clearinghouse.gohm/dai/sdai()` (V1/V1.1) | `clearinghouseGohm/Dai/Sdai` | no |
| `Clearinghouse_V1_2.gohm/reserve/sReserve()` | `clearinghouseGohm/Reserve/SReserve` | no |
| `Clearinghouse_V1_2.VERSION()` | `clearinghouseVersion` | no |
| `Clearinghouse.INTEREST_RATE/DURATION/FUND_CADENCE/FUND_AMOUNT/LOAN_TO_COLLATERAL/factory()` | `clearinghouse*` | no (config consts) |
| `Clearinghouse.active/fundTime/interestReceivables/principalReceivables()` | `clearinghouseActive/FundTime/...` | yes (state) |
| `ERC20.decimals()` | `erc20Decimals` | no |
| `ERC20/ERC4626.balanceOf()` | `balanceOf` | yes |
| `ERC4626.previewRedeem()` | `previewRedeem` | yes |
| `Kernel.getModuleForKeycode("TRSRY")` | `kernelGetModuleForKeycode` | yes |
| `TRSRY.getReserveBalance/reserveDebt()` | `trsryGetReserveBalance/ReserveDebt` | yes |
| `ChainlinkPriceFeed.decimals/latestAnswer()` (OHM/ETH, ETH/USD) | `feedDecimals/feedLatestAnswer` | latestAnswer yes |
| `gOHM.index()` | `gohmIndex` | yes |
| `MonoCooler.loanToValues()` | `monoLoanToValues` | yes |
| `MonoCooler.accountPosition(acct)` | `monoAccountPosition` | yes |
| `MonoCooler.totalCollateral/totalDebt/interestAccumulatorRay/interestRateWad/ltvOracle/liquidationsPaused/borrowsPaused/treasuryBorrower()` | `mono*` | yes |

`dataSource.network()` lookups in `src/bophades.ts`/`src/token.ts` are replaced
with the rendered mainnet constants (Kernel `0x2286d7…f54b`, gOHM
`0x0ab87…a52f`, feeds in `src/constants.ts`).

## Entity IDs (byte-for-byte parity)

- `Clearinghouse` id = clearinghouse address (lowercase).
- `ClearinghouseSingleton` id = `"ROOT"`.
- `CoolerLoanRequest` id = `{cooler}-{requestId}`.
- `CoolerLoan` id = `{cooler}-{loanId}`.
- `RequestLoanEvent` / `RescindLoanRequestEvent` id = `{cooler}-{requestId}`.
- `ClearLoanRequestEvent` id = `{cooler}-{loanId}`.
- `RebalanceEvent` / `DefundEvent` id = `{clearinghouse}-{block}` (subgraph shape).
- `BorrowerStats` id = borrower address; `ClearinghouseCumulativeStats` id =
  clearinghouse address; MonoCooler `*Account` id = account address;
  `MonoCoolerGlobalState` id = `"singleton"`.
- Timeseries entity ids: reconstructed deterministically (see Schema changes).

`CoolerLoan.borrower` is a required relation to `BorrowerStats` whose id is the
borrower address — the subgraph stores `request.borrower.toHexString()` there,
which equals the BorrowerStats id, so `borrower_id` is consistent.

## Preserved quirks / bugs (for parity)

1. **`handleDefaultLoan` zeroes the loan before computing stat deltas.** The
   subgraph sets `loanRecord.principal/interest/collateral = 0`, then calls
   `updateBorrowerStats(..., loanRecord.principal.neg(), ...)` — reading the
   already-zeroed in-memory values, so **all three deltas are 0**. The port
   reproduces this exactly (passes `ZERO.negated()` for all three). Documented
   inline in `src/handlers/coolerFactory.ts`.
2. **Repay interest/principal split.** Matches the subgraph: `amountPaid >
   interest ⇒ interestPaid = interest, principalPaid = amountPaid - interest`;
   else `interestPaid = amountPaid, principalPaid = 0`. `amountPaid == 0` is
   short-circuited (no event written), as in the subgraph.
3. **`updateBorrowerStats` validation branches.** The subgraph's many
   `log.error(...)` validations do not mutate persisted state — *except* the
   `currentActiveBorrowers > currentActiveLoans ⇒ currentActiveBorrowers =
   currentActiveLoans` "fix the state" line, which **is** kept.
4. **`interestForLoan` hardcodes `INTEREST_RATE = 5e15`** (the subgraph's own
   hardcoded extension-interest constant), independent of the per-clearinghouse
   rate. Preserved verbatim in `src/handlers/coolerFactory.ts`.
5. **MonoCooler `getLtvValues` fallback** to constant `[3000e18, 3300e18]` WAD
   on a reverted `loanToValues()` is preserved.
6. **MonoCooler `LtvOracleSet` reads old & new LTV both pinned to the event
   block** — the subgraph reads `getLtvValues()` before and after writing the
   new oracle, but both reads hit the contract at the same block, so they
   return identical values. Preserved.

## Deviations

1. **`event.transactionLogIndex` → `event.logIndex`.** HyperIndex does not
   expose `transactionLogIndex`. The subgraph used `event.logIndex` for its ids
   (`MonoCoolerActivity`, `MonoCoolerLtvOracleChange`), so the activity/oracle
   ids match exactly. The reconstructed timeseries ids also use `logIndex`.
2. **Timeseries / aggregation reworking** (see Schema changes) — the only place
   the port's persisted ids differ from the subgraph (auto Int8 → deterministic
   string). Field *values* are identical. These entities are excluded from the
   `validation.json` entity diff (their id columns can't match).
3. **No block handler.** The subgraph is purely event-driven; snapshots are
   taken inside the loan/clearinghouse event handlers (`populateClearinghouseSnapshot`),
   so no `indexer.onBlock` is needed.

## Tests (offline)

- `test/origination.test.ts` — `RequestLoan` → `ClearRequest` on the V1
  Clearinghouse. Mocks every Cooler/Clearinghouse/ERC20/Kernel/TRSRY/ERC4626
  call and asserts exact values for `CoolerLoanRequest`, `CoolerLoan`,
  `Clearinghouse`, `ClearinghouseSnapshot`, `ClearLoanRequestEvent`,
  `BorrowerStats`, `ClearinghouseCumulativeStats`.
- `test/repay.test.ts` — `RequestLoan` → `ClearRequest` → `RepayLoan` (full
  repayment). Asserts the `RepayLoanEvent` interest/principal split, the zeroed
  `CoolerLoan`, the borrower stats (`activeLoans=0`, `totalRepaidLoans=1`,
  balances zeroed) and the cumulative counters, plus the repay snapshot.

Loan/snapshot entities are created dynamically by the simulated flow (no
seeding needed); the MonoCooler path and default/extend flows are exercised by
the shared services but not asserted in a dedicated test (the request→clear→repay
flow covers the loan-accounting core and the snapshot/treasury pricing path).

## Bounded validation run

`config.yaml` has a commented `end_block: 18235779` (Clearinghouse_V1 start
18185779 + 50k). `validation.json` uses block range 18185779 → 18235779. To run
a bounded historical sync set `RPC_URL_1` (and optionally a HyperSync endpoint),
uncomment `end_block`, then `pnpm envio start`. Compare against the
decentralized-network subgraph once a concrete subgraph id is filled into
`validation.json` (see the TODO there; the Studio slug is `cooler-loans`).

## Gaps / not ported

- **`@aggregation` rollup entities** (8 types) — dropped, recomputable from the
  ported timeseries entities (see Schema changes #2).
- **goerli network** — the subgraph manifest is mainnet-only; goerli addresses
  in `networks.json`/`src/*.ts` maps are not carried (mainnet constants only).
- **`MonoCoolerLtvOracleChange.globalState` / MonoCooler aggregation sources** —
  the entities are ported; only their aggregation views are dropped.
