import { describe, expect, it } from "bun:test";
import Specify, { APIError, AuthenticationError, ValidationError, NotFoundError } from "../lib";
import { VALID_MOCK_PUBLISHER_KEY, VALID_MOCK_WALLET_ADDRESS } from "./consts";
import { setupMockFetch } from "./helpers";

interface MockSpecifyAd {
  walletAddress?: string;
  campaignId?: string;
  adId?: string;
  headline?: string;
  content?: string;
  imageUrl?: string;
  ctaUrl?: string;
  ctaLabel?: string;
  error?: string;
  communityName?: string;
  communityLogo?: string;
}

describe("Specify", () => {
  describe("constructor", () => {
    it("should initialize with valid publisher key", () => {
      const specify = new Specify({
        publisherKey: VALID_MOCK_PUBLISHER_KEY,
      });
      expect(specify).toBeInstanceOf(Specify);
    });

    it("should throw AuthenticationError with invalid publisher key", () => {
      expect(() => {
        new Specify({
          publisherKey: "invalid_key",
        });
      }).toThrow(AuthenticationError);

      expect(() => {
        new Specify({
          publisherKey: "spk_short",
        });
      }).toThrow(AuthenticationError);

      expect(() => {
        new Specify({
          publisherKey: `spk_${"a".repeat(31)}`, // Too long
        });
      }).toThrow(AuthenticationError);
    });
  });

  describe("serve", () => {
    it("should return content for valid wallet address", async () => {
      const specify = new Specify({
        publisherKey: VALID_MOCK_PUBLISHER_KEY,
      });

      const mockResponse = {
        walletAddress: VALID_MOCK_WALLET_ADDRESS,
        campaignId: "abcd1234567",
        adId: "A",
        headline: "Bored Ape Yacht Club Collection",
        content: "Join the club with the hottest NFTs in the metaverse.",
        imageUrl: "https://example.com/image.jpg",
        ctaUrl: "https://boredapeyachtclub.com/collection",
        ctaLabel: "Mint Now",
        communityName: "Outposts",
        communityLogo:
          "https://outpostscdn.com/file/outposts/8b44e98c-6753-4d00-91a7-811347bf0888/logos/bbafcd7b-e52c-4e4f-8764-8f45187825f6",
      };

      setupMockFetch<MockSpecifyAd>(mockResponse);

      const content = await specify.serve(VALID_MOCK_WALLET_ADDRESS);

      expect(content).toBeDefined();
      expect(content).toHaveProperty("walletAddress", VALID_MOCK_WALLET_ADDRESS);
      expect(content).toHaveProperty("campaignId", "abcd1234567");
      expect(content).toHaveProperty("adId", "A");
      expect(content).toHaveProperty("headline", "Bored Ape Yacht Club Collection");
      expect(content).toHaveProperty("content", "Join the club with the hottest NFTs in the metaverse.");
      expect(content).toHaveProperty("imageUrl", "https://example.com/image.jpg");
      expect(content).toHaveProperty("ctaUrl", "https://boredapeyachtclub.com/collection");
      expect(content).toHaveProperty("ctaLabel", "Mint Now");
      expect(content).toHaveProperty("communityName", "Outposts");
      expect(content).toHaveProperty(
        "communityLogo",
        "https://outpostscdn.com/file/outposts/8b44e98c-6753-4d00-91a7-811347bf0888/logos/bbafcd7b-e52c-4e4f-8764-8f45187825f6",
      );
    });

    it("should return content for array of wallet addresses", async () => {
      const specify = new Specify({
        publisherKey: VALID_MOCK_PUBLISHER_KEY,
      });

      const mockResponse = {
        walletAddress: VALID_MOCK_WALLET_ADDRESS,
        campaignId: "abcd1234567",
        adId: "A",
        headline: "Bored Ape Yacht Club Collection",
        content: "Join the club with the hottest NFTs in the metaverse.",
        imageUrl: "https://example.com/image.jpg",
        ctaUrl: "https://boredapeyachtclub.com/collection",
        ctaLabel: "Mint Now",
        communityName: "Outposts",
        communityLogo:
          "https://outpostscdn.com/file/outposts/8b44e98c-6753-4d00-91a7-811347bf0888/logos/bbafcd7b-e52c-4e4f-8764-8f45187825f6",
      };

      setupMockFetch<MockSpecifyAd>(mockResponse);

      const content = await specify.serve([VALID_MOCK_WALLET_ADDRESS]);

      expect(content).toBeDefined();
      expect(content).toHaveProperty("walletAddress", VALID_MOCK_WALLET_ADDRESS);
    });

    it("should deduplicate addresses in array", async () => {
      const specify = new Specify({
        publisherKey: VALID_MOCK_PUBLISHER_KEY,
      });

      const mockResponse = {
        walletAddress: VALID_MOCK_WALLET_ADDRESS,
        campaignId: "abcd1234567",
        adId: "A",
        headline: "Bored Ape Yacht Club Collection",
        content: "Join the club with the hottest NFTs in the metaverse.",
        imageUrl: "https://example.com/image.jpg",
        ctaUrl: "https://boredapeyachtclub.com/collection",
        ctaLabel: "Mint Now",
        communityName: "Outposts",
        communityLogo:
          "https://outpostscdn.com/file/outposts/8b44e98c-6753-4d00-91a7-811347bf0888/logos/bbafcd7b-e52c-4e4f-8764-8f45187825f6",
      };

      setupMockFetch<MockSpecifyAd>(mockResponse);

      // Pass the same address multiple times
      const content = await specify.serve([VALID_MOCK_WALLET_ADDRESS, VALID_MOCK_WALLET_ADDRESS]);

      expect(content).toBeDefined();
      expect(content).toHaveProperty("walletAddress", VALID_MOCK_WALLET_ADDRESS);
    });

    it("should throw ValidationError for invalid wallet address", async () => {
      const specify = new Specify({
        publisherKey: VALID_MOCK_PUBLISHER_KEY,
      });

      await expect(specify.serve("invalid_address" as `0x${string}`)).rejects.toThrow(ValidationError);
      await expect(specify.serve("0xinvalid" as `0x${string}`)).rejects.toThrow(ValidationError);
    });

    it("should throw ValidationError for empty address array", async () => {
      const specify = new Specify({
        publisherKey: VALID_MOCK_PUBLISHER_KEY,
      });

      await expect(specify.serve([])).rejects.toThrow(ValidationError);
    });

    it("should throw ValidationError for too many addresses", async () => {
      const specify = new Specify({
        publisherKey: VALID_MOCK_PUBLISHER_KEY,
      });

      const manyAddresses = Array.from(
        { length: 51 },
        (_, i) => `0x${i.toString().padStart(40, "0")}` as `0x${string}`,
      );

      await expect(specify.serve(manyAddresses)).rejects.toThrow(ValidationError);
    });

    it("should throw NotFoundError when ad is not found", async () => {
      const specify = new Specify({
        publisherKey: VALID_MOCK_PUBLISHER_KEY,
      });

      setupMockFetch<MockSpecifyAd>({ error: "Not Found" }, 404);

      await expect(specify.serve(VALID_MOCK_WALLET_ADDRESS)).rejects.toThrow(NotFoundError);
    });

    it("should throw AuthenticationError for 401 status", async () => {
      const specify = new Specify({
        publisherKey: VALID_MOCK_PUBLISHER_KEY,
      });

      setupMockFetch<MockSpecifyAd>({ error: "Unauthorized" }, 401);

      await expect(specify.serve(VALID_MOCK_WALLET_ADDRESS)).rejects.toThrow(AuthenticationError);
    });

    it("should throw ValidationError for 400 status with details", async () => {
      const specify = new Specify({
        publisherKey: VALID_MOCK_PUBLISHER_KEY,
      });

      const errorResponse = {
        error: "Invalid request",
        details: [{ field: "walletAddresses", message: "Invalid address format" }],
      };

      setupMockFetch<MockSpecifyAd>(errorResponse, 400);

      const error = await specify.serve(VALID_MOCK_WALLET_ADDRESS).catch((e) => e);
      expect(error).toBeInstanceOf(ValidationError);
      expect(error.details).toEqual(errorResponse.details);
    });

    it("should throw APIError with status code for HTTP errors", async () => {
      const specify = new Specify({
        publisherKey: VALID_MOCK_PUBLISHER_KEY,
      });

      setupMockFetch<MockSpecifyAd>({ error: "Internal Server Error" }, 500);

      const error = await specify.serve(VALID_MOCK_WALLET_ADDRESS).catch((e) => e);
      expect(error).toBeInstanceOf(APIError);
      expect(error.status).toBe(500);
    });

    it("should throw APIError for network errors", async () => {
      const specify = new Specify({
        publisherKey: VALID_MOCK_PUBLISHER_KEY,
      });

      setupMockFetch<MockSpecifyAd>({ error: "Network error" }, 0);

      await expect(specify.serve(VALID_MOCK_WALLET_ADDRESS)).rejects.toThrow(APIError);
    });
  });
});
