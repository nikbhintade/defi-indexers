/**
 * Typed wrappers around `tryContractCall` for every eth_call this port
 * performs. The original subgraph's calls (mappings/helpers.ts):
 *
 * | Original call                  | Wrapper            | Pinned |
 * | ------------------------------ | ------------------ | ------ |
 * | ERC20.try_name()               | erc20Name          | no     |
 * | ERC20NameBytes.try_name()      | erc20NameBytes32   | no     |
 * | ERC20.try_symbol()             | erc20Symbol        | no     |
 * | ERC20SymbolBytes.try_symbol()  | erc20SymbolBytes32 | no     |
 * | ERC20.try_decimals()           | erc20Decimals      | no     |
 * | ERC20.try_totalSupply()        | erc20TotalSupply   | no     |
 * | Pair.balanceOf(account)        | pairBalanceOf      | yes    |
 *
 * ERC20 metadata is immutable, so none of those are block-pinned. balanceOf is
 * state-dependent and pinned to the event block.
 * `Factory.getPair` (pricing) is NOT an eth_call here — QuickSwap's
 * findEthPerToken iterates the per-token `whitelist` array of pair addresses.
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

/** Pair.balanceOf(account) returns (uint256) — pinned to the event block. */
export const pairBalanceOf = (ec: EC, pair: string, account: string, block: number) =>
  tryContractCall<bigint>(
    ec,
    pair,
    "function balanceOf(address) view returns (uint256)",
    "balanceOf",
    [account],
    block,
  );
