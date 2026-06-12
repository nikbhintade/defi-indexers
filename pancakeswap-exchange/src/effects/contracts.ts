/**
 * Typed wrappers around `tryContractCall` for every eth_call this port
 * performs. The original subgraph's calls (mappings/utils/index.ts):
 *
 * | Original call                  | Wrapper            | Pinned |
 * | ------------------------------ | ------------------ | ------ |
 * | ERC20.try_name()               | erc20Name          | no     |
 * | ERC20NameBytes.try_name()      | erc20NameBytes32   | no     |
 * | ERC20.try_symbol()             | erc20Symbol        | no     |
 * | ERC20SymbolBytes.try_symbol()  | erc20SymbolBytes32 | no     |
 * | ERC20.try_decimals()           | erc20Decimals      | no     |
 *
 * ERC20 metadata is immutable, so none of these are block-pinned.
 * `Factory.getPair` (pricing) is NOT an eth_call here — it is served from the
 * PairTokenLookup entity (see src/pricing.ts).
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
