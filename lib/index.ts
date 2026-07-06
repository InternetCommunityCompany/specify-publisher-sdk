import { type EndpointConfig, resolveEndpoints } from "./core/config";
import { getSessionId } from "./core/session";
import { EventTransport } from "./core/transport";
import { WalletDetector } from "./core/wallet";
import { APIError, AuthenticationError, NotFoundError, ValidationError } from "./error";
import { getLocalId, removeLocalId, setLocalId } from "./storage";
import type { APIErrorResponse, Address, ImageFormat, SpecifyAd, SpecifyInitConfig } from "./types";
import { isClient } from "./utils";

const SDK_NAME = "publisher";
const SDK_VERSION = "0.5.0";

const WALLET_CACHE_VOID = "WALLET_CACHE_VOID";

interface ServeOptions {
  imageFormat: ImageFormat;
  adUnitId?: string;
}

interface ServeResponse extends SpecifyAd {
  localId: string;
}

/**
 * Specify Publisher SDK client
 *
 * Provides access to publisher content based on end user wallet address.
 *
 * v2 (identity layer): ad requests are credentialed so the server-only `spid`
 * cookie rides along and the ad server can resolve `spid -> wallet` from the
 * network identity graph — letting a wallet-targeted ad serve even when the page
 * has no connected wallet. The SDK also performs passive, read-only wallet
 * detection to seed that graph; it can be disabled via
 * `privacy.disableWalletDetection`. The SDK never sees the `spid` value.
 */
export default class Specify {
  // Publisher key used for authentication
  private readonly publisherKey: string;

  private readonly cacheMostRecentAddress: boolean;

  private readonly endpoints: EndpointConfig;

  private readonly walletDetector: WalletDetector | null = null;

  private transport: EventTransport | null = null;

  // True once an ad request has fired; gates the accountsChanged beacon so we
  // only send a wallet update after the initial ad request.
  private adRequestFired = false;

