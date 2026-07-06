/**
 * Edge endpoint resolution for the Specify identity layer.
 *
 * Prototype: all endpoints are paths on the existing app (`app.specify.sh/api`),
 * so cross-site works via a `SameSite=None` cookie on that host with no new
 * infrastructure. When the dedicated edge domain (`spfy-net.com`) ships, point
 * `edge.baseUrl` at it — nothing else changes. See docs/identity-graph.md §8.
 */

export type Environment = "production" | "staging";

export interface EndpointConfig {
  /** Ad decisioning endpoint. */
  ads: string;
  /** Identity sync endpoint (mints/refreshes the `spid` cookie). */
  sync: string;
  /** Event ingest endpoint. */
  events: string;
}

export interface EndpointOverrides {
  /** Override the API base URL, e.g. "https://ads.spfy-net.com/v1". */
  baseUrl?: string;
  /** Fully override individual endpoints (takes precedence over baseUrl). */
  endpoints?: Partial<EndpointConfig>;
}

const DEFAULT_BASE_URL: Record<Environment, string> = {
  production: "https://app.specify.sh/api",
  staging: "https://staging.specify.sh/api",
};

function buildEndpoints(baseUrl: string): EndpointConfig {
  const base = baseUrl.replace(/\/$/, "");
  return {
    ads: `${base}/ads`,
    sync: `${base}/sync`,
    events: `${base}/events`,
  };
}

export function resolveEndpoints(
  environment: Environment = "production",
  overrides: EndpointOverrides = {},
): EndpointConfig {
  const baseUrl = overrides.baseUrl ?? DEFAULT_BASE_URL[environment];
  return { ...buildEndpoints(baseUrl), ...overrides.endpoints };
}
