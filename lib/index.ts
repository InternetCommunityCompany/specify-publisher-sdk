import { APIError, AuthenticationError, ValidationError } from "./error";
import type { SpecifyAd, SpecifyInitConfig } from "./types";

type Address = `0x${string}`;

const API_BASE_URL = "https://app.specify.sh/api";

/**
 * Specify Publisher SDK client
 *
 * Provides access to publisher content based on end user wallet address.
 */
export default class Specify {
  // Publisher key used for authentication
  private readonly publisherKey: string;

  /**
   * Creates a new Specify client instance
   *
   * @param config - Configuration object containing publisherKey
   * @throws {AuthenticationError} When publisher key format is invalid
   */
  constructor(config: SpecifyInitConfig) {
    if (!this.validatePublisherKey(config.publisherKey)) {
      throw new AuthenticationError("Invalid API key format");
    }
    this.publisherKey = config.publisherKey;
  }

  /**
   * Validates the publisher key format
   *
   * @param key - Publisher key to validate
   * @returns True if the key is valid, false otherwise
   */
  private validatePublisherKey(key: string): boolean {
    return key.startsWith("spk_") && key.length === 34;
  }

  /**
   * Validates wallet address format
   *
   * @param address - Ethereum or EVM-compatible wallet address
   * @returns True if the address is valid, false otherwise
   */
  private validateAddress(address: Address): boolean {
    const addressRegex = /^0x[a-fA-F0-9]{40}$/;
    return addressRegex.test(address);
  }

  /**
   * Serves content to the specified wallet address
   *
   * @param address - Ethereum or EVM-compatible wallet address
   * @throws {ValidationError} When wallet address format is invalid
   * @returns Ad content for the specified wallet address or null if the ad is not found
   */
  public async serve(address: Address): Promise<SpecifyAd | null> {
    if (!this.validateAddress(address)) {
      throw new ValidationError("Invalid wallet address");
    }

    let response: Response;
    try {
      response = await fetch(`${API_BASE_URL}/ads`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.publisherKey,
        },
        body: JSON.stringify({ walletAddress: address }),
      });

      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }

        if (response.status === 401) {
          throw new AuthenticationError("Invalid API key");
        }

        throw new APIError(`HTTP error! status: ${response.status}`, response.status);
      }

      const data = await response.json();
      return data as SpecifyAd;
    } catch (error) {
      // If it's already an APIError (from our !response.ok check), just rethrow it
      if (error instanceof APIError) {
        throw error;
      }
      // For network errors or other fetch failures
      throw new APIError(
        `Failed to fetch ad content: ${error instanceof Error ? error.message : "Unknown error"}`,
        error instanceof Error && "status" in error ? (error as { status: number }).status : 0,
      );
    }
  }
}

// Export type definitions
export * from "./types";
// Export error classes
export * from "./error";
