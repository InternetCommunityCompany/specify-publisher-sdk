import { describe, expect, it } from "bun:test";
import Specify, { ImageFormat } from "../lib";
import { resolveEndpoints } from "../lib/core/config";
import { uuidv7 } from "../lib/core/uuid";
import { normalizeAddresses } from "../lib/core/wallet";
import { VALID_MOCK_PUBLISHER_KEY, VALID_MOCK_WALLET_ADDRESS } from "./consts";

describe("core/uuid", () => {
  it("emits a v7-shaped UUID", () => {
    expect(uuidv7()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("core/config", () => {
  it("resolves default prototype endpoints on app.specify.sh", () => {
    const e = resolveEndpoints();
    expect(e.ads).toBe("https://app.specify.sh/api/ads");
    expect(e.sync).toBe("https://app.specify.sh/api/sync");
    expect(e.events).toBe("https://app.specify.sh/api/events");
  });

  it("honours a baseUrl override", () => {
    const e = resolveEndpoints("production", { baseUrl: "https://ads.spfy-net.com/v1" });
    expect(e.ads).toBe("https://ads.spfy-net.com/v1/ads");
  });
});

describe("core/wallet normalizeAddresses", () => {
  it("lowercases, validates, and dedupes", () => {
    expect(
      normalizeAddresses([
        "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "bad",
      ]),
    ).toEqual(["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]);
  });
});

describe("Specify identity integration", () => {
  it("has no detected wallets outside the browser", () => {
    const specify = new Specify({ publisherKey: VALID_MOCK_PUBLISHER_KEY });
    expect(specify.getDetectedWallets()).toEqual([]);
  });

  it("posts to the /api/ads endpoint with credentials included", async () => {
    const specify = new Specify({ publisherKey: VALID_MOCK_PUBLISHER_KEY });

    let sawUrl = "";
    let sawCredentials: RequestCredentials | undefined;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      sawUrl = input.toString();
      sawCredentials = init?.credentials;
      return Promise.resolve({
        status: 200,
        ok: true,
        headers: new Headers(),
        json: () =>
          Promise.resolve({
            walletAddress: VALID_MOCK_WALLET_ADDRESS,
            campaignId: "c",
            adId: "A",
            headline: "h",
            content: "c",
            ctaUrl: "https://x.test",
            ctaLabel: "go",
            imageUrl: "https://x.test/i.png",
            communityName: "n",
            communityLogo: "https://x.test/l.png",
            localId: "local_1",
          }),
      } as unknown as Response);
    }) as typeof fetch;

    const ad = await specify.serve(VALID_MOCK_WALLET_ADDRESS, { imageFormat: ImageFormat.LANDSCAPE });
    expect(ad).not.toBeNull();
    expect(sawUrl).toBe("https://app.specify.sh/api/ads");
    expect(sawCredentials).toBe("include");
  });

  it("returns null without a request outside the browser when there is no wallet", async () => {
    // In a non-browser env there is no spid cookie to resolve, so an empty
    // serve() is a no-op (no network call).
    const specify = new Specify({ publisherKey: VALID_MOCK_PUBLISHER_KEY });
    let fetched = false;
    globalThis.fetch = (() => {
      fetched = true;
      return Promise.reject(new Error("should not be called"));
    }) as typeof fetch;
    const ad = await specify.serve(undefined, { imageFormat: ImageFormat.LANDSCAPE });
    expect(ad).toBeNull();
    expect(fetched).toBe(false);
  });

  it("always fires in the browser even with no wallet, returning null on a 404", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: minimal browser env for isClient()
    (globalThis as any).window = { document: {} };
    // biome-ignore lint/suspicious/noExplicitAny: minimal browser env for isClient()
    (globalThis as any).document = {};
    try {
      const specify = new Specify({
        publisherKey: VALID_MOCK_PUBLISHER_KEY,
        privacy: { disableWalletDetection: true },
      });
      let fetchedUrl = "";
      globalThis.fetch = ((input: RequestInfo | URL) => {
        fetchedUrl = input.toString();
        return Promise.resolve({
          status: 404,
          ok: false,
          headers: new Headers(),
          json: () => Promise.resolve({ localId: "WALLET_CACHE_VOID" }),
        } as unknown as Response);
      }) as typeof fetch;

      const ad = await specify.serve(undefined, { imageFormat: ImageFormat.LANDSCAPE });
      expect(fetchedUrl).toBe("https://app.specify.sh/api/ads");
      expect(ad).toBeNull();
    } finally {
      // biome-ignore lint/suspicious/noExplicitAny: cleanup
      (globalThis as any).window = undefined;
      // biome-ignore lint/suspicious/noExplicitAny: cleanup
      (globalThis as any).document = undefined;
    }
  });
});
