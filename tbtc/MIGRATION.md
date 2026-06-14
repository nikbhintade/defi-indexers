# tBTC subgraph → HyperIndex migration

Port of the Threshold tBTC v2 subgraph (Bitcoin bridge: deposits, redemptions,
the TBTC token + vault, and staking) to Envio HyperIndex `3.1.2` (TypeScript,
Ethereum mainnet / chain 1).

- **Source:** `threshold-network/tbtc-subgraph` (clone at `/tmp/sources/tbtc-subgraph`)
- **Source commit:** `e5606a6bef09e775d72edb266a9c3a7d773f812a`
- **Published subgraph (validation target):** deploys to The Graph Studio as
  `tbtc-mainnet` (see `package.json` `deploy-mainnet`). No concrete gateway
  subgraph id is committed in the repo — `validation.json` carries a `TODO`
  placeholder + `authEnv: GRAPH_API_KEY`.

## What was ported

The Bitcoin-bridge lifecycle + token supply + staking accounting, i.e. the five
data sources that touch the deposit/redemption/token/operator entities:

- **Bridge** — `DepositRevealed`, `DepositsSwept`, `RedemptionRequested`,
  `RedemptionTimedOut`, `RedemptionsCompleted`. Deposit & redemption lifecycle
  including the deposit-key / redemption-key derivation and the Bitcoin
  tx-vector parsing originally done in *call handlers* (see below).
- **TBTCVault** — optimistic minting (requested/finalized/cancelled/debt-repaid,
  pause/unpause) and `Minted`/`Unminted` supply accounting.
- **TBTC token** — `Transfer` (mint/burn/peer) → per-holder balances,
  `totalTokensHeld`, `currentTokenHolders`.
- **TokenStaking** — `Staked`/`ToppedUp`/`Unstaked`/`TokensSeized`/`OwnerRefreshed`
  → `Operator` + global `StatsRecord.totalStaked`.
- **RedemptionWatchtower** — `VetoFinalized` (→ Redemption `VETOED`),
  `Banned`/`Unbanned` (→ `User.isRedeemerBanned`).

### File map

| Source (`src/…`)                          | Port (`src/…`)                          |
| ----------------------------------------- | --------------------------------------- |
| `mappingBridge.ts` + `swept.ts`           | `handlers/bridge.ts`                    |
| `mappingTBTCVault.ts`                     | `handlers/tbtcVault.ts`                 |
| `mappingTBTCToken.ts`                     | `handlers/tbtcToken.ts`                 |
| `mappingTokenStaking.ts`                  | `handlers/tokenStaking.ts`              |
| `mappingRedemptionWatchtower.ts`          | `handlers/redemptionWatchtower.ts`      |
| `utils/utils.ts`                          | `utils/utils.ts`                        |
| `utils/crypto.ts` (AS SHA-256)            | `utils/crypto.ts` (@noble/hashes)       |
| `utils/bitcoin_utils.ts`                  | `utils/bitcoin_utils.ts`                |
| `utils/helper.ts`                         | `utils/helper.ts`                       |
| `utils/constants.ts`                      | `utils/constants.ts` (mainnet only)     |
| n/a (eth_calls inline in mappings)        | `effects/calls.ts`                      |
| n/a (sweep/redemption-proof tuple ABIs)   | `handlers/proofAbis.ts`                 |

## Bitcoin utils: AssemblyScript → TypeScript

The original shipped two pure-function utility modules implemented in
AssemblyScript. These produce the load-bearing identifiers (deposit keys,
redemption keys) and Bitcoin tx parsing, so byte-parity was the priority.

- **`crypto.ts`** — a hand-rolled SHA-256 (port of `fast-sha256-js`) exposed via
  `Utils.hash()`. graph-node had no built-in SHA-256 in AS; in TS we delegate to
  **`@noble/hashes`** (`sha256`, `ripemd160`, `sha3/keccak_256`), which is
  byte-identical. *Note:* `Utils.hash()` (SHA-256) is **not actually called by
  any active mapping** — every entity id in the live handlers is derived with
  `keccak256` (graph-ts `crypto.keccak256` → `@noble/hashes` `keccak_256`). The
  SHA-256 / `hash160` / `hash256` helpers are ported for completeness and pinned
  with canonical test vectors anyway.
- **`bitcoin_utils.ts`** — varint parsing + input/output length determination
  over Bitcoin tx vectors, ported 1:1. graph-ts `BigInt` offsets become native
  `bigint`; small intermediate values use `number`.

**Dependency added:** `@noble/hashes@^1.4.0`.

**Byte-parity proof:** `test/bitcoin-utils.test.ts` (11 assertions) checks
`sha256('abc')`, `ripemd160('')`, `hash256('')`, `hash160(secp256k1 G)` against
their canonical constants; checks `calculateDepositKey` /
`calculateRedemptionKey` against an **independent** viem `keccak256`
recomputation of the preimage; and checks varint / output-length parsing.

## Call handlers → event handlers (the big structural change)

The subgraph used Ethereum **call handlers** to mark deposits SWEPT and
redemptions COMPLETED:

- `submitDepositSweepProof(...)` → `callHandleSubmitDepositSweepProofCall`
- `submitRedemptionProof(...)`  → `callHandlerSubmitRedemptionProof`

