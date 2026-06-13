# venus: subgraph → HyperIndex migration

Port of the official Venus Protocol **core-pool** subgraph (**BNB Smart Chain**,
chain id 56) to envio HyperIndex 3.1.2 (TypeScript). Venus is a Compound-v2 fork;
the closest reference port in this repo is `compound-v2`, whose effect/handler/
test shape is mirrored here.

- **Source repo:** https://github.com/VenusProtocol/subgraphs (`subgraphs/venus`)
- **Commit:** `68f1cb98a719454282277e920fdd67f0af5788a7`
  ("Merge pull request #260 from VenusProtocol/fix/vip-447-events", 2025-06-26)
- **Manifest:** Mustache `template.yaml` + `config/index.ts`. Ported the **bsc**
  config block: Comptroller (Unitroller) at
  `0xfD36E2c2a6789Db23113685031d7F16329158384`, start block `2471512`, plus the
  hardcoded vToken renames `vTRXOLD` (`0x61edcfe8dd6ba3c891cb9bec2dc7657b3b422e93`)
  and `vTUSDOLD` (`0x08ceb3f4a7ed3500ca0982bcd0fc7816688084c3`). `wbETHAddress`
  is empty in the bsc block, so the wBETH token special case never matches a
  real BSC underlying (deviation 6).

ABIs were obtained by `npm install @venusprotocol/venus-protocol @venusprotocol/oracle`
in a scratch dir and copying `DiamondConsolidated.json`, `VBep20.json`,
`ResilientOracle.json`, `BEP20.json` (IBEP20) into `abis/`. The deployed
core-pool Comptroller ABI (`Comptroller.json`) is taken from the repo's own
`packages/venus-core-pool-abis` — see deviation 1.

## File map (original → ported)

| Original | Ported |
| --- | --- |
| `template.yaml` (DiamondComptroller + Comptroller data sources, VToken + VTokenUpdatedEvents templates) | `config.yaml` (one `Comptroller` contract; two address-less template contracts `VToken` / `VTokenUpdatedEvents`) |
| `schema.graphql` | `schema.graphql` (Bytes → String lowercase, `@entity` removed, `@index` on MarketPosition relations) |
| `src/mappings/comptroller.ts` | `src/handlers/comptroller.ts` |
| `src/mappings/vToken.ts` | `src/handlers/vToken.ts` |
| `src/operations/getOrCreate.ts` (market, token) + `updateMarket*.ts` + `utilities/getTokenPriceCents.ts`/`getUnderlyingPrice.ts` | `src/services/markets.ts` |
| `src/operations/getOrCreate.ts` (account, position) + `get.ts` + `update.ts` + `updateXvs*State.ts` + `create.ts` | `src/services/helpers.ts` |
| `src/operations/handleInitialization` (block handler, `filter: once`) | lazy `getOrCreateComptroller` in `src/services/helpers.ts` (deviation 3) |
| `src/utilities/ids.ts` | `src/utilities/ids.ts` (byte-layout helpers) |
| `src/utilities/exponentToBigInt.ts` / `exponentToBigDecimal.ts` | `src/utilities/index.ts` |
| `src/constants/index.ts` + `constants/addresses.ts` + rendered bsc `config.ts` | `src/constants/index.ts` |
| `templates:` (`VTokenTemplate.create` / `VTokenUpdatedEventsTemplate.create` inside `getOrCreateMarket`) | `indexer.contractRegister` on the six comptroller events carrying a `vToken` (`src/handlers/comptroller.ts`) |
| — | `src/effects/calls.ts`, `src/effects/contracts.ts` (eth_call layer) |

All handlers are ported:
- **Comptroller:** `MarketListed`, `MarketUnlisted`, `MarketEntered`,
  `MarketExited`, `NewCloseFactor`, `NewCollateralFactor`,
  `NewLiquidationIncentive`, `NewPriceOracle`, `DistributedSupplierVenus`,
  `DistributedBorrowerVenus`, `VenusSpeedUpdated`, `VenusBorrowSpeedUpdated`,
  `VenusSupplySpeedUpdated`.
