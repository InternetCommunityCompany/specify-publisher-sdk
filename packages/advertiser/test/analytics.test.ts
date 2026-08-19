import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resetSessionId } from "@specify-sh/core";
import { SpecifyAnalytics, ValidationError } from "../lib";
import type { Address } from "../lib/types";
import {
  type BrowserStub,
  DEFAULT_URL,
  announceProviderOnRequest,
  createStubProvider,
  flush,
  installBrowser,
  uninstallBrowser,
} from "./browser";
import { EVENTS_ENDPOINT, VALID_MOCK_PROPERTY_KEY, VALID_MOCK_WALLET_ADDRESS } from "./consts";
import {
  getBatch,
  getFetchCalls,
  getLastFetchCall,
  getSentEventNames,
  getSentEvents,
  resetFetchCalls,
  restoreFetch,
  setupMockFetch,
} from "./helpers";

const OTHER_ADDRESS = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as Address;
const DETECTED_ADDRESS = "0x1111111111111111111111111111111111111111";

function newAnalytics(overrides: Partial<ConstructorParameters<typeof SpecifyAnalytics>[0]> = {}): SpecifyAnalytics {
  return new SpecifyAnalytics({
    privacy: { disableWalletDetection: true },
    propertyKey: VALID_MOCK_PROPERTY_KEY,
    ...overrides,
  });
}

