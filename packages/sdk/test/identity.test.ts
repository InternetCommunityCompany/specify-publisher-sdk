import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import Specify, { type Address, ImageFormat, ValidationError } from "../lib";
import {
  type BrowserStub,
  announceProviderOnRequest,
  createStubProvider,
  flush,
  installBrowser,
  uninstallBrowser,
} from "./browser";
import { VALID_MOCK_PUBLISHER_KEY, VALID_MOCK_WALLET_ADDRESS } from "./consts";
import {
  getFetchCalls,
  getLastFetchCall,
  getLastRequestBody,
  resetFetchCalls,
  restoreFetch,
  setupMockFetch,
} from "./helpers";

const AD = {
  adId: "A",
  campaignId: "abcd1234567",
  communityLogo: "https://example.com/logo.png",
  communityName: "Outposts",
  content: "Join the club.",
  ctaLabel: "Mint Now",
  ctaUrl: "https://example.com",
  headline: "Bored Ape Yacht Club Collection",
  imageUrl: "https://example.com/image.jpg",
  localId: "local-id-from-server",
  walletAddress: VALID_MOCK_WALLET_ADDRESS,
};

const OTHER_ADDRESS = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as Address;
const CHECKSUMMED_OTHER_ADDRESS = "0xAbCdEfAbCdEfAbCdEfAbCdEfAbCdEfAbCdEfAbCd" as Address;
const DETECTED_ADDRESS = "0x1111111111111111111111111111111111111111";

const LANDSCAPE = { imageFormat: ImageFormat.LANDSCAPE };

function newClient(overrides: Partial<ConstructorParameters<typeof Specify>[0]> = {}): Specify {
  return new Specify({ publisherKey: VALID_MOCK_PUBLISHER_KEY, ...overrides });
}

