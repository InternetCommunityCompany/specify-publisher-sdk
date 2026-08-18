import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { WalletDetector, normalizeAddresses } from "../lib/wallet";
import {
  type BrowserStub,
  announceProviderOnRequest,
  createStubProvider,
  flush,
  installBrowser,
  uninstallBrowser,
} from "./browser";

const ADDRESS_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ADDRESS_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

describe("WalletDetector", () => {
  let browser: BrowserStub;

  beforeEach(() => {
    browser = installBrowser();
  });

  afterEach(() => {
    uninstallBrowser();
  });

  it("discovers accounts from an EIP-6963 announcement", async () => {
    const provider = createStubProvider({ accounts: [ADDRESS_A] });
    announceProviderOnRequest(browser, "wallet-a", provider);

    const detector = new WalletDetector();
    detector.start();
    await flush();

    expect(detector.getAddresses()).toEqual([ADDRESS_A]);
    expect(provider.requestedMethods).toEqual(["eth_accounts"]);
  });

  it("only ever reads accounts silently", async () => {
    const provider = createStubProvider({ accounts: [ADDRESS_A] });
    announceProviderOnRequest(browser, "wallet-a", provider);

    const detector = new WalletDetector();
    detector.start();
    await flush();

    expect(provider.requestedMethods).not.toContain("eth_requestAccounts");
    expect(provider.requestedMethods).not.toContain("wallet_requestPermissions");
  });

  it("falls back to a legacy window.ethereum provider", async () => {
    const provider = createStubProvider({ accounts: [ADDRESS_B] });
    (browser.window as unknown as { ethereum: unknown }).ethereum = provider;

    const detector = new WalletDetector();
    detector.start();
    await flush();

    expect(detector.getAddresses()).toEqual([ADDRESS_B]);
  });

  it("merges accounts from several announced wallets", async () => {
    announceProviderOnRequest(browser, "wallet-a", createStubProvider({ accounts: [ADDRESS_A] }));
    announceProviderOnRequest(browser, "wallet-b", createStubProvider({ accounts: [ADDRESS_B] }));

    const detector = new WalletDetector();
    detector.start();
    await flush();

    expect(detector.getAddresses().sort()).toEqual([ADDRESS_A, ADDRESS_B]);
  });

  it("registers each announced provider only once", async () => {
    const provider = createStubProvider({ accounts: [ADDRESS_A] });
    announceProviderOnRequest(browser, "wallet-a", provider);

    const detector = new WalletDetector();
    detector.start();
    // A wallet that re-announces (some do on navigation) must not be re-read.
    browser.window.dispatchEvent(new Event("eip6963:requestProvider"));
    await flush();

    expect(provider.requestedMethods).toEqual(["eth_accounts"]);
  });

  it("picks up accounts from a mid-session accountsChanged event", async () => {
    const provider = createStubProvider({ accounts: [] });
    announceProviderOnRequest(browser, "wallet-a", provider);

    const detector = new WalletDetector();
    detector.start();
    await flush();
    expect(detector.getAddresses()).toEqual([]);

    provider.emit("accountsChanged", [ADDRESS_A]);
    expect(detector.getAddresses()).toEqual([ADDRESS_A]);
  });

  it("re-reads accounts when a provider connects", async () => {
    const provider = createStubProvider({ accounts: [ADDRESS_A] });
    announceProviderOnRequest(browser, "wallet-a", provider);

    const detector = new WalletDetector();
    detector.start();
    await flush();

    provider.emit("connect");
    await flush();

    expect(provider.requestedMethods).toEqual(["eth_accounts", "eth_accounts"]);
  });

  it("notifies subscribers once per change and supports unsubscribing", async () => {
    const provider = createStubProvider({ accounts: [] });
    announceProviderOnRequest(browser, "wallet-a", provider);

    const detector = new WalletDetector();
    const snapshots: string[][] = [];
    const unsubscribe = detector.onChange((addresses) => snapshots.push(addresses));
    detector.start();
    await flush();

    provider.emit("accountsChanged", [ADDRESS_A]);
    // Re-announcing the same account is not a change.
    provider.emit("accountsChanged", [ADDRESS_A]);
    expect(snapshots).toEqual([[ADDRESS_A]]);

    unsubscribe();
    provider.emit("accountsChanged", [ADDRESS_B]);
    expect(snapshots).toEqual([[ADDRESS_A]]);
    expect(detector.getAddresses()).toEqual([ADDRESS_A, ADDRESS_B]);
  });

  it("keeps detecting when one subscriber throws", async () => {
    const provider = createStubProvider({ accounts: [] });
    announceProviderOnRequest(browser, "wallet-a", provider);

    const detector = new WalletDetector();
    const seen: string[][] = [];
    detector.onChange(() => {
      throw new Error("consumer bug");
    });
    detector.onChange((addresses) => seen.push(addresses));
    detector.start();
    await flush();

    provider.emit("accountsChanged", [ADDRESS_A]);

    expect(seen).toEqual([[ADDRESS_A]]);
  });

  it("lowercases and rejects malformed addresses", async () => {
    const provider = createStubProvider({
      accounts: ["0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "0xnope", "", 42, null],
    });
    announceProviderOnRequest(browser, "wallet-a", provider);

    const detector = new WalletDetector();
    detector.start();
    await flush();

    expect(detector.getAddresses()).toEqual([ADDRESS_A]);
  });

  it("tolerates a locked provider that rejects the read", async () => {
    announceProviderOnRequest(browser, "wallet-a", createStubProvider({ reject: true }));

    const detector = new WalletDetector();
    detector.start();
    await flush();

    expect(detector.getAddresses()).toEqual([]);
  });

  it("ignores a non-array accounts payload", async () => {
    const provider = createStubProvider({ accounts: { nope: true } });
    announceProviderOnRequest(browser, "wallet-a", provider);

    const detector = new WalletDetector();
    detector.start();
    await flush();

    expect(detector.getAddresses()).toEqual([]);
  });

  it("is idempotent on start", async () => {
    const provider = createStubProvider({ accounts: [ADDRESS_A] });
    announceProviderOnRequest(browser, "wallet-a", provider);

    const detector = new WalletDetector();
    detector.start();
    detector.start();
    await flush();

    expect(provider.requestedMethods).toEqual(["eth_accounts"]);
  });

  it("detaches window and provider listeners on stop", async () => {
    const provider = createStubProvider({ accounts: [ADDRESS_A] });
    announceProviderOnRequest(browser, "wallet-a", provider);

    const detector = new WalletDetector();
    detector.start();
    await flush();
    expect(provider.listenerCount("accountsChanged")).toBe(1);

    detector.stop();

    expect(provider.listenerCount("accountsChanged")).toBe(0);

    // A late announcement after stop must not re-register anything.
    browser.window.dispatchEvent(new Event("eip6963:requestProvider"));
    await flush();
    expect(provider.requestedMethods).toEqual(["eth_accounts"]);
  });

  it("is a no-op outside the browser", async () => {
    uninstallBrowser();

    const detector = new WalletDetector();
    detector.start();
    await flush();

    expect(detector.getAddresses()).toEqual([]);
    expect(() => detector.stop()).not.toThrow();
  });
});

describe("normalizeAddresses", () => {
  it("lowercases, deduplicates and drops invalid entries", () => {
    expect(
      normalizeAddresses(["0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", ADDRESS_A, `  ${ADDRESS_B}  `, "0xbad"]),
    ).toEqual([ADDRESS_A, ADDRESS_B]);
  });
});
