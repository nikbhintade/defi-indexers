# pancakeswap-exchange: subgraph → HyperIndex migration

Port of the PancakeSwap exchange-v2 subgraph (**BNB Smart Chain**, the
canonical Uniswap-v2-style AMM subgraph) to envio HyperIndex 3.1.2
(TypeScript).

- **Source repo:** https://github.com/pancakeswap/pancake-subgraph
- **Commit:** `b219cc5670864b4a7c4fc4002b1cee1b028991c4` ("docs: Update urls (#265)", 2024-06-11)
- **Ported package:** `subgraphs/exchange` — the **BSC rendering** of the
  exchange-v2 codebase. Rationale: at this commit `subgraphs/exchange-v2` is
  the mustache-templated multichain variant whose checked-in rendered files
  (`subgraph.yaml`, `mappings/pricing.ts`, `mappings/utils/index.ts`) are
  rendered for **arbitrum-one** (factory `0x02a8…749e`, ETH-named fields),
  and `config/bsc.js` contains **no `v2` block** to render BSC values from.
  The BSC-deployed version of the very same code lives in
  `subgraphs/exchange`: BNB-named schema fields (`derivedBNB`, `bnbPrice`,
  `reserveBNB`, …), factory `0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73`,
  start block `6809737`, WBNB priced via the BUSD-WBNB + USDT-WBNB pairs.
  The mapping logic is otherwise identical up to field naming and two
  cosmetic exchange-v2 additions (Mint/Burn `token0`/`token1` refs that the
  BSC schema doesn't have).
- **Manifest:** Factory data source at
  `0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73` (start block 6809737) plus a
  `Pair` template instantiated on `PairCreated`.

## File map (original → ported)

| Original (`subgraphs/exchange`) | Ported |
| --- | --- |
| `subgraph.yaml` | `config.yaml` (template → address-less `Pair` contract; chain 56) |
| `schema.graphql` | `schema.graphql` (Bytes → String lowercase, `@entity` removed, `[Mint]!` id-arrays → `[String!]!`, + port-internal `PairTokenLookup`) |
| `mappings/factory.ts` | `src/handlers/factory.ts` |
| `mappings/core.ts` | `src/handlers/core.ts` |
| `mappings/dayUpdates.ts` | `src/dayUpdates.ts` |
| `mappings/pricing.ts` | `src/pricing.ts` |
| `mappings/utils/index.ts` (numeric helpers, constants) | `src/utils/index.ts` |
| `mappings/utils/index.ts` (fetchTokenName/Symbol/Decimals) | `src/services/tokens.ts` |
| `templates:` (manifest, `PairTemplate.create(...)`) | `indexer.contractRegister` on `Factory.PairCreated` |
| — | `src/effects/calls.ts`, `src/effects/contracts.ts` (eth_call layer) |

All handlers are ported: `handlePairCreated`, `handleTransfer`,
`handleSync`, `handleMint`, `handleBurn`, `handleSwap`, and all four
day-update helpers (`PancakeDayData`, `PairDayData`, `PairHourData`,
`TokenDayData`). The schema has no liquidity-position entities (unlike the
Uniswap-v2 original), so none are ported.

Hardcoded constants are copied exactly: factory
`0xca143ce32fe78f1f7019d7d551a6402fc5350c73`, WBNB
`0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c`, BUSD_WBNB_PAIR
`0x58f876857a02d6762e0101bb5c46a8c1ed44dc16`, USDT_WBNB_PAIR
`0x16b9a82891338f9ba80e2d6970fdda79d1eb0dae`, the 7-token whitelist
(WBNB, BUSD, USDT, USDC, UST, BTCB, WETH) and
`MINIMUM_LIQUIDITY_THRESHOLD_BNB = 10`.

## Entity ids

Byte-for-byte the original's:

- `Mint` / `Burn` / `Swap`: `txHash + "-" + index` where the index is the
  position in the corresponding `Transaction.mints/burns/swaps` array — the
  original's *transaction-scoped* counters are reproduced exactly because the
  arrays themselves are ported (no logIndex substitution was needed).
- `Mint.logIndex` / `Burn.logIndex` / `Swap.logIndex` use `event.logIndex`,
  the same absolute (block-level) log index graph-node provides.
- Day datas: `dayID`, `pair-dayID`, `pair-hourIndex`, `token-dayID` with
  i32 division (`Math.floor`) like the original.
- Addresses/hashes are lowercased everywhere (graph-ts `toHex()` semantics).

## eth_calls → Effects

ERC20 metadata calls go through a single cached Effect `ethCall`
(`src/effects/calls.ts`, input `{to, data, block?}`, output nullable hex,
`cache: true`) using viem over `RPC_URL_56`. `try_*` semantics are mirrored:
revert / empty / undecodable return data → `null` (this is also how
graph-node "reverts" `try_symbol()` on bytes32-returning tokens). Typed
wrappers live in `src/effects/contracts.ts`:

| Original call | Wrapper | Pinned |
| --- | --- | --- |
| `ERC20.try_name()` | `erc20Name` | no (immutable) |
| `ERC20NameBytes.try_name()` (bytes32) | `erc20NameBytes32` | no |
| `ERC20.try_symbol()` | `erc20Symbol` | no |
| `ERC20SymbolBytes.try_symbol()` (bytes32) | `erc20SymbolBytes32` | no |
| `ERC20.try_decimals()` | `erc20Decimals` | no |

For offline tests, a declarative mock spec is injected via the
`PANCAKE_EXCHANGE_CALL_MOCK` env var (`setCallMock` in
`src/effects/calls.ts`) — the envio test indexer runs handlers in a worker
thread, so the spec is JSON-serialized into the env (which the worker
copies). Mock rules match on a mock name that distinguishes the string and
bytes32 ABI variants (`name`/`nameBytes32`, `symbol`/`symbolBytes32`).

### `Factory.getPair` → `PairTokenLookup` entity (intentional deviation)

`findBnbPerToken` originally performed an eth_call
`factoryContract.getPair(token, WHITELIST[i])` on **every Sync of every
pair × up to 7 whitelist tokens**. The port replaces it with the
`PairTokenLookup` entity (two rows per pair, `tokenA-tokenB` and
`tokenB-tokenA`, written on `PairCreated`) — the factory's symmetric pair
mapping is exactly the data the indexer itself derives from `PairCreated`,
so results are identical without millions of (block-pinned, uncacheable
across blocks) RPC calls. A missing row corresponds to getPair returning
`ADDRESS_ZERO`. Edge case where behaviour could differ: a Sync handler
running *earlier in the same block* than another pair's `PairCreated` —
graph-node's eth_call (executed at end-of-block state) would return the
not-yet-indexed pair address and then crash on `Pair.load(...)` null deref;
the port simply skips it (the subgraph deployment evidently never hit that
crash, so data matches).

## Faithfully-preserved quirks

1. **`fetchTokenDecimals` null-coercion.** In AssemblyScript,
   `BigInt.fromI32(null as i32)` turns a reverted `decimals()` into `0`, so
   the function never returns null and factory.ts's
   `if (decimals === null) return` is dead code. The port returns `0n` on
   revert and drops the unreachable branch. Symbols/names default to
   `"unknown"`; the bytes32 fallback checks `isNullBnbValue`
   (`0x…01`) before decoding; `Bytes.toString()`'s null-terminated UTF-8
   decode (strips bytes32 zero padding) is replicated in `bytes32ToString`.
2. **`ZERO_BD` sentinel reference comparison.** handleSwap's
   `trackedAmountUSD === ZERO_BD ? derivedAmountUSD : trackedAmountUSD`
   (same for `amountFeeUSD`) is an AssemblyScript *reference* comparison: it
   only selects the derived amount when the pricing function returned the
   shared `ZERO_BD` object (neither token whitelisted), not when a
   whitelisted-path product is numerically 0. The pricing functions return
   the shared `ZERO_BD` object in exactly the original branches and the
   handler keeps the `===` identity check.
3. **Entity-cache staleness in handleSync.** `bundle.bnbPrice` and
   `findBnbPerToken` are computed *before* the synced pair is saved, so for
   the pricing pairs themselves they read the previous sync's
   reserves/prices/`reserveBNB` (graph-node's store cache only sees data
   after `save()`). envio's `context.X.get` has the same
   visible-after-`set` semantics, and the port keeps the original
   save order (asserted in `test/swap-flow.test.ts`).
4. **Reused Burn keeps `needsComplete: true`** (and its original
   `liquidity`) when the "direct send to pair" Transfer path is completed by
   the burn Transfer — the original never resets the flag.
5. **`PancakeDayData.totalVolumeBNB` / `totalVolumeUSD`** are initialized to
   0 and never accumulated (original behaviour).
6. **Minimum-liquidity skip**: `Transfer` with `to == 0x0` and raw
   `value == 1000` is ignored (the Uniswap V2 `MINIMUM_LIQUIDITY` lock).
7. **Missing-entity crash semantics**: unchecked `X.load(...)` derefs
   (handleMint's transaction/mint, handleBurn's burn, handleSync's
   pair/tokens/factory, `isCompleteMint`) are mirrored with `getOrThrow`;
   handleBurn keeps the original's explicit null check on the transaction.
8. **UST** (`0x23396c…d6fc`) stays in the whitelist exactly as deployed.

## Intentional deviations

1. **`getPair` eth_call → `PairTokenLookup` entity** (see above; extra
   entity type not present in the original schema).
2. **Bytes → String.** All `Bytes` fields (`Mint.to`, `Swap.sender/from/to`,
   `PairDayData.pairAddress`, …) are lowercase hex strings.
3. **`Transaction.mints/burns/swaps`**: `[Mint]!` etc. (arrays of entity
   refs) → `[String!]!` id arrays — same contents, same ordering.
4. **Schema directives**: `@entity` removed, `@derivedFrom` kept; relation
   fields are written via `<field>_id`.
5. **BigDecimal precision**: graph-node keeps 34 significant digits;
   bignumber.js (envio's BigDecimal) is configured to 34 decimal places for
   division and non-exponential serialization (`src/utils/index.ts`). Far
   decimals of division results may differ; `tools/compare` tolerates this.
6. **Non-`try_` semantics**: there are no non-`try_` eth_calls in this
   subgraph (all metadata reads are `try_`), so nothing to relax.

## Tests (offline, no network)

- `test/pair-created.test.ts` — PairCreated creates
  PancakeFactory/Bundle/Token/Pair/PairTokenLookup with mocked metadata
  (strict `PANCAKE_EXCHANGE_CALL_MOCK`): string path, bytes32-name fallback,
  symbol → `"unknown"`, reverted decimals → 0 quirk, id lowercasing.
- `test/swap-flow.test.ts` — full WBNB-BUSD flow on the real BSC pricing
  pair address (PairCreated → minimum-liquidity Transfer (skipped) → mint
  Transfer → Sync → Mint → Sync → Swap) asserting exact values for
  reserves, `bundle.bnbPrice` (incl. the one-sync staleness quirk), derived
  token prices, tracked/untracked/fee volumes, Transaction/Mint/Swap
  entities and PancakeDayData/PairDayData/PairHourData/TokenDayData.

## Validation run

1. Uncomment `end_block: 6859737` in `config.yaml` (chain 56).
2. `export RPC_URL_56=<BSC RPC>` (only immutable ERC20 metadata is fetched —
   no archive node required; effects are cached so re-runs are cheap).
3. `pnpm codegen && pnpm dev` (or `envio start` with a configured database)
   and wait for the indexer to reach the end block.
4. Fill in the subgraph gateway URL in `validation.json` (see the note
   there) and run
   `node tools/compare/compare.mjs --config pancakeswap-exchange/validation.json`.

Block range rationale: 6809737 is the factory deployment / subgraph start
block (PancakeSwap v2 launch, late April 2021). The +50k window (~42 hours
of BSC blocks) covers the factory bootstrap, creation of the
BUSD-WBNB/USDT-WBNB pricing pairs plus hundreds of others, and dense
mint/burn/swap/sync traffic across multiple PancakeDayData/PairHourData
buckets, exercising every handler incl. the fee-mint burn path.

## Known gaps

- `validation.json` subgraph URL is a TODO (the repo README no longer lists
  concrete endpoints; the explorer ID could not be verified offline — a
  candidate ID and the NodeReal proxy URL are noted in the file).
- Offline tests don't drive the burn path (`Transfer` to pair →
  `Transfer` to zero → `Burn`) or the fee-mint removal
  (`store.remove("Mint", …)` → `deleteUnsafe`); these share the
  Transfer/Transaction machinery exercised by the mint test and are covered
  by the bounded validation run.
- `Swap.from` uses `event.transaction.from` via `field_selection`; envio
  types it as optional, the port non-null asserts (always present on EVM).
