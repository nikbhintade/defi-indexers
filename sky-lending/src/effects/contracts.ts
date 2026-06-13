/**
 * Typed wrappers around `tryContractCall` for every eth_call the makerdao
 * subgraph performed (Contract.bind(addr).fn() / try_fn()).
 *
 * Pinning policy (CONVENTIONS.md): state reads that change over time
 * (Vat.ilks, Jug.base/ilks, Pot.chi/rho/Pie, Flip/Clip auction state,
 * CdpManager.urns/ilks, DAI.totalSupply) are pinned to the event block.
 * Immutable ERC20 metadata (name/symbol/decimals) and per-adapter config
 * (GemJoin.ilk/gem, PSM.ilk) are left unpinned.
 *
 * try_ semantics: a revert / undecodable output resolves to null so handlers
 * can mirror the subgraph's `.reverted` branches.
 */
import type { EffectCaller } from "envio";
import { tryContractCall } from "./calls";

type EC = EffectCaller | null;
const lower = (a: string | null): string | null => (a === null ? null : a.toLowerCase());

// ---- ERC20 (immutable, unpinned) ----
export const erc20Name = (ec: EC, token: string) =>
  tryContractCall<string>(ec, token, "function name() view returns (string)", "name", []);
export const erc20Symbol = (ec: EC, token: string) =>
  tryContractCall<string>(ec, token, "function symbol() view returns (string)", "symbol", []);
export const erc20Decimals = (ec: EC, token: string) =>
  tryContractCall<number>(ec, token, "function decimals() view returns (uint8)", "decimals", []);

// ---- GemJoin (per-adapter config, unpinned) ----
export const gemJoinIlk = (ec: EC, join: string) =>
  tryContractCall<string>(ec, join, "function ilk() view returns (bytes32)", "ilk", []);
export const gemJoinGem = async (ec: EC, join: string) =>
  lower(await tryContractCall<string>(ec, join, "function gem() view returns (address)", "gem", []));

// ---- Vat.ilks(ilk) -> (Art, rate, spot, line, dust) — pinned ----
export type VatIlk = { Art: bigint; rate: bigint; spot: bigint; line: bigint; dust: bigint };
export async function vatIlks(ec: EC, vat: string, ilk: string, block: number): Promise<VatIlk | null> {
  const r = await tryContractCall<readonly unknown[]>(
    ec,
    vat,
    "function ilks(bytes32) view returns (uint256 Art, uint256 rate, uint256 spot, uint256 line, uint256 dust)",
    "ilks",
    [ilk],
    block,
  );
  if (r === null) return null;
  return {
    Art: BigInt(r[0] as string | bigint),
    rate: BigInt(r[1] as string | bigint),
    spot: BigInt(r[2] as string | bigint),
    line: BigInt(r[3] as string | bigint),
    dust: BigInt(r[4] as string | bigint),
  };
}

// ---- Jug — pinned ----
export const jugBase = (ec: EC, jug: string, block: number) =>
  tryContractCall<bigint>(ec, jug, "function base() view returns (uint256)", "base", [], block);
export async function jugIlkDuty(ec: EC, jug: string, ilk: string, block: number): Promise<bigint | null> {
  const r = await tryContractCall<readonly unknown[]>(
    ec,
    jug,
    "function ilks(bytes32) view returns (uint256 duty, uint256 rho)",
    "ilks",
    [ilk],
    block,
  );
  if (r === null) return null;
  return BigInt(r[0] as string | bigint);
}

// ---- Pot — pinned ----
export const potChi = (ec: EC, pot: string, block: number) =>
  tryContractCall<bigint>(ec, pot, "function chi() view returns (uint256)", "chi", [], block);
export const potRho = (ec: EC, pot: string, block: number) =>
  tryContractCall<bigint>(ec, pot, "function rho() view returns (uint256)", "rho", [], block);
export const potPie = (ec: EC, pot: string, block: number) =>
  tryContractCall<bigint>(ec, pot, "function Pie() view returns (uint256)", "Pie", [], block);

// ---- Flip — pinned ----
export const flipIlk = (ec: EC, flip: string, block: number) =>
  tryContractCall<string>(ec, flip, "function ilk() view returns (bytes32)", "ilk", [], block);
export type FlipBid = { bid: bigint; lot: bigint; guy: string; tab: bigint };
export async function flipBids(ec: EC, flip: string, id: bigint, block: number): Promise<FlipBid | null> {
  const r = await tryContractCall<readonly unknown[]>(
    ec,
    flip,
    "function bids(uint256) view returns (uint256 bid, uint256 lot, address guy, uint48 tic, uint48 end, address usr, address gal, uint256 tab)",
    "bids",
    [id],
    block,
  );
  if (r === null) return null;
  return {
    bid: BigInt(r[0] as string | bigint),
    lot: BigInt(r[1] as string | bigint),
    guy: String(r[2]).toLowerCase(),
    tab: BigInt(r[7] as string | bigint),
  };
}

// ---- Clip — pinned ----
export const clipIlk = (ec: EC, clip: string, block: number) =>
  tryContractCall<string>(ec, clip, "function ilk() view returns (bytes32)", "ilk", [], block);
export type ClipSale = { tab: bigint; lot: bigint; usr: string };
export async function clipSales(ec: EC, clip: string, id: bigint, block: number): Promise<ClipSale | null> {
  const r = await tryContractCall<readonly unknown[]>(
    ec,
    clip,
    "function sales(uint256) view returns (uint256 pos, uint256 tab, uint256 lot, address usr, uint96 tic, uint256 top)",
    "sales",
    [id],
    block,
  );
  if (r === null) return null;
  return {
    tab: BigInt(r[1] as string | bigint),
    lot: BigInt(r[2] as string | bigint),
    usr: String(r[3]).toLowerCase(),
  };
}

// ---- CdpManager — pinned ----
export const cdpManagerUrns = async (ec: EC, mgr: string, cdpi: bigint, block: number) =>
  lower(await tryContractCall<string>(ec, mgr, "function urns(uint256) view returns (address)", "urns", [cdpi], block));
export const cdpManagerIlks = (ec: EC, mgr: string, cdpi: bigint, block: number) =>
  tryContractCall<string>(ec, mgr, "function ilks(uint256) view returns (bytes32)", "ilks", [cdpi], block);

// ---- PSM (config, unpinned) ----
export const psmIlk = (ec: EC, psm: string) =>
  tryContractCall<string>(ec, psm, "function ilk() view returns (bytes32)", "ilk", []);

// ---- DAI totalSupply — pinned ----
export const daiTotalSupply = (ec: EC, dai: string, block: number) =>
  tryContractCall<bigint>(ec, dai, "function totalSupply() view returns (uint256)", "totalSupply", [], block);
