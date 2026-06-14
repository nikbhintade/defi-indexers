/**
 * Typed wrappers around `tryContractCall` for every eth_call this port
 * performs. eth_call -> effect table (also in MIGRATION.md):
 *
 * | Original subgraph call                       | Wrapper            | Pinned |
 * | -------------------------------------------- | ------------------ | ------ |
 * | ERC20.try_name()                             | erc20Name          | no     |
 * | ERC20NameBytes.try_name()                    | erc20NameBytes32   | no     |
 * | ERC20.try_symbol()                           | erc20Symbol        | no     |
 * | ERC20SymbolBytes.try_symbol()                | erc20SymbolBytes32 | no     |
 * | ERC20.try_decimals()                         | erc20Decimals      | no     |
 * | ERC20.try_totalSupply()                      | erc20TotalSupply   | no     |
 * | NonfungiblePositionManager.try_positions(id) | nfpmPositions      | no(*)  |
 * | Factory.getPool(t0,t1,fee)                   | factoryGetPool     | no(*)  |
 * | Pool.feeGrowthGlobal0X128()                  | poolFeeGrowth0     | yes    |
 * | Pool.feeGrowthGlobal1X128()                  | poolFeeGrowth1     | yes    |
 * | Pool.ticks(tickIdx)                          | poolTicks          | yes    |
 *
 * (*) The original subgraph did NOT pin these calls to the event block (it used
 * the default "latest" behaviour of AssemblyScript contract binds at the time
 * the handler ran). positions()/getPool() are effectively immutable for a given
 * tokenId (fee growth fields aside, which the subgraph re-reads on each event),
 * so leaving them unpinned matches subgraph behaviour at chain head. The
 * fee-growth re-reads (positions value8/value9, pool global fee growth, tick
 * fee growth) ARE state-dependent and are pinned to the event block here so a
 * bounded historical re-run is deterministic.
 */
import type { EffectCaller } from "envio";
import { tryContractCall } from "./calls";

type EC = EffectCaller | null;

/** ERC20.name() returns (string) */
export const erc20Name = (ec: EC, token: string) =>
  tryContractCall<string>(ec, token, "function name() view returns (string)", "name", []);

/** ERC20NameBytes.name() returns (bytes32) — raw 0x… hex (or a pre-decoded mock value) */
export const erc20NameBytes32 = (ec: EC, token: string) =>
  tryContractCall<string>(ec, token, "function name() view returns (bytes32)", "name", [], undefined, "nameBytes32");

/** ERC20.symbol() returns (string) */
export const erc20Symbol = (ec: EC, token: string) =>
  tryContractCall<string>(ec, token, "function symbol() view returns (string)", "symbol", []);

/** ERC20SymbolBytes.symbol() returns (bytes32) — raw 0x… hex (or a pre-decoded mock value) */
export const erc20SymbolBytes32 = (ec: EC, token: string) =>
  tryContractCall<string>(
    ec,
    token,
    "function symbol() view returns (bytes32)",
    "symbol",
    [],
    undefined,
    "symbolBytes32",
  );

/** ERC20.decimals() returns (uint8) */
export const erc20Decimals = (ec: EC, token: string) =>
  tryContractCall<number>(ec, token, "function decimals() view returns (uint8)", "decimals", []);

/** ERC20.totalSupply() returns (uint256) */
export const erc20TotalSupply = (ec: EC, token: string) =>
  tryContractCall<bigint>(ec, token, "function totalSupply() view returns (uint256)", "totalSupply", []);

/**
 * NonfungiblePositionManager.positions(tokenId). Returns the full 12-field
 * tuple. Fields used by the subgraph (0-indexed): value2=token0, value3=token1,
 * value4=fee, value5=tickLower, value6=tickUpper, value8=feeGrowthInside0LastX128,
 * value9=feeGrowthInside1LastX128.
 */
export const nfpmPositions = (ec: EC, nfpm: string, tokenId: bigint, block?: number) =>
  tryContractCall<readonly unknown[]>(
    ec,
    nfpm,
    "function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
    "positions",
    [tokenId],
    block,
    "positions",
  );

/** Factory.getPool(token0, token1, fee) returns (address) */
export const factoryGetPool = (ec: EC, factory: string, token0: string, token1: string, fee: number, block?: number) =>
  tryContractCall<string>(
    ec,
    factory,
    "function getPool(address,address,uint24) view returns (address)",
    "getPool",
    [token0, token1, fee],
    block,
    "getPool",
  );

/** Pool.feeGrowthGlobal0X128() returns (uint256) — pinned to the event block. */
export const poolFeeGrowth0 = (ec: EC, pool: string, block?: number) =>
  tryContractCall<bigint>(
    ec,
    pool,
    "function feeGrowthGlobal0X128() view returns (uint256)",
    "feeGrowthGlobal0X128",
    [],
    block,
    "feeGrowthGlobal0X128",
  );

/** Pool.feeGrowthGlobal1X128() returns (uint256) — pinned to the event block. */
export const poolFeeGrowth1 = (ec: EC, pool: string, block?: number) =>
  tryContractCall<bigint>(
    ec,
    pool,
    "function feeGrowthGlobal1X128() view returns (uint256)",
    "feeGrowthGlobal1X128",
    [],
    block,
    "feeGrowthGlobal1X128",
  );

/**
 * Pool.ticks(tickIdx). Returns the 8-field tuple. Fields used by the subgraph
 * (0-indexed): value2=feeGrowthOutside0X128, value3=feeGrowthOutside1X128.
 */
export const poolTicks = (ec: EC, pool: string, tickIdx: number, block?: number) =>
  tryContractCall<readonly unknown[]>(
    ec,
    pool,
    "function ticks(int24 tick) view returns (uint128 liquidityGross, int128 liquidityNet, uint256 feeGrowthOutside0X128, uint256 feeGrowthOutside1X128, int56 tickCumulativeOutside, uint160 secondsPerLiquidityOutsideX128, uint32 secondsOutside, bool initialized)",
    "ticks",
    [tickIdx],
    block,
    "ticks",
  );