- **VToken (v1 / orig-events):** `Mint`(handleMintV1), `MintBehalf`(V1),
  `Redeem`(V1), `Borrow`, `RepayBorrow`, `LiquidateBorrow`, `AccrueInterest`,
  `NewReserveFactor`, `Transfer`, `NewMarketInterestRateModel`, `ReservesAdded`,
  `ReservesReduced`.
- **VTokenUpdatedEvents (v2):** `Mint`, `MintBehalf`, `Redeem` (the
  `totalSupply`-bearing variants → handleMint / handleMintBehalf / handleRedeem).

## Two VToken event generations

Venus upgraded its vTokens at some point, changing three event signatures by
appending a trailing `totalSupply`:

| v1 (orig-events, `@venusprotocol/venus-protocol@2.2.1`) | v2 (current) |
| --- | --- |
| `Mint(address,uint256,uint256)` | `Mint(address,uint256,uint256,uint256)` |
| `MintBehalf(address,address,uint256,uint256)` | `MintBehalf(address,address,uint256,uint256,uint256)` |
| `Redeem(address,uint256,uint256)` | `Redeem(address,uint256,uint256,uint256)` |

They have distinct `topic0` (different arity), so both are registered against
the same vToken address via two template contracts (`VToken` for v1,
`VTokenUpdatedEvents` for v2). Each vToken emits one or the other depending on
the block; both handlers update the same `Market` / `MarketPosition`.

## eth_calls → Effects

All calls go through a single cached Effect `ethCall` (`src/effects/calls.ts`,
input `{to, data, block?}`, output nullable hex, `cache: true`) over `RPC_URL_56`.
`try_*` semantics are mirrored: revert / empty data → `null`, mapped by callers
to the subgraph sentinels (`valueOrNotAvailableIntIfReverted` → `-1n`,
`valueOrNotAvailableAddressIfReverted` → `nullAddress`). Typed wrappers live in
`src/effects/contracts.ts`. Block pinning: state-dependent reads pinned to
`event.block.number`; immutable metadata unpinned.

| Original call | Wrapper | try_? | Pinned |
| --- | --- | --- | --- |
| `VToken.comptroller()` | `vTokenComptroller` | no | no |
| `VToken.underlying()` | `vTokenUnderlying` | no | no |
| `VToken.name()` / `symbol()` / `decimals()` | `vTokenName` / `vTokenSymbol` / `vTokenDecimals` | no | no |
| `VToken.try_interestRateModel()` | `vTokenInterestRateModel` | yes | yes |
| `VToken.try_reserveFactorMantissa()` | `vTokenReserveFactorMantissa` | yes | yes |
| `VToken.accrualBlockNumber()` | `vTokenAccrualBlockNumber` | no | yes |
| `VToken.try_borrowIndex()` | `vTokenBorrowIndex` | yes | yes |
| `VToken.getCash()` | `vTokenGetCash` | no | yes |
| `VToken.try_borrowRatePerBlock()` | `vTokenBorrowRatePerBlock` | yes | yes |
| `VToken.try_supplyRatePerBlock()` | `vTokenSupplyRatePerBlock` | yes | yes |
| `VToken.try_exchangeRateStored()` | `vTokenExchangeRateStored` | yes | yes |
| `VToken.totalReserves()` | `vTokenTotalReserves` | no | yes |
| `BEP20.name()` / `symbol()` / `decimals()` (underlying) | `bep20Name` / `bep20Symbol` / `bep20Decimals` | no | no |
| `Comptroller.try_venusSupplySpeeds(vToken)` | `comptrollerVenusSupplySpeeds` | yes | yes |
| `Comptroller.try_venusBorrowSpeeds(vToken)` | `comptrollerVenusBorrowSpeeds` | yes | yes |
| `Comptroller.venusBorrowState(vToken)` → `(uint224,uint32)` | `comptrollerVenusBorrowState` | no | yes |
| `Comptroller.venusSupplyState(vToken)` → `(uint224,uint32)` | `comptrollerVenusSupplyState` | no | yes |
| `ResilientOracle.try_getUnderlyingPrice(vToken)` | `oracleGetUnderlyingPrice` | yes | yes |

