/**
 * eth_call layer. Mirrors the subgraph's `Contract.bind(addr).try_foo()`
 * semantics: a reverted (or empty-data) call resolves to `null`.
 *
 * All calls go through a single `ethCall` Effect (cache: true) carrying raw
 * calldata, so every distinct (to, data, block) tuple is cached and re-runs
 * are deterministic. State reads are pinned to the event block; immutable
 * metadata (semantic version) is left unpinned.
 *
 * Offline tests install a declarative mock via LIDO_CALL_MOCK (same approach
 * as compound-v2's COMPOUND_V2_CALL_MOCK): the env var is JSON-serialized so
 * it crosses into envio's worker thread.
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

export const REVERTED = Symbol.for("lido.reverted");

export type MockResult =
  | { kind: "bigint"; value: string }
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "tuple"; value: unknown } // decoded tuple/array, JSON-friendly
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

export const CALL_MOCK_ENV = "LIDO_CALL_MOCK";

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

function reviveBigints(value: unknown): unknown {
  if (typeof value === "string" && /^-?\d+n$/.test(value)) {
    return BigInt(value.slice(0, -1));
  }
  if (Array.isArray(value)) return value.map(reviveBigints);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = reviveBigints(v);
    return out;
  }
  return value;
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
        return reviveBigints(result.value);
    }
  }
  if (spec.strict) {
    throw new Error(
      `unexpected eth_call: ${req.fn} on ${req.to} (${req.args
        .map(String)
        .join(",")})`
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
  async ({ input }) => rawEthCall(input)
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
 * When a mock is installed, calls resolve from it; the abi/calldata path is
 * skipped entirely so tests need no viem encoding.
 */
export async function tryContractCall<T>(
  effectCall: EffectCaller | null,
  to: string,
  signature: string,
  functionName: string,
  args: readonly unknown[],
  block?: number
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
  if (hex === null || hex === "0x") return null;
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

// ---- Typed wrappers mirroring the subgraph's contract reads ----

import {
  ACCOUNTING_ORACLE_ADDRESS,
  NOS_ADDRESS,
  SR_ADDRESS,
} from "./constants";

/** NodeOperatorsRegistry.getRewardsDistribution(totalRewardShares)
 * -> (address[] recipients, uint256[] shares, uint256 nosFee) */
export async function getRewardsDistribution(
  effectCall: EffectCaller,
  totalRewardShares: bigint,
  block: number,
  registry: string = NOS_ADDRESS
): Promise<{ recipients: string[]; shares: bigint[] } | null> {
  const res = await tryContractCall<
    readonly [readonly string[], readonly bigint[], bigint]
  >(
    effectCall,
    registry,
    "function getRewardsDistribution(uint256 _totalRewardShares) view returns (address[] recipients, uint256[] shares, uint256 nosFee)",
    "getRewardsDistribution",
    [totalRewardShares],
    block
  );
  if (!res) return null;
  return {
    recipients: res[0].map((a) => a.toLowerCase()),
    shares: res[1].slice(),
  };
}

/** StakingRouter.getStakingModules() -> StakingModule[] (we only need stakingModuleAddress) */
export async function getStakingModules(
  effectCall: EffectCaller,
  block: number,
  router: string = SR_ADDRESS
): Promise<string[] | null> {
  const res = await tryContractCall<
    readonly {
      stakingModuleAddress: string;
    }[]
  >(
    effectCall,
    router,
    "function getStakingModules() view returns ((uint24 id,address stakingModuleAddress,uint16 stakingModuleFee,uint16 treasuryFee,uint16 stakeShareLimit,uint8 status,string name,uint64 lastDepositAt,uint256 lastDepositBlock,uint256 exitedValidatorsCount,uint16 priorityExitShareThreshold,uint64 maxDepositsPerBlock,uint64 minDepositBlockDistance)[])",
    "getStakingModules",
    [],
    block
  );
  if (!res) return null;
  return res.map((m) => m.stakingModuleAddress.toLowerCase());
}

/** AccountingOracle.getLastProcessingRefSlot() -> uint256 */
export async function getLastProcessingRefSlot(
  effectCall: EffectCaller,
  block: number,
  oracle: string = ACCOUNTING_ORACLE_ADDRESS
): Promise<bigint | null> {
  return tryContractCall<bigint>(
    effectCall,
    oracle,
    "function getLastProcessingRefSlot() view returns (uint256)",
    "getLastProcessingRefSlot",
    [],
    block
  );
}

/** AppRepo.getLatestForContractAddress(addr) -> (semanticVersion uint16[3], ...) */
export async function getLatestSemanticVersion(
  effectCall: EffectCaller,
  repo: string,
  app: string
): Promise<[number, number, number] | null> {
  const res = await tryContractCall<
    readonly [readonly [number, number, number], string, string]
  >(
    effectCall,
    repo,
    "function getLatestForContractAddress(address _contractAddress) view returns (uint16[3] semanticVersion, address contractAddress, bytes contentURI)",
    "getLatestForContractAddress",
    [app as `0x${string}`]
  );
  if (!res) return null;
  return [Number(res[0][0]), Number(res[0][1]), Number(res[0][2])];
}

/** HashConsensus.getChainConfig() -> (slotsPerEpoch, secondsPerSlot, genesisTime) */
export async function getChainConfig(
  effectCall: EffectCaller,
  consensus: string,
  block: number
): Promise<{ slotsPerEpoch: bigint; secondsPerSlot: bigint; genesisTime: bigint } | null> {
  const res = await tryContractCall<readonly [bigint, bigint, bigint]>(
    effectCall,
    consensus,
    "function getChainConfig() view returns (uint256 slotsPerEpoch, uint256 secondsPerSlot, uint256 genesisTime)",
    "getChainConfig",
    [],
    block
  );
  if (!res) return null;
  return { slotsPerEpoch: res[0], secondsPerSlot: res[1], genesisTime: res[2] };
}

/** Lido.getTotalPooledEther() -> uint256 */
export async function getTotalPooledEther(
  effectCall: EffectCaller,
  lido: string,
  block: number
): Promise<bigint | null> {
  return tryContractCall<bigint>(
    effectCall,
    lido,
    "function getTotalPooledEther() view returns (uint256)",
    "getTotalPooledEther",
    [],
    block
  );
}
