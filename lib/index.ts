import { APIError, AuthenticationError, NotFoundError, ValidationError } from "./error";
import { getStoredWalletAddresses, setStoredWalletAddresses } from "./storage";
import type { APIErrorResponse, Address, ImageFormat, SpecifyAd, SpecifyInitConfig } from "./types";
import { isClient } from "./utils";

const API_BASE_URL = "https://app.specify.sh/api";

interface ServeOptions {
  imageFormat: ImageFormat;
  adUnitId?: string;
}

/**
 * Specify Publisher SDK client
 *
 * Provides access to publisher content based on end user wallet address.
 */
export default class Specify {
  // Publisher key used for authentication
  private readonly publisherKey: string;
  private readonly cacheAddressesInLocalSession: boolean;

  /**
   * Creates a new Specify client instance
   *
   * @param config - SDK configuration object
   * @param config.publisherKey - Publisher key used for authentication
   * @param config.cacheAddressesInLocalSession - Whether to cache wallet addresses across requests in the browser's local session. Only available in browser environments. Defaults to false.
   * @throws {ValidationError} When publisher key format is invalid
   */
  constructor(config: SpecifyInitConfig) {
    if (!this.validatePublisherKey(config.publisherKey)) {
      throw new ValidationError("Invalid publisher key format");
    }
    this.publisherKey = config.publisherKey;
    this.cacheAddressesInLocalSession = config.cacheAddressesInLocalSession ?? false;
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
   * @param addressOrAddresses - Single wallet address, array of wallet addresses. Also accepts an empty array, or undefined if relying solely on SDK memory
   * @param options - Configuration options containing imageFormat and optional adUnitId
   * @param options.imageFormat - The desired image format for the ad
   * @param options.adUnitId - arbitrary string id to identify where the ad is being displayed
   * @throws {ValidationError} When wallet address format is invalid
   * @returns Ad content for the specified wallet address or null if the ad is not found
   */
  public async serve(
    addressOrAddresses: Address | Address[] | undefined,
    options: ServeOptions,
  ): Promise<SpecifyAd | null> {
    const providedAddresses: Address[] = Array.isArray(addressOrAddresses)
      ? addressOrAddresses
      : addressOrAddresses
        ? [addressOrAddresses]
        : [];

    let allAddressesToServe: Address[];
    let storedAddresses: Address[] = []; // Initialize here

    if (isClient && this.cacheAddressesInLocalSession) {
      storedAddresses = (await getStoredWalletAddresses()) || [];
      // Merge provided addresses with stored addresses
      allAddressesToServe = [...new Set([...providedAddresses, ...storedAddresses])];

      // Cap the addresses at 50 before storing to prevent continuous failures
      const addressesToStore = allAddressesToServe.slice(0, 50);

      // Update stored addresses for future calls
      await setStoredWalletAddresses(addressesToStore);
    } else {
      allAddressesToServe = providedAddresses;
    }

    // Validate all addresses
    if (!this.validateAddresses(allAddressesToServe)) {
      throw new ValidationError("Invalid wallet address format");
    }

    // Deduplicate addresses
    const uniqueAddresses = [...new Set(allAddressesToServe)];

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
        body: JSON.stringify({
          walletAddresses: uniqueAddresses,
          imageFormat: options.imageFormat,
          adUnitId: options.adUnitId,
        }),
      });

      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }

        if (response.status === 401) {
          throw new AuthenticationError("Invalid Publisher key");
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
