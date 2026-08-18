/**
 * The no-agent path.
 *
 * When `detect()` finds nothing, the wizard has no model to drive — but the
 * developer still came here to install an SDK, so it prints everything needed
 * to do it by hand and exits successfully. This is a supported outcome, not an
 * error, and it is the reason the integration reference lives in code rather
 * than only inside a prompt.
 */

import { isPlaceholderKey } from "./keys";
import { PRODUCTS, type PackageManager, type ProductId, installCommand } from "./products";

export interface ManualInstructionsInput {
  /** The key to show in the snippets, real or placeholder. */
  key: string;
  /** Package manager to write the install command for. */
  packageManager?: PackageManager;
  product: ProductId;
}

/**
 * The complete manual integration for one product.
 *
 * @param input - Product, key and package manager
 * @returns Plain text, ready to print to a terminal
 */
export function renderManualInstructions(input: ManualInstructionsInput): string {
  const { key, packageManager = "npm", product } = input;
  const spec = PRODUCTS[product];
  const sections: string[] = [];

  sections.push(
    `No supported coding agent was found on your PATH, so there is nothing for the wizard to drive.

Nothing has been changed. Here is the whole integration by hand — it is a short one.

You can also install one of Claude Code, Codex, Cursor, Gemini CLI, opencode,
Cline, Goose or Kilo Code and run this wizard again; it will use whichever you
have, with your own login.`,
  );

  sections.push(`── 1. Install ${spec.packageName} ──

  ${installCommand(packageManager, spec.packageName)}`);

  if (product === "publisher") {
    sections.push(`── 2. Create one shared client ──

  import Specify, { ImageFormat } from "@specify-sh/sdk";

  export const specify = new Specify({
    publisherKey: "${key}",
    cacheMostRecentAddress: true, // browser only — never enable server-side
  });

Create it once and share it. It is browser-only: keep it out of server-rendered
and build-time code paths.

── 3. Wire consent to your CMP ──

  cmp.onConsentChange((consent) => {
    if (consent.targetedAdvertising) {
      specify.consentForEnhancedTracking();
    } else {
      specify.revokeEnhancedTrackingConsent();
    }
  });

Consent is never persisted by the SDK — it lives on the instance for the
lifetime of the page. Call it on EVERY page load where the user has consented,
so your CMP stays the single source of truth and a withdrawal takes effect on
the very next page view. Ads serve with or without consent; consent only enables
the identity cookie.

── 4. Hand over connected wallets ──

  walletClient.on("connect", ({ account }) => {
    specify.identify(account.address);
  });

Call \`identify()\` from your real wallet-connect callback. Addresses accumulate
and are used by every later \`serve()\`. WalletConnect sessions are invisible to
passive detection, so they must come through here.

── 5. Serve and render an ad ──

  const ad = await specify.serve({
    imageFormat: ImageFormat.LANDSCAPE,
    adUnitId: "header-banner",
  });

  if (!ad) return null; // no fill — render NOTHING, no empty box, no spinner

  // Required: a visible "Sponsored" label, and ad.ctaUrl used exactly as
  // returned, with rel="noopener noreferrer sponsored".

Formats: LANDSCAPE (640x360), LONG_BANNER (1456x180), SHORT_BANNER (640x200),
NO_IMAGE (text only). \`ad.imageUrl\` may be null and may be an animated GIF.

── 6. Tear down in single-page apps ──

  specify.destroy(); // stops wallet detection and detaches its listeners

── Alternative: Google Tag Manager / CDN, no npm ──

  <script>window.specify=window.specify||function(){(window.specify.q=window.specify.q||[]).push(arguments)};</script>
  <script async src="${spec.loaderUrl}"></script>

  <script>
    specify('init', { publisherKey: '${key}' });
    specify('consent');           // from your CMP, on every consented page load
    specify('identify', '0x...'); // on wallet connect
    specify('serve', { imageFormat: 'LANDSCAPE', adUnitId: 'header-banner-1' }, function (ad, error) {
      if (error || !ad) { return; }
      // build the DOM node here, including the "Sponsored" label
    });
  </script>

Commands: init, consent, revokeConsent, identify, serve. The inline stub must
come first; anything fired before \`init\` is buffered and replayed.

── Content-Security-Policy ──

  script-src 'self' https://spfsrv.com; connect-src 'self' https://spfsrv.com;

Ad images and community logos come from https://content.specify.sh and
https://assets.specify.sh — add those to img-src if you restrict images. Do not
proxy Specify requests through your own origin: that strips the identity cookie
and disables enhanced tracking.`);
  } else {
    sections.push(`── 2. Create one shared client ──

  import { SpecifyAnalytics } from "@specify-sh/advertiser";

  export const analytics = new SpecifyAnalytics({
    propertyKey: "${key}",
  });

Create it once, in the browser, as early in the page lifecycle as your framework
allows. Construction is the whole setup: it captures the \`spclid\` click id from
the landing URL, starts passive wallet detection, hooks SPA route changes and
records the first page view.

── 3. Wire consent to your consent banner ──

  onConsentChange((granted) =>
    granted
      ? analytics.consentForEnhancedTracking()
      : analytics.revokeEnhancedTrackingConsent(),
  );

Nothing leaves the page without consent — events are held in memory only, and
are released in order the moment consent is granted, so the landing-page view
that happened just before the user clicked "Accept" still reaches your funnel.
Consent is never persisted by the SDK, so call it on EVERY page load where the
user has consented.

── 4. Hand over connected wallets ──

  onWalletConnect((addresses) => analytics.identify(addresses));

The strongest signal you can send. Call it from your real wallet-connect
callback; WalletConnect sessions are invisible to passive detection.

── 5. Log your conversion milestones ──

  analytics.logEvent("signup_completed", { plan: "pro" });

Names match /^[a-z0-9_]{1,64}$/; props are JSON up to 8 KB.

\`page_view\` (including SPA route changes), \`wallet_detected\` and
\`wallet_changed\` are captured automatically — do not re-implement them.

── 6. Tear down in single-page apps ──

  analytics.destroy(); // flushes, stops detection, restores patched history

── Alternative: Google Tag Manager / CDN, no npm ──

  <script>window.specifyAnalytics=window.specifyAnalytics||function(){(window.specifyAnalytics.q=window.specifyAnalytics.q||[]).push(arguments)};</script>
  <script async src="${spec.loaderUrl}"></script>

  <script>
    specifyAnalytics('init', { propertyKey: '${key}' });
    specifyAnalytics('consent');
    specifyAnalytics('identify', ['0x...']);
    specifyAnalytics('event', 'signup_completed', { plan: 'pro' });
  </script>

Commands: init, consent, revokeConsent, identify, event. Tag ordering does not
matter — anything fired before \`init\` is buffered and replayed.

── Content-Security-Policy ──

Add https://spfsrv.com to connect-src (and to script-src if you use the
tag-manager install).`);
  }

  if (isPlaceholderKey(key)) {
    sections.push(`── Replace the placeholder key ──

"${key}" is a placeholder, not a real ${spec.keyLabel}. Swap in your own before
this ships — the SDK throws on a malformed key at construction.`);
  }

  sections.push(`Full documentation: ${spec.docsUrl}`);

  return sections.join("\n\n");
}
