# DeFi Indexers — Subgraph → HyperIndex (Envio) Migrations

This monorepo contains [HyperIndex](https://docs.envio.dev) (Envio) migrations of
existing subgraph/indexer deployments for a set of DeFi protocols. Each protocol
lives in its own directory and is a self-contained HyperIndex project (envio v3.x,
TypeScript) that mirrors the schema and handler semantics of the original indexer
so that indexed data can be cross-validated entity-by-entity against the original.

## Protocols

| # | Protocol | Original indexer | Directory | Status |
|---|----------|------------------|-----------|--------|
| 1 | Curve Finance | [curvefi/volume-subgraphs](https://github.com/curvefi/volume-subgraphs) (volume, mainnet) | `curve-volume/` | ✅ ported, builds + offline tests pass |
| 2 | Compound v2 | [graphprotocol/compound-v2-subgraph](https://github.com/graphprotocol/compound-v2-subgraph) | `compound-v2/` | ✅ ported, builds + offline tests pass |
| 3 | Compound v3 | [papercliplabs/compound-v3-subgraph](https://github.com/papercliplabs/compound-v3-subgraph) | `compound-v3/` | ✅ ported, builds + offline tests pass |
| 4 | PancakeSwap | [pancakeswap/pancake-subgraph](https://github.com/pancakeswap/pancake-subgraph) (exchange, BSC) | `pancakeswap-exchange/` | ✅ ported, builds + offline tests pass |
| 5 | Venus | [VenusProtocol/venus-protocol-subgraphs](https://github.com/VenusProtocol/venus-protocol-subgraphs) | `venus/` | ✅ ported, builds + offline tests pass |
| 6 | Pendle | public Pendle subgraphs | `pendle/` | ✅ ported, builds + offline tests pass |
| 7 | Convex Finance | [convex-community/convex-subgraph](https://github.com/convex-community/convex-subgraph) | `convex/` | ✅ ported, builds + offline tests pass |
| 8 | ether.fi | public `etherfi-v2` subgraph | `etherfi/` | ⏭️ skipped (no public source; deployed artifacts network-blocked) |
| 9 | Anemoy Capital | [centrifuge/api-v3](https://github.com/centrifuge/api-v3) indexer + public GraphQL | `anemoy-centrifuge/` | pending |
| 10 | Spiko | [spiko-tech/morpho-blue-subgraph](https://github.com/spiko-tech/morpho-blue-subgraph) | `spiko-morpho/` | pending |

## Per-protocol layout

```
<protocol>/
  config.yaml          # HyperIndex config (chains, contracts, events)
  schema.graphql       # entity schema, ported 1:1 from the original subgraph
  src/                 # TypeScript handlers + effects (eth_call ports)
  test/                # offline tests with createTestIndexer (simulated events)
  validation.json      # entities/fields/endpoints used by tools/compare
  MIGRATION.md         # notes: what was ported, deviations, how to run + validate
```

## Running an indexer (small block range)

Each project supports a bounded run for validation:

```bash
cd <protocol>
pnpm install
pnpm codegen
# bounded run: set end_block via config or run env-overridden
pnpm dev            # starts docker (postgres + hasura) and indexes
```

Then cross-validate against the original subgraph:

```bash
node tools/compare/compare.mjs --config <protocol>/validation.json
```

## Required environment / network access

Indexing and validation require outbound access that is **not** part of the
default sandbox allowlist. To run them, allow these hosts in the environment's
network egress settings and set the env vars:

- `*.hypersync.xyz` — HyperSync data source (e.g. `eth.hypersync.xyz`, `bsc.hypersync.xyz`)
- `gateway.thegraph.com` / `api.studio.thegraph.com` — original subgraph queries
- an Ethereum / BSC RPC host of your choice — for `eth_call` effects
- `ENVIO_API_TOKEN` — Envio API token (https://envio.dev/app/api-tokens)
- `GRAPH_API_KEY` — The Graph gateway key for querying original subgraphs
- `RPC_URL_1`, `RPC_URL_56`, ... — JSON-RPC endpoints per chain id

Without these, projects still fully build (`pnpm codegen`, `tsc`) and the
offline handler tests (`pnpm test`, simulated events) run.
