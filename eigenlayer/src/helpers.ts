/** Shared helpers for the EigenLayer core port. */

/** Lowercase an address/hex string (subgraph + sidecar store lowercase). */
export const low = (x: string): string => x.toLowerCase();

/** Event-record entity id: txHash-logIndex (lowercase tx hash). */
export const eventId = (txHash: string, logIndex: number): string =>
  `${txHash.toLowerCase()}-${logIndex}`;

/** Native beacon-chain ETH "strategy" sentinel (sidecar stakerShares.go). */
export const NATIVE_ETH_STRATEGY =
  "0xbeac0eeeeeeeeeeeeeeeeeeeeeeeeeeeeeebeac0";

/** AVSDirectory OperatorAVSRegistrationStatusUpdated status enum. */
export const AVS_REGISTRATION_STATUS_REGISTERED = 1;
