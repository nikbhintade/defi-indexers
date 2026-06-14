/**
 * eth_call layer. Mirrors the subgraph's `Contract.bind(addr).foo()` reads.
 *
 * Two reads are needed:
 *   - Bridge.deposits(uint256 depositKey).treasuryFee  (DepositRevealed)
 *   - TBTCVault.optimisticMintingFeeDivisor()           (OptimisticMintingFinalized)
 *
 * Both go through a single cached `ethCall` Effect carrying raw calldata so
 * every distinct (to, data, block) tuple is cached and reruns are
 * deterministic. The Bridge.deposits read is block-pinned (state-dependent);
 * optimisticMintingFeeDivisor reads a parameter that is effectively constant
 * over the validation window and is left unpinned.
 *
 * Offline tests install a mock via `setCallMock` (JSON-serialized into the
 * TBTC_CALL_MOCK env var; worker threads copy parent env at creation).
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

export const REVERTED = Symbol.for("tbtc.reverted");

export type MockResult =
  | { kind: "bigint"; value: string }
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
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

export const CALL_MOCK_ENV = "TBTC_CALL_MOCK";

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

/** try_<fn> equivalent. Returns decoded result or null on revert. */
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
  if (hex === null || hex === "0x") return null;
  try {
    return decodeFunctionResult({ abi, functionName, data: hex as `0x${string}` }) as T;
  } catch (_e) {
    return null;
  }
}

const BRIDGE_DEPOSITS_SIG =
  "function deposits(uint256) view returns (address depositor, uint64 amount, uint32 revealedAt, address vault, uint64 treasuryFee, uint32 sweptAt)";
const VAULT_FEE_DIVISOR_SIG =
  "function optimisticMintingFeeDivisor() view returns (uint32)";

/** Bridge.deposits(depositKey).treasuryFee — returns 0n if reverted. */
export async function getDepositTreasuryFee(
  effectCall: EffectCaller,
  bridge: string,
  depositKey: bigint,
  block: number,
): Promise<bigint> {
  const res = await tryContractCall<unknown>(
    effectCall,
    bridge,
    BRIDGE_DEPOSITS_SIG,
    "deposits",
    [depositKey],
    block,
  );
  if (res === null) return 0n;
  // Offline mocks return the treasuryFee scalar directly; viem decoding returns
  // a named-tuple object for this multi-output function.
  if (typeof res === "bigint") return res;
  const obj = res as { treasuryFee?: bigint };
  return obj.treasuryFee ?? 0n;
}

/** TBTCVault.optimisticMintingFeeDivisor() — returns 0n if reverted. */
export async function getOptimisticMintingFeeDivisor(
  effectCall: EffectCaller,
  vault: string,
): Promise<bigint> {
  const res = await tryContractCall<number | bigint>(
    effectCall,
    vault,
    VAULT_FEE_DIVISOR_SIG,
    "optimisticMintingFeeDivisor",
    [],
  );
  if (res === null) return 0n;
  return BigInt(res);
}