  /**
   * Creates a new Specify client instance
   *
   * @param config - SDK configuration object
   * @param config.publisherKey - Publisher key used for authentication
   * @param config.cacheMostRecentAddress - Whether to cache wallet addresses across requests in the browser's local session. Only available in browser environments. Defaults to false.
   * @param config.environment - Deployment environment used to resolve edge endpoints. Defaults to "production".
   * @param config.privacy - Privacy controls. Set `disableWalletDetection: true` to turn off automatic wallet detection.
   * @param config.edge - Advanced overrides for the identity edge endpoints.
   * @throws {ValidationError} When publisher key format is invalid
   */
  constructor(config: SpecifyInitConfig) {
    if (!this.validatePublisherKey(config.publisherKey)) {
      throw new ValidationError("Invalid publisher key format");
    }
    this.publisherKey = config.publisherKey;
    this.cacheMostRecentAddress = config.cacheMostRecentAddress ?? false;
    this.endpoints = resolveEndpoints(config.environment ?? "production", config.edge);

    if (isClient() && !config.privacy?.disableWalletDetection) {
      // Passive, read-only wallet detection to seed the identity graph. The
      // `spid` cookie itself is set/refreshed by the credentialed ad request, so
      // no separate sync ping is needed on publisher pages.
      this.walletDetector = new WalletDetector();
      this.walletDetector.onChange((addresses) => this.onWalletsChanged(addresses));
      this.walletDetector.start();
    }
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
   * The wallet addresses currently known to the SDK via passive detection.
   *
   * Note: there is deliberately no `setWalletAddresses()` on the publisher SDK.
   * If your integration holds the connected address (e.g. WalletConnect), pass
   * it straight to {@link serve} — that both targets the ad and seeds the graph.
   */
  public getDetectedWallets(): Address[] {
    return (this.walletDetector?.getAddresses() ?? []) as Address[];
  }

  private onWalletsChanged(_addresses: string[]): void {
    // Only beacon after the first ad request; before that, the addresses will
    // ride on the ad request itself.
    if (this.adRequestFired) {
      this.sendWalletBeacon(this.getDetectedWallets());
    }
  }

  private getTransport(): EventTransport | null {
    if (!isClient()) {
      return null;
    }
    if (!this.transport) {
      this.transport = new EventTransport({
        endpoint: this.endpoints.events,
        propertyId: this.publisherKey,
        sdk: { name: SDK_NAME, version: SDK_VERSION },
      });
    }
    return this.transport;
  }

  private sendWalletBeacon(wallets: Address[]): void {
    if (wallets.length === 0) {
      return;
    }
    const transport = this.getTransport();
    if (!transport) {
      return;
    }
    transport.enqueue({
      name: "wallet_detected",
      ts: new Date().toISOString(),
      session_id: getSessionId(),
      spclid: null,
      wallets,
      page: {
        url: isClient() ? window.location.href : "",
        referrer: isClient() ? document.referrer : "",
      },
      props: {},
    });
  }

  /**
   * Serves content to the specified wallet address(es)
   *
   * With the identity layer, the request is credentialed and always fires in the
   * browser — even with no wallet — so the ad server can resolve a wallet from
   * the `spid` cookie. It returns `null` only when nothing (passed wallet,
   * cached wallet, or graph lookup) resolves to an ad.
   *
   * @param addressOrAddresses - Single wallet address, array of wallet addresses, an empty array, or `undefined` to rely on passively detected wallets and the identity cookie.
   * @param options - Configuration options containing imageFormat and optional adUnitId
   * @param options.imageFormat - The desired image format for the ad
   * @param options.adUnitId - arbitrary string id to identify where the ad is being displayed
   * @throws {ValidationError} When wallet address format is invalid
   * @returns Ad content, or null if no ad is found
   */
  public async serve(
    addressOrAddresses: Address | Address[] | undefined | null,
    options: ServeOptions,
  ): Promise<SpecifyAd | null> {
    const providedAddresses: Address[] = Array.isArray(addressOrAddresses)
      ? addressOrAddresses
      : addressOrAddresses
        ? [addressOrAddresses]
        : [];

    // Validate all explicitly-provided addresses
    if (!this.validateAddresses(providedAddresses)) {
      throw new ValidationError("Invalid wallet address format");
    }

    // Merge caller-provided addresses with passively detected wallets, then
    // deduplicate. Detected wallets are already validated.
    const uniqueAddresses = [...new Set<Address>([...providedAddresses, ...this.getDetectedWallets()])];

    let localId = null;

    if (this.cacheMostRecentAddress) {
      localId = getLocalId();
    }

    if (uniqueAddresses.length > 50) {
      throw new ValidationError("Maximum 50 wallet addresses allowed");
    }

    // Outside the browser there is no `spid` cookie to resolve, so with no
    // wallet and no cache there is nothing to serve — skip the request.
    if (uniqueAddresses.length === 0 && !localId && !isClient()) {
      return null;
    }

    let response: Response;
    try {
      response = await fetch(this.endpoints.ads, {
        method: "POST",
        // Credentialed so the server-only `spid` cookie rides along and the ad
        // server can resolve `spid -> wallet` for graph-targeted serving.
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.publisherKey,
        },
        body: JSON.stringify({
          walletAddresses: uniqueAddresses,
          imageFormat: options.imageFormat,
          adUnitId: options.adUnitId,
          localId,
        }),
      });

      // From here on, a wallet observed mid-session should be beaconed.
      this.adRequestFired = true;

      if (!response.ok) {
        if (response.status === 404) {
          const errorData: ServeResponse = await response.json();
          if (errorData.localId === WALLET_CACHE_VOID) {
            removeLocalId();
          } else if (errorData.localId) {
            setLocalId(errorData.localId);
          }
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

      const data: ServeResponse = await response.json();

      // Store the localId returned by the API
      if (this.cacheMostRecentAddress && data.localId && data.localId !== WALLET_CACHE_VOID) {
        setLocalId(data.localId);
      }

      // Ensure the returned data conforms to SpecifyAd, excluding the localId for the public interface
      const { localId: returnedLocalId, ...adData } = data;
      return adData as SpecifyAd;
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

  /**
   * Release SDK resources: stop wallet detection and flush/detach the event
   * transport. Call this when tearing down a single-page-app view that created
   * a client, to avoid leaking listeners.
   */
  public destroy(): void {
    this.walletDetector?.stop();
    this.transport?.destroy();
    this.transport = null;
  }
}

// Export type definitions
export * from "./types";
// Export error classes
export * from "./error";