For offline tests, a declarative call-mock spec is injected via the
`VENUS_CALL_MOCK` env var (`setCallMock` in `src/effects/calls.ts`) — the envio
test indexer runs handlers in a worker thread, so the spec is JSON-serialized
into the env (worker threads copy the parent env). A `bigintTuple` mock kind
covers the two-value `venusBorrowState`/`venusSupplyState` reads.

## Entity ids (byte-for-byte)

graph-ts `Bytes` ids serialize as lowercase `0x` hex. Replicated in
`src/utilities/ids.ts`:

- `Comptroller.id` = comptroller address (lowercase).
- `Market.id` / `Token.id` = vToken / token address (lowercase).
- `Account.id` = account address (lowercase).
- `MarketPosition.id` = `account.concat(market)` → `"0x" + accountHex + marketHex`
  (raw 40-byte concatenation, no separator).
- `Transaction.id` = `txHash.concatI32(logIndex)` → `txHash` (32 bytes) followed
  by the log index as a **little-endian** 4-byte i32 (graph-ts `ByteArray.fromI32`
  writes `self[0]=x, self[1]=x>>8, …`; e.g. logIndex 5 → `05000000`).
- `getMarketActionId` / `getMarketPositionTransactionId` are ported for
  completeness but, as in the source, are not used by any handler.

## Intentional deviations

