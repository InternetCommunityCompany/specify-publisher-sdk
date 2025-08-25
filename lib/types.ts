export interface SpecifyInitConfig {
  publisherKey: string;
}

export enum ImageFormat {
  LANDSCAPE = "LANDSCAPE",
  SQUARE = "SQUARE",
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
