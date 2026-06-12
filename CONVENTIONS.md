# Porting conventions: subgraph → HyperIndex (envio 3.x)

Rules every migration in this repo follows. Target: **envio `3.1.2`**, TypeScript,
Node 22, pnpm. The goal of each port is *data parity* with the original subgraph —
entity IDs and field values must match so `tools/compare` can diff them.

## Project setup

- One self-contained pnpm project per protocol: `package.json` (deps: `envio`,
  dev: `typescript`, `vitest`, `viem` if effects are needed), `tsconfig.json`,
  `config.yaml`, `schema.graphql`, `src/`, `test/`.
- `pnpm codegen` must pass; `pnpm tsc --noEmit` must pass; `pnpm test` (vitest,
  offline simulated events) must pass.
- Copy ABIs needed for effects into `abis/` as JSON (human-readable viem ABIs in
  TS are also fine and preferred for effects).

## config.yaml (envio 3.x format)

```yaml
# yaml-language-server: $schema=./node_modules/envio/evm.schema.json
name: <protocol>-indexer
contracts:
  - name: Factory
    events:
      - event: "PoolCreated(address indexed pool, uint256 index)"
  - name: Pool            # dynamically registered -> no static address
    events:
      - event: "TokenExchange(address indexed buyer, int128 sold_id, uint256 tokens_sold, int128 bought_id, uint256 tokens_bought)"
        field_selection:
          transaction_fields: [hash, from]   # only when handlers need tx fields
chains:
  - id: 1
    start_block: 9456293
    # end_block: <N>     # uncomment for bounded validation runs
    contracts:
      - name: Factory
        address: "0x..."
      - name: Pool       # no address — registered via contractRegister
rollback_on_reorg: false   # deterministic bounded runs for validation
```

- Event signatures are human-readable ABI with `indexed` keywords — copy them
  exactly from the original subgraph manifest's `eventHandlers` (translating
  `(indexed address,uint256)` → `(address indexed a, uint256 b)` with the real
  param names from the ABI, since param names become `event.params.*`).
- If two contracts share an event signature but need different handlers, they are
  separate contract entries.
- Subgraph `templates:` → contract entry with **no address** + `indexer.contractRegister`.

## schema.graphql

- Port the original schema 1:1: same entity names, same field names, same IDs.
- Type mapping: `Bytes` → `String` (store **lowercase** `0x…` hex), `BigInt` →
  `BigInt`, `BigDecimal` → `BigDecimal`, `Int` → `Int`, enums → enums.
- Remove `@entity(immutable: …)` directives (HyperIndex types are plain
  `type X { … }`). Keep `@derivedFrom`. References: `pool: Pool!` stays; in
  handlers the generated field is `pool_id: string`.
