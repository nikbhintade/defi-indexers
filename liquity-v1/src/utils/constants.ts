/**
 * Ported from liquity/dev packages/subgraph/src/utils/constants.ts.
 */
export const ZERO_ADDRESS = "0x" + "0".repeat(40);

/** Addresses are delivered checksummed by HyperIndex; subgraphs store lowercase. */
export const a = (x: string): string => x.toLowerCase();
