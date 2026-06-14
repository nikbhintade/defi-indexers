# quickswap: subgraph → HyperIndex migration

Port of the **QuickSwap V2** subgraph (**Polygon / matic**, a Uniswap-v2-style
AMM DEX) to envio HyperIndex 3.1.2 (TypeScript).

- **Source repo:** https://github.com/QuickSwap/QuickSwap-subgraph
- **Commit:** `47acf76f41bad9d38c999ca54390555cdf74081f` (2023-01-31)
- **Based on:** the sibling `pancakeswap-exchange` port in this repo (same
  Uniswap-v2 architecture). The structure (config.yaml, schema, src layout,
  effects layer, day/hour updates, tests) mirrors that port; everything below
  is adapted to QuickSwap's Polygon addresses, MATIC/USD pricing and schema.
- **Manifest:** Factory data source at
  `0x5757371414417b8C6CAad45bAeF941aBc7d3Ab32` (start block `5484576`) plus a
  `Pair` template instantiated on `PairCreated`.
- **Graft note:** the original `subgraph.yaml` grafts onto base
  `QmPUb1rWhd9C81XfiGTSEH3koXikC1bUZaUdMm84957aFv` at block `31025550`. This
  port indexes from genesis (`5484576`); a grafted hosted deployment and a
  from-genesis index can diverge for entities mutated before the graft block.
  See validation.json `_note`.

## File map (original → ported)

| Original (`src/mappings/…`) | Ported |
| --- | --- |
| `subgraph.yaml` | `config.yaml` (template → address-less `Pair` contract; chain 137) |
| `schema.graphql` | `schema.graphql` (Bytes → String lowercase, `@entity` removed, `[Mint]!` id-arrays → `[String!]!`) |
| `factory.ts` (`handleNewPair`) | `src/handlers/factory.ts` |
| `core.ts` | `src/handlers/core.ts` |
| `dayUpdates.ts` | `src/dayUpdates.ts` |
| `pricing.ts` | `src/pricing.ts` |
| `helpers.ts` (numeric helpers, constants) | `src/utils/index.ts` |
| `helpers.ts` (fetchToken{Name,Symbol,Decimals,TotalSupply}) | `src/services/tokens.ts` |
| `helpers.ts` (createUser/createLiquidityPosition/createLiquiditySnapshot) | `src/services/liquidity.ts` |
| `templates:` (`PairTemplate.create(...)`) | `indexer.contractRegister` on `Factory.PairCreated` |
| — | `src/effects/calls.ts`, `src/effects/contracts.ts` (eth_call layer) |

## Polygon pricing values (from `pricing.ts`, used verbatim)

- **WETH_ADDRESS** (the priced native asset = WMATIC):
  `0x7ceb23fd6bc0add59e62ac25578270cff1b9f619`
- **MATIC/USD source pair:** only `USDC_WETH_PAIR`
  `0x853ee4b2a13f8a742d64c8f088be7ba2131f670d` is used; USDC is token0, so
  `getEthPriceInUSD()` returns `usdcPair.token0Price`. (The DAI/USDT-weighted
  branch is commented out in the original and not ported.)
- **WHITELIST (13 tokens):** WMATIC, USDC, QUICK, WMATIC-wrapper
  `0x0d50…1270`, WBTC, DAI, USDT, MAUSDC, FRAX, AGA, AAVE, EROWAN, VERSA — see
  `src/pricing.ts` for the exact addresses.
- **BLACKLIST (1 token):** `0x5d76fa95c308fce88d347556785dd1dd44416272`.
- **MINIMUM_LIQUIDITY_THRESHOLD_ETH:** `1` MATIC.
- The original keeps Uniswap's **ETH naming** (`derivedETH`, `ethPrice`,
  `reserveETH`, `totalVolumeETH`, …) on a MATIC-priced chain; the port keeps
  the field names 1:1.

## eth_call → Effect table

All calls go through a single cached `ethCall` Effect (raw calldata; RPC env
`RPC_URL_137`). `try_*` revert semantics are mirrored by returning `null`.
Offline tests mock via the `QUICKSWAP_CALL_MOCK` env var.

| Original `Contract.bind(addr).try_*` | Wrapper (`src/effects/contracts.ts`) | Block-pinned |
| --- | --- | --- |
| `ERC20.try_name()` | `erc20Name` | no (immutable) |
| `ERC20NameBytes.try_name()` | `erc20NameBytes32` | no |
| `ERC20.try_symbol()` | `erc20Symbol` | no |
| `ERC20SymbolBytes.try_symbol()` | `erc20SymbolBytes32` | no |
| `ERC20.try_decimals()` | `erc20Decimals` | no |
| `ERC20.try_totalSupply()` | `erc20TotalSupply` | no |
| `Pair.balanceOf(account)` | `pairBalanceOf` | **yes** (event block) |
| `Factory.getPair(token, whitelist[i])` | — (not an eth_call here) | — |

`findEthPerToken` does **not** call `Factory.getPair`: QuickSwap's
`findEthPerToken` iterates the **per-token `whitelist` array** — a list of pair
addresses populated in `factory.ts` whenever the *other* side of a new pair is
a whitelist token. The port reproduces that array on `Token` and loads each
`Pair` from the store, identical to the original mechanism (no RPC, no
port-internal lookup entity — unlike pancakeswap-exchange, which had to add a
`PairTokenLookup` entity to replace a real `getPair` eth_call).

## Intentional deviations / preserved quirks

