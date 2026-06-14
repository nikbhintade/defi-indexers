/**
 * eth_call layer. Mirrors the subgraph's `Contract.bind(addr).foo()` reads
 * (graph-ts `bind().method()` reverts the whole handler on failure; the M0
 * mappings do not use `try_`, so a revert would have halted the subgraph —
 * we surface a revert as `null` and let the caller decide, matching the
 * `createMinterAttributeEntity` / `createTimeseriesEntity` guards which only
 * write when the returned amount is truthy / > 0).
 *
 * All calls go through a single `ethCall` Effect (cache: true) carrying raw
 * calldata, so every distinct (to, data, block) tuple is cached and re-runs
 * are deterministic. Every M0 read is state-dependent (owed-M / collateral /
 * totals at a point in time) and is therefore block-pinned.
 *
 * For offline tests, a mock can be installed via `setCallMock`, JSON-serialized
 * into the M0_CALL_MOCK env var (envio runs handlers in a worker thread that
 * copies the parent env at creation time).
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

/** Sentinel emulating a reverted call in mocks. */
export const REVERTED = Symbol.for("m0.reverted");

export type MockResult =
  | { kind: "bigint"; value: string }
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "revert" };

export type CallMockRule = {
  /** function name to match (e.g. "activeOwedMOf") */
  fn: string;
  /** optional contract address to match (case-insensitive) */
  to?: string;
  /** optional args to match; compared as lowercase strings */
  args?: string[];
  /** optional block number to match (M0 reads are block-pinned) */
  block?: number;
  result: MockResult;
};

export type CallMockSpec = {
  /** when true, an unmatched call throws (fails the test) instead of reverting */
  strict?: boolean;
  rules: CallMockRule[];
};

export const CALL_MOCK_ENV = "M0_CALL_MOCK";

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
      transport: http(process.env.RPC_URL_1, { batch: true }),
    });
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
 * `bind().method()` equivalent. Returns the decoded result or null on revert.
 * - `effectCall`: pass `context.effect` inside handlers (cached Effect); pass
 *   `null` outside handler contexts (raw call).
 * - `block`: pin the call to a block (all M0 reads are state-dependent).
 */
export async function tryContractCall<T>(
  effectCall: EffectCaller | null,
  to: string,
  signature: string,
  functionName: string,
  args: readonly unknown[],
  block?: number,
): Promise<T | null> {
  const mockSpec = getCallMockSpec();
  if (mockSpec) {
    const result = resolveMock(mockSpec, {
      to: to.toLowerCase(),
      fn: functionName,
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
    return decodeFunctionResult({
      abi,
      functionName,
      data: hex as `0x${string}`,
    }) as T;
  } catch (_e) {
    return null;
  }
}
