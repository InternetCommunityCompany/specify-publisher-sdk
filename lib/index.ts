import { AuthenticationError, ValidationError } from "./error";
import type { SpecifyInitConfig } from "./types";

/**
 * Specify Publisher SDK client
 *
 * Provides access to publisher content based on end user wallet address.
 */
export default class Specify {
  // Publisher API key used for authentication
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
    return key.startsWith("spk_") && key.length === 32;
  }

  /**
   * Validates wallet address format
   *
   * @param address - Ethereum or EVM-compatible wallet address
   * @returns True if the address is valid, false otherwise
   */
  private validateAddress(address: `0x${string}`): boolean {
    const addressRegex = /^0x[a-fA-F0-9]{40}$/;
    return addressRegex.test(address);
  }

  /**
   * Serves content to the specified wallet address
   *
   * @param address - Ethereum or EVM-compatible wallet address
   * @throws {ValidationError} When wallet address format is invalid
   * @returns Ad content for the specified wallet address
   */
  public async serve(address: `0x${string}`) {
    if (!this.validateAddress(address)) {
      throw new ValidationError("Invalid wallet address");
    }

    // TODO: Implement the API call to the Specify publisher API
    console.log("Using publisher key:", this.publisherKey); // TODO: Remove this, added for avoiding linting error

    // TODO: Replace with actual API response
    return {
      headline: "Sample Headline",
      content: "This is some sample content",
      image: "https://specify.sh/sample.jpg",
    };
  }
}

// Export type definitions
export * from "./types";
// Export error classes
export * from "./error";
