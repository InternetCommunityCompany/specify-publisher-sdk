/**
 * Edge endpoint resolution.
 *
 * Serving lives on a neutral domain (`spfsrv.com`) rather than on the Specify
 * app domain. A neutral host is what lets the edge set a first-party-to-itself
 * identity cookie that is stable across every publisher site, so a credentialed
 * ad request can resolve an identity the page itself never saw.
 *
 * The shape is intentionally an endpoint *map*: the publisher SDK serves ads
 * from one path and the advertiser SDK posts funnel events to another, both on
 * the same base.
 */

/** Neutral serving domain. Overridable per-instance for local development. */
export const DEFAULT_EDGE_BASE_URL = "https://spfsrv.com";

export interface EdgeOverrides {
  /**
   * Override the edge origin, e.g. "http://localhost:3000". A trailing slash is
   * trimmed. Most integrators never need this.
   */
  baseUrl?: string;
}

export interface EndpointConfig {
  /** Ad decisioning endpoint. */
  ads: string;
  /** Funnel event ingest endpoint. */
  events: string;
}

/**
 * Resolve the concrete endpoint URLs for an edge deployment.
 *
 * @param overrides - Optional base URL override
 * @returns Fully-qualified endpoint URLs
 */
export function resolveEndpoints(overrides: EdgeOverrides = {}): EndpointConfig {
  const baseUrl = overrides.baseUrl?.trim() || DEFAULT_EDGE_BASE_URL;
  const base = baseUrl.replace(/\/+$/, "");
  return {
    ads: `${base}/api/ads`,
    events: `${base}/v1/events`,
  };
}
