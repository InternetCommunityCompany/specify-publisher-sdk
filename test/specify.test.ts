import { describe, expect, it } from "bun:test";
import Specify, { APIError, AuthenticationError, ValidationError, ImageFormat } from "../lib";
import { VALID_MOCK_PUBLISHER_KEY, VALID_MOCK_WALLET_ADDRESS } from "./consts";
import { setupMockFetch } from "./helpers";

interface MockSpecifyAd {
  walletAddress?: string;
  campaignId?: string;
  adId?: string;
  headline?: string;
  content?: string;
  imageId?: string;
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
        imageId: "bored1234",
        ctaUrl: "https://boredapeyachtclub.com/collection",
        ctaLabel: "Mint Now",
        communityName: "Outposts",
        communityLogo: "https://outpostscdn.com/file/outposts/8b44e98c-6753-4d00-91a7-811347bf0888/logos/bbafcd7b-e52c-4e4f-8764-8f45187825f6"
      };

      setupMockFetch<MockSpecifyAd>(mockResponse);

      const content = await specify.serve(VALID_MOCK_WALLET_ADDRESS, ImageFormat.LANDSCAPE);

      expect(content).toBeDefined();
      expect(content).toHaveProperty("walletAddress", VALID_MOCK_WALLET_ADDRESS);
      expect(content).toHaveProperty("campaignId", "abcd1234567");
      expect(content).toHaveProperty("adId", "A");
      expect(content).toHaveProperty("headline", "Bored Ape Yacht Club Collection");
      expect(content).toHaveProperty("content", "Join the club with the hottest NFTs in the metaverse.");
      expect(content).toHaveProperty("imageId", "bored1234");
      expect(content).toHaveProperty("ctaUrl", "https://boredapeyachtclub.com/collection");
      expect(content).toHaveProperty("ctaLabel", "Mint Now");
    });

    it("should throw ValidationError for invalid wallet address", async () => {
      const specify = new Specify({
        publisherKey: VALID_MOCK_PUBLISHER_KEY,
      });

      await expect(specify.serve("invalid_address" as `0x${string}`, ImageFormat.LANDSCAPE)).rejects.toThrow(
        ValidationError,
      );
      await expect(specify.serve("0xinvalid" as `0x${string}`, ImageFormat.LANDSCAPE)).rejects.toThrow(ValidationError);
    });

    it("should expect null when ad is not found", async () => {
      const specify = new Specify({
        publisherKey: VALID_MOCK_PUBLISHER_KEY,
      });

      setupMockFetch<MockSpecifyAd>({ error: "Not Found" }, 404);

      await expect(specify.serve(VALID_MOCK_WALLET_ADDRESS, ImageFormat.LANDSCAPE)).resolves.toBeNull();
    });

    it("should throw APIError with status code for HTTP errors", async () => {
      const specify = new Specify({
        publisherKey: VALID_MOCK_PUBLISHER_KEY,
      });

      setupMockFetch<MockSpecifyAd>({ error: "Internal Server Error" }, 500);

      const error = await specify.serve(VALID_MOCK_WALLET_ADDRESS, ImageFormat.LANDSCAPE).catch((e) => e);
      expect(error).toBeInstanceOf(APIError);
      expect(error.status).toBe(500);
    });

    it("should throw APIError for network errors", async () => {
      const specify = new Specify({
        publisherKey: VALID_MOCK_PUBLISHER_KEY,
      });

      setupMockFetch<MockSpecifyAd>({ error: "Network error" }, 0);

      await expect(specify.serve(VALID_MOCK_WALLET_ADDRESS, ImageFormat.LANDSCAPE)).rejects.toThrow(APIError);
    });

    it("should return content when imageFormat is provided", async () => {
      const specify = new Specify({
        publisherKey: VALID_MOCK_PUBLISHER_KEY,
      });

      const mockResponse = {
        walletAddress: VALID_MOCK_WALLET_ADDRESS,
        campaignId: "abcd1234567",
        adId: "A",
        headline: "Test Ad with Square Format",
        content: "Test content for square image",
        imageId: "square123",
        ctaUrl: "https://example.com",
        ctaLabel: "Click Here",
      };

      setupMockFetch<MockSpecifyAd>(mockResponse);

      const content = await specify.serve(VALID_MOCK_WALLET_ADDRESS, ImageFormat.SQUARE);

      expect(content).toBeDefined();
      expect(content).toHaveProperty("walletAddress", VALID_MOCK_WALLET_ADDRESS);
      expect(content).toHaveProperty("headline", "Test Ad with Square Format");
    });

    it("should work with different image formats", async () => {
      const specify = new Specify({
        publisherKey: VALID_MOCK_PUBLISHER_KEY,
      });

      // Test each image format
      const imageFormats = [
        ImageFormat.LANDSCAPE,
        ImageFormat.SQUARE,
        ImageFormat.LONG_BANNER,
        ImageFormat.SHORT_BANNER,
        ImageFormat.NO_IMAGE,
      ];

      for (const format of imageFormats) {
        const mockResponse = {
          walletAddress: VALID_MOCK_WALLET_ADDRESS,
          campaignId: "abcd1234567",
          adId: "A",
          headline: `Test Ad with ${format}`,
          content: `Test content for ${format.toLowerCase()}`,
          imageId: `${format.toLowerCase()}123`,
          ctaUrl: "https://example.com",
          ctaLabel: "Click Here",
        };

        setupMockFetch<MockSpecifyAd>(mockResponse);

        const content = await specify.serve(VALID_MOCK_WALLET_ADDRESS, format);

        expect(content).toBeDefined();
        expect(content).toHaveProperty("headline", `Test Ad with ${format}`);
        expect(content).toHaveProperty("walletAddress", VALID_MOCK_WALLET_ADDRESS);
      }
    });
  });
});
