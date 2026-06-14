/**
 * eth_call layer for the FAssets port. Mirrors the source StateUpdater's
 * `contract.foo()` reads (AgentOwnerRegistry agent metadata + work address,
 * collateral-pool-token ERC20 symbol). The source has no try_ wrapper for
 * these — they throw on revert — but to keep handlers robust and offline-
 * testable we resolve a reverted/empty call to `null` and let the handler
 * fall back to a sentinel.
 *
 * All calls go through a single `ethCall` Effect (cache: true) carrying raw
 * calldata, so every distinct (to, data, block) tuple is cached. Metadata
 * reads (symbol, agent name/desc/icon, work address) are unpinned.
 *
 * Offline tests install a mock via setCallMock(), JSON-serialized into the
 * FASSETS_CALL_MOCK env var (the envio test worker copies parent env at
 * creation, so the mock is visible inside the worker thread).
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

export const REVERTED = Symbol.for("fassets.reverted");

export type MockResult =
  | { kind: "string"; value: string }
  | { kind: "bigint"; value: string }
  | { kind: "number"; value: number }
  | { kind: "revert" };

export type CallMockRule = {
  fn: string;
  to?: string;
  args?: string[];
  result: MockResult;
};

export type CallMockSpec = {
  strict?: boolean;
  rules: CallMockRule[];
};

export const CALL_MOCK_ENV = "FASSETS_CALL_MOCK";

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
      transport: http(process.env.RPC_URL_14, { batch: true }),
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

/** try_<fn> equivalent: decoded result or null on revert/empty. */
export async function tryCall<T>(
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
  if (hex === null || hex === "0x") return null;
  try {
    return decodeFunctionResult({ abi, functionName, data: hex as `0x${string}` }) as T;
  } catch (_e) {
    return null;
  }
}

// --- signatures used by the AgentVaultCreated state-updater reads ---
export const SIG_GET_WORK_ADDRESS = "function getWorkAddress(address) view returns (address)";
export const SIG_GET_AGENT_NAME = "function getAgentName(address) view returns (string)";
export const SIG_GET_AGENT_DESCRIPTION = "function getAgentDescription(address) view returns (string)";
export const SIG_GET_AGENT_ICON_URL = "function getAgentIconUrl(address) view returns (string)";
export const SIG_SYMBOL = "function symbol() view returns (string)";
