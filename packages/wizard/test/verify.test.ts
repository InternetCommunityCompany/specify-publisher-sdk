import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { markerSpecs, renderVerification, verifyIntegration } from "../lib/verify";

let root: string;

async function write(relative: string, contents: string): Promise<void> {
  const full = join(root, relative);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, contents, "utf8");
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "specify-wizard-verify-"));
});

afterEach(async () => {
  await rm(root, { force: true, recursive: true });
});

describe("verifyIntegration — publisher", () => {
  it("finds every marker in a complete npm integration", async () => {
    await write("package.json", JSON.stringify({ dependencies: { "@specify-sh/sdk": "^1.0.0" }, name: "site" }));
    await write(
      "src/specify.ts",
      `import Specify, { ImageFormat } from "@specify-sh/sdk";
       export const specify = new Specify({ publisherKey: "spk_x" });
       cmp.onChange((ok) => ok && specify.consentForEnhancedTracking());
       wallet.onConnect((a) => specify.identify(a));
       export const load = () => specify.serve({ imageFormat: ImageFormat.LANDSCAPE });`,
    );

    const result = await verifyIntegration(root, "publisher");
    expect(result.complete).toBe(true);
    expect(result.dependencyDeclared).toBe(true);
    for (const marker of result.markers) {
      expect(marker.found).toBe(true);
      expect(marker.files).toContain("src/specify.ts");
    }
  });

  it("finds the dependency declared in a workspace package, not only at the root", async () => {
    // Live-run finding on the CoW Swap monorepo: the agent correctly added the
    // dependency to libs/analytics/package.json and the root-only check
    // reported it missing.
    await write("package.json", JSON.stringify({ name: "monorepo", workspaces: ["libs/*"] }));
    await write(
      "libs/analytics/package.json",
      JSON.stringify({ dependencies: { "@specify-sh/sdk": "1.0.0" }, name: "@repo/analytics" }),
    );

    const result = await verifyIntegration(root, "publisher");
    expect(result.dependencyDeclared).toBe(true);
  });

  it("accepts a GTM loader integration as equally valid", async () => {
    await write("package.json", JSON.stringify({ name: "site" }));
    await write(
      "public/index.html",
      `<script async src="https://spfsrv.com/sdk/v1.js"></script>
       <script>
         specify('init', { publisherKey: 'spk_x' });
         specify('consent');
         specify('identify', '0xabc');
         specify('serve', { imageFormat: 'LANDSCAPE' }, function (ad) {});
       </script>`,
    );

    const result = await verifyIntegration(root, "publisher");
    expect(result.complete).toBe(true);
    expect(result.dependencyDeclared).toBe(false);
  });

  it("reports what is missing when consent was never wired", async () => {
    await write("package.json", JSON.stringify({ dependencies: { "@specify-sh/sdk": "^1.0.0" }, name: "site" }));
    await write("src/ad.ts", `const specify = new Specify({ publisherKey: "spk_x" }); specify.serve({});`);

    const result = await verifyIntegration(root, "publisher");
    expect(result.complete).toBe(false);

    const consent = result.markers.find((marker) => marker.label === "consentForEnhancedTracking");
    expect(consent?.found).toBe(false);
    expect(consent?.required).toBe(true);
    expect(consent?.hint).toContain("every page load");
  });

  it("does not treat a missing identify() as fatal", async () => {
    await write("package.json", JSON.stringify({ dependencies: { "@specify-sh/sdk": "^1.0.0" }, name: "site" }));
    await write(
      "src/ad.ts",
      `const specify = new Specify({ publisherKey: "spk_x" });
       specify.consentForEnhancedTracking();
       specify.serve({ imageFormat: "LANDSCAPE" });`,
    );

    const result = await verifyIntegration(root, "publisher");
    expect(result.complete).toBe(true);
    expect(result.markers.find((marker) => marker.label === "identify")?.found).toBe(false);
  });

  it("reports nothing found on an untouched tree", async () => {
    await write("package.json", JSON.stringify({ name: "site" }));
    await write("src/app.ts", "export const hello = 1;");

    const result = await verifyIntegration(root, "publisher");
    expect(result.complete).toBe(false);
    expect(result.dependencyDeclared).toBe(false);
    expect(result.markers.every((marker) => !marker.found)).toBe(true);
  });
});

