/**
 * `@specify-sh/core` — internal plumbing shared by the Specify SDKs.
 *
 * Private and never published: it is bundled into each publishable package's
 * `dist` output. Nothing here is part of a public API surface, so it can change
 * without a semver bump on the consuming packages.
 */

export { DEFAULT_EDGE_BASE_URL, type EdgeOverrides, type EndpointConfig, resolveEndpoints } from "./config";
export { isClient } from "./env";
export { getSessionId, resetSessionId } from "./session";
export { EventTransport, type SpecifyEvent, type TransportOptions } from "./transport";
export { uuidv7 } from "./uuid";
export {
  type Eip1193Provider,
  type Eip6963ProviderDetail,
  normalizeAddresses,
  type WalletChangeListener,
  WalletDetector,
} from "./wallet";
