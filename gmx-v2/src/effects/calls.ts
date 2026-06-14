/**
 * eth_call layer for GMX V2. Mirrors the subgraph's `Contract.bind(addr).try_*()`
 * semantics: a reverted (or empty-data / undecodable) call resolves to `null`.
 *
 * The subgraph performs two on-chain reads inside fee handlers:
 *   - Reader.getMarketTokenPrice(...)  -> pool value (state-dependent; reverts
 *     are common, so the subgraph falls back to ZERO) — block-pinned.
 *   - MarketToken.totalSupply()        -> GM token supply for deposit/withdrawal
 *     fee actions — block-pinned (latest value in the event block).
 *
 * All calls go through a single cached `ethCall` Effect carrying raw calldata,
 * so every (to, data, block) tuple is deterministic on re-run. For offline
 * tests, a mock is installed via setCallMock -> GMX_V2_CALL_MOCK env var (the
 * test indexer runs handlers in a worker thread which copies the parent env).
 */
import { createEffect, S, type EffectCaller } from "envio";
import {
  createPublicClient,
  http,
  encodeFunctionData,
  decodeFunctionResult,
  parseAbi,
  type Abi,
  type PublicClient,
} from "viem";

export const REVERTED = Symbol.for("gmx-v2.reverted");

export type MockResult =
  | { kind: "bigint"; value: string }
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "bool"; value: boolean }
  | { kind: "json"; value: unknown }
  | { kind: "revert" };

export type CallMockRule = {
  fn: string;
  to?: string;
  args?: string[];
  block?: number;
  result: MockResult;
};

export type CallMockSpec = {
  strict?: boolean;
  rules: CallMockRule[];
};

export const CALL_MOCK_ENV = "GMX_V2_CALL_MOCK";

export function setCallMock(spec: CallMockSpec | undefined): void {
  if (spec === undefined) {
    delete process.env[CALL_MOCK_ENV];
  } else {
    process.env[CALL_MOCK_ENV] = JSON.stringify(spec);
  }
}

let cachedSpecRaw: string | undefined;
let cachedSpec: CallMockSpec | undefined;
function getCallMockSpec(): CallMockSpec | undefined {
  const raw = process.env[CALL_MOCK_ENV];
  if (!raw) return undefined;
  if (raw !== cachedSpecRaw) {
    cachedSpecRaw = raw;
    cachedSpec = JSON.parse(raw) as CallMockSpec;
  }
  return cachedSpec;
}

type CallRequest = { to: string; fn: string; args: readonly unknown[]; block?: number };

function resolveMock(spec: CallMockSpec, req: CallRequest): unknown {
  for (const rule of spec.rules) {
    if (rule.fn !== req.fn) continue;
    if (rule.to !== undefined && rule.to.toLowerCase() !== req.to) continue;
    if (rule.block !== undefined && rule.block !== req.block) continue;
    if (rule.args !== undefined) {
      if (rule.args.length !== req.args.length) continue;
      let ok = true;
      for (let i = 0; i < rule.args.length; i++) {
        if (rule.args[i]!.toLowerCase() !== String(req.args[i]).toLowerCase()) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
    }
    const result = rule.result;
    switch (result.kind) {
      case "revert":
        return REVERTED;
      case "bigint":
        return BigInt(result.value);
      case "number":
        return result.value;
      case "string":
        return result.value;
      case "bool":
        return result.value;
      case "json":
        return result.value;
    }
  }
  if (spec.strict) {
    throw new Error(
      `unexpected eth_call: ${req.fn} on ${req.to} (${req.args.map(String).join(",")})`,
    );
  }
  return REVERTED;
}

let client: PublicClient | undefined;
function getClient(): PublicClient {
  if (!client) {
    client = createPublicClient({
      transport: http(process.env.RPC_URL_42161, { batch: true }),
    });
  }
  return client;
}

async function rawEthCall(input: { to: string; data: string; block?: number }): Promise<string | null> {
  try {
    const result = await getClient().call({
      to: input.to as `0x${string}`,
      data: input.data as `0x${string}`,
      blockNumber: input.block !== undefined ? BigInt(input.block) : undefined,
    });
    return result.data ?? "0x";
  } catch (_e) {
    return null;
  }
}

export const ethCall = createEffect(
  {
    name: "ethCall",
    input: { to: S.string, data: S.string, block: S.optional(S.number) },
    output: S.nullable(S.string),
    rateLimit: false,
    cache: true,
  },
  async ({ input }) => rawEthCall(input),
);

const abiCache = new Map<string, Abi>();
function getAbi(signature: string): Abi {
  let abi = abiCache.get(signature);
  if (!abi) {
    abi = parseAbi([signature]) as Abi;
    abiCache.set(signature, abi);
  }
  return abi;
}

/** try_<fn> equivalent. Returns decoded result or null on revert / undecodable. */
export async function tryContractCall<T>(
  effectCall: EffectCaller | null,
  to: string,
  signature: string,
  functionName: string,
  args: readonly unknown[],
  block?: number,
  mockFn?: string,
): Promise<T | null> {
  const mockSpec = getCallMockSpec();
  if (mockSpec) {
    const result = resolveMock(mockSpec, { to: to.toLowerCase(), fn: mockFn ?? functionName, args, block });
    return result === REVERTED ? null : (result as T);
  }
  const abi = getAbi(signature);
  const data = encodeFunctionData({ abi, functionName, args: args as never });
  const hex = effectCall ? await effectCall(ethCall, { to, data, block }) : await rawEthCall({ to, data, block });
  if (hex === null || hex === "0x") return null;
  try {
    return decodeFunctionResult({ abi, functionName, data: hex as `0x${string}` }) as T;
  } catch (_e) {
    return null;
  }
}
