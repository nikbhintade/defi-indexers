/**
 * eth_call layer. Mirrors the subgraph's `Contract.bind(addr).try_foo()`
 * semantics: a reverted / empty / undecodable call resolves to `null`.
 *
 * Adapted from the compound-v3 reference port. All calls flow through a single
 * cached `ethCall` Effect carrying raw calldata, so every distinct (to, data,
 * block) tuple is cached and re-runs are deterministic. State/price reads are
 * block-pinned; immutable ERC20 metadata is left unpinned.
 *
 * Offline tests install a mock via `setCallMock`; the test indexer runs
 * handlers in a worker thread, so the mock is JSON-serialized into the
 * SPARKLEND_CALL_MOCK env var (worker threads copy the parent env at creation).
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

export type CallRequest = {
  to: string;
  fn: string;
  args: readonly unknown[];
  block?: number;
};

export const REVERTED = Symbol.for("sparklend.reverted");

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
  /** when true, an unmatched call throws (fails the test) instead of reverting */
  strict?: boolean;
  rules: CallMockRule[];
};

export const CALL_MOCK_ENV = "SPARKLEND_CALL_MOCK";

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
    client = createPublicClient({ transport: http(process.env.RPC_URL_1, { batch: true }) });
  }
  return client;
}

async function rawEthCall(input: {
  to: string;
  data: string;
  block?: number;
}): Promise<string | null> {
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

/**
 * try_<fn> equivalent. Returns the decoded result or null on revert /
 * undecodable output.
 * - `effectCall`: pass `context.effect` inside onEvent handlers (cached
 *   Effect); pass `null` outside handler contexts.
 * - `block`: pin the call to a block for state-dependent reads.
 * - `mockFn`: override the function name used for mock matching (e.g. to
 *   distinguish V1 vs V2 strategy reads sharing a calldata shape).
 */
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
    const result = resolveMock(mockSpec, {
      to: to.toLowerCase(),
      fn: mockFn ?? functionName,
      args,
      block,
    });
    return result === REVERTED ? null : (result as T);
  }
  const abi = getAbi(signature);
  const data = encodeFunctionData({ abi, functionName, args: args as never });
  const hex = effectCall
    ? await effectCall(ethCall, { to, data, block })
    : await rawEthCall({ to, data, block });
  if (hex === null || hex === "0x") return null;
  try {
    return decodeFunctionResult({ abi, functionName, data: hex as `0x${string}` }) as T;
  } catch (_e) {
    return null;
  }
}
