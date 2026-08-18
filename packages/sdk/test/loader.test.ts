import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import Specify, { type Address, ImageFormat, type SpecifyAd } from "../lib";
import { install } from "../lib/gtm/loader";
import { flush } from "./browser";
import { VALID_MOCK_PUBLISHER_KEY, VALID_MOCK_WALLET_ADDRESS } from "./consts";
import { getFetchCalls, getLastRequestBody, resetFetchCalls, restoreFetch, setupMockFetch } from "./helpers";

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

const INIT_CONFIG = { privacy: { disableWalletDetection: true }, publisherKey: VALID_MOCK_PUBLISHER_KEY };

type Dispatcher = ((...args: unknown[]) => void) & { q?: ArrayLike<unknown>[] };

interface FakeWindow {
  specify?: Dispatcher;
  Specify?: typeof Specify;
}

/** Reproduces the inline snippet publishers paste above the script tag. */
function createStubbedWindow(): FakeWindow {
  const stub = ((...args: unknown[]) => {
    stub.q = stub.q ?? [];
    (stub.q as unknown[][]).push(args);
  }) as Dispatcher;
  return { specify: stub };
}

describe("GTM loader", () => {
  beforeEach(() => {
    resetFetchCalls();
    setupMockFetch(AD);
  });

  afterEach(() => {
    restoreFetch();
  });

  it("drains a queue that was filled before the script loaded", async () => {
    const target = createStubbedWindow();
    target.specify?.("init", INIT_CONFIG);
    target.specify?.("identify", VALID_MOCK_WALLET_ADDRESS as Address);

    let received: SpecifyAd | null | undefined;
    target.specify?.("serve", { imageFormat: ImageFormat.LANDSCAPE }, (ad: SpecifyAd | null) => {
      received = ad;
    });

    // Nothing has run yet — the stub only buffers.
    expect(getFetchCalls()).toHaveLength(0);

    install(target);
    await flush();

    expect(received).toHaveProperty("headline", AD.headline);
    expect(getLastRequestBody().walletAddresses).toEqual([VALID_MOCK_WALLET_ADDRESS]);
  });

  it("exposes the class on window.Specify and a live dispatcher on window.specify", () => {
    const target = createStubbedWindow();
    const stub = target.specify;

    install(target);

    expect(target.Specify).toBe(Specify);
    expect(target.specify).not.toBe(stub);
  });

  it("buffers commands issued before init and replays them in order", async () => {
    const target: FakeWindow = {};
    install(target);

    const seen: (SpecifyAd | null)[] = [];
    target.specify?.("identify", VALID_MOCK_WALLET_ADDRESS as Address);
    target.specify?.("serve", { imageFormat: ImageFormat.LANDSCAPE }, (ad: SpecifyAd | null) => seen.push(ad));

    await flush();
    expect(getFetchCalls()).toHaveLength(0);

    target.specify?.("init", INIT_CONFIG);
    await flush();

    expect(seen).toHaveLength(1);
    expect(seen[0]).toHaveProperty("headline", AD.headline);
    expect(getLastRequestBody().walletAddresses).toEqual([VALID_MOCK_WALLET_ADDRESS]);
  });

  it("ignores a second install on the same window", async () => {
    const target = createStubbedWindow();
    target.specify?.("init", INIT_CONFIG);
    target.specify?.("identify", VALID_MOCK_WALLET_ADDRESS as Address);

    install(target);
    const firstDispatcher = target.specify as Dispatcher;

    // A second script tag: the stale queue must not be re-drained and the
    // dispatcher must not be replaced.
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    install(target);

    expect(target.specify).toBe(firstDispatcher);
    // A re-drain would replay the buffered init and warn about the repeat.
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();

    target.specify?.("serve", { imageFormat: ImageFormat.LANDSCAPE }, () => {});
    await flush();
    expect(getFetchCalls()).toHaveLength(1);
  });

  it("warns and ignores a repeated init", () => {
    const target: FakeWindow = {};
    install(target);
    const warn = spyOn(console, "warn").mockImplementation(() => {});

    target.specify?.("init", INIT_CONFIG);
    target.specify?.("init", INIT_CONFIG);

    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("warns on an unknown command and keeps dispatching", async () => {
    const target: FakeWindow = {};
    install(target);
    const warn = spyOn(console, "warn").mockImplementation(() => {});

    target.specify?.("teleport", { anywhere: true });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();

    target.specify?.("init", INIT_CONFIG);
    target.specify?.("identify", VALID_MOCK_WALLET_ADDRESS as Address);
    target.specify?.("serve", { imageFormat: ImageFormat.LANDSCAPE }, () => {});
    await flush();

    expect(getFetchCalls()).toHaveLength(1);
  });

  it("survives a throwing callback", async () => {
    const target: FakeWindow = {};
    install(target);
    const error = spyOn(console, "error").mockImplementation(() => {});

    target.specify?.("init", INIT_CONFIG);
    target.specify?.("identify", VALID_MOCK_WALLET_ADDRESS as Address);
    target.specify?.("serve", { imageFormat: ImageFormat.LANDSCAPE }, () => {
      throw new Error("publisher bug");
    });
    await flush();

    expect(error).toHaveBeenCalled();
    error.mockRestore();

    // The dispatcher still works afterwards.
    let received: SpecifyAd | null | undefined;
    target.specify?.("serve", { imageFormat: ImageFormat.LANDSCAPE }, (ad: SpecifyAd | null) => {
      received = ad;
    });
    await flush();
    expect(received).toHaveProperty("headline", AD.headline);
  });

  it("reports serve failures to the callback instead of throwing", async () => {
    setupMockFetch({ error: "Unauthorized" }, 401);
    const target: FakeWindow = {};
    install(target);

    let callbackError: Error | undefined;
    let callbackAd: SpecifyAd | null | undefined;
    target.specify?.("init", INIT_CONFIG);
    target.specify?.("identify", VALID_MOCK_WALLET_ADDRESS as Address);
    target.specify?.("serve", { imageFormat: ImageFormat.LANDSCAPE }, (ad: SpecifyAd | null, err?: Error) => {
      callbackAd = ad;
      callbackError = err;
    });
    await flush();

    expect(callbackAd).toBeNull();
    expect(callbackError?.name).toBe("AuthenticationError");
  });

  it("routes consent and revokeConsent to the singleton", async () => {
    const target: FakeWindow = {};
    install(target);

    target.specify?.("init", INIT_CONFIG);
    target.specify?.("identify", VALID_MOCK_WALLET_ADDRESS as Address);
    target.specify?.("consent");
    target.specify?.("serve", { imageFormat: ImageFormat.LANDSCAPE }, () => {});
    await flush();

    // Outside the browser consent is a no-op, so credentials stay omitted —
    // what matters here is that the command reached the instance without error.
    expect(getFetchCalls()).toHaveLength(1);

    target.specify?.("revokeConsent");
    target.specify?.("serve", { imageFormat: ImageFormat.LANDSCAPE }, () => {});
    await flush();
    expect(getFetchCalls()).toHaveLength(2);
  });

  it("reports a bad publisher key from init without breaking the dispatcher", () => {
    const target: FakeWindow = {};
    install(target);
    const error = spyOn(console, "error").mockImplementation(() => {});

    target.specify?.("init", { publisherKey: "nope" });

    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
