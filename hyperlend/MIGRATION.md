# HyperLend (HyperEVM, chain 999) — Ponder → HyperIndex migration

Port of the **hyperlendx/ponder-indexer** Ponder 0.8.x indexer to Envio
HyperIndex (`envio@3.1.2`, TypeScript). HyperLend is an **Aave-V3-style** lending
protocol on HyperEVM (chain 999); the Pool/oracle/factory→child-token structure
mirrors the in-repo `aave-v3` port, which was used as the reference for the
factory→template registration chain and the eth_call→Effect pattern.

- Source repo: https://github.com/hyperlendx/ponder-indexer
- Source commit: `fa74189c2ad49f172dffc609f2a6d56286cfb609` (2025-05-05)
- Ponder version: `^0.8.32`
- Reference ports: `../aave-v3` (Aave-V3 accounting + factory registration +
  effects/CALL_MOCK) and `../anemoy-centrifuge` (Ponder→envio API mapping).

## Scope

Faithful, behavior-preserving port of every contract/handler in the Ponder
source. HyperLend's Ponder indexer is **event-record-oriented**: each handler
inserts one row per event (no Aave-style Reserve/UserReserve accounting), plus
two oracle eth_calls for USD pricing. All of that is reproduced 1:1.

## Networks / start blocks

Single chain: HyperEVM `id: 999` (Ponder `networks.hyperEvm`, RPC env
`PONDER_RPC_URL_999` → here `RPC_URL_999`). Ponder contracts and their start
blocks:

| Contract | Address | Ponder startBlock |
| --- | --- | --- |
| CorePool | `0x00A89d7a5A02160f20150EbEA7a2b5E4879A1A8b` | 787000 |
| Oracle | `0xC9Fb4fbE842d57EAc1dF3e641a281827493A630e` | 787000 |
| HToken factory (emits ReserveInitialized) | `0x8CB4310dD38F6fD59388C9DE225f328092bdC379` | 787000 |
| IsolatedPair registry (emits AddPair) | `0x9A32C32D7A0e13892Cd68E143AC890F6308304F5` | 249000 |
| LoopingStrategyManagerFactory | `0xc3Ed646181Ca80562e96d9e6CF4AF317d22F34b0` | 3414683 |

`chains[].start_block = 787000` (the prompt-pinned core start block). See
**Deviations** for the IsolatedPair / Looping start-block consequence.

## Ponder → envio API mapping

| Ponder | envio HyperIndex |
| --- | --- |
| `ponder.on("CorePool:Borrow", fn)` | `indexer.onEvent({contract:"CorePool", event:"Borrow"}, fn)` |
| `event.args.*` | `event.params.*` |
| `event.log.id` | `logId(event)` = `block.hash + "-" + logIndex` (see Entity IDs) |
| `event.log.address` | `event.srcAddress` |
| `event.transaction.hash` / `.to` / `.from` | same (via `field_selection.transaction_fields`) |
| `context.db.insert(T).values({...})` | `context.T.set({...})` |
| `factory({address, event, parameter})` (HTokens, IsolatedPair) | address-less template contract + `indexer.contractRegister` |
| `context.client.readContract(...)` (oracle price) | cached `ethCall` Effect (`src/effects`) |

## Entity IDs (byte-for-byte)

Every Ponder handler keys its row by `event.log.id`. In Ponder 0.8.x
`event.log.id` is produced by the internal `encodeLog`:

```
id = `${log.blockHash}-${log.logIndex}`
```

i.e. the lowercase `0x` block hash, a literal `-`, then the **decimal** log
index. HyperIndex exposes the block hash on `event.block.hash` (lowercase) and
the index on `event.logIndex`, so `src/common/ids.ts::logId` reproduces it
exactly. (Note: this is *not* the Ponder `encodeCheckpoint` 75-char string —
that is `event.id`, which the handlers do not use.)

All address fields are `.toLowerCase()`d for parity (Ponder stores lowercase;
HyperIndex delivers checksummed addresses).

## File map (source → port)

| Ponder file | Port file |
| --- | --- |
| `ponder.config.ts` | `config.yaml` |
| `ponder.schema.ts` | `schema.graphql` |
| `src/index.ts` (CorePool:* handlers) | `src/handlers/pool.ts` |
| `src/index.ts` (HTokens:BalanceTransfer) | `src/handlers/tokens.ts` |
| `src/index.ts` (IsolatedPair:* handlers) | `src/handlers/isolated.ts` |
| `src/index.ts` (LoopingStrategyManagerFactory:StrategyDeployed) | `src/handlers/looping.ts` |
| `factory(...)` sources in `ponder.config.ts` | `src/handlers/registry.ts` |
| `src/helpers/getPrice.ts` | `src/effects/contracts.ts` (+ `src/effects/calls.ts`) |

## Factory → template registration

Two Ponder `factory(...)` child sources become address-less HyperIndex template
contracts registered via `indexer.contractRegister`:

- `HTokens` ← `HTokenFactory.ReserveInitialized(asset, aToken, stableDebtToken,
  variableDebtToken, interestRateStrategyAddress)`, registering the **aToken**
  param (Ponder `parameter: "aToken"`). This is the same chain the aave-v3 port
  uses for its a/s/v debt tokens from `PoolConfigurator.ReserveInitialized`;
  HyperLend only tracks the aToken child (its only token handler is
  `HTokens:BalanceTransfer`).
- `IsolatedPair` ← `IsolatedPairRegistry.AddPair(pairAddress)` (Ponder
  `parameter: "pairAddress"`).

The factory/registry contracts themselves are static data sources (they emit the
factory events). The `Oracle` contract has **no event handlers** in the Ponder
source — it is read-only (eth_call) — so it is not a data source here; its
address is hard-coded in `src/effects/contracts.ts` exactly as in
`ponder.config.ts`.

## eth_call → Effect table

All calls flow through one cached `ethCall` Effect (`src/effects/calls.ts`)
carrying raw calldata; typed `try_`-style wrappers live in
`src/effects/contracts.ts`. Reverts resolve to `undefined` (envio nullable
fields are `T | undefined`), mirroring the Ponder handlers' `try/catch → null`
price. Offline tests inject a JSON mock via `HYPERLEND_CALL_MOCK`.

| eth_call | Contract | Pinned? | Used by |
| --- | --- | --- | --- |
| `getAssetPrice(asset) → uint256` | Oracle `0xC9Fb…630e` | block-pinned | CorePool Borrow/Repay/Supply/Withdraw/LiquidationCall/FlashLoan/ReserveDataUpdated/MintedToTreasury/MintUnbacked/BackUnbacked |
| `exchangeRateInfo() → (…, highExchangeRate)` | the IsolatedPair itself | block-pinned | all IsolatedPair handlers (price = `highExchangeRate`) |

RPC env: `RPC_URL_999`. The Ponder helper pinned implicitly to the indexing
block; the port pins explicitly to `event.block.number`.

## Deviations

- **Oracle price block-pinning.** The Ponder `getOraclePrice` calls
  `context.client.readContract` without an explicit block (Ponder pins reads to
  the event block internally). The port pins explicitly to
  `event.block.number`, which is behaviorally identical and required for
  deterministic cached re-runs (per CONVENTIONS).
- **Single chain start_block.** HyperIndex starts all contracts at the chain
  `start_block` (787000). The IsolatedPair registry (Ponder startBlock 249000)
  and LoopingStrategyManagerFactory (3414683) therefore begin at 787000 in this
  port. Looping (>787000) loses nothing for a run starting at 787000; the
  IsolatedPair registry would **miss pairs created in blocks 249000–786999**.
  For full isolated-pair parity, lower `chains[].start_block` to 249000 (this
  trades the core-pool-focused validation range for full coverage). Documented
  as a known gap below.
- **`event.transaction.to || "0xNEW"` sentinel.** The isolated handlers preserve
  the Ponder sentinel verbatim (no lowercasing) when `transaction.to` is absent.
  In practice `transaction.to` is always set for these calls.
- **Liquidate `liquidator`.** Ponder uses `event.transaction.from`; the port
  lowercases it and leaves it `undefined` only if `from` is absent (always
  present in practice).
- **Price-field nullability.** The Ponder columns have no `.notNull()`; the
  schema makes every `price` / `priceCollateral` / `priceDebt` nullable. For the
  Supply/Withdraw/Repay/etc. handlers Ponder awaits the price directly (would
  throw on revert) rather than try/catch; the port returns `undefined` on revert
  uniformly, which is strictly more lenient and matches the nullable column.
- Entity type names are already PascalCase in the Ponder schema exports
  (`Borrow`, `Supply`, …), satisfying the HyperIndex PascalCase requirement; the
  underlying `onchainTable("borrow", …)` snake_case table names are irrelevant
  to envio.

## Known gaps

- **IsolatedPair / Looping start blocks** below 787000 are not covered when the
  chain starts at 787000 (see Deviations). The core pool (the primary scope) is
  fully covered from 787000.
- **Cross-validation target.** hyperlendx/ponder-indexer ships no README and no
  documented public GraphQL/api endpoint, so `validation.json.subgraph.url` is a
  TODO with `authEnv: null`. The entity field maps and the 787000→837000 block
  range are filled in so `tools/compare` can run as soon as an upstream endpoint
  is supplied.

## Bounded run (validation)

1. Uncomment `end_block: 837000` in `config.yaml` (start 787000 + 50k).
2. `export RPC_URL_999=<hyperevm rpc>` (needed for live oracle eth_calls; the
   `ethCall` Effect is cached).
3. `pnpm codegen && pnpm dev` (or `pnpm start`) to index 787000→837000.
4. Point `tools/compare` at `validation.json` once an upstream GraphQL endpoint
   is known.

## Verification (offline, no network)

```
pnpm install
pnpm codegen
pnpm build      # tsc --noEmit, zero errors
pnpm test       # 2 vitest suites, eth_calls mocked via HYPERLEND_CALL_MOCK
```
