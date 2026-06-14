# pancakeswap-v3: subgraph → HyperIndex migration

Port of the PancakeSwap **V3** subgraph (Uniswap-V3-style concentrated-liquidity
AMM) to envio HyperIndex 3.1.2 (TypeScript), scoped to **BNB Smart Chain
(BSC, chain 56)**.

- **Source repo:** https://github.com/pancakeswap/pancake-subgraph
  (clone: pancakeswap/exchange-v3-subgraphs)
- **Commit:** `2f6248444994ff1c2a5f0b601324d1f531355ccf` (2025-05-14)
- **Source layout:** mustache-templated under `template/`, with per-chain
  config in `config/`. This port renders the **BSC** values from
  `config/bsc.js` into `src/utils/pricing.ts` and `src/utils/constants.ts`.
- **Rendered-chain choice — BSC (chain 56):** factory
  `0x0bfbcf9fa4f9c56b0f40a671ad40e0805a091865` (start block 26956207),
  NonfungiblePositionManager `0x46a15b0b27311cedf172ab29e4f4766fbe7f4364`
  (start block 26931961), wNative WBNB
  `0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c`, wNativeStablePool (WBNB-USDT
  500) `0x36696169c63e42cd08ce11f5deebbcebae652050` with `stableIsToken0 =
  true`, `minETHLocked = 10`. Full stablecoin (USDT/BUSD/USDC) and whitelist
  (WBNB/USDT/BUSD/USDC/BTCB/WETH/CAKE) lists copied verbatim from
  `config/bsc.js` into `src/utils/pricing.ts`.

## File map (original → ported)

| Original (`template/…`) | Ported |
| --- | --- |
| `subgraph.template.yaml` | `config.yaml` (Factory + NonfungiblePositionManager static; address-less `Pool` template; chain 56) |
| `schema.graphql` | `schema.graphql` (Bytes → String lowercase, `@entity` removed, `whitelistPools: [Pool!]!` → `[String!]!`) |
| `mappings/factory.ts` | `src/handlers/factory.ts` |
| `mappings/core.ts` | `src/handlers/core.ts` |
| `mappings/position-manager.ts` | `src/handlers/position-manager.ts` |
| `utils/pricing.template.ts` | `src/utils/pricing.ts` (BSC values rendered) |
| `utils/constants.template.ts` | `src/utils/constants.ts` (BSC values rendered) |
| `utils/tick.ts` | `src/utils/tick.ts` |
| `utils/tvl.ts` | `src/utils/tvl.ts` |
| `utils/intervalUpdates.ts` | `src/utils/intervalUpdates.ts` |
| `utils/index.ts` (numeric helpers) | `src/utils/index.ts` |
| `utils/index.ts` (`loadTransaction`) | `src/utils/transaction.ts` |
| `utils/token.ts` | `src/utils/token.ts` |
| `utils/entity.ts` (`getOrLoadToken`) | `src/utils/entity.ts` |
| `utils/staticTokenDefinition.ts` | (omitted — all definitions commented out in source; `fromAddress()` returns null. See "Deviations".) |
| `templates:` (`PoolTemplate.create(...)`) | `indexer.contractRegister` on `Factory.PoolCreated` |
| — | `src/effects/calls.ts`, `src/effects/contracts.ts` (eth_call layer) |

## Entities & IDs (byte-for-byte)

- `Factory.id` = factory address (lowercase).
- `Bundle.id` = `"1"`.
- `Token.id` = token address (lowercase).
- `Pool.id` = pool address (lowercase).
- `Tick.id` = `<poolAddress>#<tickIdx>` (e.g. `0x…#-60`).
- `Position.id` = NFT `tokenId` (decimal string).
- `PositionSnapshot.id` = `<tokenId>#<blockNumber>`.
- `Transaction.id` = tx hash (lowercase).
- `Mint`/`Burn`/`Swap`/`Collect.id` = `<txHash>#<pool.txCount>` (the pool tx
  counter incremented earlier in the handler — replicated exactly).
- Day/hour datas: `PancakeDayData.id` = `<dayID>`; `Pool{Day,Hour}Data.id` =
  `<poolAddress>-<dayID|hourIndex>`; `Token{Day,Hour}Data.id` =
  `<tokenAddress>-<dayID|hourIndex>`; `TickDayData.id` = `<tickId>-<dayID>`.

## Tick handling

Ported from `utils/tick.ts` + `mappings/core.ts`:

