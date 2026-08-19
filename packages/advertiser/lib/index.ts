import {
  type EndpointConfig,
  EventTransport,
  type SpecifyEvent,
  WalletDetector,
  getSessionId,
  isClient,
  resolveEndpoints,
} from "@specify-sh/core";
import { ValidationError } from "./error";
import type { Address, EventProps, SpecifyAnalyticsConfig } from "./types";

/** Identifies this SDK to the ingest endpoint. */
const SDK_NAME = "@specify-sh/advertiser";
const SDK_VERSION = "1.0.0";

/** Server-side cap on the wallet set attached to a single event. */
const MAX_WALLET_ADDRESSES = 50;

/** Event names are a closed character set so they stay queryable as columns. */
const EVENT_NAME_REGEX = /^[a-z0-9_]{1,64}$/;

/** Serialised `props` budget, matched to the edge's per-event limit. */
const MAX_PROPS_BYTES = 8192;

/**
 * How many pre-consent events are held in memory. Deep enough to keep a
 * realistic pre-banner funnel (landing page view, a wallet event, a couple of
 * interactions), shallow enough that a page which never consents cannot grow
 * this without bound.
 */
const MAX_BUFFERED_EVENTS = 20;

/** Click id parameter dropped on advertiser landing pages by Specify ads. */
const SPCLID_PARAM = "spclid";
const SPCLID_KEY = "__specify_spclid";

const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

function getSessionStorage(): Storage | undefined {
  try {
    if (isClient() && window.sessionStorage) {
      return window.sessionStorage;
    }
  } catch {
    // sessionStorage can throw in sandboxed iframes / privacy modes.
  }
  return undefined;
}

/**
 * Read `spclid` from the current query string.
 *
 * Falls back to parsing the full href because SPA shells and test doubles do
 * not always keep `location.search` in step with `location.href`.
 */
