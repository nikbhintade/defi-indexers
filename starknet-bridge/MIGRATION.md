# starknet-bridge: subgraph → HyperIndex (envio 3.1.2)

Port of **kaonone/starknet-bridge-subgraph** — an indexer for the StarkNet core
bridge's `StarknetMessaging` contract on **Ethereum L1 mainnet**. It tracks
L1↔L2 bridge messages: token **deposits** (L1→L2) and **withdrawals** (L2→L1),
with PENDING→FINISHED accounting.

This is a pure-EVM port. There is **no Starknet/Cairo (L2) indexing** in scope —
the subgraph only ever indexed the Ethereum L1 `StarknetMessaging` contract.

- **Source repo:** kaonone/starknet-bridge-subgraph (a.k.a. project "delphi")
- **Source commit:** `af126919aff94becc17e8d87e0d018407668831c` (2022-02-02)
- **Target:** envio HyperIndex 3.1.2, TypeScript, Node 22, pnpm
- **Chain:** Ethereum mainnet (chain id 1)
- **Contract:** StarknetMessaging (StarkNet Core proxy)
  `0xc662c410C0ECf747543f5bA90660f6ABeBD9C8c4`
- **Start block:** `13620297` (StarkNet Core proxy deployment, Nov 2021)

## Mainnet rendering

The source is mustache-templated (`templates/subgraph.template.yaml` +
`templates/config.template.ts`) rendered from `config/*.json`. The repo ships
only:
- `config/stable.json` — declares `network: mainnet` and subgraph name
  `in19farkt/starknet-bridge-stable`, but **every address is a placeholder
  `0x0000…0000`** (including `starknetMessaging` and all bridge addresses).
- `config/staging.json` — Goerli (`network: goerli`), with real testnet
  addresses.

There is **no committed mainnet bridge-address set**. So the mainnet "rendering"
was reconstructed:
- `StarknetMessaging` address + start block: the canonical StarkNet Core mainnet
  proxy `0xc662c410C0ECf747543f5bA90660f6ABeBD9C8c4`, deployed at block
  `13620297`.
- `bridgesAddressesL1` / `bridgesAddressesL2` (the `isL1BridgeAddress` filter
  registry): materialized in `src/utils/constants.ts` from the canonical
  StarkGate mainnet registry
  (`starkware-libs/starknet-addresses`, `bridged_tokens/mainnet.json`) as of the
  port date. Index 0 is the ETH bridge (the template's `ethBridgeL1`/
  `ethBridgeL2`); the rest are the per-token bridges (the template's
  `tokenBridges[]`). The shared multi-bridge `StarknetTokenBridge` proxy
  (`0xF5b6…69eb` / L2 `0x0616…9256`) is included once.

## File map (source → port)

| subgraph | port |
| --- | --- |
| `templates/subgraph.template.yaml` (mainnet) | `config.yaml` |
| `schema.graphql` | `schema.graphql` |
| `templates/config.template.ts` (bridge lists) | `src/utils/constants.ts` |
| `src/utils/{makeIdFromPayload,getUniqId,bigIntToAddressBytes,convertUint256ToBigInt,addUniq}.ts` | `src/utils/graphTs.ts` |
| `src/utils/isL1BridgeAddress.ts` | `src/utils/isL1BridgeAddress.ts` |
| `src/utils/constants.ts` (`TransferStatus`, lists) | `src/utils/constants.ts` |
| `src/mappings/starknetMessages/deposit.ts` + `src/entities/*Deposit*` | `src/handlers/deposit.ts` |
| `src/mappings/starknetMessages/withdrawal.ts` + `src/entities/*Withdrawal*` | `src/handlers/withdrawal.ts` |
| `abis/StarknetMessaging.json` | `abis/StarknetMessaging.json` |
| `abis/ERC20Detailed.json` | — (unused; dropped, see below) |

## Load-bearing id construction (byte-for-byte)

The original builds entity ids out of graph-ts type conversions; these are
reproduced exactly in `src/utils/graphTs.ts` and proved with known vectors in
`test/utils.test.ts`.

- **`bigIntToHex` (graph-ts `BigInt.toHex()` / `.toHexString()`):** maps to
  graph-node host `typeConversion.bigIntToHex`, which uses go-ethereum hexutil
  "quantity" encoding — lowercase, **no leading zeros, uneven nibble length
  allowed, and zero encodes as `"0x0"`** (e.g. `1n→"0x1"`, `256n→"0x100"`,
  `0n→"0x0"`). Verified against the graph-node source doc-comment ("Their
  encoding may be of uneven length. The number zero encodes as \"0x0\".").
- **`makeIdFromPayload(bridgeL1, payload)`** =
  `[bridgeL1.toLowerCase(), ...payload.map(bigIntToHex)].join("-")`. Used for the
  `UnfinishedDeposit`/`UnfinishedWithdrawal` ids — load-bearing for matching the
  create event to its consume event.
- **`getUniqId`** = `txHash.toLowerCase() + "-" + logIndex.toString()`. The
  source uses `event.logIndex` (NOT `transactionLogIndex`), which HyperIndex
  exposes directly as `event.logIndex` — no deviation needed here.
- **`bigIntToAddressBytes(value, type)`** = minimal hex of `value`, left-padded
  with `0` to a fixed width (64 nibbles for STARKNET, 40 for ETHEREUM), prefixed
  `0x`. Produces the lowercase fixed-width hex stored in the `Bytes!`→`String!`
  fields and compared in the bridge filter.
