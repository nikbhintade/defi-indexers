# usdt0: envio v2 → v3.1.2 upgrade

USDT0 (#16 by TVL) is a LayerZero OFT-based omnichain USDT. Unlike the other
protocols in this repo, its public indexer is **already an Envio HyperIndex
indexer** — [enviodev/usdt0-indexer](https://github.com/enviodev/usdt0-indexer)
— but pinned to the older **envio 2.32.3**. So this is not a subgraph→HyperIndex
port; it's a **v2 → v3.1.2 upgrade** to this repo's standard, preserving handler
logic 1:1.

- **Source:** enviodev/usdt0-indexer (envio 2.32.3), Ethereum mainnet, USDT0 OApp
  `0x6C96dE32CEa08842dcc4058c14d3aaAD7Fa41dee`, start block 23997148.
- **Events:** `OFTSent`, `OFTReceived`.

## What changed (v2 → v3)

| v2 (2.32.3) | v3 (3.1.2) |
| --- | --- |
| `networks:` with per-contract `handler:` path | `contracts:` (events) + `chains:` (addresses), handlers auto-discovered from `src/` |
| `import { USDT0, USDT0Transfer } from "generated"` | `import { indexer, type USDT0Transfer } from "envio"` |
| `USDT0.OFTReceived.handler(async ({event, context}) => …)` | `indexer.onEvent({ contract: "USDT0", event: "OFTReceived" }, async ({event, context}) => …)` |
| `context.USDT0Transfer.getOrCreate(...)` / `.set(...)` | identical |
| `event.params` / `event.chainId` / `event.block.timestamp` / `event.transaction.hash` | identical |

Handler bodies (the EID→chainId map, `bigIntToDecimal`, `startOfDayUTC`, the
guid-keyed merge of OFTSent/OFTReceived, and the daily-stats accumulation) are
copied verbatim.

## Deviations

1. **Entity rename `dailyUSDT0TransferStats` → `DailyUSDT0TransferStats`.**
   envio 3.1.2 PascalCases the generated entity accessor/type, and a schema type
   whose name starts lowercase desyncs the test-runtime table mapping (the
   `createTestIndexer` worker crashes with "Worker exited with code 1"). Renaming
   the type to PascalCase (the envio convention) fixes it. Field names, ids, and
   values are unchanged; only the GraphQL type name differs in case. The v2 side
   exposes it as `dailyUSDT0TransferStats` — `validation.json` maps the names.
2. **Undefined EID lookups coalesced to `0`.** v3's `Int!` fields are strictly
   typed; `EID_TO_CHAIN_ID[...]` for an unknown endpoint id is `number | undefined`,
   so it's coalesced with `?? 0` (v2 stored `undefined` loosely). Affects only
   transfers to/from endpoints not in the map.

## Preserved behavior worth noting (not bugs to fix)

- **Cross-chain daily bucketing:** `OFTSent` records to the **dstChain** daily
  bucket; `OFTReceived` records to the **srcChain** daily bucket — so a single
  transfer's sent and received sides land in different `DailyUSDT0TransferStats`
  rows. Asserted in `test/usdt0.test.ts`.
- Single-chain (mainnet) only, so `USDT0Transfer` rows may keep `fromAddress`/
  `srcChain` defaults until the counterpart event is seen — same as upstream.
- `StatsByChain` schema entity is declared but never written (upstream leftover);
  kept for parity.

## Run a bounded validation

```bash
cd usdt0 && pnpm install && pnpm codegen
# bounded run: uncomment end_block in config.yaml (24047148), then
pnpm dev
```
Then diff `USDT0Transfer` / `DailyUSDT0TransferStats` against an instance of the
upstream v2 indexer over blocks 23997148→24047148 (see `validation.json`).

## Verification (offline)

`pnpm codegen` ✓ · `pnpm build` (tsc --noEmit) ✓ · `pnpm test` ✓ (1 suite: the
OFTSent→OFTReceived guid merge + both daily buckets, exact values).