- Add `@index` to fields handlers must query via `context.X.getWhere(...)`
  (the subgraph's `store.loadRelated`/derived lookups used inside mappings).
- Subgraph `ID`/`Bytes` ids → `id: ID!` strings.

## Handlers (src/)

envio 3.x API — single global `indexer` object:

```ts
import { indexer, BigDecimal, type Pool } from "envio";

indexer.onEvent(
  { contract: "Factory", event: "PoolCreated" },
  async ({ event, context }) => {
    // event.params.*, event.block.{number,timestamp,hash},
    // event.transaction.* (needs field_selection), event.srcAddress,
    // event.logIndex, event.chainId
  },
);

// subgraph template instantiation:
indexer.contractRegister(
  { contract: "Factory", event: "PoolCreated" },
  async ({ event, context }) => {
    context.chain.Pool.add(event.params.pool);
  },
);
```

- Entities are **plain immutable objects**: read with `await context.Pool.get(id)`
  / `getOrThrow` / `getOrCreate`, write with `context.Pool.set({ ...pool, field: v })`.
  There is no `entity.save()`; spread-update instead.
- Relation fields are set via `<field>_id` (e.g. `pool_id: pool.id`).
- **Addresses: always `.toLowerCase()`** before using in ids or storing in
  fields. HyperIndex delivers checksummed addresses; subgraphs store lowercase.
  Helper: `const a = (x: string) => x.toLowerCase();`
- Event ordering within a tx matches subgraphs (block, logIndex). Subgraph
  `event.transaction.hash.toHexString()` ids → `event.transaction.hash` (add
  `field_selection`).
- `BigDecimal` is `bignumber.js` (re-exported by envio). Port AssemblyScript
  `toDecimal()`/`exponentToBigDecimal` helpers into `src/utils/`. Match the
  subgraph's precision: graph-node BigDecimal keeps 34 significant digits and
  serializes without trailing zeros; use `new BigDecimal(x).div(...)` and avoid
  premature rounding. Division results may differ in far decimals — `tools/compare`
  compares decimals with a tolerance for that reason.
- Handlers run twice when preloading (`context.isPreload`) — keep them
  idempotent: no side effects outside `context.*.set` / `context.effect`.

## eth_call ports (Effects)

Subgraph `Contract.bind(addr).try_foo()` → an envio Effect using viem:

```ts
import { createEffect, S } from "envio";
import { createPublicClient, http, parseAbi } from "viem";

const client = (chainId: number) =>
  createPublicClient({ transport: http(process.env[`RPC_URL_${chainId}`]) });

export const getDecimals = createEffect(
  {
    name: "getDecimals",
    input: { address: S.string, chainId: S.number, block: S.optional(S.number) },
    output: S.number,
    rateLimit: false,
    cache: true,            // persisted; makes reruns deterministic & fast
  },
  async ({ input }) => {
    return client(input.chainId).readContract({
      address: input.address as `0x${string}`,
      abi: parseAbi(["function decimals() view returns (uint8)"]),
      functionName: "decimals",
      blockNumber: input.block ? BigInt(input.block) : undefined,
    });
  },
);
// in a handler: const d = await context.effect(getDecimals, {...});
```

- Wrap multiple calls with viem `multicall` where the subgraph used Multicall.
- `try_` semantics: catch errors inside the effect and return a sentinel
  (`null` via `S.nullable`) so handler logic can mirror `reverted` branches.
- Pin `blockNumber` to `event.block.number` when the subgraph's call was
  state-dependent (balances, rates); leave latest for immutable data
  (decimals, symbol).

## Tests (offline, no network)

Use `createTestIndexer` + `simulate` so logic is verified without HyperSync:

```ts
import { createTestIndexer } from "envio";
const indexer = createTestIndexer();
await indexer.process({
  chains: { 1: { simulate: [{ contract: "Factory", event: "PoolCreated",
    params: { pool: "0x...", index: 0n }, block: { number: 1, timestamp: 1000 } }] } },
});
const pool = await indexer.Pool.getOrThrow("0x...");
```

Effects can be mocked by overriding env RPC or injecting test doubles; prefer
structuring handlers so math/aggregation is testable with simulated events alone.
Every protocol ships at least one test that walks its main event flow
(create → trade/accrue → snapshot) and asserts entity values.

## validation.json (consumed by tools/compare)

```json
{
  "subgraph": { "url": "https://gateway.thegraph.com/api/subgraphs/id/<ID>", "authEnv": "GRAPH_API_KEY" },
  "local": { "url": "http://localhost:8080/v1/graphql", "adminSecret": "testing" },
  "blockRange": { "start": 9456293, "end": 9486293 },
  "entities": [
    { "subgraphName": "pools", "localName": "Pool",
      "fields": ["id", "name", "coins", "virtualPrice"],
      "decimalFields": ["virtualPrice"], "orderBy": "id" }
  ]
}
```

`MIGRATION.md` per project documents: source repo + commit, what was ported,
any intentional deviations, the chosen validation block range, and known gaps.