1. **`Token.totalSupply` stores the real decoded supply (DEVIATION).** The
   original `fetchTokenTotalSupply` has a well-known AssemblyScript bug — it
   assigns the whole `CallResult` object instead of `.value` and then casts
   `as i32`, so graph-node stores a **non-deterministic runtime pointer**, not
   the actual supply. That value cannot be reproduced deterministically, so the
   port stores the real decoded `totalSupply()` (0 on revert). `totalSupply` is
   never read by any pricing/volume code, so only the `Token.totalSupply` field
   differs. (Excluded from validation.json.)
2. **Entity/contract names are PascalCase** (`UniswapFactory`, `Pair`, `Token`,
   `UniswapDayData`, …) per repo convention; `Factory`/`Pair` are the
   PascalCase contract names in `config.yaml` and handlers.
3. **`Bytes` → `String` (lowercase 0x hex)** for ids and all address/hash
   fields (`Mint.to`, `Burn.to/sender`, `Swap.sender/from/to`,
   `PairDayData.pairAddress`, etc.); addresses are `.toLowerCase()`d before use.
4. **Transaction id-array fields** `mints/burns/swaps` are `[String!]!`
   (entity-id strings), matching the original's intent.
5. **Burn branch fires on `to == ADDRESS_ZERO` alone** in `handleTransfer`
   (the original has no extra `from == pair.id` guard, unlike some forks). A
   `needsComplete` burn from the direct-send path keeps its original
   `liquidity` forever. Both preserved.
6. **graph-node entity-cache staleness preserved:** `handleSync` computes the
   bundle price and derived token prices *before* saving the synced pair, so on
   a sync of the USDC pricing pair itself the read-back reserves/prices are the
   *previous* sync's. The port reads through `context.X.get` (which sees only
   already-`set` values), reproducing this exactly. (Asserted in
   `test/swap-flow.test.ts`: ethPrice/derivedETH use sync1's values.)
7. **`UniswapDayData.totalVolumeETH` / `totalVolumeUSD` are never accumulated**
   (initialized to 0, only liquidity/txCount updated) — original behaviour.
8. **`Swap.amountUSD` uses the `=== ZERO_BD` sentinel comparison.**
   `getTrackedVolumeUSD`'s "neither whitelisted" branch returns the shared
   `ZERO_BD` object; `handleSwap` compares with `===` (AssemblyScript reference
   equality), so a whitelisted-path result that is numerically 0 still uses the
   tracked value, not the untracked fallback. Preserved. QuickSwap's `Swap`
   has **no** `amountFeeUSD` field (PancakeSwap did) and no fee math.
9. **Blacklist early-returns** in `handleMint/handleBurn/handleSwap` (after the
   handler has begun) and in `handleNewPair` (before token metadata fetch) are
   preserved.
10. **`User` entity is not created** (the original's `createUser` calls are
    commented out in `handleTransfer`). `LiquidityPosition.user_id` is therefore
    a dangling reference, matching graph-node. `User.usdSwapped` is never
    written. (Asserted in the swap-flow test.)
11. **`isCompleteMint` / missing-Transaction crashes** are mirrored with
    `getOrThrow` where the original would null-deref, and with the explicit
    `if (transaction === null) return` safety check in `handleBurn`.
12. **`decimals()` revert → 0** (AssemblyScript `null as i32` coercion), so
    `factory.ts`'s `if (decimals === null) return` branch is dead code and not
    ported (the bail is unreachable).

## BigDecimal semantics

`bignumber.js` (re-exported by envio) configured to 34 decimal places and no
exponential notation, approximating graph-node BigDecimal. Division far-decimals
may differ slightly; `tools/compare` tolerates this on `decimalFields`.

## Verification (offline, no network)

```
cd quickswap
pnpm install
pnpm codegen
pnpm build      # tsc --noEmit, zero errors
pnpm test       # 2 vitest suites, offline, QUICKSWAP_CALL_MOCK
```

- `test/pair-created.test.ts` — `PairCreated` creates UniswapFactory + Bundle +
  both Tokens (mocked string metadata, bytes32 name fallback, reverted-decimals
  → 0, reverted-totalSupply → 0) + Pair, and pushes the pair onto the
  whitelist-paired token's `whitelist` array.
- `test/swap-flow.test.ts` — full USDC-WMATIC flow against the real pricing pair
  `0x853e…670d`: PairCreated → Transfer(min-liq skip) → Transfer(mint, with LP
  position + snapshot via mocked `balanceOf`) → Sync → Mint → Sync → Swap, with
  exact asserts for reserves, derived MATIC/USD prices (incl. the staleness
  quirk), tracked/untracked volumes, Transaction/Mint/Swap,
  LiquidityPosition/Snapshot and every day/hour data entity.

## Bounded validation run

`config.yaml` has a commented `end_block: 5534576` (start + 50k) and
`rollback_on_reorg: false` for a deterministic bounded run. Set `RPC_URL_137`
to a Polygon RPC, uncomment `end_block`, then `pnpm dev`. Compare against the
subgraph with `tools/compare` once a concrete gateway endpoint id is filled into
`validation.json` (see its `_note`).

## Known gaps

- **Subgraph endpoint TBD:** the repo only deploys to the decommissioned hosted
  service; no decentralized-network id is available offline. `validation.json`
  `subgraph.url` is `TODO` with lookup instructions.
- **`Token.totalSupply`** intentionally diverges (deviation #1) and is excluded
  from validation.
- No live indexing was performed (network restricted to github + npm).
