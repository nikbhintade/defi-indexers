# MakerDAO / Sky (MCD Vat CDP) — subgraph → HyperIndex migration

Port of the **Messari `makerdao` subgraph** (the MCD/CDP "Vat" system, now Sky)
to **Envio HyperIndex v3.1.2**, TypeScript, Ethereum mainnet.

> This single indexer is the data source for **BOTH** queue rows
> **"Sky Lending (#13)"** and **"Sky RWA (#49)"**. The Messari makerdao subgraph
> indexes the entire Maker/Sky `Vat` (every collateral `ilk`, including the RWA
> ilks), so one port covers both.

- **Source repo:** `messari/subgraphs`, path `subgraphs/makerdao`
- **Source commit:** `2711ac91ef119f321f65b339e10a57f9aa74f9d8` (2025-03-25)
- **Rendered network:** Ethereum mainnet, from
  `protocols/makerdao/config/templates/makerdao.template.yaml` +
  `protocols/makerdao/config/deployments/makerdao-ethereum/configurations.json`
  (`graftEnabled: false`, so no grafting block was applied).

## Verification

```
cd sky-lending
pnpm install
pnpm codegen      # generates .envio types from config.yaml + schema.graphql
pnpm build        # tsc --noEmit, zero errors
pnpm test         # 2 offline vitest suites, no RPC
```

All four pass. Tests run fully offline via `createTestIndexer` + `simulate`
with eth_calls mocked through `SKY_CALL_MOCK`.

## File map

| Source (subgraph) | Port (HyperIndex) |
| --- | --- |
| `makerdao.template.yaml` + `configurations.json` | `config.yaml` |
| `schema.graphql` | `schema.graphql` (Bytes→String, directives stripped) |
| `src/mapping.ts` (Vat handlers) | `src/handlers/vat.ts` |
| `src/mapping.ts` (Cat/Dog + Flip/Clip) | `src/handlers/liquidation.ts` |
| `src/mapping.ts` (Jug/Pot/Spot) | `src/handlers/rates.ts` |
| `src/mapping.ts` (CdpManager/DSProxyFactory) | `src/handlers/cdpManager.ts` |
| `src/mapping.ts` (PSM) | `src/handlers/psm.ts` |
| `src/common/getters.ts` | `src/common/getters.ts` |
| `src/common/helpers.ts` | `src/common/helpers.ts` |
| `src/common/constants.ts` | `src/common/constants.ts` |
| `src/utils/{bytes,numbers,strings}.ts` | `src/utils/{bytes,numbers,strings}.ts` |
| `Contract.bind().try_*()` eth_calls | `src/effects/{calls,contracts}.ts` |
| — | `src/common/{types,event}.ts` (HyperIndex glue) |
| `abis/*.json` | `abis/*.json` (copied verbatim) |

## Data sources (rendered mainnet addresses + start blocks)

Static contracts: `Vat` (8928152), `Jug` (8928160), `Pot` (8928160),
`Spot` (8928152), `CatV1` (8928165), `CatV2` (10742907), `Dog` (12246358),
`CdpManager` (8928198), `DSProxyFactory` (5834580), `PsmUsdcA` (11478006),
`PsmPaxA` (13057085), `PsmGusdA` (13684200).

Templates (no static address, dynamically registered): `Flip`, `Clip`.

The chain `start_block` is the earliest source (`DSProxyFactory` @ 5834580);
HyperIndex still only delivers each contract's logs from its own first
appearance because every static source has a pinned address.

## LogNote dispatch (the key structural difference)

The Maker contracts emit the anonymous `LogNote` event whose **first indexed
topic is the called function's 4-byte selector**. The subgraph registered one
`eventHandler` per `topic0`. HyperIndex matches by ABI signature and delivers
*every* `LogNote` of a contract to a single handler, so each handler switches
on `event.params.sig` (the selector). Two ABI shapes exist and are declared
separately in `config.yaml`:

- `Vat`:  `LogNote(bytes4 sig, bytes32 arg1, bytes32 arg2, bytes32 arg3, bytes data)`
- others: `LogNote(bytes4 sig, address usr, bytes32 arg1, bytes32 arg2, bytes data)`

