import { describe, expect, it } from "bun:test";
import { renderManualInstructions } from "../lib/fallback";
import { placeholderKey } from "../lib/keys";
import { PRODUCTS } from "../lib/products";
import { VALID_ADVERTISER_KEY, VALID_PUBLISHER_KEY } from "./fixtures";

describe("renderManualInstructions — publisher", () => {
  const text = renderManualInstructions({ key: VALID_PUBLISHER_KEY, product: "publisher" });

  it("explains why it is printing this and that nothing changed", () => {
    expect(text).toContain("No supported coding agent was found");
    expect(text).toContain("Nothing has been changed");
  });

  it("names agents the user could install to get the guided path", () => {
    expect(text).toContain("Claude Code");
    expect(text).toContain("Codex");
  });

  it("gives an install command", () => {
    expect(text).toContain("npm install @specify-sh/sdk");
  });

  it("shows the real constructor with the user's key", () => {
    expect(text).toContain("new Specify({");
    expect(text).toContain("publisherKey");
    expect(text).toContain(VALID_PUBLISHER_KEY);
  });

  it("covers the whole consent trio and the per-page-load rule", () => {
    expect(text).toContain("consentForEnhancedTracking()");
    expect(text).toContain("revokeEnhancedTrackingConsent()");
    expect(text).toContain("EVERY page load");
    expect(text).toContain("never persisted");
  });

  it("covers identify, serve, rendering rules and destroy", () => {
    expect(text).toContain("specify.identify(");
    expect(text).toContain("specify.serve({");
    expect(text).toContain("imageFormat");
    expect(text).toContain("adUnitId");
    expect(text).toContain("render NOTHING");
    expect(text).toContain("Sponsored");
    expect(text).toContain("specify.destroy()");
  });

  it("offers the GTM alternative with the real loader URL", () => {
    expect(text).toContain("https://spfsrv.com/sdk/v1.js");
    expect(text).toContain("window.specify=window.specify||");
    expect(text).toContain("specify('init'");
  });

  it("includes the CSP guidance", () => {
    expect(text).toContain("connect-src 'self' https://spfsrv.com");
    expect(text).toContain("content.specify.sh");
  });

  it("ends with the docs link", () => {
    expect(text).toContain(PRODUCTS.publisher.docsUrl);
  });
});

describe("renderManualInstructions — advertiser", () => {
  const text = renderManualInstructions({ key: VALID_ADVERTISER_KEY, product: "advertiser" });

  it("shows the real constructor with the user's key", () => {
    expect(text).toContain("new SpecifyAnalytics({");
    expect(text).toContain("propertyKey");
    expect(text).toContain(VALID_ADVERTISER_KEY);
  });

  it("covers consent, identify, logEvent and destroy", () => {
    expect(text).toContain("consentForEnhancedTracking()");
    expect(text).toContain("analytics.identify(");
    expect(text).toContain('analytics.logEvent("signup_completed"');
    expect(text).toContain("analytics.destroy()");
  });

  it("states the event name and props limits", () => {
    expect(text).toContain("/^[a-z0-9_]{1,64}$/");
    expect(text).toContain("8 KB");
  });

  it("warns against re-implementing the automatic events", () => {
    expect(text).toContain("do not re-implement them");
  });

  it("offers the GTM alternative on the advertiser global and URL", () => {
    expect(text).toContain("https://spfsrv.com/sdk/advertiser/v1.js");
    expect(text).toContain("window.specifyAnalytics=window.specifyAnalytics||");
    expect(text).toContain("specifyAnalytics('event'");
  });

  it("does not leak the publisher instructions", () => {
    expect(text).not.toContain("new Specify({");
    expect(text).not.toContain("imageFormat");
    expect(text).toContain(PRODUCTS.advertiser.docsUrl);
  });
});

describe("renderManualInstructions — options", () => {
  it("uses the given package manager for the install command", () => {
    const text = renderManualInstructions({
      key: VALID_ADVERTISER_KEY,
      packageManager: "bun",
      product: "advertiser",
    });
    expect(text).toContain("bun add @specify-sh/advertiser");
  });

  it("calls out a placeholder key so it cannot ship by accident", () => {
    const text = renderManualInstructions({ key: placeholderKey("publisher"), product: "publisher" });
    expect(text).toContain("Replace the placeholder key");
    expect(text).toContain("is a placeholder");
  });

  it("says nothing about placeholders when the key is real", () => {
    const text = renderManualInstructions({ key: VALID_PUBLISHER_KEY, product: "publisher" });
    expect(text).not.toContain("Replace the placeholder key");
  });
});
