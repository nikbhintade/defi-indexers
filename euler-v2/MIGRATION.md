# Euler V2 — subgraph → HyperIndex migration

Port of the official Euler V2 subgraph (**euler-xyz/euler-subgraph**, Ethereum
mainnet) to Envio HyperIndex (envio `3.1.2`, TypeScript).

## Source

- Repo: `euler-xyz/euler-subgraph` (cloned to `/tmp/sources/euler-subgraph`)
- Commit: `025c787a834699b7d22ebc1fe869f72c3eeb6065` (2026-05-23)
- The source is mustache-templated (`template/subgraph.template.yaml` rendered
  per network by `bun scripts/prepare.ts <network>`). This port renders the
  **Ethereum mainnet** (`network: mainnet`, chain id 1) variant.

## Scope

The subgraph is small and almost entirely event-driven. It tracks Euler V2 EVK
vaults created by factories and, per active account, the share-balance and debt
positions across all vaults. Three entities: `Vault`, `TrackingActiveAccount`,
`TrackingVaultBalance` (schema ported 1:1).

## Mainnet factory addresses (how they were resolved)

`scripts/config.ts` builds the mainnet data-source addresses by spreading
`mainnetAddresses.{coreAddresses,swapAddresses,peripheryAddresses}` from
`contracts/addresses/1/`. Resolved directly from those files (chain id `1`):

| data source            | template registered | address                                      | source file                                   |
| ---------------------- | ------------------- | -------------------------------------------- | --------------------------------------------- |
| `EulerVaultFactory` (GenericFactory / eVaultFactory) | `EulerVault`   | `0x29a56a1b8214D9Cf7c5561811750D5cBDb45CC8e` | `contracts/addresses/1/coreAddresses.ts` (`eVaultFactory`) |
| `EulerEarnFactory`     | `ERC4626Vault`      | `0x59709B029B140C853FE28d277f83C3a65e308aF4` | `contracts/addresses/1/coreAddresses.ts` (`eulerEarnFactory`) |
| `SecuritizeFactory`    | `ERC4626Vault`      | `0x5F51D980F15fE6075aE30394dc35De57A4f76Cbb` | `contracts/addresses/1/peripheryAddresses.ts` (`securitizeFactory`) |

- Start block (all three): **20529207** (`scripts/config.ts` → `networks.mainnet.startBlock`).
- `eVaultFactory` `0x29a5…cC8e` is the well-known Euler V2 GenericFactory on
  mainnet (the EVK vault factory). Addresses are stored lowercased into the
  `Vault.factory` field; the config keeps the source's checksummed form.
- The `SecuritizeFactory` data source is conditional in the template
  (`{{#securitizeFactory}}`). Mainnet defines `securitizeFactory`, so it is
  included.

## File map (source → port)

| subgraph                                | port                                          |
| --------------------------------------- | --------------------------------------------- |
| `template/subgraph.template.yaml` (mainnet render) | `config.yaml`                      |
| `schema.graphql`                        | `schema.graphql`                              |
| `src/factories/euler-vault-factory.ts`  | `src/handlers/euler-vault-factory.ts`         |
| `src/factories/euler-earn-factory.ts`   | `src/handlers/euler-earn-factory.ts`          |
| `src/factories/base-factory.ts`         | `src/handlers/base-factory.ts`                |
| `src/euler-vault.ts`                     | `src/handlers/euler-vault.ts`                 |
| `src/erc4626-vault.ts`                  | `src/handlers/erc4626-vault.ts`               |
| `src/utils/vault.ts`                    | `src/utils/vault.ts`                          |
| `src/utils/tracking.ts`                 | `src/utils/tracking.ts`                       |
| `Contract.bind().balanceOf/try_debtOf`  | `src/effects/vault-calls.ts` + `src/effects/calls.ts` |
| abis: GenericFactory, EulerEarnFactory, ERC4626EVCCollateralSecuritizeFactory, EulerVault, EulerEarn | `abis/` (copied as needed) |

## Factory → template registration

The subgraph instantiates templates with `Template.create(address)`. Ported to
`indexer.contractRegister` adding the address (taken from the event params) to
the address-less template contract:

- `EulerVaultFactory.ProxyCreated(proxy, …)` → `context.chain.EulerVault.add(proxy)`
  and `Vault{id: proxy, factory}`.
- `EulerEarnFactory.CreateEulerEarn(eulerEarn, …)` → `context.chain.ERC4626Vault.add(eulerEarn)`
  and `Vault{id: eulerEarn, factory}`.
- `SecuritizeFactory.ContractDeployed(deployedContract, …)` →
  `context.chain.ERC4626Vault.add(deployedContract)` and `Vault{…}`.

Each factory ships both a `contractRegister` (registration) and an `onEvent`
(writes the `Vault` entity) handler, mirroring the source's combined
`registerVault(...) + Template.create(...)`.

`EulerVault` and `ERC4626Vault` are separate config contracts (no static
address) even though both listen to `Transfer(address,address,uint256)` — they
use different handlers (`euler-vault.ts` vs `erc4626-vault.ts`).

## addressPrefix / EVC sub-account tracking (`src/utils/tracking.ts`)

Ported byte-for-byte from the 117-line original:

- **addressPrefix** = first **19 bytes** of the 20-byte account address. In
  graph-ts: `Bytes.fromUint8Array(account.slice(0, 19))`. Here:
  `"0x" + account.toLowerCase().slice(2, 40)` (38 hex chars). The EVC sub-account
  scheme keeps the first 19 bytes identical across a main address and its 256
  sub-accounts, so one `TrackingActiveAccount` (keyed by addressPrefix) links
  every sub-account of an owner.
- **trackingId** = `account.concat(vault)` (graph-ts `Bytes.concat`): the
  lowercased account hex (with `0x`) followed by the vault hex **without** its
  `0x` prefix. Used as `TrackingVaultBalance.id` and as the element stored in the
  `deposits`/`borrows` arrays.
- Entity ids: `Vault.id` = lowercased vault address;
  `TrackingActiveAccount.id` = addressPrefix; `TrackingVaultBalance.id` =
  account ++ vault.
- Zero-address accounts (mints/burns) are skipped, exactly as the source
  (`Address.fromBytes(account).equals(ZERO_ADDRESS)`).
- deposits/borrows list maintenance preserves the source's exact add/remove
  rules, **including the quirk** that an entry is only *removed* when the
  previously stored `balanceEntity.balance`/`.debt` was `> 0` (i.e. there was a
  prior deposit/borrow). Newly-zero positions that were never positive are not
  added and not removed.

## eth_call → Effects

`tracking.ts` binds an `EulerVault` to the event address and reads live state:

- `vaultContract.balanceOf(account)` — non-`try_` in the source (a revert would
  abort the graph-node handler). Ported as a try-call that falls back to `0`
  on revert (see *Deviations*).
- `vaultContract.try_debtOf(account)` — try-call; revert ⇒ debt `0`.

Both are **state-dependent** (live balance / outstanding debt) and so are
**block-pinned to `event.block.number`**. They are routed through a single
cached `ethCall` Effect carrying raw calldata (`src/effects/calls.ts`), with
typed wrappers in `src/effects/vault-calls.ts`. For ERC4626/EulerEarn vaults
`debtOf` reverts (no debt concept) and debt stays `0`, matching the source. The
subgraph manifest prefetched these via `calls:` blocks; the ported handler
issues them through the Effect, equivalently.

Offline tests mock every call via the `EULER_V2_CALL_MOCK` env var
(`setCallMock`), so no RPC is needed.

## Deviations / parity notes

- **`balanceOf` revert handling.** The source calls `balanceOf` non-`try_`, so a
  revert would crash the subgraph mapping (and the indexer would stall on that
  block). The port treats a `balanceOf` revert as `0` rather than crashing.
  In practice `balanceOf` on a live EVK/ERC4626 vault never reverts for a valid
  address, so this is unobservable on real data; it is only a robustness choice.
- **`transactionLogIndex`.** The source does not use `event.transactionLogIndex`
  anywhere, so no substitution was needed. (Entity ids derive only from account
  and vault addresses, not log index.)
- **Entity / contract names.** Source entity names were already PascalCase and
  are kept as-is. Contract `name:` values in `config.yaml` are PascalCase per
  conventions.
- **`Bytes` → `String`.** All `Bytes` schema fields become lowercase `0x` hex
  strings. Empty-bytes defaults (`Bytes.empty()`) are stored as `"0x"` (e.g. a
  freshly-created `TrackingActiveAccount.transactionHash` before its first real
  event).
- **rollback_on_reorg: false** for deterministic bounded validation runs.
- **Other networks omitted.** The source manifest is multi-chain; only mainnet
  is rendered here, as scoped.

## Bounded run / validation

- `config.yaml` pins `start_block: 20529207`. Uncomment `end_block: 20579207`
  (start + 50k) for a bounded validation run.
- `validation.json` maps the three entities for `tools/compare` over block range
  20529207 → 20579207.
- **Subgraph endpoint is a TODO.** The mainnet subgraph deploys to Goldsky as
  `euler-simple-mainnet` (`scripts/deploy.ts`: `euler-${PROTOCOL_VERSION}-${network}`,
  `PROTOCOL_VERSION = "simple"`). Its query URL is written to a generated,
  uncommitted `deployments.json` (`verify/utils/utils.ts` → `getSubgraphUrl`),
  which requires Goldsky credentials, so no public gateway id/url is resolvable
  from the repo. Fill `validation.json.subgraph.url` once the Goldsky public
  endpoint (`https://api.goldsky.com/api/public/<projectId>/subgraphs/euler-simple-mainnet/<version>/gn`)
  is obtained.

## Verification

All pass from `/home/user/defi-indexers/euler-v2`:

1. `pnpm install`
2. `pnpm codegen`
3. `pnpm build` (`tsc --noEmit`, zero errors)
4. `pnpm test` (offline vitest, 2 tests)

Tests:

- `test/proxy-created.test.ts` — `ProxyCreated` creates a `Vault` and registers
  the `EulerVault` template; a subsequent `Transfer` on the proxy is handled and
  produces the expected `TrackingVaultBalance` / `TrackingActiveAccount` (zero
  `from` skipped).
- `test/tracking-flow.test.ts` — full `Transfer`/`Borrow`/`Repay` flow across two
  EVC sub-accounts sharing a 19-byte prefix: asserts exact balance/debt values,
  the `deposits`/`borrows` arrays (add on borrow, remove on repay), and the
  shared `TrackingActiveAccount` linking via `addressPrefix`.

## Known gaps

- Validation subgraph URL pending (see above).
- `balanceOf` revert fallback differs from the source's crash behaviour
  (unobservable on valid data; documented above).