Selectors handled: Vat `rely 0x65fae35e`, `cage 0x69245009`, `frob 0x76088703`,
`grab 0x7bab3f40`, `fork 0x870c616d`, `fold 0xb65337df`; Cat `file 0x1a0b287e`;
Jug `file 0x1a0b287e`; Pot `file(vow) 0xd4e8be83`, `file(dsr) 0x29ae8114`,
`drip 0x9f678cca`; Spot `file(mat) 0x1a0b287e`, `file(par) 0x29ae8114`;
CdpManager `give 0xfcafcc68`, `shift 0xe50322a2`, `enter 0x7e348b7d`,
`quit 0x1b0dbf72`; Flip `tend 0x4b43ed12`, `dent 0x5ff3a382`, `deal 0xc959c42b`,
`yank 0x26e027f1`.

## Dynamic data-source registration (templates)

`Flip.create(flip)` / `Clip.create(clip)` in the subgraph become
`indexer.contractRegister` on the events that carry the auction address:

- `Cat(V1|V2).Bite` → `context.chain.Flip.add(event.params.flip)`
- `Dog.Bark` → `context.chain.Clip.add(event.params.clip)`

The address comes straight from the event params (no entity/effect read is
needed at registration time), matching the subgraph exactly.

## eth_call → Effect table

All calls go through one cached `ethCall` Effect (`src/effects/calls.ts`),
wrapped by typed helpers (`src/effects/contracts.ts`). `try_` semantics are
preserved: a revert / undecodable output → `null`, mirroring the subgraph's
`.reverted` branches. Offline tests bypass RPC via `SKY_CALL_MOCK`.

| Subgraph call | Effect wrapper | Pinned to block? |
| --- | --- | --- |
| `GemJoin.try_ilk()` / `try_gem()` | `gemJoinIlk` / `gemJoinGem` | no (per-adapter config) |
| `ERC20.try_name/symbol/decimals()` | `erc20Name/Symbol/Decimals` | no (immutable metadata) |
| `Vat.ilks(ilk)` (fold revenue) | `vatIlks` | yes |
| `Jug.base()` / `Jug.ilks(ilk).duty` | `jugBase` / `jugIlkDuty` | yes |
| `Pot.chi()` / `rho()` / `Pie()` | `potChi` / `potRho` / `potPie` | yes |
| `Flip.ilk()` / `Flip.bids(id)` | `flipIlk` / `flipBids` | yes |
| `Clip.ilk()` / `Clip.sales(id)` | `clipIlk` / `clipSales` | yes |
| `CdpManager.urns(cdpi)` / `ilks(cdpi)` | `cdpManagerUrns` / `cdpManagerIlks` | yes |
| `PSM.ilk()` | `psmIlk` | no (config) |
| `DAI.totalSupply()` (protocol minted supply) | `daiTotalSupply` | yes |
| `event.receipt.logs` (Vat.grab liquidation check) | `tryGetReceiptTopics` (RPC `eth_getTransactionReceipt`) | n/a |

## Entity IDs (byte-for-byte parity)

Maker ids are plain string concatenations (not graph-ts `Bytes.concat`), so no
`graphBytes` helper is needed:

- Market id = the GemJoin/adapter address (lowercase); the Pot "MCD POT" market
  id = the Pot address.
- `_Ilk` id = the ilk `bytes32` hex (lowercase).
- Position id = `{urn}-{market}-{side}-{counter}`.
- `_PositionCounter` id = `{urn}-{market}-{side}`.
- tx-event ids (Deposit/Withdraw/Borrow/Repay/Liquidate) = `{txHash}-{logIndex}`.
- PositionSnapshot id = `{positionId}-{txHash}-{logIndex}`.
- Flip/Clip store ids = `{auctionAddr}-{auctionId}`.
- snapshot ids = `{marketAddr}-{hoursOrDaysSinceEpoch}`, `{daysSinceEpoch}`, etc.

