import { describe, expect, it } from "bun:test";
import Specify, { AuthenticationError, ValidationError } from "../lib";
import { VALID_MOCK_PUBLISHER_KEY, VALID_MOCK_WALLET_ADDRESS } from "./consts";

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
    });
  });

  describe("serve", () => {
    it("should return content for valid wallet address", async () => {
      const specify = new Specify({
        publisherKey: VALID_MOCK_PUBLISHER_KEY,
      });

      const content = await specify.serve(VALID_MOCK_WALLET_ADDRESS);

      // TODO: Add more specific assertions once the API returns actual content
      expect(content).toBeDefined();
      expect(content).toHaveProperty("headline");
      expect(content).toHaveProperty("content");
      expect(content).toHaveProperty("image");
    });

    it("should throw ValidationError for invalid wallet address", async () => {
      const specify = new Specify({
        publisherKey: VALID_MOCK_PUBLISHER_KEY,
      });

      await expect(specify.serve("invalid_address" as `0x${string}`)).rejects.toThrow(ValidationError);
      await expect(specify.serve("0xinvalid" as `0x${string}`)).rejects.toThrow(ValidationError);
    });
  });
});
