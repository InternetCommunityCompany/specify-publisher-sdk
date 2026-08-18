import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { resetSessionId } from "@specify-sh/core";
import { SpecifyAnalytics } from "../lib";
import { install } from "../lib/gtm/loader";
import type { Address } from "../lib/types";
import { type BrowserStub, installBrowser, uninstallBrowser } from "./browser";
import { VALID_MOCK_PROPERTY_KEY, VALID_MOCK_WALLET_ADDRESS } from "./consts";
import {
  getFetchCalls,
  getSentEventNames,
  getSentEvents,
  resetFetchCalls,
  restoreFetch,
  setupMockFetch,
} from "./helpers";

const INIT_CONFIG = { privacy: { disableWalletDetection: true }, propertyKey: VALID_MOCK_PROPERTY_KEY };

type Dispatcher = ((...args: unknown[]) => void) & { q?: ArrayLike<unknown>[] };

interface FakeWindow {
  specifyAnalytics?: Dispatcher;
  SpecifyAnalytics?: typeof SpecifyAnalytics;
}

/** Reproduces the inline snippet advertisers paste above the script tag. */
function createStubbedWindow(): FakeWindow {
  const stub = ((...args: unknown[]) => {
    stub.q = stub.q ?? [];
    (stub.q as unknown[][]).push(args);
  }) as Dispatcher;
  return { specifyAnalytics: stub };
}

describe("GTM loader", () => {
  let browser: BrowserStub;

  /** Force the transport to send without tearing the singleton down. */
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

  it("drains a queue that was filled before the script loaded", () => {
    const target = createStubbedWindow();
    target.specifyAnalytics?.("init", INIT_CONFIG);
    target.specifyAnalytics?.("consent");
    target.specifyAnalytics?.("identify", VALID_MOCK_WALLET_ADDRESS as Address);
    target.specifyAnalytics?.("event", "signup_completed", { plan: "pro" });

    // Nothing has run yet — the stub only buffers.
    expect(getFetchCalls()).toHaveLength(0);

    install(target);
    flushTransport();

    expect(getSentEventNames()).toEqual(["page_view", "signup_completed"]);
    expect(getSentEvents()[1].wallets).toEqual([VALID_MOCK_WALLET_ADDRESS]);
    expect(getSentEvents()[1].props).toEqual({ plan: "pro" });
  });

  it("exposes the class and a live dispatcher on the window", () => {
    const target = createStubbedWindow();
    const stub = target.specifyAnalytics;

    install(target);

    expect(target.SpecifyAnalytics).toBe(SpecifyAnalytics);
    expect(target.specifyAnalytics).not.toBe(stub);
  });

  it("buffers commands issued before init and replays them in order", () => {
    const target: FakeWindow = {};
    install(target);

    target.specifyAnalytics?.("consent");
    target.specifyAnalytics?.("identify", VALID_MOCK_WALLET_ADDRESS as Address);
    target.specifyAnalytics?.("event", "signup_completed");
    flushTransport();
    expect(getFetchCalls()).toHaveLength(0);

    target.specifyAnalytics?.("init", INIT_CONFIG);
    flushTransport();

    expect(getSentEventNames()).toEqual(["page_view", "signup_completed"]);
    expect(getSentEvents()[1].wallets).toEqual([VALID_MOCK_WALLET_ADDRESS]);
  });

  it("sends nothing until the consent command arrives", () => {
    const target: FakeWindow = {};
    install(target);

    target.specifyAnalytics?.("init", INIT_CONFIG);
    target.specifyAnalytics?.("event", "signup_completed");
    flushTransport();
    expect(getFetchCalls()).toHaveLength(0);

    target.specifyAnalytics?.("consent");
    flushTransport();
    expect(getSentEventNames()).toEqual(["page_view", "signup_completed"]);
  });

  it("routes revokeConsent to the singleton", () => {
    const target: FakeWindow = {};
    install(target);

    target.specifyAnalytics?.("init", INIT_CONFIG);
    target.specifyAnalytics?.("consent");
    target.specifyAnalytics?.("revokeConsent");
    target.specifyAnalytics?.("event", "signup_completed");
    flushTransport();

    expect(getFetchCalls()).toHaveLength(0);
  });

  it("ignores a second install on the same window", () => {
    const target = createStubbedWindow();
    target.specifyAnalytics?.("init", INIT_CONFIG);
    target.specifyAnalytics?.("consent");

    install(target);
    const firstDispatcher = target.specifyAnalytics as Dispatcher;

    // A second script tag: the stale queue must not be re-drained and the
    // dispatcher must not be replaced.
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    install(target);

    expect(target.specifyAnalytics).toBe(firstDispatcher);
    // A re-drain would replay the buffered init and warn about the repeat.
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();

    target.specifyAnalytics?.("event", "signup_completed");
    flushTransport();
    expect(getSentEventNames()).toEqual(["page_view", "signup_completed"]);
  });

  it("warns and ignores a repeated init", () => {
    const target: FakeWindow = {};
    install(target);
    const warn = spyOn(console, "warn").mockImplementation(() => {});

    target.specifyAnalytics?.("init", INIT_CONFIG);
    target.specifyAnalytics?.("init", INIT_CONFIG);

    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("warns on an unknown command and keeps dispatching", () => {
    const target: FakeWindow = {};
    install(target);
    const warn = spyOn(console, "warn").mockImplementation(() => {});

    target.specifyAnalytics?.("teleport", { anywhere: true });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();

    target.specifyAnalytics?.("init", INIT_CONFIG);
    target.specifyAnalytics?.("consent");
    target.specifyAnalytics?.("event", "signup_completed");
    flushTransport();

    expect(getSentEventNames()).toEqual(["page_view", "signup_completed"]);
  });

  it("reports a bad event name without throwing at the tag", () => {
    const target: FakeWindow = {};
    install(target);
    const error = spyOn(console, "error").mockImplementation(() => {});

    target.specifyAnalytics?.("init", INIT_CONFIG);
    target.specifyAnalytics?.("consent");
    expect(() => target.specifyAnalytics?.("event", "Signup Completed")).not.toThrow();
    expect(error).toHaveBeenCalled();
    error.mockRestore();

    // The dispatcher still works afterwards.
    target.specifyAnalytics?.("event", "signup_completed");
    flushTransport();
    expect(getSentEventNames()).toEqual(["page_view", "signup_completed"]);
  });

  it("reports a bad address from identify without breaking the dispatcher", () => {
    const target: FakeWindow = {};
    install(target);
    const error = spyOn(console, "error").mockImplementation(() => {});

    target.specifyAnalytics?.("init", INIT_CONFIG);
    target.specifyAnalytics?.("identify", "nope" as Address);

    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("reports a bad property key from init without breaking the dispatcher", () => {
    const target: FakeWindow = {};
    install(target);
    const error = spyOn(console, "error").mockImplementation(() => {});

    target.specifyAnalytics?.("init", { propertyKey: "nope" });

    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