HyperIndex has **no call handlers**. But each of those functions emits an event
in the same transaction (`DepositsSwept`, `RedemptionsCompleted`). The port
hooks those events and decodes `event.transaction.input` (selected via
`field_selection: transaction_fields: [input]`) with the function ABI to recover
the exact same Bitcoin tx vectors the call handler received — producing
identical entity updates. Both calldata overloads (the legacy 3-field proof and
the newer 5-field proof with `coinbasePreimage`/`coinbaseProof`) are tried in
turn (`handlers/proofAbis.ts`).

For redemption completion, the subgraph split work across the
`RedemptionsCompleted` **event** (push `[redemptionTxHash, blockHash]` onto
`StatusRecord.pendingRedemptions`) and the `submitRedemptionProof` **call
handler** (consume it, gated on `pendingRedemptions[1] == call.block.hash`).
The port **merges both into the single `RedemptionsCompleted` handler**: it
pushes the pending entry, then immediately runs the proof-decoding loop (which
reads back the entry it just wrote) and resets the list — preserving the
`pendingRedemptions[1] == block.hash` completion gate.

## eth_call → Effect table

Implemented in `effects/calls.ts` via a single cached `ethCall` Effect carrying
raw calldata (compound-v2 pattern). Offline tests mock via `setCallMock`
(JSON into the **`TBTC_CALL_MOCK`** env var).

| Subgraph call                                       | Effect helper                      | Block-pinned | Revert default |
| --------------------------------------------------- | ---------------------------------- | ------------ | -------------- |
| `Bridge.deposits(depositKey).treasuryFee` (reveal)  | `getDepositTreasuryFee`            | yes (event)  | `0n`           |
| `TBTCVault.optimisticMintingFeeDivisor()` (finalize)| `getOptimisticMintingFeeDivisor`   | no (param)   | `0n`           |

Both subgraph calls were *non-`try_`* direct binds (they would have reverted the
whole handler on failure); the port returns a `0n` sentinel on revert, which is
also what the offline tests exercise.

## Deviations & preserved quirks (documented for parity)

- **Entity / contract PascalCase** (per CONVENTIONS): `TBTCToken`, `Deposit`,
  `Redemption`, `StatsRecord`, `StatusRecord`, etc. are already PascalCase in the
  source schema; all `config.yaml` contract names are PascalCase.
- **`Bytes` → lowercase hex `String`.** Addresses (delivered checksummed by
  HyperIndex) are `.toLowerCase()`d before use, matching graph-node storage.
- **`event.transactionLogIndex` not available.** The source `getIDFromEvent`
  uses `event.logIndex` (Transaction ids `txHash-logIndex`) — replicated. The
  call-handler `getIDFromCall` used `transaction.hash + "-" + transaction.index`;
  since the port runs the call logic from an event in the same tx and HyperIndex
  does not expose the transaction index without extra selection, `getIDFromCall`
  reuses `txHash-logIndex`. This only affects the id of the *swept/redemption
  success* `Transaction` rows, not deposit/redemption ids or values.
- **Token holder-count quirks preserved.** `mappingTBTCToken` updates the `from`
  holder before the `to` holder and lets the zero address accrue a negative
  balance as its own `User`; the port reproduces this verbatim (and asserts the
  negative zero-address balance in `test/token-flow.test.ts`).
- **`convertDepositKeyToHex` left-pads** odd-length uint256 deposit keys to 64
  nibbles (the AS code's guard against a 0x…-65-char crash) — ported and tested.
- **StatusRecord trimmed.** The source `getStatus()` also initialized
  `groupState`/`ecdsaState`/`challenger`/`reason` (the RandomBeacon DKG domain,
  enum `State`). Those data sources are out of scope (see Gaps), are never read
  by the in-scope handlers, so those fields + the `State` enum were dropped.
  `pendingRedemptions`/`lastMintedInfo`/`lastMintedHash` are kept.
- **Empty source handlers omitted.** Most Bridge events (`Wallet*`, `Fraud*`,
  `MovingFunds*`, parameter-update events) had empty `{}` bodies in the source;
  they are not registered (no-ops produce no entity changes — parity preserved).

## Gaps / out of scope

- **RandomBeacon, SortitionPool, WalletRegistry** data sources are **not
  ported**. They populate the staking-node / DKG domain (`RandomBeaconGroup`,
  `RandomBeaconGroupMembership`, `RelayEntry`, `GroupPublicKey`, plus most
  `Operator` authorization fields) and are independent of the Bitcoin-bridge
  lifecycle this port targets. Their schema entities were also dropped. The
  `Operator`/`Event` entities are retained because `TokenStaking` writes them.
- The `_Schema_` fulltext index (`searchRedemption`) is a graph-node feature
  with no HyperIndex equivalent and is dropped.
- Validation subgraph URL is a `TODO` pending the published gateway id.

## Bounded run (validation)

`config.yaml` start blocks are the per-contract source start blocks. For a
bounded validation run over the Bridge-active window, uncomment the `end_block`
in `config.yaml` (`16447413`, i.e. Bridge start `16397413` + 50k), matching
`validation.json`'s `blockRange`. `rollback_on_reorg: false` for determinism.

```
cd tbtc
pnpm install
pnpm codegen
pnpm build      # tsc --noEmit, zero errors
pnpm test       # offline vitest (13 tests)
# live (needs RPC_URL_1): set end_block, then: pnpm start
```
