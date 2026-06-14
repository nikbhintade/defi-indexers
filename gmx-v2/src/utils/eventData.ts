/**
 * Port of the subgraph's `src/utils/eventData.ts` EventData accessor class.
 *
 * GMX V2's EventEmitter emits generic `EventLog`/`EventLog1`/`EventLog2` events
 * carrying a deeply-nested `eventData` tuple of (key,value) item arrays, one per
 * solidity type: addressItems/uintItems/intItems/boolItems/bytes32Items/
 * bytesItems/stringItems, each split into single `items` and `arrayItems`.
 *
 * envio decodes the tuple into a plain object (see `.envio/types.d.ts`), so the
 * accessor simply linearly scans the `items` arrays by key — byte-for-byte the
 * same lookup the AssemblyScript subgraph used.
 *
 * Address / bytes32 / bytes values arrive from envio as checksummed/0x hex
 * strings. The subgraph stored them lowercased (`Address.toHexString()` /
 * `Bytes.toHexString()` both lowercase), so the *String accessors lowercase.
 */

const ZERO_BYTES32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

type AddressItems = {
  readonly items: readonly { readonly key: string; readonly value: string }[];
  readonly arrayItems: readonly { readonly key: string; readonly value: readonly string[] }[];
};
type UintItems = {
  readonly items: readonly { readonly key: string; readonly value: bigint }[];
  readonly arrayItems: readonly { readonly key: string; readonly value: readonly bigint[] }[];
};
type BoolItems = {
  readonly items: readonly { readonly key: string; readonly value: boolean }[];
  readonly arrayItems: readonly { readonly key: string; readonly value: readonly boolean[] }[];
};
type StringItems = {
  readonly items: readonly { readonly key: string; readonly value: string }[];
  readonly arrayItems: readonly { readonly key: string; readonly value: readonly string[] }[];
};

export type RawEventData = {
  readonly addressItems: AddressItems;
  readonly uintItems: UintItems;
  readonly intItems: UintItems;
  readonly boolItems: BoolItems;
  readonly bytes32Items: StringItems;
  readonly bytesItems: StringItems;
  readonly stringItems: StringItems;
};

function lookup<V>(
  items: readonly { readonly key: string; readonly value: V }[],
  key: string,
): V | null {
  for (let i = 0; i < items.length; i++) {
    if (items[i]!.key === key) {
      return items[i]!.value;
    }
  }
  return null;
}

export const ZERO_BYTES_32 = ZERO_BYTES32;

export class EventData {
  constructor(public rawData: RawEventData) {}

  getAddressItem(key: string): string | null {
    const v = lookup(this.rawData.addressItems.items, key);
    return v === null ? null : v.toLowerCase();
  }

  // alias used by the subgraph (returns the lowercase hex string)
  getAddressItemString(key: string): string | null {
    return this.getAddressItem(key);
  }

  getAddressArrayItemString(key: string): string[] | null {
    const v = lookup(this.rawData.addressItems.arrayItems, key);
    if (v === null) return null;
    return v.map((a) => a.toLowerCase());
  }

  getStringItem(key: string): string | null {
    return lookup(this.rawData.stringItems.items, key);
  }

  getStringArrayItem(key: string): readonly string[] | null {
    return lookup(this.rawData.stringItems.arrayItems, key);
  }

  getUintItem(key: string): bigint | null {
    return lookup(this.rawData.uintItems.items, key);
  }

  getUintArrayItem(key: string): readonly bigint[] | null {
    return lookup(this.rawData.uintItems.arrayItems, key);
  }

  getIntItem(key: string): bigint | null {
    return lookup(this.rawData.intItems.items, key);
  }

  getIntArrayItem(key: string): readonly bigint[] | null {
    return lookup(this.rawData.intItems.arrayItems, key);
  }

  getBytesItem(key: string): string | null {
    const v = lookup(this.rawData.bytesItems.items, key);
    return v === null ? null : v.toLowerCase();
  }

  getBytes32Item(key: string): string | null {
    const v = lookup(this.rawData.bytes32Items.items, key);
    return v === null ? null : v.toLowerCase();
  }

  getBytes32ArrayItem(key: string): string[] | null {
    const v = lookup(this.rawData.bytes32Items.arrayItems, key);
    if (v === null) return null;
    return v.map((b) => b.toLowerCase());
  }

  // boolean type is not nullable in the subgraph: returns false if absent
  getBoolItem(key: string): boolean {
    const v = lookup(this.rawData.boolItems.items, key);
    return v === null ? false : v;
  }
}