- `createTick` sets `price0 = 1.0001^tickIdx` (via `bigDecimalExponated`) and
  `price1 = 1/price0`. `tickIdx` is delivered by envio as `bigint` (int24), so
  the source's `BigInt.fromI32(i32)` round-trip is dropped (value identical).
- Mint adds `amount` to lower/upper `liquidityGross`, `+amount` to lower
  `liquidityNet` and `-amount` to upper `liquidityNet`; Burn does the inverse.
- Pool active `liquidity` is only updated on Mint/Burn when
  `tickLower <= pool.tick < tickUpper`.
- After Mint/Burn the lower/upper tick fee-growth vars are refreshed via
  `Pool.ticks(tickIdx)` (eth_call); on Swap the crossed-tick range is walked
  (`feeTierToTickSpacing`, the `numIters > 100` skip guard, and the
  `newTick.mod(tickSpacing)` truncated-division semantics — JS `bigint %`
  matches graph-node `BigInt.mod()`).

## Position handling

Ported from `mappings/position-manager.ts`:

- `getPosition` resolves the pool with two eth_calls:
  `NonfungiblePositionManager.positions(tokenId)` → token0/token1/fee/tickLower/
  tickUpper/feeGrowthInside, then `Factory.getPool(token0, token1, fee)` → pool
  address. A reverted `positions()` (position minted+deleted in the same block)
  makes the handler bail, exactly like the original `if (positionCall.reverted)`.
- `tickLower`/`tickUpper` relations are stored as `<poolId>#<tickIdx>` ids.
- `IncreaseLiquidity`/`DecreaseLiquidity`/`Collect`/`Transfer` update the
  Position and write a `PositionSnapshot` per event (`<tokenId>#<blockNumber>`).
- **Preserved source bug:** `handleCollect` adds `amount0` to BOTH
  `collectedFeesToken0` and `collectedFeesToken1` (the original never decodes
  `amount1`). Kept for parity.

## eth_call → Effect table

All calls funnel through a single cached `ethCall` Effect (`src/effects/calls.ts`,
raw calldata keyed by `(to, data, block)`), wrapped by typed helpers in
`src/effects/contracts.ts`. `try_*` reverts → `null` (mirrors graph-node).

| Original subgraph call | Wrapper | Block-pinned |
| --- | --- | --- |
| `ERC20.try_name()` | `erc20Name` | no (immutable metadata) |
| `ERC20NameBytes.try_name()` | `erc20NameBytes32` | no |
| `ERC20.try_symbol()` | `erc20Symbol` | no |
| `ERC20SymbolBytes.try_symbol()` | `erc20SymbolBytes32` | no |
| `ERC20.try_decimals()` | `erc20Decimals` | no |
| `ERC20.try_totalSupply()` | `erc20TotalSupply` | no |
| `NonfungiblePositionManager.try_positions(id)` | `nfpmPositions` | yes (event block) |
| `Factory.getPool(t0,t1,fee)` | `factoryGetPool` | yes (event block) |
| `Pool.feeGrowthGlobal0X128()` | `poolFeeGrowth0` | yes (event block) |
| `Pool.feeGrowthGlobal1X128()` | `poolFeeGrowth1` | yes (event block) |
| `Pool.ticks(tickIdx)` | `poolTicks` | yes (event block) |

State-dependent reads (fee growth, positions, ticks) are pinned to
`event.block.number` so bounded historical re-runs are deterministic. The
original subgraph ran these against chain head at handler time; pinning is the
HyperIndex-correct equivalent and produces the same values when re-indexing a
fixed block range. ERC20 metadata is immutable and left unpinned.

- RPC env: `RPC_URL_56`.
- Offline tests mock the entire layer via `PANCAKE_V3_CALL_MOCK` (declarative
  rules: string / number / bigint / multi-output `tuple` / revert), set with
  `setCallMock(...)`. Worker threads copy the parent env, so the JSON-serialized
  mock crosses into the test indexer's worker.

## Concentrated-liquidity math & pricing

- `sqrtPriceX96ToTokenPrices`: `price1 = (sqrtP^2 / 2^192) · 10^dec0 / 10^dec1`,
  `price0 = 1/price1`. `2^192` is a constant `BigDecimal`.
- `getEthPriceInUSD` reads `token0Price` of the WBNB-USDT 500 pool
  (`stableIsToken0 = true`).
- `findEthPerToken` returns 1 for WBNB; `1/ethPriceUSD` for stablecoins;
  otherwise walks the token's `whitelistPools` choosing the largest ETH-locked
  pool above `minETHLocked = 10` (or any whitelisted-counterparty pool).