describe("Specify v1 identity layer", () => {
  let browser: BrowserStub;

  beforeEach(() => {
    browser = installBrowser();
    resetFetchCalls();
    setupMockFetch(AD);
  });

  afterEach(() => {
    uninstallBrowser();
    restoreFetch();
  });

  describe("serve overload resolution", () => {
    it("accepts the options-only form", async () => {
      const specify = newClient({ privacy: { disableWalletDetection: true } });
      specify.identify(VALID_MOCK_WALLET_ADDRESS as Address);

      const ad = await specify.serve(LANDSCAPE);

      expect(ad).toHaveProperty("headline", AD.headline);
      expect(getLastRequestBody().walletAddresses).toEqual([VALID_MOCK_WALLET_ADDRESS]);
    });

    it("accepts the wallets-first form", async () => {
      const specify = newClient({ privacy: { disableWalletDetection: true } });

      const ad = await specify.serve(VALID_MOCK_WALLET_ADDRESS as Address, LANDSCAPE);

      expect(ad).toHaveProperty("headline", AD.headline);
      expect(getLastRequestBody().walletAddresses).toEqual([VALID_MOCK_WALLET_ADDRESS]);
    });

    it("treats an array first argument as wallets, not options", async () => {
      const specify = newClient({ privacy: { disableWalletDetection: true } });

      await specify.serve([VALID_MOCK_WALLET_ADDRESS as Address, OTHER_ADDRESS], {
        adUnitId: "sidebar",
        imageFormat: ImageFormat.SHORT_BANNER,
      });

      const body = getLastRequestBody();
      expect(body.walletAddresses).toEqual([VALID_MOCK_WALLET_ADDRESS, OTHER_ADDRESS]);
      expect(body.imageFormat).toBe(ImageFormat.SHORT_BANNER);
      expect(body.adUnitId).toBe("sidebar");
    });

    it("treats null and undefined first arguments as wallets-first", async () => {
      const specify = newClient({ privacy: { disableWalletDetection: true } });
      specify.identify(VALID_MOCK_WALLET_ADDRESS as Address);

      await specify.serve(null, LANDSCAPE);
      expect(getLastRequestBody().walletAddresses).toEqual([VALID_MOCK_WALLET_ADDRESS]);

      await specify.serve(undefined, LANDSCAPE);
      expect(getLastRequestBody().walletAddresses).toEqual([VALID_MOCK_WALLET_ADDRESS]);
    });

    it("carries adUnitId through the options-only form", async () => {
      const specify = newClient({ privacy: { disableWalletDetection: true } });
      specify.identify(VALID_MOCK_WALLET_ADDRESS as Address);

      await specify.serve({ adUnitId: "header-banner-1", imageFormat: ImageFormat.LONG_BANNER });

      const body = getLastRequestBody();
      expect(body.adUnitId).toBe("header-banner-1");
      expect(body.imageFormat).toBe(ImageFormat.LONG_BANNER);
    });
  });

  describe("consent gating", () => {
    it("omits credentials by default", async () => {
      const specify = newClient({ privacy: { disableWalletDetection: true } });

      await specify.serve(VALID_MOCK_WALLET_ADDRESS as Address, LANDSCAPE);

      expect(specify.hasEnhancedTrackingConsent()).toBe(false);
      expect(getLastFetchCall()?.init?.credentials).toBe("omit");
    });

    it("includes credentials once consent is granted", async () => {
      const specify = newClient({ privacy: { disableWalletDetection: true } });
      specify.consentForEnhancedTracking();

      await specify.serve(VALID_MOCK_WALLET_ADDRESS as Address, LANDSCAPE);

      expect(specify.hasEnhancedTrackingConsent()).toBe(true);
      expect(getLastFetchCall()?.init?.credentials).toBe("include");
    });

    it("goes back to omitting credentials after revocation", async () => {
      const specify = newClient({ privacy: { disableWalletDetection: true } });
      specify.consentForEnhancedTracking();
      specify.revokeEnhancedTrackingConsent();

      await specify.serve(VALID_MOCK_WALLET_ADDRESS as Address, LANDSCAPE);

      expect(specify.hasEnhancedTrackingConsent()).toBe(false);
      expect(getLastFetchCall()?.init?.credentials).toBe("omit");
    });

    it("never grants consent outside the browser", async () => {
      uninstallBrowser();
      const specify = newClient();
      specify.consentForEnhancedTracking();

      await specify.serve(VALID_MOCK_WALLET_ADDRESS as Address, LANDSCAPE);

      expect(specify.hasEnhancedTrackingConsent()).toBe(false);
      expect(getLastFetchCall()?.init?.credentials).toBe("omit");
    });

    it("does not persist consent to storage", () => {
      const specify = newClient({ privacy: { disableWalletDetection: true } });
      specify.consentForEnhancedTracking();

      expect(browser.localStorage.__entries.size).toBe(0);
      expect(browser.sessionStorage.__entries.size).toBe(0);
      // A fresh instance on the same page starts unconsented: the CMP is the
      // only source of truth and must call consent on every page load.
      expect(newClient({ privacy: { disableWalletDetection: true } }).hasEnhancedTrackingConsent()).toBe(false);
    });
  });

  describe("identify", () => {
    it("lowercases and merges addresses into later serves", async () => {
      const specify = newClient({ privacy: { disableWalletDetection: true } });
      specify.identify("0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" as Address);

      await specify.serve(LANDSCAPE);

      expect(getLastRequestBody().walletAddresses).toEqual(["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]);
    });

    it("accumulates across calls and deduplicates", async () => {
      const specify = newClient({ privacy: { disableWalletDetection: true } });
      specify.identify(VALID_MOCK_WALLET_ADDRESS as Address);
      specify.identify([OTHER_ADDRESS, VALID_MOCK_WALLET_ADDRESS as Address]);

      await specify.serve(LANDSCAPE);

      expect(getLastRequestBody().walletAddresses).toEqual([VALID_MOCK_WALLET_ADDRESS, OTHER_ADDRESS]);
    });

    it("throws ValidationError on a malformed address", () => {
      const specify = newClient({ privacy: { disableWalletDetection: true } });

      expect(() => specify.identify("not-an-address" as Address)).toThrow(ValidationError);
      expect(() => specify.identify(["0xshort" as Address])).toThrow(ValidationError);
    });
  });

  describe("wallet set merge order", () => {
    it("orders explicit, then identified, then detected", async () => {
      announceProviderOnRequest(browser, "stub-wallet", createStubProvider({ accounts: [DETECTED_ADDRESS] }));
      const specify = newClient();
      await flush();

      specify.identify(OTHER_ADDRESS);

      await specify.serve(VALID_MOCK_WALLET_ADDRESS as Address, LANDSCAPE);

      expect(specify.getDetectedWallets()).toEqual([DETECTED_ADDRESS as Address]);
      expect(getLastRequestBody().walletAddresses).toEqual([
        VALID_MOCK_WALLET_ADDRESS,
        OTHER_ADDRESS,
        DETECTED_ADDRESS,
      ]);
    });

    it("deduplicates case-insensitively, keeping the caller's spelling", async () => {
      // Detection and identify() both lowercase; the caller's checksummed form
      // is what reaches the wire, and the same wallet is only sent once.
      announceProviderOnRequest(browser, "stub-wallet", createStubProvider({ accounts: [OTHER_ADDRESS] }));
      const specify = newClient();
      await flush();

      specify.identify(OTHER_ADDRESS);

      await specify.serve(CHECKSUMMED_OTHER_ADDRESS, LANDSCAPE);

      expect(specify.getDetectedWallets()).toEqual([OTHER_ADDRESS]);
      expect(getLastRequestBody().walletAddresses).toEqual([CHECKSUMMED_OTHER_ADDRESS]);
    });

    it("throws only when the caller itself passes more than 50 addresses", async () => {
      const specify = newClient({ privacy: { disableWalletDetection: true } });
      const fiftyOne = Array.from({ length: 51 }, (_, i) => `0x${i.toString().padStart(40, "0")}` as Address);

      await expect(specify.serve(fiftyOne, LANDSCAPE)).rejects.toThrow(ValidationError);
    });

    it("drops inferred addresses from the end instead of throwing at the cap", async () => {
      const specify = newClient({ privacy: { disableWalletDetection: true } });
      const fifty = Array.from({ length: 50 }, (_, i) => `0x${i.toString().padStart(40, "0")}` as Address);
      specify.identify(OTHER_ADDRESS);

      await specify.serve(fifty, LANDSCAPE);

      const sent = getLastRequestBody<{ walletAddresses: string[] }>().walletAddresses;
      expect(sent).toHaveLength(50);
      expect(sent).toEqual(fifty);
      expect(sent).not.toContain(OTHER_ADDRESS);
    });
  });

  describe("zero-wallet requests", () => {
    it("sends the request in a consenting browser so the cookie can resolve an identity", async () => {
      const specify = newClient({ privacy: { disableWalletDetection: true } });
      specify.consentForEnhancedTracking();

      await specify.serve(LANDSCAPE);

      expect(getFetchCalls()).toHaveLength(1);
      expect(getLastFetchCall()?.init?.credentials).toBe("include");
      expect(getLastRequestBody().walletAddresses).toEqual([]);
    });

    it("skips the request in a browser without consent", async () => {
      const specify = newClient({ privacy: { disableWalletDetection: true } });

      await expect(specify.serve(LANDSCAPE)).resolves.toBeNull();
      expect(getFetchCalls()).toHaveLength(0);
    });

    it("skips the request outside the browser", async () => {
      uninstallBrowser();
      const specify = newClient();
      specify.consentForEnhancedTracking();

      await expect(specify.serve([], LANDSCAPE)).resolves.toBeNull();
      expect(getFetchCalls()).toHaveLength(0);
    });

    it("returns null instead of throwing when a walletless request is rejected with 400", async () => {
      setupMockFetch(
        { details: [{ field: "walletAddresses", message: "required" }], error: "Invalid request body" },
        400,
      );
      const specify = newClient({ privacy: { disableWalletDetection: true } });
      specify.consentForEnhancedTracking();

      await expect(specify.serve(LANDSCAPE)).resolves.toBeNull();
      expect(getFetchCalls()).toHaveLength(1);
    });

    it("still throws on a 400 for a request that carried wallets", async () => {
      setupMockFetch({ details: [{ field: "imageFormat", message: "invalid" }], error: "Invalid request body" }, 400);
      const specify = newClient({ privacy: { disableWalletDetection: true } });

      const error = await specify.serve(VALID_MOCK_WALLET_ADDRESS as Address, LANDSCAPE).catch((e) => e);
      expect(error).toBeInstanceOf(ValidationError);
      expect(error.details).toEqual([{ field: "imageFormat", message: "invalid" }]);
    });
  });

  describe("localId cache", () => {
    it("stores the localId returned on a successful serve", async () => {
      const specify = newClient({ cacheMostRecentAddress: true, privacy: { disableWalletDetection: true } });

      await specify.serve(VALID_MOCK_WALLET_ADDRESS as Address, LANDSCAPE);

      expect(browser.localStorage.getItem("__specify_local_id")).toBe("local-id-from-server");
    });

    it("does not store a localId when caching is off", async () => {
      const specify = newClient({ privacy: { disableWalletDetection: true } });

      await specify.serve(VALID_MOCK_WALLET_ADDRESS as Address, LANDSCAPE);

      expect(browser.localStorage.getItem("__specify_local_id")).toBeNull();
    });

    it("sends the cached localId on later requests", async () => {
      browser.localStorage.setItem("__specify_local_id", "cached-local-id");
      const specify = newClient({ cacheMostRecentAddress: true, privacy: { disableWalletDetection: true } });

      await specify.serve(VALID_MOCK_WALLET_ADDRESS as Address, LANDSCAPE);

      expect(getLastRequestBody().localId).toBe("cached-local-id");
    });

    it("serves on the cached localId alone, with no wallets and no consent", async () => {
      browser.localStorage.setItem("__specify_local_id", "cached-local-id");
      const specify = newClient({ cacheMostRecentAddress: true, privacy: { disableWalletDetection: true } });

      const ad = await specify.serve(LANDSCAPE);

      expect(ad).toHaveProperty("headline", AD.headline);
      expect(getLastFetchCall()?.init?.credentials).toBe("omit");
    });

    it("clears the cached localId on the WALLET_CACHE_VOID sentinel", async () => {
      browser.localStorage.setItem("__specify_local_id", "stale-local-id");
      setupMockFetch({ localId: "WALLET_CACHE_VOID" }, 404);
      const specify = newClient({ cacheMostRecentAddress: true, privacy: { disableWalletDetection: true } });

      await expect(specify.serve(VALID_MOCK_WALLET_ADDRESS as Address, LANDSCAPE)).resolves.toBeNull();
      expect(browser.localStorage.getItem("__specify_local_id")).toBeNull();
    });

    it("stores a fresh localId returned alongside a 404 no-fill", async () => {
      setupMockFetch({ localId: "fresh-local-id" }, 404);
      const specify = newClient({ cacheMostRecentAddress: true, privacy: { disableWalletDetection: true } });

      await expect(specify.serve(VALID_MOCK_WALLET_ADDRESS as Address, LANDSCAPE)).resolves.toBeNull();
      expect(browser.localStorage.getItem("__specify_local_id")).toBe("fresh-local-id");
    });
  });

  describe("wallet detection", () => {
    it("is on by default and only ever reads accounts silently", async () => {
      const provider = createStubProvider({ accounts: [DETECTED_ADDRESS] });
      announceProviderOnRequest(browser, "stub-wallet", provider);

      const specify = newClient();
      await flush();

      expect(specify.getDetectedWallets()).toEqual([DETECTED_ADDRESS as Address]);
      expect(provider.requestedMethods).toEqual(["eth_accounts"]);
      expect(provider.requestedMethods).not.toContain("eth_requestAccounts");
    });

    it("can be disabled", async () => {
      announceProviderOnRequest(browser, "stub-wallet", createStubProvider({ accounts: [DETECTED_ADDRESS] }));

      const specify = newClient({ privacy: { disableWalletDetection: true } });
      await flush();

      expect(specify.getDetectedWallets()).toEqual([]);
    });

    it("stays empty outside the browser", async () => {
      uninstallBrowser();
      const specify = newClient();
      await flush();

      expect(specify.getDetectedWallets()).toEqual([]);
    });

    it("stops detecting after destroy()", async () => {
      const provider = createStubProvider({ accounts: [DETECTED_ADDRESS] });
      announceProviderOnRequest(browser, "stub-wallet", provider);

      const specify = newClient();
      await flush();
      specify.destroy();

      provider.emitAccountsChanged(["0x2222222222222222222222222222222222222222"]);
      await flush();

      expect(specify.getDetectedWallets()).toEqual([]);
    });
  });

  describe("edge configuration", () => {
    it("targets https://spfsrv.com/api/ads by default", async () => {
      const specify = newClient({ privacy: { disableWalletDetection: true } });

      await specify.serve(VALID_MOCK_WALLET_ADDRESS as Address, LANDSCAPE);

      expect(getLastFetchCall()?.url).toBe("https://spfsrv.com/api/ads");
    });

    it("honours a baseUrl override and trims its trailing slash", async () => {
      const specify = newClient({
        edge: { baseUrl: "http://localhost:3000/" },
        privacy: { disableWalletDetection: true },
      });

      await specify.serve(VALID_MOCK_WALLET_ADDRESS as Address, LANDSCAPE);

      expect(getLastFetchCall()?.url).toBe("http://localhost:3000/api/ads");
    });
  });
});