function readSpclidFromLocation(): string | null {
  try {
    const { href, search } = window.location;
    const query = search || new URL(href).search;
    const value = new URLSearchParams(query).get(SPCLID_PARAM);
    return value?.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Specify Advertiser SDK client.
 *
 * An optional analytics library advertisers add to their own site to see the
 * funnel a Specify campaign produced: saw the ad, visited, converted. Events
 * are used for funnel reporting only — Specify never bills on them, so there is
 * no allowlist of "billable" events and nothing here affects spend. Billing
 * stays entirely on-chain.
 *
 * Identity works exactly as it does in the Publisher SDK: consented requests
 * are sent credentialed, so the edge's server-only `spid` cookie rides along
 * and the backend can stitch a visit to an impression. The SDK never reads or
 * receives that cookie's value.
 */
export class SpecifyAnalytics {
  /** Advertiser property key used for authentication. */
  private readonly propertyKey: string;

  private readonly endpoints: EndpointConfig;

  private readonly transport: EventTransport;

  private readonly walletDetector: WalletDetector | null = null;

  /** Addresses supplied via {@link identify}, merged into every event. */
  private readonly identifiedAddresses = new Set<Address>();

  /**
   * Per-instance consent flag. Deliberately never persisted — see
   * {@link consentForEnhancedTracking}.
   */
  private enhancedTrackingConsent = false;

  /**
   * Events raised before consent was granted. Without the `spid` cookie the
   * backend has nothing to stitch a row to and would drop it, so sending
   * un-consented events would be pure noise; they wait here instead.
   */
  private pendingEvents: SpecifyEvent[] = [];

  /** Click id from the landing URL, attached to every event. */
  private spclid: string | null = null;

  /** Last URL a `page_view` was emitted for, to suppress duplicates. */
  private lastPageViewUrl: string | null = null;

  /** Whether the first wallet detection has already been reported. */
  private walletsReported = false;

  private unsubscribeWallets: (() => void) | null = null;

  private restoreHistory: (() => void) | null = null;

  private destroyed = false;

  /**
   * Creates a new Specify analytics client.
   *
   * Construction is the whole setup: it captures the click id, starts passive
   * wallet detection and records the first `page_view`. Nothing leaves the page
   * until {@link consentForEnhancedTracking} is called.
   *
   * @param config - SDK configuration object
   * @param config.propertyKey - Advertiser property key used for authentication
   * @param config.privacy - Privacy controls. Set `disableWalletDetection: true` to turn off automatic wallet detection.
   * @param config.edge - Advanced overrides for the Specify edge origin.
   * @throws {ValidationError} When the property key format is invalid
   */
  constructor(config: SpecifyAnalyticsConfig) {
    if (!this.validatePropertyKey(config.propertyKey)) {
      throw new ValidationError("Invalid property key format");
    }
    this.propertyKey = config.propertyKey;
    this.endpoints = resolveEndpoints(config.edge);

    this.transport = new EventTransport({
      endpoint: this.endpoints.events,
      headers: { "x-api-key": this.propertyKey },
      // The edge caps a request at 25 events; batching well below that leaves
      // room for the lifecycle flush to append without splitting a batch.
      maxBatchSize: 10,
      propertyId: this.propertyKey,
      sdk: { name: SDK_NAME, version: SDK_VERSION },
    });

    if (isClient() && !config.privacy?.disableWalletDetection) {
      // Passive, read-only discovery of wallets already connected to the page.
      // Never prompts: `eth_accounts` only, never `eth_requestAccounts`.
      this.walletDetector = new WalletDetector();
      this.unsubscribeWallets = this.walletDetector.onChange((addresses) => this.onWalletsChanged(addresses));
      this.walletDetector.start();
    }

    this.captureSpclid();
    this.patchHistory();
    this.capturePageView();
  }

  /**
   * Validates the advertiser property key format.
   *
   * @param key - Property key to validate
   * @returns True if the key is valid, false otherwise
   */
  private validatePropertyKey(key: string): boolean {
    return typeof key === "string" && key.startsWith("adv_") && key.length === 34;
  }

  /**
   * Validates wallet address format.
   *
   * @param address - Ethereum or EVM-compatible wallet address
   * @returns True if the address is valid, false otherwise
   */
  private validateAddress(address: Address): boolean {
    return ADDRESS_REGEX.test(address);
  }

  /**
   * Grant consent for enhanced tracking on this instance.
   *
   * This is what turns the SDK on. Without consent no event is ever sent: the
   * backend drops rows it cannot attach an identity to, so an un-consented
   * event would only add noise. With consent, events are posted credentialed so
   * the edge's server-only `spid` cookie is attached, and anything buffered
   * since page load is flushed in the order it happened.
   *
   * **Consent is never persisted by the SDK.** It lives only on this instance
   * for the lifetime of the page, so your Consent Management Platform must call
   * this on every page load where the user has consented. That keeps the CMP —
   * not the SDK — the single source of truth, and means a withdrawal in the CMP
   * takes effect on the very next page view.
   *
   * No-op outside the browser.
   */
  public consentForEnhancedTracking(): void {
    if (!isClient() || this.destroyed || this.enhancedTrackingConsent) {
      return;
    }
    this.enhancedTrackingConsent = true;

    const buffered = this.pendingEvents.splice(0, this.pendingEvents.length);
    for (const event of buffered) {
      this.transport.enqueue(event);
    }
  }

  /**
   * Withdraw enhanced tracking consent on this instance.
   *
   * Event capture stops immediately. Anything still buffered here, and anything
   * the transport has queued but not yet sent, is dropped rather than delivered
   * after the fact.
   */
  public revokeEnhancedTrackingConsent(): void {
    this.enhancedTrackingConsent = false;
    this.pendingEvents = [];
    this.transport.discard();
  }

  /**
   * Whether enhanced tracking consent is currently granted on this instance.
   *
   * @returns True when events will be captured and sent
   */
  public hasEnhancedTrackingConsent(): boolean {
    return this.enhancedTrackingConsent;
  }

  /**
   * The wallet addresses currently known to the SDK via passive detection.
   *
   * Returns an empty array when detection is disabled or when running outside a
   * browser. Wallets held by your own integration (WalletConnect sessions, for
   * example) are invisible to detection — pass those to {@link identify}.
   *
   * @returns Detected addresses, lowercased
   */
  public getDetectedWallets(): Address[] {
    return (this.walletDetector?.getAddresses() ?? []) as Address[];
  }

  /**
   * Register wallet address(es) known to your application so they are attached
   * to every subsequent event.
   *
   * Addresses accumulate; calling this repeatedly adds to the set rather than
   * replacing it. Stored lowercased. This does not itself emit an event.
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

    if (!addresses.every((address) => this.validateAddress(address))) {
      throw new ValidationError("Invalid wallet address format");
    }

    for (const address of addresses) {
      this.identifiedAddresses.add(address.toLowerCase() as Address);
    }
  }

  /**
   * Record a funnel event.
   *
   * Events are analytics only. They never bill, never affect campaign spend and
   * are not verified against an allowlist — send whatever milestones make your
   * funnel legible.
   *
   * @param name - Event name, lowercase `a-z0-9_`, up to 64 characters
   * @param props - Optional JSON-serialisable properties, up to 8KB serialised
   * @throws {ValidationError} When the name or props are malformed or oversized
   */
  public logEvent(name: string, props?: EventProps): void {
    if (typeof name !== "string" || !EVENT_NAME_REGEX.test(name)) {
      throw new ValidationError("Invalid event name: expected 1-64 characters matching /^[a-z0-9_]+$/");
    }

    const validated = this.validateProps(props);
    this.raise(name, validated);
  }

  /**
   * Release SDK resources: flush anything consented and still queued, stop
   * wallet detection, restore the patched history methods and drop all state.
   *
   * Call this when tearing down a single-page-app view that created a client.
   * The instance should not be reused afterwards.
   */
  public destroy(): void {
    this.destroyed = true;
    this.unsubscribeWallets?.();
    this.unsubscribeWallets = null;
    this.walletDetector?.stop();
    this.restoreHistory?.();
    this.restoreHistory = null;
    // Flushes whatever the transport still holds, then detaches its listeners.
    this.transport.destroy();
    this.pendingEvents = [];
    this.identifiedAddresses.clear();
    this.enhancedTrackingConsent = false;
    this.lastPageViewUrl = null;
  }

  /**
   * Validate optional event properties and return the object to send.
   *
   * @param props - Caller-supplied properties
   * @returns The properties, or an empty object when none were given
   */
  private validateProps(props?: EventProps): EventProps {
    if (props === undefined || props === null) {
      return {};
    }
    if (typeof props !== "object" || Array.isArray(props)) {
      throw new ValidationError("Invalid event props: expected a plain object");
    }

    let serialized: string;
    try {
      serialized = JSON.stringify(props);
    } catch {
      // Circular references and BigInt values both land here.
      throw new ValidationError("Invalid event props: value is not JSON-serialisable");
    }

    if (new TextEncoder().encode(serialized).length > MAX_PROPS_BYTES) {
      throw new ValidationError(`Event props exceed the ${MAX_PROPS_BYTES} byte limit`);
    }

    return props;
  }

  /**
   * Build the event envelope and either send it or hold it until consent.
   *
   * @param name - Event name
   * @param props - Already-validated event properties
   */
  private raise(name: string, props: EventProps): void {
    if (this.destroyed) {
      return;
    }

    const event = this.buildEvent(name, props);

    if (!this.enhancedTrackingConsent) {
      this.pendingEvents.push(event);
      if (this.pendingEvents.length > MAX_BUFFERED_EVENTS) {
        // Drop the oldest: the events closest to the consent moment are the
        // ones most likely to still matter to the funnel.
        this.pendingEvents.shift();
      }
      return;
    }

    this.transport.enqueue(event);
  }

  /**
   * Assemble the wire envelope for an event.
   *
   * @param name - Event name
   * @param props - Event properties
   * @returns The full event as the ingest endpoint expects it
   */
  private buildEvent(name: string, props: EventProps): SpecifyEvent {
    return {
      name,
      page: this.getPage(),
      props,
      session_id: getSessionId(),
      spclid: this.spclid,
      ts: new Date().toISOString(),
      wallets: this.getWallets(),
    };
  }

  /** Current page context; empty strings outside the browser. */
  private getPage(): { url: string; referrer: string } {
    if (!isClient()) {
      return { referrer: "", url: "" };
    }
    return { referrer: document.referrer ?? "", url: window.location.href };
  }

  /**
   * The merged wallet set attached to events: addresses passed to
   * {@link identify} first, then passively detected ones, deduplicated and
   * capped so a wallet-heavy browser cannot blow up the payload.
   */
  private getWallets(): string[] {
    const merged = new Set<string>();
    for (const address of [...this.identifiedAddresses, ...this.getDetectedWallets()]) {
      merged.add(address.toLowerCase());
    }
    return [...merged].slice(0, MAX_WALLET_ADDRESSES);
  }

  /**
   * Capture the `spclid` click id.
   *
   * A Specify ad click lands on the advertiser's site with `?spclid=…`. It is
   * stashed in `sessionStorage` so it survives the rest of the visit, including
   * navigations that drop the query string, and is attached to every event so
   * the backend can join a conversion back to the click that produced it.
   */
  private captureSpclid(): void {
    if (!isClient()) {
      return;
    }

    const storage = getSessionStorage();
    const fromUrl = readSpclidFromLocation();

    if (fromUrl) {
      this.spclid = fromUrl;
      try {
        storage?.setItem(SPCLID_KEY, fromUrl);
      } catch {
        // Ignore write failures; the in-memory value covers this page.
      }
      return;
    }

    try {
      this.spclid = storage?.getItem(SPCLID_KEY) ?? null;
    } catch {
      this.spclid = null;
    }
  }

  /**
   * Emit a `page_view`, unless the URL has not actually changed.
   *
   * SPA routers fire `replaceState` for things that are not navigations at all
   * (syncing a query param, restoring scroll), so the URL — not the call — is
   * what counts as a page view.
   */
  private capturePageView(): void {
    if (!isClient()) {
      return;
    }
    const url = window.location.href;
    if (url === this.lastPageViewUrl) {
      return;
    }
    this.lastPageViewUrl = url;
    this.raise("page_view", {});
  }

  /**
   * Wrap `history.pushState` / `history.replaceState` and listen for
   * `popstate`, so client-side route changes are captured as page views.
   *
   * The wrappers call through to the originals first and never swallow their
   * return value, so a router that inspects the result is unaffected.
   */
  private patchHistory(): void {
    if (!isClient()) {
      return;
    }

    const history = window.history;
    const originalPushState = history?.pushState;
    const originalReplaceState = history?.replaceState;
    if (typeof originalPushState !== "function" || typeof originalReplaceState !== "function") {
      return;
    }

    const onPopState = () => this.capturePageView();

    const patchedPushState = (...args: Parameters<History["pushState"]>) => {
      const result = originalPushState.apply(history, args);
      this.capturePageView();
      return result;
    };
    const patchedReplaceState = (...args: Parameters<History["replaceState"]>) => {
      const result = originalReplaceState.apply(history, args);
      this.capturePageView();
      return result;
    };

    history.pushState = patchedPushState;
    history.replaceState = patchedReplaceState;
    window.addEventListener("popstate", onPopState);

    this.restoreHistory = () => {
      // Only unwrap our own wrappers: another library may have patched on top
      // of us since, and restoring blindly would erase its wrapper.
      if (history.pushState === patchedPushState) {
        history.pushState = originalPushState;
      }
      if (history.replaceState === patchedReplaceState) {
        history.replaceState = originalReplaceState;
      }
      window.removeEventListener("popstate", onPopState);
    };
  }

  /**
   * Report a wallet detection change: the first snapshot is `wallet_detected`,
   * every later one is `wallet_changed`.
   *
   * @param addresses - Full address snapshot from the detector
   */
  private onWalletsChanged(addresses: string[]): void {
    if (this.walletsReported) {
      this.raise("wallet_changed", { addresses });
      return;
    }
    this.walletsReported = true;
    this.raise("wallet_detected", { addresses });
  }
}

export default SpecifyAnalytics;

// Export type definitions
export * from "./types";
// Export error classes
export * from "./error";
