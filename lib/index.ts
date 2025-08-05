import { APIError, AuthenticationError, NotFoundError, ValidationError } from "./error";
import type { APIErrorResponse, Address, SpecifyAd, SpecifyInitConfig } from "./types";

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
   * Validates an array of wallet addresses
   *
   * @param addresses - Array of Ethereum or EVM-compatible wallet addresses
   * @returns True if all addresses are valid, false otherwise
   */
  private validateAddresses(addresses: Address[]): boolean {
    return addresses.every((address) => this.validateAddress(address));
  }

  /**
   * Serves content to the specified wallet address(es)
   *
   * @param addressOrAddresses - Single wallet address or array of wallet addresses
   * @throws {ValidationError} When wallet address format is invalid
   * @throws {NotFoundError} When no ad is found for the address(es)
   * @returns Ad content for the specified wallet address or null if the ad is not found
   */
  public async serve(addressOrAddresses: Address | Address[]): Promise<SpecifyAd | null> {
    const addresses = Array.isArray(addressOrAddresses) ? addressOrAddresses : [addressOrAddresses];

    // Validate all addresses
    if (!this.validateAddresses(addresses)) {
      throw new ValidationError("Invalid wallet address format");
    }

    // Deduplicate addresses
    const uniqueAddresses = [...new Set(addresses)];

    // Check limits
    if (uniqueAddresses.length === 0) {
      throw new ValidationError("At least one wallet address is required");
    }

    if (uniqueAddresses.length > 50) {
      throw new ValidationError("Maximum 50 wallet addresses allowed");
    }

    let response: Response;
    try {
      response = await fetch(`${API_BASE_URL}/ads`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.publisherKey,
        },
        body: JSON.stringify({ walletAddresses: uniqueAddresses }),
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new NotFoundError();
        }

        if (response.status === 401) {
          throw new AuthenticationError("Invalid API key");
        }

        if (response.status === 400) {
          const errorData: APIErrorResponse = await response.json();
          throw new ValidationError(errorData.error || "Invalid request", errorData.details);
        }

        throw new APIError(`HTTP error! status: ${response.status}`, response.status);
      }

      const data = await response.json();
      return data as SpecifyAd;
    } catch (error) {
      // If it's already one of our custom errors, just rethrow it
      if (
        error instanceof APIError ||
        error instanceof AuthenticationError ||
        error instanceof ValidationError ||
        error instanceof NotFoundError
      ) {
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