describe("verifyIntegration — advertiser", () => {
  it("finds initialisation, consent, identify and logEvent", async () => {
    await write("package.json", JSON.stringify({ dependencies: { "@specify-sh/advertiser": "^1.0.0" }, name: "site" }));
    await write(
      "app/analytics.ts",
      `import { SpecifyAnalytics } from "@specify-sh/advertiser";
       export const analytics = new SpecifyAnalytics({ propertyKey: "adv_x" });
       onConsent(() => analytics.consentForEnhancedTracking());
       onConnect((a) => analytics.identify(a));
       export const signup = () => analytics.logEvent("signup_completed", { plan: "pro" });`,
    );

    const result = await verifyIntegration(root, "advertiser");
    expect(result.complete).toBe(true);
    expect(result.dependencyDeclared).toBe(true);
    expect(result.markers.map((marker) => marker.label)).toEqual([
      "SpecifyAnalytics initialisation",
      "consentForEnhancedTracking",
      "identify",
      "logEvent",
    ]);
  });

  it("treats a missing logEvent as a gap but not a failure", async () => {
    await write("package.json", JSON.stringify({ name: "site" }));
    await write(
      "app/analytics.ts",
      `const analytics = new SpecifyAnalytics({ propertyKey: "adv_x" });
       analytics.consentForEnhancedTracking();`,
    );

    const result = await verifyIntegration(root, "advertiser");
    expect(result.complete).toBe(true);
    expect(result.markers.find((marker) => marker.label === "logEvent")?.found).toBe(false);
  });
});

describe("verifyIntegration — scanning", () => {
  it("ignores node_modules, dist and .git so the SDK's own source is not a false positive", async () => {
    await write("package.json", JSON.stringify({ name: "site" }));
    await write(
      "node_modules/@specify-sh/sdk/index.js",
      `new Specify({ publisherKey: "x" }); consentForEnhancedTracking(); identify(); serve({});`,
    );
    await write("dist/bundle.js", `new Specify({ publisherKey: "x" });`);
    await write(".git/COMMIT_EDITMSG", "new Specify(");

    const result = await verifyIntegration(root, "publisher");
    expect(result.markers.every((marker) => !marker.found)).toBe(true);
  });

  it("ignores files it has no reason to read", async () => {
    await write("package.json", JSON.stringify({ name: "site" }));
    await write("notes.md", "we should call new Specify({ publisherKey }) some day");
    await write("logo.svg", "<svg>new Specify(</svg>");

    const result = await verifyIntegration(root, "publisher");
    expect(result.markers.every((marker) => !marker.found)).toBe(true);
  });

  it("finds markers in vue, svelte and jsx sources", async () => {
    await write("package.json", JSON.stringify({ name: "site" }));
    await write("src/Ad.vue", `<script>const s = new Specify({ publisherKey: "spk_x" });</script>`);
    await write("src/Consent.svelte", "<script>s.consentForEnhancedTracking();</script>");
    await write("src/Slot.jsx", "export const go = () => s.serve({ imageFormat: 'LANDSCAPE' });");

    const result = await verifyIntegration(root, "publisher");
    expect(result.complete).toBe(true);
  });
});

describe("renderVerification", () => {
  it("shows found and missing markers, and hints for the gaps", async () => {
    await write("package.json", JSON.stringify({ name: "site" }));
    await write("src/ad.ts", `const specify = new Specify({ publisherKey: "spk_x" });`);

    const rendered = renderVerification(await verifyIntegration(root, "publisher"), "publisher");
    expect(rendered).toContain("found");
    expect(rendered).toContain("missing");
    expect(rendered).toContain("@specify-sh/sdk in package.json");
    expect(rendered).toContain("consentForEnhancedTracking");
    expect(rendered).toContain("!");
  });
});

describe("markerSpecs", () => {
  it("marks initialisation and serve as required for the publisher SDK", () => {
    const required = markerSpecs("publisher")
      .filter((spec) => spec.required)
      .map((spec) => spec.label);
    expect(required).toContain("Specify initialisation");
    expect(required).toContain("consentForEnhancedTracking");
    expect(required).toContain("serve");
  });

  it("does not require logEvent for the advertiser SDK", () => {
    const logEvent = markerSpecs("advertiser").find((spec) => spec.label === "logEvent");
    expect(logEvent?.required).toBe(false);
  });
});
