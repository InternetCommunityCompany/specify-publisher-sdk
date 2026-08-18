export interface PrivacyConfig {
  /**
   * Disable the automatic, passive EIP-6963/EIP-1193 wallet detection layer.
   * Addresses passed explicitly to `serve()` or `identify()` still work when
   * this is `true`.
   *
   * @default false
   */
  disableWalletDetection?: boolean;
}

export interface EdgeConfig {
  /**
   * Advanced: override the edge origin that ad requests are sent to, e.g.
   * "http://localhost:3000" for local development. A trailing slash is trimmed.
   * Defaults to the Specify edge, `https://spfsrv.com`.
   */
  baseUrl?: string;
}

export interface SpecifyInitConfig {
  /** Publisher key used for authentication. Format: `spk_` + 30 characters. */
  publisherKey: string;
  /**
   * Cache the most recent wallet data across requests using the browser's
   * `localStorage`. Only meaningful in browser environments.
   *
   * @default false
   */
  cacheMostRecentAddress?: boolean;
  /** Privacy controls for the identity layer. */
  privacy?: PrivacyConfig;
  /** Advanced: override the edge origin. Most integrators never need this. */
  edge?: EdgeConfig;
}

export enum ImageFormat {
  LANDSCAPE = "LANDSCAPE",
  LONG_BANNER = "LONG_BANNER",
  SHORT_BANNER = "SHORT_BANNER",
  NO_IMAGE = "NO_IMAGE",
}

export interface ServeOptions {
  /** The desired image format for the ad. */
  imageFormat: ImageFormat;
  /** Arbitrary string id identifying where the ad is being displayed. */
  adUnitId?: string;
}

export interface SpecifyAd {
  walletAddress: string;
  campaignId: string;
  adId: string;
  headline: string;
  content: string;
  ctaUrl: string;
  ctaLabel: string;
  imageUrl: string;
  communityName: string;
  communityLogo: string;
  imageFormat: keyof typeof ImageFormat;
  adUnitId?: string;
}

export interface APIErrorResponse {
  error: string;
  details?: Array<{
    field: string;
    message: string;
  }>;
}

export type Address = `0x${string}`;