- **`convertUint256ToBigInt(low, high)`** = `(high << 128n) + low` — the
  split-uint256 amount decoding.

## `isL1BridgeAddress` filter

Ported exactly: a message is a bridge token-transfer **iff both** its L1 address
**and** its L2 address match the **same index** of the paired
`l1BridgesAddresses` / `l2BridgesAddresses` lists (the original ANDs both sides
inside the loop). `isBridgeWithdrawalMessage` takes `(l2From, l1To)` order, which
is preserved. graph-ts `Bytes.equals` is reproduced with lowercase string
compare (constants are stored lowercase; HyperIndex addresses are lowercased
before comparison).

## Payload decoding (uint256[] → bigint[])

HyperIndex delivers `uint256[]` payloads as `bigint[]`. The deposit path reads
`payload[0]=l2Recipient`, `payload[1]=amountLow`, `payload[2]=amountHigh`; the
withdrawal path reads `payload[1]=l1Recipient`, `payload[2]=amountLow`,
`payload[3]=amountHigh`. Extracted identically to the AssemblyScript source.

## eth_call → Effects

**None.** No handler in the source calls `Contract.bind().try_*()`. The
`ERC20Detailed` ABI and the `Token` entity exist in the source but are **never
referenced by any mapping** (dead code). So no Effects are needed and
`STARKNET_BRIDGE_CALL_MOCK` is unused. The `Token` entity is kept in
`schema.graphql` for 1:1 parity (it will always be empty); the `ERC20Detailed`
ABI was dropped.

## Deviations (documented for parity)

1. **`UnfinishedDeposit.depositEvents` / `UnfinishedWithdrawal.withdrawalEvents`
   typed as `[String!]!` instead of `[DepositEvent!]!`/`[WithdrawalEvent!]!`.**
   The original keeps an **explicit, ordered, mutated** array of entity ids
   (`addUniq(...)` on create, `slice(1)` FIFO-pop on finish). HyperIndex only
   permits `[Entity!]!` via read-only `@derivedFrom`, which cannot express an
   ordered mutable queue. Storing the raw id list as a scalar `[String!]!`
   preserves the **exact id-list values and ordering** (asserted in
   `test/flows.test.ts`). Field name unchanged.
2. **Bridge-address registry sourced from StarkGate, not from repo config.** The
   source ships no real mainnet bridge addresses (placeholders only), so the
   filter set is reconstructed from the canonical StarkGate mainnet registry
   (see "Mainnet rendering"). If the original was ever deployed to mainnet with
   a different rendered set, the *which-messages-are-bridge-transfers* filter
   would differ; the id/value construction for matched messages is unaffected.
3. **`Bytes!` → `String!`** (per repo conventions), storing lowercase `0x` hex.
4. **`ERC20Detailed` ABI + (unwritten) `Token` entity** — ABI dropped; entity
   kept empty for schema parity.
5. Entity helper files (`createDepositEvent`, `loadUnfinishedDeposit`, …) are
   **inlined** into the two handler files; behavior preserved, including the
   "throw if missing" semantics (`getOrThrow`) of `loadUnfinishedDeposit` /
   `loadDepositEvent`.

## Preserved quirks / bugs (not fixed)

- **Consume-before-log throws.** `handleConsumedMessageToL2` /
  `handleConsumedMessageToL1` call the load-or-throw on the `Unfinished*` entity
  and then index `[0]` of its event list. If a Consumed event arrives without a
  prior matching Log event (or the queue is empty), the original throws; this
  port mirrors that via `getOrThrow` + non-null `[0]!`.
- **FIFO matching by payload id only.** Multiple in-flight messages with an
  identical `(bridgeL1, payload)` share one `Unfinished*` row and are finished in
  arrival order — the original behavior, kept as-is.
- **`bigIntToAddressBytes` throws on over-wide values** (the AssemblyScript
  `String.repeat(negative)` would throw); mirrored with an explicit
  `RangeError` rather than silently clamping.

## Verification

```bash
cd starknet-bridge
pnpm install
pnpm codegen     # generates ./generated + .envio types
pnpm build       # tsc --noEmit, zero errors
pnpm test        # vitest, offline simulated events (14 tests)
```

## Bounded validation run

`validation.json` uses block range `13620297 → 13670297` (start + 50k).

```bash
# uncomment end_block: 13670297 in config.yaml, then:
pnpm dev
```

Then diff `DepositEvent` / `WithdrawalEvent` / `UnfinishedDeposit` /
`UnfinishedWithdrawal` against the original subgraph via `tools/compare` once a
subgraph endpoint is set in `validation.json` (`GRAPH_API_KEY`).

## Known gaps

- **No subgraph endpoint.** The original is community-maintained (kaonone),
  stale (2022), and the repo carries no decentralized-network deployment id; the
  hosted-service names (`in19farkt/starknet-bridge-*`) are deprecated. Live
  data-parity validation requires locating/deploying the subgraph first. See the
  `_note` in `validation.json`.
- **Mainnet bridge set vs. original.** Because the source has no mainnet bridge
  config, exact parity of the *filtered* entity set depends on the original
  deployment's actual rendered bridge list, which is unknown. Id/value
  construction for any matched message is byte-identical regardless.
