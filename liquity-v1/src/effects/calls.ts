/**
 * eth_call layer. The Liquity V1 subgraph performs exactly one kind of
 * eth_call: in Token.ts, `ERC20.bind(addr).name()` / `.symbol()` are read the
 * first time a token is seen (these are NOT `try_` calls in the subgraph — they
 * revert the handler if they fail, but LUSD/LQTY always implement them).
 *
 * Calls go through a single `ethCall` Effect (cache: true) carrying raw
 * calldata, so every distinct (to, data) tuple is cached and re-runs are
 * deterministic. ERC20 name/symbol are immutable metadata, so calls are NOT
 * block-pinned.
 *
 * For offline tests a mock is installed via `setCallMock`, JSON-serialized into
 * the LIQUITY_V1_CALL_MOCK env var (envio's test worker copies the parent env at
 * creation time).
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

export const REVERTED = Symbol.for("liquity-v1.reverted");

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

export const CALL_MOCK_ENV = "LIQUITY_V1_CALL_MOCK";

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
 * undecodable output. Pass `context.effect` as `effectCall` inside handlers.
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
    const result = resolveMock(mockSpec, { to: to.toLowerCase(), fn: functionName, args, block });
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
    return null;
  }
}

/** ERC20.name() — immutable, unpinned. */
export const erc20Name = (ec: EffectCaller | null, token: string) =>
  tryContractCall<string>(ec, token, "function name() view returns (string)", "name", []);

/** ERC20.symbol() — immutable, unpinned. */
export const erc20Symbol = (ec: EffectCaller | null, token: string) =>
  tryContractCall<string>(ec, token, "function symbol() view returns (string)", "symbol", []);