- `getAdjustedAmounts` produces tracked/untracked ETH+USD per the whitelist
  rules; TVL aggregation in `tvl.ts` resets the per-pool factory contribution
  before re-adding.

## Deviations (documented for parity)

1. **BigDecimal semantics.** `bignumber.js` configured to 34 decimal places,
   no exponential notation (graph-node keeps 34 significant digits). Division
   far-decimals may differ; `tools/compare` tolerates this.
2. **`whitelistPools` type.** Schema `[Pool!]!` (a derived id-array in the
   subgraph store) → `[String!]!` of lowercase pool addresses. Values/ordering
   identical, including the source quirk that a pool may be pushed more than
   once if the same token appears across multiple whitelisted pools.
3. **Bytes → String.** All `Bytes` fields (`owner`, `sender`, `recipient`,
   `origin`, `poolAddress`) store lowercase `0x…` hex.
4. **`staticTokenDefinition` omitted.** Every definition in the source's
   `staticTokenDefinition.ts` is commented out and `fromAddress()` returns
   `null`, so the fallback is dead code on BSC; not ported.
5. **`fetchTokenDecimals` null-coercion quirk.** A reverted `decimals()` call
   yields `0` (AssemblyScript `BigInt.fromI32(null)` → 0), so the factory's
   dead `if (decimals === null) return` branch is unreachable; not ported.
6. **`updateTickDayData` `volumeToken1 = tick.volumeToken0` bug** preserved.
7. **`handleCollect` (position-manager) `collectedFeesToken1 += amount0`
   bug** preserved (see Position handling).
8. **Mainnet-specific hot-fixes** (`transaction.blockNumber == 18450862`
   WBTC-WETH derivedETH revert) ported verbatim; they never fire on BSC.
9. **`event.transactionLogIndex`** is not exposed by envio. The subgraph uses
   `event.logIndex` (not `transactionLogIndex`) for `Mint/Burn/Swap/Collect.
   logIndex` and for nothing in the ids, so `event.logIndex` is a 1:1 match.
10. **`oldTick` when a Swap precedes Initialize.** The subgraph reads
    `pool.tick!` (would crash if null). Here a null `pool.tick` is treated as
    `0n` for the `oldTick`/`newTick` crossing loop (`numIters` becomes 0). This
    only affects an out-of-order Swap before Initialize, which does not occur in
    practice on a correctly-ordered chain.
11. **gasUsed** is hard-coded to `0` by the subgraph's `loadTransaction`;
    preserved. `gasPrice` comes from `event.transaction.gasPrice`
    (field_selection); when unavailable it falls back to `0`.

## Known gaps / not yet ported

- **`TickHourData`** entity exists in the schema but the source mappings never
  write it (no `updateTickHourData` is called anywhere in `template/`). Schema
  type retained; no handler emits it (matches source — zero rows).
- **`observationIndex`** on Pool is initialized to 0 and never updated (the
  source never updates it either).
- Peripheral `masterChefV3` / `predictionV2` data sources from `config/bsc.js`
  are out of scope (not part of the v3 exchange manifest).

## Verification

```
cd pancakeswap-v3
pnpm install
pnpm codegen
pnpm build      # tsc --noEmit, zero errors
pnpm test       # offline vitest (2 suites)
```

Tests (`test/`):
- `pool-created.test.ts` — `PoolCreated` → Factory/Bundle/Tokens/Pool with
  mocked ERC20 metadata (string + bytes32 fallback + reverted-decimals→0),
  whitelist wiring, and Pool-template registration verified by a subsequent
  `Initialize`.
- `swap-flow.test.ts` — `Initialize → Mint → Swap` on the WBNB-USDT pool;
  asserts exact pool price/tick/liquidity/sqrtPrice/TVL, bundle ETH price,
  token derived prices, the Mint-created Ticks (liquidityGross/Net + price0/1)
  and a PoolDayData.

## Bounded validation run

`config.yaml` pins `start_block: 26931961` (the earlier NFPM start; the factory
starts at 26956207). For a bounded run, uncomment `end_block: 27006207`
(≈ factory start + 50k) and set `RPC_URL_56`. `rollback_on_reorg: false` for
deterministic comparison. `validation.json` maps in-scope entities over block
range 26956207 → 27006207; set the subgraph gateway `url` (see the `_note`
field there — no concrete deployment ID is committed in the source repo).
```