`Bytes`→`String` conversion stores **lowercase** `0x` hex everywhere
(`bytes32ToAddressHexString`, `extractCallData`, `bytes32ToString` reimplement
the graph-ts helpers in `src/utils/bytes.ts`).

## Math semantics (RAD/RAY/WAD)

`src/utils/numbers.ts` ports the subgraph helpers exactly:
`bigIntToBDUseDecimals`, `bigIntChangeDecimals` (with the BigDecimal-truncate
path for decimals < 18), and `bigDecimalExponential` (the 4-term binomial
expansion used for annualizing the Jug duty / Pot dsr). `BigDecimal` is
bignumber.js (envio) configured with `DECIMAL_PLACES: 34` to approximate
graph-node's 34-significant-digit BigDecimal; far-decimal division results may
differ slightly, which `tools/compare` tolerates for `decimalFields`.

## Deviations / preserved quirks

1. **`event.transactionLogIndex` → `event.logIndex`.** HyperIndex does not
   expose `transactionLogIndex`. The subgraph only used it in log lines and in
   contexts where the persisted id (`createEventID`) actually uses
   `event.logIndex`, so behaviour is unchanged. Documented in
   `src/common/event.ts` / `src/utils/strings.ts`.
2. **`marketIDList` double-append (preserved bug).** `getOrCreateMarket`
   appends the marketID to `protocol.marketIDList`, and `handleVatRely` appends
   it again, so each market appears twice. `updateProtocol` /
   `updatePriceForMarket` iterate that list summing per entry, so protocol-level
   `totalDepositBalanceUSD` / `totalBorrowBalanceUSD` are **double-counted**.
   This is faithful to the subgraph and is asserted in the frob test (6000 → 12000).
3. **`updateMarket` re-reads the market from the store.** graph-node returns the
   same in-memory entity across `updatePosition`→`updateMarket`; HyperIndex hands
   out immutable snapshots, so `updateMarket` re-reads the latest persisted
   market to avoid clobbering position counters updated earlier in the same
   event. Net result matches the subgraph.
4. **`handleSpotFilePar` off-by-one.** The subgraph loops
   `i <= marketIDList.length` (out of bounds). The port iterates the valid range
   `i < length` to avoid a crash; the extra OOB iteration in the subgraph was a
   no-op/AssemblyScript trap and does not change persisted state. Documented in
   `src/handlers/rates.ts`.
5. **`handleVatFold` Vow-mismatch warning** is log-only in the subgraph and has
   no state effect; the port keeps the revenue accrual and drops the log.
6. **`handleVatGrab` receipt scan.** The subgraph used `event.receipt.logs`
   (`receipt: true`) to skip `grab()` calls that are part of a liquidation
   (Bite/Bark in the same tx). HyperIndex has no receipt-log field selection, so
   this is fetched via an `eth_getTransactionReceipt` Effect (`tryGetReceiptTopics`,
   cached); mockable in tests.

## Gaps / not ported

- **`handleCdpFlux` / `handleCdpMove`** (CdpManager `flux`/`move` selectors)
  were defined in `src/mapping.ts` **but never wired to an `eventHandler`** in
  the manifest (the template lists only give/shift/enter/quit). They are
  therefore intentionally **not** registered here, matching the deployed
  subgraph behaviour.
- **Helper entities `_TokenInOut`, `_gem`, `_gemSnapshot`** exist in the schema
  but are never written by the mappings (debugging leftovers). Carried in the
  schema for 1:1 parity; never populated, exactly as in the subgraph.
- `Versions.get*()` (schema/subgraph/methodology) are pinned to constant strings
  in `src/common/constants.ts` (the subgraph reads them from a generated
  `versions` module); they do not affect quantitative parity.

## Bounded validation run

`config.yaml` has a commented `end_block: 8978152` (Vat start `8928152` + 50k).
`validation.json` uses the same range. To run a bounded historical sync set
`RPC_URL_1` (or a HyperSync endpoint), uncomment `end_block`, then
`pnpm envio start`. Compare against the decentralized-network subgraph once a
concrete subgraph id is filled into `validation.json` (see the TODO there; the
hosted-service slug was `messari/makerdao`).
