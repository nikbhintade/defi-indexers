/**
 * eth_call layer for the Rocket Pool port. Mirrors the subgraph's
 * `Contract.bind(addr).foo()` calls. The original subgraph used non-`try_`
 * calls (so a revert would have halted the mapping); we mirror that by
 * surfacing a sentinel `null` on revert and letting the typed wrappers decide
 * the fallback. State reads are pinned to the event block.
 *
 * Pattern copied from lido/src/effects.ts. Offline tests install a declarative
 * mock via ROCKET_POOL_CALL_MOCK (JSON-serialized so it crosses into envio's
 * worker thread); when a mock is present the abi/calldata path is skipped.
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

export const REVERTED = Symbol.for("rocketpool.reverted");

export type MockResult =
  | { kind: "bigint"; value: string }
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "bool"; value: boolean }
  | { kind: "tuple"; value: unknown }
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

export const CALL_MOCK_ENV = "ROCKET_POOL_CALL_MOCK";

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
      case "bool":
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
// On revert these return the same default the AssemblyScript runtime would have
// produced if the (non-try_) call had succeeded with a zero/empty value; in
// practice these calls never reverted on mainnet for in-scope blocks.

const u = (sig: string) =>
  `function ${sig}`;

async function callUint(
  effectCall: EffectCaller,
  to: string,
  signature: string,
  functionName: string,
  args: readonly unknown[],
  block: number
): Promise<bigint> {
  const r = await tryContractCall<bigint>(
    effectCall,
    to,
    signature,
    functionName,
    args,
    block
  );
  return r === null ? 0n : r;
}

// rocketTokenRETH
export const getExchangeRate = (
  effectCall: EffectCaller,
  to: string,
  block: number
) =>
  callUint(
    effectCall,
    to,
    u("getExchangeRate() view returns (uint256)"),
    "getExchangeRate",
    [],
    block
  );

export const getTotalCollateral = (
  effectCall: EffectCaller,
  to: string,
  block: number
) =>
  callUint(
    effectCall,
    to,
    u("getTotalCollateral() view returns (uint256)"),
    "getTotalCollateral",
    [],
    block
  );

// rocketDepositPool
export const getDepositPoolBalance = (
  effectCall: EffectCaller,
  to: string,
  block: number
) =>
  callUint(
    effectCall,
    to,
    u("getBalance() view returns (uint256)"),
    "getBalance",
    [],
    block
  );

export const getDepositPoolExcessBalance = (
  effectCall: EffectCaller,
  to: string,
  block: number
) =>
  callUint(
    effectCall,
    to,
    u("getExcessBalance() view returns (uint256)"),
    "getExcessBalance",
    [],
    block
  );

// rocketNetworkPrices
export const getRPLPrice = (
  effectCall: EffectCaller,
  to: string,
  block: number
) =>
  callUint(
    effectCall,
    to,
    u("getRPLPrice() view returns (uint256)"),
    "getRPLPrice",
    [],
    block
  );

// rocketNodeStaking
export const getNodeRPLStake = (
  effectCall: EffectCaller,
  to: string,
  node: string,
  block: number
) =>
  callUint(
    effectCall,
    to,
    u("getNodeRPLStake(address) view returns (uint256)"),
    "getNodeRPLStake",
    [node as `0x${string}`],
    block
  );

export const getNodeEffectiveRPLStake = (
  effectCall: EffectCaller,
  to: string,
  node: string,
  block: number
) =>
  callUint(
    effectCall,
    to,
    u("getNodeEffectiveRPLStake(address) view returns (uint256)"),
    "getNodeEffectiveRPLStake",
    [node as `0x${string}`],
    block
  );

export const getNodeMinimumRPLStake = (
  effectCall: EffectCaller,
  to: string,
  node: string,
  block: number
) =>
  callUint(
    effectCall,
    to,
    u("getNodeMinimumRPLStake(address) view returns (uint256)"),
    "getNodeMinimumRPLStake",
    [node as `0x${string}`],
    block
  );

export const getNodeMaximumRPLStake = (
  effectCall: EffectCaller,
  to: string,
  node: string,
  block: number
) =>
  callUint(
    effectCall,
    to,
    u("getNodeMaximumRPLStake(address) view returns (uint256)"),
    "getNodeMaximumRPLStake",
    [node as `0x${string}`],
    block
  );

// rocketNetworkFees
export const getNodeFee = (
  effectCall: EffectCaller,
  to: string,
  block: number
) =>
  callUint(
    effectCall,
    to,
    u("getNodeFee() view returns (uint256)"),
    "getNodeFee",
    [],
    block
  );

// rocketDAOProtocolSettingsMinipool V1/V2
export const getHalfDepositNodeAmount = (
  effectCall: EffectCaller,
  to: string,
  block: number
) =>
  callUint(
    effectCall,
    to,
    u("getHalfDepositNodeAmount() view returns (uint256)"),
    "getHalfDepositNodeAmount",
    [],
    block
  );

// rocketDAOProtocolSettingsNode
export const getMinimumPerMinipoolStake = (
  effectCall: EffectCaller,
  to: string,
  block: number
) =>
  callUint(
    effectCall,
    to,
    u("getMinimumPerMinipoolStake() view returns (uint256)"),
    "getMinimumPerMinipoolStake",
    [],
    block
  );

export const getMaximumPerMinipoolStake = (
  effectCall: EffectCaller,
  to: string,
  block: number
) =>
  callUint(
    effectCall,
    to,
    u("getMaximumPerMinipoolStake() view returns (uint256)"),
    "getMaximumPerMinipoolStake",
    [],
    block
  );

// rocketNodeManager
export const getNodeTimezoneLocation = async (
  effectCall: EffectCaller,
  to: string,
  node: string,
  block: number
): Promise<string> => {
  const r = await tryContractCall<string>(
    effectCall,
    to,
    u("getNodeTimezoneLocation(address) view returns (string)"),
    "getNodeTimezoneLocation",
    [node as `0x${string}`],
    block
  );
  return r === null || r === "" ? "UNKNOWN" : r;
};

// rocketRewardsPool
export const getClaimIntervalTimeStart = (
  effectCall: EffectCaller,
  to: string,
  block: number
) =>
  callUint(
    effectCall,
    to,
    u("getClaimIntervalTimeStart() view returns (uint256)"),
    "getClaimIntervalTimeStart",
    [],
    block
  );

export const getClaimIntervalTime = (
  effectCall: EffectCaller,
  to: string,
  block: number
) =>
  callUint(
    effectCall,
    to,
    u("getClaimIntervalTime() view returns (uint256)"),
    "getClaimIntervalTime",
    [],
    block
  );

export const getClaimIntervalRewardsTotal = (
  effectCall: EffectCaller,
  to: string,
  block: number
) =>
  callUint(
    effectCall,
    to,
    u("getClaimIntervalRewardsTotal() view returns (uint256)"),
    "getClaimIntervalRewardsTotal",
    [],
    block
  );

export const getClaimingContractAllowance = (
  effectCall: EffectCaller,
  to: string,
  contractName: string,
  block: number
) =>
  callUint(
    effectCall,
    to,
    u("getClaimingContractAllowance(string) view returns (uint256)"),
    "getClaimingContractAllowance",
    [contractName],
    block
  );

// rocketDAONodeTrusted
export const getMemberIsValid = async (
  effectCall: EffectCaller,
  to: string,
  member: string,
  block: number
): Promise<boolean> => {
  const r = await tryContractCall<boolean>(
    effectCall,
    to,
    u("getMemberIsValid(address) view returns (bool)"),
    "getMemberIsValid",
    [member as `0x${string}`],
    block
  );
  return r === null ? false : r;
};
