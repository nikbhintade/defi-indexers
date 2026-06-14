/**
 * Typed wrappers around `tryContractCall` for every eth_call the original M0
 * `protocol` subgraph performed (src/minter-gateway.ts via
 * `MinterGatewayContract.bind(...)`). All of these are state-dependent reads
 * (owed-M / collateral / totals at a point in time) and are therefore pinned
 * to the event/block number, per CONVENTIONS.md.
 *
 * Solidity return types: uint112 / uint128 / uint240 all decode to `bigint`.
 */
import type { EffectCaller } from "envio";
import { tryContractCall } from "./calls";

type EC = EffectCaller | null;

// ---- MinterGateway aggregate (no-arg) reads ----

/** MinterGateway.principalOfTotalActiveOwedM() -> uint112 */
export const principalOfTotalActiveOwedM = (ec: EC, gw: string, block: number) =>
  tryContractCall<bigint>(
    ec,
    gw,
    "function principalOfTotalActiveOwedM() view returns (uint112)",
    "principalOfTotalActiveOwedM",
    [],
    block,
  );

/** MinterGateway.totalOwedM() -> uint240 */
export const totalOwedM = (ec: EC, gw: string, block: number) =>
  tryContractCall<bigint>(
    ec,
    gw,
    "function totalOwedM() view returns (uint240)",
    "totalOwedM",
    [],
    block,
  );

/** MinterGateway.totalActiveOwedM() -> uint240 */
export const totalActiveOwedM = (ec: EC, gw: string, block: number) =>
  tryContractCall<bigint>(
    ec,
    gw,
    "function totalActiveOwedM() view returns (uint240)",
    "totalActiveOwedM",
    [],
    block,
  );

/** MinterGateway.totalInactiveOwedM() -> uint240 */
export const totalInactiveOwedM = (ec: EC, gw: string, block: number) =>
  tryContractCall<bigint>(
    ec,
    gw,
    "function totalInactiveOwedM() view returns (uint240)",
    "totalInactiveOwedM",
    [],
    block,
  );

/** MinterGateway.excessOwedM() -> uint240 */
export const excessOwedM = (ec: EC, gw: string, block: number) =>
  tryContractCall<bigint>(
    ec,
    gw,
    "function excessOwedM() view returns (uint240)",
    "excessOwedM",
    [],
    block,
  );

// ---- MinterGateway per-minter reads ----

/** MinterGateway.activeOwedMOf(minter) -> uint240 */
export const activeOwedMOf = (ec: EC, gw: string, minter: string, block: number) =>
  tryContractCall<bigint>(
    ec,
    gw,
    "function activeOwedMOf(address minter) view returns (uint240)",
    "activeOwedMOf",
    [minter],
    block,
  );

/** MinterGateway.inactiveOwedMOf(minter) -> uint240 */
export const inactiveOwedMOf = (ec: EC, gw: string, minter: string, block: number) =>
  tryContractCall<bigint>(
    ec,
    gw,
    "function inactiveOwedMOf(address minter) view returns (uint240)",
    "inactiveOwedMOf",
    [minter],
    block,
  );

/** MinterGateway.principalOfActiveOwedMOf(minter) -> uint112 */
export const principalOfActiveOwedMOf = (
  ec: EC,
  gw: string,
  minter: string,
  block: number,
) =>
  tryContractCall<bigint>(
    ec,
    gw,
    "function principalOfActiveOwedMOf(address minter) view returns (uint112)",
    "principalOfActiveOwedMOf",
    [minter],
    block,
  );

/** MinterGateway.collateralOf(minter) -> uint240 */
export const collateralOf = (ec: EC, gw: string, minter: string, block: number) =>
  tryContractCall<bigint>(
    ec,
    gw,
    "function collateralOf(address minter) view returns (uint240)",
    "collateralOf",
    [minter],
    block,
  );
