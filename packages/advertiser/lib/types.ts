export interface PrivacyConfig {
  /**
   * Disable the automatic, passive EIP-6963/EIP-1193 wallet detection layer.
   * Addresses passed to `identify()` still work when this is `true`, and the
   * `wallet_detected` / `wallet_changed` events stop being captured.
   *
   * @default false
   */
  disableWalletDetection?: boolean;
}

export interface EdgeConfig {
  /**
   * Advanced: override the edge origin that events are sent to, e.g.
   * "http://localhost:3000" for local development. A trailing slash is trimmed.
   * Defaults to the Specify edge, `https://spfsrv.com`.
   */
  baseUrl?: string;
}

export interface SpecifyAnalyticsConfig {
  /** Advertiser property key. Format: `adv_` + 30 characters. */
  propertyKey: string;
  /** Privacy controls for the identity layer. */
  privacy?: PrivacyConfig;
  /** Advanced: override the edge origin. Most integrators never need this. */
  edge?: EdgeConfig;
}

/** Arbitrary, JSON-serialisable properties attached to an event. */
export type EventProps = Record<string, unknown>;

export type Address = `0x${string}`;