1. **Deployed Comptroller ABI vs latest `DiamondConsolidated`.** The latest
   `DiamondConsolidated.json` has diverged from what was emitted at the
   core-pool start block: it carries pool-aware
   `NewCollateralFactor(uint96 indexed poolId, address indexed vToken, …)` /
   `NewLiquidationIncentive(uint96 indexed poolId, …)` and omits
   `VenusSpeedUpdated`. The deployed core-pool events (and the subgraph
   manifest's `Comptroller` data source) use the older shapes
   `NewCollateralFactor(address,uint256,uint256)`,
   `NewLiquidationIncentive(uint256,uint256)`, `VenusSpeedUpdated(address,uint256)`.
   `config.yaml` uses those deployed signatures (from
   `packages/venus-core-pool-abis/Comptroller.json`). `topic0` depends only on
   name + param types, not `indexed`; the manifest's `DiamondComptroller`
   source declared some of these `indexed` while the deployed Comptroller does
   not — indexing only affects topic/data decoding, and the authoritative ABI
   (non-indexed for `MarketListed`/`MarketEntered`/`MarketExited`/
   `NewCollateralFactor`) is used so params decode correctly.
2. **`event.transactionLogIndex` → `event.logIndex`.** All seven `Transaction`
   ids (mint/mintBehalf/redeem/borrow/repay/liquidate/transfer) used
   `event.transactionLogIndex`. envio only exposes the absolute (block-level)
   `event.logIndex`, which graph-node's Ethereum/BSC adapter populates
   `transactionLogIndex` with anyway (no per-transaction log counter), so ids
   are expected to match byte-for-byte.
3. **`handleInitialization` (block handler, `filter: once`).** The subgraph
   created the `Comptroller` singleton on the first indexed block. envio has no
   once-block handler, so the singleton is created lazily by
   `getOrCreateComptroller` (same defaults: `priceOracle = nullAddress`,
   `closeFactorMantissa = 0`, `liquidationIncentive = 0`) on the first event
   that touches it. Because the block handler always ran before any event in
   the original, the stored data is identical.
4. **Missing-entity crash semantics.** `getMarket(...)!`,
   `getComptroller()` (`Comptroller.load(...)!`) and
   `getMarketPosition` null-derefs are mirrored with `getOrThrow`
   (`getMarketOrThrow`). `handleVenusSpeedUpdated`/`handleVenus*SpeedUpdated`
   keep the original's crash-if-market-missing behaviour.
5. **Non-`try_` calls don't abort.** graph-node aborts the subgraph when a
   non-`try_` call reverts (`comptroller`, `underlying`, `name`, `symbol`,
   `decimals`, `accrualBlockNumber`, `getCash`, `totalReserves`,
   `venusBorrowState`, `venusSupplyState`, BEP20 metadata). The port logs an
   error and falls back to neutral values (`""` / `0` / `0n` / `nullAddress`).
   These never revert for real listed markets, so stored data is unaffected.
6. **wBETH special cases inert on BSC.** `wbETHAddress` is empty in the bsc
   config block, so it resolves to `nullAddress`; the
   `getOrCreateWrappedEthToken` branch (`asset == wbETHAddress`) therefore only
   matches address(0). The hardcoded wBETH token
   (`0x9c37e59ba22c4320547f00d4f1857af1abd1dd6f`) is preserved but unreachable on
   mainnet — exactly like the original bsc deployment.
7. **Faithfully-preserved quirks:**
   - **xvsBorrowSpeed copy-paste bug** in `getOrCreateMarket`: the borrow-speed
     assignment is gated on the *supply*-speed call not reverting
     (`if (!supplySpeedResult.reverted) { market.xvsBorrowSpeed = borrowSpeedResult.value }`).
     If `try_venusSupplySpeeds` reverts, both speeds stay `0` even if
     `try_venusBorrowSpeeds` succeeded. Reproduced exactly (asserted in the
     market-listing test).
   - **`getTokenPriceCents` reverted-oracle path**: a reverted
     `try_getUnderlyingPrice` yields `NOT_AVAILABLE` (`-1`); since `-1 != 0`, the
     code computes `-1 / 10^factor`, which truncates toward zero to `0n` (matches
     graph-node `BigInt.div`). Preserved.
   - **`AccrueInterest` 4-param signature** (`cashPrior, interestAccumulated,
     borrowIndex, totalBorrows`) — the core-pool deployed event.
   - The market is created (not just looked up) from `MarketEntered`/
     `MarketExited`/`NewCollateralFactor`/`DistributedSupplier/BorrowerVenus`
     because the original calls `getOrCreateMarket` in those handlers; template
     registration fires on the same set.

## BigDecimal note

The core-pool schema stores everything as **BigInt mantissas** (no `BigDecimal`
fields), so there is no graph-node 34-significant-digit BigDecimal behaviour to
reproduce. The only division is integer division in `getTokenPriceCents`
(BigInt, truncates toward zero — matches graph-node). `exponentToBigDecimal` is
ported for completeness but unused at runtime.

## Validation run

1. Uncomment `end_block: 2521512` in `config.yaml` (chain 56).
2. `export RPC_URL_56=<BSC archive RPC>` (most reads are block-pinned; an
   archive node is required). Effects are cached (`cache: true`), so re-runs are
   cheap.
3. `pnpm codegen && pnpm dev` (or `envio start` with a configured database) and
   wait for the indexer to reach the end block.
4. Fill in the subgraph gateway URL in `validation.json` (see the note there —
   the repo deploys `venus-core-pool-subgraph` to Subgraph Studio; the
   decentralized-network ID must be resolved on the explorer) and run
   `tools/compare`.

Block-range rationale: 2471512 is the subgraph's BSC start block; the +50k
window (~1.7 days, May 2021) covers the Comptroller bootstrap (NewPriceOracle,
NewCloseFactor, NewLiquidationIncentive), the initial vToken listings (incl.
vBNB native-underlying and generic vBEP20 paths), market entries, accrue/mint/
redeem/borrow/repay/transfer traffic, and XVS distribution/speed events.

## Known gaps

- `validation.json` subgraph URL is a TODO (decentralized-network ID for
  `venus-core-pool-subgraph` could not be resolved offline).
- Offline tests cover (a) the market-creation flow (vBNB native + generic
  vBEP20, incl. the preserved xvsBorrowSpeed bug and the
  `try_supplyRatePerBlock` revert → `-1` sentinel) and (b) the v2 Mint flow
  (MarketPosition creation, supplierCount transition, market total-supply
  update, Transaction id byte layout) with mocked eth_calls (`VENUS_CALL_MOCK`).
  The remaining handlers (redeem/borrow/repay/liquidate/transfer, v1 mint
  variants, AccrueInterest, reserves, XVS speed/distribution) share the same
  helper code paths and are exercised by the bounded validation run against a
  live archive RPC.
- `MarketPosition` / `Market` relation fields (`market_id` / `account_id` /
  `underlyingToken_id`) compare against the subgraph's nested-relation
  selection; see the `_note`s in `validation.json`.
