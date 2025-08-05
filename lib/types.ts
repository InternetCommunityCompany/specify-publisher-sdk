export interface SpecifyInitConfig {
  publisherKey: string;
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
}

export interface APIErrorResponse {
  error: string;
  details?: Array<{
    field: string;
    message: string;
  }>;
}

export type Address = `0x${string}`;
