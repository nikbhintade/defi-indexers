/**
 * eth_call layer. Mirrors the subgraph's `Contract.bind(addr).try_foo()`
 * semantics: a reverted (or empty-data / undecodable) call resolves to `null`.
 *
 * All calls go through a single `ethCall` Effect (cache: true) carrying raw
 * calldata, so every distinct (to, data, block) tuple is cached and re-runs
 * are deterministic.
 *
 * For offline tests, a mock is installed via `setCallMock`. The envio test
 * indexer runs handlers in a worker thread, so the mock is passed by value:
 * JSON-serialized into the PANCAKE_V3_CALL_MOCK env var (worker threads copy
 * the parent env at creation time).
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
  /** mock-matching name (distinguishes string vs bytes32 variants, etc.) */
  fn: string;
  args: readonly unknown[];
  block?: number;
};

/** Sentinel emulating a reverted call in mocks. */
export const REVERTED = Symbol.for("pancakeswap-v3.reverted");

/**
 * Declarative call-mock result spec for offline tests. `tuple` carries a
 * JSON-encoded array of values (bigint as decimal string) for multi-output
 * calls such as NFPM.positions / Pool.ticks.
 */
export type MockResult =
  | { kind: "bigint"; value: string }
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "tuple"; value: string }
  | { kind: "revert" };

export type CallMockRule = {
  /** mock function name to match (e.g. "symbol", "symbolBytes32", "positions") */
  fn: string;
  /** optional contract address to match (case-insensitive) */
  to?: string;
  /** optional args to match; compared as lowercase strings */
  args?: string[];
  result: MockResult;
};

export type CallMockSpec = {
  /** when true, an unmatched call throws (fails the test) instead of reverting */
  strict?: boolean;
  rules: CallMockRule[];
};

export const CALL_MOCK_ENV = "PANCAKE_V3_CALL_MOCK";

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
  if (!raw) {
    return undefined;
  }
  if (raw !== cachedSpecRaw) {
    cachedSpecRaw = raw;
    cachedSpec = JSON.parse(raw) as CallMockSpec;
  }
  return cachedSpec;
}

/** revive a JSON tuple value: decimal strings ending in "n" -> bigint */
function reviveTuple(json: string): unknown[] {
  const arr = JSON.parse(json) as unknown[];
  return arr.map((v) => {
    if (typeof v === "string" && /^-?\d+n$/.test(v)) {
      return BigInt(v.slice(0, -1));
    }
    return v;
  });
}

function resolveMock(spec: CallMockSpec, req: CallRequest): unknown {
  for (const rule of spec.rules) {
    if (rule.fn !== req.fn) continue;
    if (rule.to !== undefined && rule.to.toLowerCase() !== req.to) continue;
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
      case "tuple":
        return reviveTuple(result.value);
    }
  }
  if (spec.strict) {
    throw new Error(`unexpected eth_call: ${req.fn} on ${req.to} (${req.args.map(String).join(",")})`);
  }
  return REVERTED;
}

let client: PublicClient | undefined;
function getClient(): PublicClient {
  if (!client) {
    client = createPublicClient({
      transport: http(process.env.RPC_URL_56, { batch: true }),
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

/**
 * try_<fn> equivalent. Returns the decoded result or null on revert.
 * - `effectCall`: pass `context.effect` inside onEvent handlers (cached
 *   Effect); pass `null` outside handler contexts (raw call).
 * - `block`: pin the call to a block (state-dependent reads).
 * - `mockName`: name used for mock matching; defaults to `functionName`.
 *
 * For multi-output functions (e.g. positions / ticks) the decoded result is a
 * tuple array; both the live decode and the mock "tuple" kind produce a
 * `readonly unknown[]`.
 */
export async function tryContractCall<T>(
  effectCall: EffectCaller | null,
  to: string,
  signature: string,
  functionName: string,
  args: readonly unknown[],
  block?: number,
  mockName?: string,
): Promise<T | null> {
  const mockSpec = getCallMockSpec();
  if (mockSpec) {
    const result = resolveMock(mockSpec, {
      to: to.toLowerCase(),
      fn: mockName ?? functionName,
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
  if (hex === null || hex === "0x") {
    return null;
  }
  try {
    return decodeFunctionResult({ abi, functionName, data: hex as `0x${string}` }) as T;
  } catch (_e) {
    // graph-node marks a call whose return data cannot be decoded as
    // `reverted` (this is how try_symbol() "reverts" for bytes32 tokens).
    return null;
  }
}
