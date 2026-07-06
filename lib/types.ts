import type { EndpointOverrides, Environment } from "./core/config";

export interface PrivacyConfig {
  /**
   * Disable the automatic, passive EIP-6963/1193 wallet detection layer.
   * Addresses passed explicitly to `serve()` still work when this is true.
   * @default false
   */
  disableWalletDetection?: boolean;
}

export interface SpecifyInitConfig {
  publisherKey: string;
  cacheMostRecentAddress?: boolean;
  /**
   * Deployment environment used to resolve edge endpoints.
   * @default "production"
   */
  environment?: Environment;
  /** Privacy controls for the identity layer. */
  privacy?: PrivacyConfig;
  /**
   * Advanced: override the identity edge base domain or individual endpoints.
   * Most integrators never need this.
   */
  edge?: EndpointOverrides;
}

export enum ImageFormat {
  LANDSCAPE = "LANDSCAPE",
  LONG_BANNER = "LONG_BANNER",
  SHORT_BANNER = "SHORT_BANNER",
  NO_IMAGE = "NO_IMAGE",
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