describe("SpecifyAnalytics", () => {
  let browser: BrowserStub;

  /**
   * Force the transport to send without tearing the instance down: batches
   * otherwise wait for 10 events or the 5s age timer.
   */
  function flushTransport(): void {
    browser.setVisibility("hidden");
    browser.setVisibility("visible");
  }

  beforeEach(() => {
    browser = installBrowser();
    resetSessionId();
    resetFetchCalls();
    setupMockFetch();
  });

  afterEach(() => {
    uninstallBrowser();
    restoreFetch();
  });

  describe("construction", () => {
    it("rejects a property key with the wrong prefix or length", () => {
      expect(() => newAnalytics({ propertyKey: "spk_1234567890abcdef1234567890abcd" })).toThrow(ValidationError);
      expect(() => newAnalytics({ propertyKey: "adv_short" })).toThrow(ValidationError);
      expect(() => newAnalytics({ propertyKey: "adv_1234567890abcdef1234567890abcdef" })).toThrow(ValidationError);
      expect(() => newAnalytics({ propertyKey: "" })).toThrow(ValidationError);
    });

    it("accepts a well-formed adv_ key", () => {
      expect(() => newAnalytics()).not.toThrow();
    });

    it("constructs outside the browser without touching the page", () => {
      uninstallBrowser();
      const analytics = newAnalytics();

      expect(analytics.hasEnhancedTrackingConsent()).toBe(false);
      expect(analytics.getDetectedWallets()).toEqual([]);
      analytics.destroy();
      expect(getFetchCalls()).toHaveLength(0);
    });
  });

  describe("consent", () => {
    it("starts unconsented and never persists consent", () => {
      const analytics = newAnalytics();
      expect(analytics.hasEnhancedTrackingConsent()).toBe(false);

      analytics.consentForEnhancedTracking();

      expect(analytics.hasEnhancedTrackingConsent()).toBe(true);
      expect(browser.localStorage.__entries.size).toBe(0);
      // Only the session id and click id ever reach sessionStorage.
      expect([...browser.sessionStorage.__entries.keys()]).not.toContain("__specify_consent");
      // A fresh instance on the same page starts unconsented: the CMP is the
      // only source of truth and must call consent on every page load.
      const fresh = newAnalytics();
      expect(fresh.hasEnhancedTrackingConsent()).toBe(false);

      analytics.destroy();
      fresh.destroy();
    });

    it("is a no-op outside the browser", () => {
      uninstallBrowser();
      const analytics = newAnalytics();

      analytics.consentForEnhancedTracking();

      expect(analytics.hasEnhancedTrackingConsent()).toBe(false);
    });

    it("reports revocation", () => {
      const analytics = newAnalytics();
      analytics.consentForEnhancedTracking();

      analytics.revokeEnhancedTrackingConsent();

      expect(analytics.hasEnhancedTrackingConsent()).toBe(false);
    });
  });

  describe("pre-consent buffering", () => {
    it("sends nothing at all before consent", () => {
      const analytics = newAnalytics();
      analytics.logEvent("signup_started");
      flushTransport();

      expect(getFetchCalls()).toHaveLength(0);
      analytics.destroy();
      expect(getFetchCalls()).toHaveLength(0);
    });

    it("flushes buffered events in order once consent arrives", () => {
      const analytics = newAnalytics();
      analytics.logEvent("signup_started");
      analytics.logEvent("signup_completed", { plan: "pro" });

      analytics.consentForEnhancedTracking();
      flushTransport();

      // The constructor's page_view was buffered first and stays first.
      expect(getSentEventNames()).toEqual(["page_view", "signup_started", "signup_completed"]);
      expect(getSentEvents()[2].props).toEqual({ plan: "pro" });
    });

    it("sends later events straight through once consented", () => {
      const analytics = newAnalytics();
      analytics.consentForEnhancedTracking();
      analytics.logEvent("checkout_started");
      flushTransport();

      expect(getSentEventNames()).toEqual(["page_view", "checkout_started"]);
    });

    it("drops the oldest event beyond a 20-event buffer", () => {
      const analytics = newAnalytics();
      // The constructor already buffered page_view, so 20 more overflow it.
      for (let i = 0; i < 20; i++) {
        analytics.logEvent(`event_${i}`);
      }

      analytics.consentForEnhancedTracking();
      flushTransport();

      const names = getSentEventNames();
      expect(names).toHaveLength(20);
      expect(names).not.toContain("page_view");
      expect(names[0]).toBe("event_0");
      expect(names[19]).toBe("event_19");
    });

    it("stops sending and clears everything on revocation", () => {
      const analytics = newAnalytics();
      analytics.consentForEnhancedTracking();
      analytics.logEvent("checkout_started");

      // Nothing has been flushed yet — the batch is still open.
      analytics.revokeEnhancedTrackingConsent();
      flushTransport();
      expect(getFetchCalls()).toHaveLength(0);

      // Capture goes back to the pre-consent behaviour: buffered, never sent.
      analytics.logEvent("checkout_completed");
      flushTransport();
      expect(getFetchCalls()).toHaveLength(0);

      // Re-consenting releases what was buffered since, but must not resurrect
      // the events dropped at revocation.
      analytics.consentForEnhancedTracking();
      flushTransport();
      expect(getSentEventNames()).toEqual(["checkout_completed"]);
    });
  });

  describe("page_view capture", () => {
    it("records a page view on construction", () => {
      const analytics = newAnalytics();
      analytics.consentForEnhancedTracking();
      flushTransport();

      expect(getSentEventNames()).toEqual(["page_view"]);
      expect(getSentEvents()[0].page.url).toBe(DEFAULT_URL);
    });

    it("records pushState, replaceState and popstate route changes", () => {
      const analytics = newAnalytics();
      analytics.consentForEnhancedTracking();

      browser.window.history.pushState({}, "", "/pricing");
      browser.window.history.replaceState({}, "", "/pricing?tab=annual");
      browser.popTo("/checkout");
      flushTransport();

      expect(getSentEventNames()).toEqual(["page_view", "page_view", "page_view", "page_view"]);
      expect(getSentEvents().map((event) => event.page.url)).toEqual([
        DEFAULT_URL,
        "https://advertiser.example/pricing",
        "https://advertiser.example/pricing?tab=annual",
        "https://advertiser.example/checkout",
      ]);
    });

    it("ignores history calls that do not change the URL", () => {
      const analytics = newAnalytics();
      analytics.consentForEnhancedTracking();

      // Routers replaceState constantly to sync scroll and state.
      browser.window.history.replaceState({ scroll: 1 }, "", DEFAULT_URL);
      browser.window.history.replaceState({ scroll: 2 }, "", DEFAULT_URL);
      browser.window.history.pushState({}, "", "/pricing");
      browser.window.history.pushState({}, "", "/pricing");
      flushTransport();

      expect(getSentEventNames()).toEqual(["page_view", "page_view"]);
    });

    it("calls through to the original history methods", () => {
      const analytics = newAnalytics();

      browser.window.history.pushState({}, "", "/pricing");

      expect(browser.window.location.href).toBe("https://advertiser.example/pricing");
      analytics.destroy();
    });

    it("restores the patched history methods on destroy", () => {
      const analytics = newAnalytics();
      analytics.consentForEnhancedTracking();
      const patchedPushState = browser.window.history.pushState;

      analytics.destroy();
      resetFetchCalls();

      expect(browser.window.history.pushState).not.toBe(patchedPushState);

      browser.window.history.pushState({}, "", "/pricing");
      browser.popTo("/checkout");
      flushTransport();

      expect(getFetchCalls()).toHaveLength(0);
      expect(browser.window.location.href).toBe("https://advertiser.example/checkout");
    });
  });

  describe("spclid", () => {
    it("captures the click id from the landing query and persists it", () => {
      browser = installBrowser("https://advertiser.example/landing?spclid=click-123&utm_source=specify");
      const analytics = newAnalytics();
      analytics.consentForEnhancedTracking();
      flushTransport();

      expect(browser.sessionStorage.getItem("__specify_spclid")).toBe("click-123");
      expect(getSentEvents()[0].spclid).toBe("click-123");
    });

    it("reuses the stored click id once the query string is gone", () => {
      browser.sessionStorage.setItem("__specify_spclid", "click-123");
      const analytics = newAnalytics();
      analytics.consentForEnhancedTracking();
      flushTransport();

      expect(getSentEvents()[0].spclid).toBe("click-123");
    });

    it("is null when there has never been a click id", () => {
      const analytics = newAnalytics();
      analytics.consentForEnhancedTracking();
      flushTransport();

      expect(getSentEvents()[0].spclid).toBeNull();
      expect(browser.sessionStorage.getItem("__specify_spclid")).toBeNull();
    });

    it("a newer click id overwrites the stored one", () => {
      browser = installBrowser("https://advertiser.example/landing?spclid=click-456");
      browser.sessionStorage.setItem("__specify_spclid", "click-123");
      const analytics = newAnalytics();
      analytics.consentForEnhancedTracking();
      flushTransport();

      expect(browser.sessionStorage.getItem("__specify_spclid")).toBe("click-456");
      expect(getSentEvents()[0].spclid).toBe("click-456");
    });
  });

  describe("logEvent validation", () => {
    it("rejects names outside /^[a-z0-9_]{1,64}$/", () => {
      const analytics = newAnalytics();

      expect(() => analytics.logEvent("Signup")).toThrow(ValidationError);
      expect(() => analytics.logEvent("signup-completed")).toThrow(ValidationError);
      expect(() => analytics.logEvent("signup completed")).toThrow(ValidationError);
      expect(() => analytics.logEvent("")).toThrow(ValidationError);
      expect(() => analytics.logEvent("a".repeat(65))).toThrow(ValidationError);
    });

    it("accepts a name at the length limit", () => {
      const analytics = newAnalytics();

      expect(() => analytics.logEvent("a".repeat(64))).not.toThrow();
      expect(() => analytics.logEvent("signup_completed_2")).not.toThrow();
    });

    it("rejects props that are not a plain object", () => {
      const analytics = newAnalytics();

      expect(() => analytics.logEvent("signup_completed", [1, 2, 3] as unknown as Record<string, unknown>)).toThrow(
        ValidationError,
      );
      expect(() => analytics.logEvent("signup_completed", "pro" as unknown as Record<string, unknown>)).toThrow(
        ValidationError,
      );
    });

    it("rejects props over 8KB serialised", () => {
      const analytics = newAnalytics();

      expect(() => analytics.logEvent("signup_completed", { blob: "x".repeat(8192) })).toThrow(ValidationError);
      expect(() => analytics.logEvent("signup_completed", { blob: "x".repeat(8000) })).not.toThrow();
    });

    it("rejects props that cannot be serialised", () => {
      const analytics = newAnalytics();
      const circular: Record<string, unknown> = {};
      circular.self = circular;

      expect(() => analytics.logEvent("signup_completed", circular)).toThrow(ValidationError);
    });

    it("defaults props to an empty object", () => {
      const analytics = newAnalytics();
      analytics.consentForEnhancedTracking();
      analytics.logEvent("signup_completed");
      flushTransport();

      expect(getSentEvents()[1].props).toEqual({});
    });
  });

  describe("event envelope", () => {
    it("carries the full envelope the ingest endpoint expects", () => {
      (browser.document as unknown as { referrer: string }).referrer = "https://publisher.example/article";
      const analytics = newAnalytics();
      analytics.consentForEnhancedTracking();
      analytics.identify(VALID_MOCK_WALLET_ADDRESS as Address);
      analytics.logEvent("signup_completed", { plan: "pro" });
      flushTransport();

      const event = getSentEvents()[1];
      expect(event.name).toBe("signup_completed");
      expect(event.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(event.session_id).toBe(browser.sessionStorage.getItem("__specify_session_id") as string);
      expect(event.wallets).toEqual([VALID_MOCK_WALLET_ADDRESS]);
      expect(event.page).toEqual({ referrer: "https://publisher.example/article", url: DEFAULT_URL });
      expect(event.props).toEqual({ plan: "pro" });
      expect(event.spclid).toBeNull();
    });

    it("tags the batch with the property id and this sdk", () => {
      const analytics = newAnalytics();
      analytics.consentForEnhancedTracking();
      flushTransport();

      const batch = getBatch();
      expect(batch.property_id).toBe(VALID_MOCK_PROPERTY_KEY);
      expect(batch.sdk).toEqual({ name: "@specify-sh/advertiser", version: "1.0.0" });
    });

    it("sends the api key header to the events endpoint, credentialed", () => {
      const analytics = newAnalytics();
      analytics.consentForEnhancedTracking();
      flushTransport();

      const call = getLastFetchCall();
      expect(call?.url).toBe(EVENTS_ENDPOINT);
      expect(call?.init?.method).toBe("POST");
      expect(call?.init?.credentials).toBe("include");
      expect(call?.init?.headers).toEqual({
        "Content-Type": "application/json",
        "x-api-key": VALID_MOCK_PROPERTY_KEY,
      });
    });

    it("honours a baseUrl override", () => {
      const analytics = newAnalytics({ edge: { baseUrl: "http://localhost:3000/" } });
      analytics.consentForEnhancedTracking();
      flushTransport();

      expect(getLastFetchCall()?.url).toBe("http://localhost:3000/v1/events");
    });
  });

  describe("identify", () => {
    it("lowercases, accumulates and deduplicates addresses", () => {
      const analytics = newAnalytics();
      analytics.consentForEnhancedTracking();
      analytics.identify("0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" as Address);
      analytics.identify([OTHER_ADDRESS, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Address]);
      analytics.logEvent("signup_completed");
      flushTransport();

      expect(getSentEvents()[1].wallets).toEqual(["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", OTHER_ADDRESS]);
    });

    it("throws ValidationError on a malformed address", () => {
      const analytics = newAnalytics();

      expect(() => analytics.identify("not-an-address" as Address)).toThrow(ValidationError);
      expect(() => analytics.identify(["0xshort" as Address])).toThrow(ValidationError);
    });

    it("does not emit an event of its own", () => {
      const analytics = newAnalytics();
      analytics.consentForEnhancedTracking();
      analytics.identify(VALID_MOCK_WALLET_ADDRESS as Address);
      flushTransport();

      expect(getSentEventNames()).toEqual(["page_view"]);
    });

    it("merges identified and detected wallets", async () => {
      announceProviderOnRequest(browser, "stub-wallet", createStubProvider({ accounts: [DETECTED_ADDRESS] }));
      const analytics = newAnalytics({ privacy: { disableWalletDetection: false } });
      analytics.consentForEnhancedTracking();
      await flush();

      analytics.identify(OTHER_ADDRESS);
      analytics.logEvent("signup_completed");
      flushTransport();

      const event = getSentEvents().find((sent) => sent.name === "signup_completed");
      expect(event?.wallets).toEqual([OTHER_ADDRESS, DETECTED_ADDRESS]);
    });

    it("caps the wallet set at 50", () => {
      const analytics = newAnalytics();
      analytics.consentForEnhancedTracking();
      analytics.identify(Array.from({ length: 60 }, (_, i) => `0x${i.toString().padStart(40, "0")}` as Address));
      analytics.logEvent("signup_completed");
      flushTransport();

      expect(getSentEvents()[1].wallets).toHaveLength(50);
    });
  });

  describe("wallet events", () => {
    it("emits wallet_detected on the first detection and wallet_changed after", async () => {
      const provider = createStubProvider({ accounts: [DETECTED_ADDRESS] });
      announceProviderOnRequest(browser, "stub-wallet", provider);

      const analytics = newAnalytics({ privacy: { disableWalletDetection: false } });
      analytics.consentForEnhancedTracking();
      await flush();

      provider.emitAccountsChanged([OTHER_ADDRESS]);
      await flush();
      flushTransport();

      expect(getSentEventNames()).toEqual(["page_view", "wallet_detected", "wallet_changed"]);
      const events = getSentEvents();
      expect(events[1].props).toEqual({ addresses: [DETECTED_ADDRESS] });
      expect(events[2].props).toEqual({ addresses: [DETECTED_ADDRESS, OTHER_ADDRESS] });
      expect(analytics.getDetectedWallets()).toEqual([DETECTED_ADDRESS as Address, OTHER_ADDRESS]);
    });

    it("emits nothing when detection is disabled", async () => {
      announceProviderOnRequest(browser, "stub-wallet", createStubProvider({ accounts: [DETECTED_ADDRESS] }));

      const analytics = newAnalytics();
      analytics.consentForEnhancedTracking();
      await flush();
      flushTransport();

      expect(getSentEventNames()).toEqual(["page_view"]);
      expect(analytics.getDetectedWallets()).toEqual([]);
    });

    it("stops emitting after destroy", async () => {
      const provider = createStubProvider({ accounts: [DETECTED_ADDRESS] });
      announceProviderOnRequest(browser, "stub-wallet", provider);

      const analytics = newAnalytics({ privacy: { disableWalletDetection: false } });
      analytics.consentForEnhancedTracking();
      await flush();
      analytics.destroy();
      resetFetchCalls();

      provider.emitAccountsChanged([OTHER_ADDRESS]);
      await flush();
      flushTransport();

      expect(getFetchCalls()).toHaveLength(0);
      expect(analytics.getDetectedWallets()).toEqual([]);
    });
  });

  describe("destroy", () => {
    it("flushes consented events that were still queued", () => {
      const analytics = newAnalytics();
      analytics.consentForEnhancedTracking();
      analytics.logEvent("signup_completed");

      analytics.destroy();

      expect(getSentEventNames()).toEqual(["page_view", "signup_completed"]);
    });

    it("clears state and stops capturing", () => {
      const analytics = newAnalytics();
      analytics.consentForEnhancedTracking();
      analytics.identify(VALID_MOCK_WALLET_ADDRESS as Address);

      analytics.destroy();
      resetFetchCalls();

      expect(analytics.hasEnhancedTrackingConsent()).toBe(false);
      analytics.logEvent("signup_completed");
      flushTransport();
      expect(getFetchCalls()).toHaveLength(0);
    });
  });
});
