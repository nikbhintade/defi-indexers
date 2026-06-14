/**
 * Test helper: assemble the nested EventEmitter `eventData` struct from
 * readable key->value maps, so the simulated EventLog1/EventLog2 params mirror
 * the on-chain EventUtils.EventLogData layout exactly. The shape matches
 * `.envio/types.d.ts` (items / arrayItems per solidity type).
 */
export type EventDataInput = {
  address?: Record<string, string>;
  addressArray?: Record<string, string[]>;
  uint?: Record<string, bigint>;
  uintArray?: Record<string, bigint[]>;
  int?: Record<string, bigint>;
  intArray?: Record<string, bigint[]>;
  bool?: Record<string, boolean>;
  bytes32?: Record<string, string>;
  bytes?: Record<string, string>;
  string?: Record<string, string>;
  stringArray?: Record<string, string[]>;
};

function items<V>(rec: Record<string, V> | undefined): { key: string; value: V }[] {
  if (!rec) return [];
  return Object.entries(rec).map(([key, value]) => ({ key, value }));
}

function arrayItems<V>(rec: Record<string, V[]> | undefined): { key: string; value: V[] }[] {
  if (!rec) return [];
  return Object.entries(rec).map(([key, value]) => ({ key, value }));
}

export function buildEventData(input: EventDataInput) {
  return {
    addressItems: { items: items(input.address), arrayItems: arrayItems(input.addressArray) },
    uintItems: { items: items(input.uint), arrayItems: arrayItems(input.uintArray) },
    intItems: { items: items(input.int), arrayItems: arrayItems(input.intArray) },
    boolItems: { items: items(input.bool), arrayItems: [] as { key: string; value: boolean[] }[] },
    bytes32Items: { items: items(input.bytes32), arrayItems: [] as { key: string; value: string[] }[] },
    bytesItems: { items: items(input.bytes), arrayItems: [] as { key: string; value: string[] }[] },
    stringItems: { items: items(input.string), arrayItems: arrayItems(input.stringArray) },
    // The generated simulate type wants 0x-typed string values for address /
    // bytes fields; the runtime only reads `.key`/`.value` so a structural cast
    // keeps the fixtures readable without per-field hex literal annotations.
  } as never;
}
