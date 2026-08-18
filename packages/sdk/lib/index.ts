import { type EndpointConfig, WalletDetector, isClient, resolveEndpoints } from "@specify-sh/core";
import { APIError, AuthenticationError, NotFoundError, ValidationError } from "./error";
import { getLocalId, removeLocalId, setLocalId } from "./storage";
import type { APIErrorResponse, Address, ServeOptions, SpecifyAd, SpecifyInitConfig } from "./types";

/** Sentinel the edge returns when the cached `localId` no longer resolves. */
const WALLET_CACHE_VOID = "WALLET_CACHE_VOID";

/** Server-side cap on the wallet set attached to a single ad request. */
const MAX_WALLET_ADDRESSES = 50;

interface ServeResponse extends SpecifyAd {
  localId: string;
}

/**
 * Narrows the first `serve()` argument to the options-only overload.
 *
 * The two forms are distinguished purely by shape: an options object is a
 * non-null, non-array object carrying `imageFormat`. Strings, arrays, `null`
 * and `undefined` all mean the caller used the wallets-first form.
 */
function isServeOptions(value: unknown): value is ServeOptions {
  return typeof value === "object" && value !== null && !Array.isArray(value) && "imageFormat" in value;
}

/**
 * Specify Publisher SDK client
 *
 * Provides access to publisher content based on end user wallet address.
 *
 * v1 (identity layer): ad requests go to the Specify edge on a neutral domain
 * and are credentialed once the user has consented, so the server-only `spid`
 * identity cookie rides along and the ad server can resolve an identity the
 * page itself never saw. The SDK never reads or receives that cookie's value.
 * Passive, read-only wallet detection runs by default and can be turned off
 * with `privacy.disableWalletDetection`.
 */
export default class Specify {
  // Publisher key used for authentication
  private readonly publisherKey: string;

  private readonly cacheMostRecentAddress: boolean;

  private readonly endpoints: EndpointConfig;

  private readonly walletDetector: WalletDetector | null = null;

  /** Addresses supplied via {@link identify}, merged into every serve. */
  private readonly identifiedAddresses = new Set<Address>();

  /**
   * Per-instance consent flag. Deliberately never persisted — see
   * {@link consentForEnhancedTracking}.
   */
  private enhancedTrackingConsent = false;

  /**
   * Creates a new Specify client instance
   *
   * @param config - SDK configuration object
   * @param config.publisherKey - Publisher key used for authentication
   * @param config.cacheMostRecentAddress - Whether to cache wallet addresses across requests in the browser's local session. Only available in browser environments. Defaults to false.
   * @param config.privacy - Privacy controls. Set `disableWalletDetection: true` to turn off automatic wallet detection.
   * @param config.edge - Advanced overrides for the Specify edge origin.
   * @throws {ValidationError} When publisher key format is invalid
   */
  constructor(config: SpecifyInitConfig) {
    if (!this.validatePublisherKey(config.publisherKey)) {
      throw new ValidationError("Invalid publisher key format");
    }
    this.publisherKey = config.publisherKey;
    this.cacheMostRecentAddress = config.cacheMostRecentAddress ?? false;
    this.endpoints = resolveEndpoints(config.edge);

    if (isClient() && !config.privacy?.disableWalletDetection) {
      // Passive, read-only discovery of wallets already connected to the page.
      // Never prompts: `eth_accounts` only, never `eth_requestAccounts`.
      this.walletDetector = new WalletDetector();
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
   * Returns an empty array when detection is disabled or when running outside a
   * browser. Wallets held by your own integration (WalletConnect sessions, for
   * example) are invisible to detection — pass those to {@link identify} or
   * straight to {@link serve}.
   *
   * @returns Detected addresses, lowercased
   */
  public getDetectedWallets(): Address[] {
    return (this.walletDetector?.getAddresses() ?? []) as Address[];
  }

  /**
   * Grant consent for enhanced tracking on this instance.
   *
   * With consent, ad requests are sent credentialed so the edge's server-only
   * `spid` identity cookie is included. That is the entire mechanism: the SDK
   * never reads, writes or sees the cookie value.
   *
   * **Consent is never persisted by the SDK.** It lives only on this instance
   * for the lifetime of the page, so your Consent Management Platform must call
   * this on every page load where the user has consented. That keeps the CMP —
   * not the SDK — the single source of truth, and means a withdrawal in the CMP
   * takes effect on the very next page view.
   *
   * Ads serve with or without consent; consent only enables the cross-site
   * identity cookie. No-op outside the browser.
   */
  public consentForEnhancedTracking(): void {
    if (!isClient()) {
      return;
    }
    this.enhancedTrackingConsent = true;
  }

  /**
   * Withdraw enhanced tracking consent on this instance.
   *
   * Subsequent ad requests are sent with `credentials: "omit"`, so the identity
   * cookie is not attached. Ads continue to serve from wallet addresses alone.
   */
  public revokeEnhancedTrackingConsent(): void {
    this.enhancedTrackingConsent = false;
  }

  /**
   * Whether enhanced tracking consent is currently granted on this instance.
   *
   * @returns True when ad requests will be sent credentialed
   */
  public hasEnhancedTrackingConsent(): boolean {
    return this.enhancedTrackingConsent;
  }

  /**
   * Register wallet address(es) known to your application so they are merged
   * into every subsequent {@link serve} call.
   *
   * Use this when your app learns the user's address outside of a render — a
   * wallet connect callback, a session restore, a WalletConnect pairing — so
   * you do not have to thread the address down to each ad slot.
   *
   * Addresses accumulate; calling this repeatedly adds to the set rather than
   * replacing it. Stored lowercased.
   *
   * @param addressOrAddresses - Single wallet address or array of addresses
   * @throws {ValidationError} When any wallet address format is invalid
   */
  public identify(addressOrAddresses: Address | Address[]): void {
    const addresses: Address[] = Array.isArray(addressOrAddresses)
      ? addressOrAddresses
      : addressOrAddresses
        ? [addressOrAddresses]
        : [];

    if (!this.validateAddresses(addresses)) {
      throw new ValidationError("Invalid wallet address format");
    }

    for (const address of addresses) {
      this.identifiedAddresses.add(address.toLowerCase() as Address);
    }
  }

  /**
   * Merge the three address sources in priority order, deduplicating
   * case-insensitively while preserving each address as first seen.
   *
   * Explicit addresses come first so that when the merged set exceeds the
   * server's limit the extras dropped from the end are the inferred ones.
   */
  private mergeWalletAddresses(provided: Address[]): Address[] {
    const seen = new Set<string>();
    const merged: Address[] = [];

    for (const address of [...provided, ...this.identifiedAddresses, ...this.getDetectedWallets()]) {
      const key = address.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(address);
      }
    }

    return merged.slice(0, MAX_WALLET_ADDRESSES);
  }

  /**
   * Serves content using the wallet addresses the SDK already knows about
   * (those registered with {@link identify}, those detected passively, and the
   * cached `localId`), plus the identity cookie when consent has been granted.
   *
   * @param options - Configuration options containing imageFormat and optional adUnitId
   * @returns Ad content, or null if no ad is found
   */
  public serve(options: ServeOptions): Promise<SpecifyAd | null>;
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
  public serve(
    addressOrAddresses: Address | Address[] | undefined | null,
    options: ServeOptions,
  ): Promise<SpecifyAd | null>;
  public async serve(
    addressesOrOptions: Address | Address[] | ServeOptions | undefined | null,
    maybeOptions?: ServeOptions,
  ): Promise<SpecifyAd | null> {
    const optionsFirst = isServeOptions(addressesOrOptions);
    const options = optionsFirst ? addressesOrOptions : maybeOptions;
    const addressOrAddresses = optionsFirst
      ? undefined
      : (addressesOrOptions as Address | Address[] | undefined | null);

    if (!options) {
      throw new ValidationError("Serve options are required");
    }

    const providedAddresses: Address[] = Array.isArray(addressOrAddresses)
      ? addressOrAddresses
      : addressOrAddresses
        ? [addressOrAddresses]
        : [];

    // Validate all explicitly-provided addresses
    if (!this.validateAddresses(providedAddresses)) {
      throw new ValidationError("Invalid wallet address format");
    }

    // Only what the caller passed can push the request over the limit; inferred
    // addresses are dropped instead of throwing (see mergeWalletAddresses).
    if (new Set(providedAddresses).size > MAX_WALLET_ADDRESSES) {
      throw new ValidationError("Maximum 50 wallet addresses allowed");
    }

    const uniqueAddresses = this.mergeWalletAddresses(providedAddresses);

    let localId = null;

    if (this.cacheMostRecentAddress) {
      localId = getLocalId();
    }

    // With no wallet and no cached id there is nothing to target on — unless we
    // are in a consenting browser, where the identity cookie may still resolve
    // an audience server-side. Everywhere else, skip the network call entirely.
    const hasNoLocalSignal = uniqueAddresses.length === 0 && !localId;
    if (hasNoLocalSignal && !(isClient() && this.enhancedTrackingConsent)) {
      return null;
    }

    // The identity cookie is attached by the browser only on credentialed
    // requests. This flag is the whole opt-in mechanism.
    const credentials: RequestCredentials = isClient() && this.enhancedTrackingConsent ? "include" : "omit";

    let response: Response;
    try {
      response = await fetch(this.endpoints.ads, {
        method: "POST",
        credentials,
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
          // A walletless request is speculative: we sent it hoping the identity
          // cookie resolves an audience. The edge's schema still requires at
          // least one address, so it answers 400 until that relaxes. Treating
          // it as a no-fill keeps a consenting, wallet-free page view quiet.
          // A 400 on a request that carried wallets is a real integration bug
          // and still throws.
          if (uniqueAddresses.length === 0) {
            return null;
          }
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
   * Release SDK resources: stop wallet detection and detach its listeners.
   *
   * Call this when tearing down a single-page-app view that created a client,
   * to avoid leaking listeners. The instance should not be reused afterwards.
   */
  public destroy(): void {
    this.walletDetector?.stop();
    this.identifiedAddresses.clear();
    this.enhancedTrackingConsent = false;
  }
}

// Export type definitions
export * from "./types";
// Export error classes
export * from "./error";
