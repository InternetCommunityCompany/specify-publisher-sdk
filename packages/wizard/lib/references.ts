/**
 * The integration reference for each product: the exact, current API surface,
 * distilled from `packages/sdk/lib/index.ts`, `packages/advertiser/lib/index.ts`
 * and the published docs.
 *
 * This text is the wizard's ground truth. It is embedded verbatim into the
 * implementation prompt so the coding agent writes against the real API instead
 * of whatever it remembers, and it is the source of the manual instructions
 * printed when no agent is installed. When the SDKs change, change this.
 */

import { PRODUCTS, type ProductId } from "./products";

/** The publisher SDK, end to end. */
export const PUBLISHER_REFERENCE = `# @specify-sh/sdk — Publisher SDK reference

Serves Specify ads against the wallet addresses a page knows about.

## Install

npm install @specify-sh/sdk@^1
(or: bun add / yarn add / pnpm add @specify-sh/sdk@^1)

Everything in this reference is the v1 API. Older majors (0.4.x) have a
different, smaller API — never install or write against one. If the package
manager cannot resolve ^1, do not fall back to an older version: add
"@specify-sh/sdk": "^1.0.0" to package.json by hand, skip the install, and
report that in your summary.

## Create the client

\`\`\`js
import Specify, { ImageFormat, AuthenticationError, ValidationError, APIError } from "@specify-sh/sdk";

const specify = new Specify({
  publisherKey: "spk_...",        // required: "spk_" + 30 chars, 34 total
  cacheMostRecentAddress: true,   // optional, browser only — never enable server-side
  privacy: { disableWalletDetection: false }, // optional
});
\`\`\`

Create ONE client and share it (a module singleton, a React context, whatever
the app already uses for shared services). The constructor throws
\`ValidationError\` on a malformed key. Passive, read-only wallet detection
(EIP-6963 / \`eth_accounts\`) starts automatically and never prompts the user.

## Consent — \`consentForEnhancedTracking()\`

\`\`\`js
consentForEnhancedTracking(): void        // send ad requests credentialed
revokeEnhancedTrackingConsent(): void     // stop
hasEnhancedTrackingConsent(): boolean
\`\`\`

Consent enables the Specify edge's server-only identity cookie, which lets the
edge resolve an audience on pages where no wallet is connected. Ads serve with
or without it.

Consent is NEVER persisted by the SDK. It lives on the instance for the lifetime
of the page, so the site's Consent Management Platform stays the single source of
truth and must call \`consentForEnhancedTracking()\` on EVERY page load where the
user has consented. A withdrawal in the CMP then takes effect on the very next
page view.

\`\`\`js
cmp.onConsentChange((consent) => {
  if (consent.targetedAdvertising) {
    specify.consentForEnhancedTracking();
  } else {
    specify.revokeEnhancedTrackingConsent();
  }
});
\`\`\`

## Wallets — \`identify()\`

\`\`\`js
identify(addressOrAddresses: \`0x\${string}\` | \`0x\${string}\`[]): void
getDetectedWallets(): \`0x\${string}\`[]
\`\`\`

Call \`identify()\` from the app's real wallet-connect callback. Addresses
accumulate, are lowercased and deduplicated, and ride along on every later
\`serve()\`. WalletConnect sessions are invisible to passive detection, so they
must go through \`identify()\`. Throws \`ValidationError\` on anything that is not
\`/^0x[a-fA-F0-9]{40}$/\`.

## Serving — \`serve()\`

\`\`\`js
// Options-only form — the recommended browser form. Uses identified +
// passively detected wallets and the identity cookie.
serve(options: ServeOptions): Promise<SpecifyAd | null>

// Wallets-first form — works everywhere, including server-side.
serve(addressOrAddresses, options: ServeOptions): Promise<SpecifyAd | null>
\`\`\`

\`ServeOptions\` is \`{ imageFormat: ImageFormat, adUnitId?: string }\`.
\`imageFormat\` is REQUIRED. \`adUnitId\` is an arbitrary string naming the slot —
set it on every call so reporting can tell placements apart.

\`ImageFormat\` values: \`LANDSCAPE\` (16:9, 640x360), \`LONG_BANNER\` (8.09:1,
1456x180), \`SHORT_BANNER\` (16:5, 640x200), \`NO_IMAGE\` (text only, \`imageUrl\`
is null). Max 50 addresses per call.

Resolves to \`null\` on a no-fill — that is not an error. It also resolves to
\`null\` without a network request when the SDK has no wallets and no consent.

\`\`\`js
const ad = await specify.serve({ imageFormat: ImageFormat.LANDSCAPE, adUnitId: "header-banner" });
\`\`\`

### The returned ad

\`{ headline, content, ctaUrl, ctaLabel, imageUrl, communityName, communityLogo, imageFormat, adId, campaignId, walletAddress, adUnitId? }\`

\`imageUrl\` may be \`null\` (and may be an animated GIF — a plain \`<img>\` handles
it). \`content\` is a simplified-markdown subset up to 400 chars; at minimum
preserve its line breaks (\`white-space: pre-line\`).

### Rendering rules — these are not optional

- On \`null\` or an error, render NOTHING. No empty box, no spinner, no error state.
- A visible "Sponsored" label is REQUIRED. The SDK does not add it.
- Link to \`ad.ctaUrl\` exactly as returned. Never modify it or append params.
- Use \`target="_blank" rel="noopener noreferrer sponsored"\`.

\`\`\`jsx
if (!ad) return null;

return (
  <aside className="specify-ad">
    <span className="specify-ad__label">Sponsored</span>
    <div className="specify-ad__brand">
      <img src={ad.communityLogo} alt="" width={20} height={20} />
      <span>{ad.communityName}</span>
    </div>
    {ad.imageUrl && <img src={ad.imageUrl} alt={ad.headline} />}
    <h3>{ad.headline}</h3>
    <p style={{ whiteSpace: "pre-line" }}>{ad.content}</p>
    <a href={ad.ctaUrl} target="_blank" rel="noopener noreferrer sponsored">{ad.ctaLabel}</a>
  </aside>
);
\`\`\`

In React, guard the effect against races (a \`cancelled\` flag) and key it on a
stable primitive, not on an array identity.

## Teardown — \`destroy()\`

\`specify.destroy()\` stops wallet detection and detaches its listeners. Call it
from the teardown path of any single-page-app view that created a client. The
instance must not be reused afterwards.

## Errors

\`ValidationError\` (bad key, bad address, bad options), \`AuthenticationError\`
(401), \`APIError\` (everything else, carries \`status\`). A no-fill is \`null\`, not
a throw. Fail open: log and render nothing.

## GTM / CDN alternative (no npm)

\`\`\`html
<script>window.specify=window.specify||function(){(window.specify.q=window.specify.q||[]).push(arguments)};</script>
<script async src="https://spfsrv.com/sdk/v1.js"></script>

<script>
  specify('init', { publisherKey: 'spk_...' });
  specify('consent');                       // from the CMP, on every consented page load
  specify('identify', '0x...');             // on wallet connect
  specify('serve', { imageFormat: 'LANDSCAPE', adUnitId: 'header-banner-1' }, function (ad, error) {
    if (error || !ad) { return; }           // no fill — leave the slot empty
    // build the DOM node here, including the "Sponsored" label
  });
</script>
\`\`\`

Commands: \`init\`, \`consent\`, \`revokeConsent\`, \`identify\`, \`serve\`. Anything
fired before \`init\` is buffered and replayed. The inline stub must come first.
\`imageFormat\` is a plain string here — there is no enum to import.

## Content-Security-Policy

\`\`\`
Content-Security-Policy: script-src 'self' https://spfsrv.com; connect-src 'self' https://spfsrv.com;
\`\`\`

Ad images and community logos come from \`https://content.specify.sh\` and
\`https://assets.specify.sh\` — add those to \`img-src\` if images are restricted.
Do NOT proxy Specify requests through your own origin: that strips the identity
cookie and disables enhanced tracking. CORS is handled on Specify's side.
`;

/** The advertiser analytics SDK, end to end. */
export const ADVERTISER_REFERENCE = `# @specify-sh/advertiser — Advertiser analytics SDK reference

Funnel analytics for an advertiser's own site: saw the ad, visited, converted.
Events are reporting only — Specify never bills on them, there is no allowlist of
"billable" events, and nothing sent here affects campaign spend.

## Install

npm install @specify-sh/advertiser@^1
(or: bun add / yarn add / pnpm add @specify-sh/advertiser@^1)

Everything in this reference is the v1 API. If the package manager cannot
resolve ^1, do not substitute any other package or version: add
"@specify-sh/advertiser": "^1.0.0" to package.json by hand, skip the install,
and report that in your summary.

## Create the client

\`\`\`js
import { SpecifyAnalytics } from "@specify-sh/advertiser";

const analytics = new SpecifyAnalytics({
  propertyKey: "adv_...",         // required: "adv_" + 30 chars, 34 total
  privacy: { disableWalletDetection: false }, // optional
});
\`\`\`

Create ONE client and share it. The constructor throws \`ValidationError\` on a
malformed key. Construction is the whole setup: it captures the \`spclid\` click
id from the landing URL, starts passive wallet detection, patches
\`history.pushState\`/\`replaceState\` for SPA route changes and records the first
\`page_view\`. It must run in the browser, once, as early in the page lifecycle as
the framework allows.

## Consent — \`consentForEnhancedTracking()\`

\`\`\`js
consentForEnhancedTracking(): void        // start sending
revokeEnhancedTrackingConsent(): void     // stop sending, drop what is queued
hasEnhancedTrackingConsent(): boolean
\`\`\`

Nothing leaves the page without consent. Until the consent banner reports
approval and \`consentForEnhancedTracking()\` is called, events are held in memory
only — never sent, never stored, gone when the tab closes (buffer depth 20,
oldest dropped). Granting consent releases the held events in order, so the
landing-page view that happened moments before the user clicked "Accept" still
makes it into the funnel. Revoking stops sending immediately and discards what
is queued.

Consent is NEVER persisted by the SDK. It lives on the instance for the lifetime
of the page, so the CMP must call \`consentForEnhancedTracking()\` on EVERY page
load where the user has consented.

\`\`\`js
onConsentChange((granted) =>
  granted
    ? analytics.consentForEnhancedTracking()
    : analytics.revokeEnhancedTrackingConsent(),
);
\`\`\`

## Wallets — \`identify()\`

\`\`\`js
identify(addressOrAddresses: \`0x\${string}\` | \`0x\${string}\`[]): void
getDetectedWallets(): \`0x\${string}\`[]
\`\`\`

The strongest signal available. Call it from the app's real wallet-connect
callback — WalletConnect sessions are invisible to passive detection, so they
must come through here. Addresses accumulate, are lowercased and validated
against \`/^0x[a-fA-F0-9]{40}$/\` (throws \`ValidationError\` otherwise), and ride
along on every later event. It does not itself emit an event.

## Events — \`logEvent()\`

\`\`\`js
logEvent(name: string, props?: Record<string, unknown>): void
\`\`\`

\`name\` must match \`/^[a-z0-9_]{1,64}$/\` — lowercase letters, digits and
underscores only. \`props\` must be a plain, JSON-serialisable object of at most
8 KB serialised. Both throw \`ValidationError\` when violated.

Log real product milestones, named for what happened:
\`signup_completed\`, \`deposit_started\`, \`docs_viewed\`, \`swap_executed\`.

\`\`\`js
analytics.logEvent("signup_completed", { plan: "pro" });
\`\`\`

### Captured automatically — do NOT re-implement these

- \`page_view\` on load and on every SPA route change (\`pushState\`,
  \`replaceState\`, \`popstate\`); a repeat of the same URL is not re-emitted.
- \`wallet_detected\` on the first passive wallet snapshot, \`wallet_changed\` after.

Every event also carries the page URL, the referrer, a per-tab session id, the
known wallets, and the Specify click id \`spclid\` when the visit came from an ad.
Events are batched before sending.

## Teardown — \`destroy()\`

\`analytics.destroy()\` flushes what is queued, stops wallet detection, restores
the patched history methods and drops all state. Call it from the teardown path
of any single-page-app view that created a client. The instance must not be
reused afterwards.

## GTM / CDN alternative (no npm)

\`\`\`html
<script>window.specifyAnalytics=window.specifyAnalytics||function(){(window.specifyAnalytics.q=window.specifyAnalytics.q||[]).push(arguments)};</script>
<script async src="https://spfsrv.com/sdk/advertiser/v1.js"></script>

<script>
  specifyAnalytics('init', { propertyKey: 'adv_...' });
  specifyAnalytics('consent');                                   // from the CMP, every consented page load
  specifyAnalytics('identify', ['0x...']);                       // on wallet connect
  specifyAnalytics('event', 'signup_completed', { plan: 'pro' });
</script>
\`\`\`

Commands: \`init\`, \`consent\`, \`revokeConsent\`, \`identify\`, \`event\`. Tag ordering
does not matter — anything fired before \`init\` is buffered and replayed. The
global is deliberately \`specifyAnalytics\`, distinct from the publisher tag's
\`specify\`, so both can run on one page.

## Content-Security-Policy

Add \`https://spfsrv.com\` to \`connect-src\` (and to \`script-src\` when using the
tag-manager install).
`;

/**
 * The reference text for one product.
 *
 * @param product - Which SDK
 * @returns The full integration reference
 */
export function referenceFor(product: ProductId): string {
  return product === "publisher" ? PUBLISHER_REFERENCE : ADVERTISER_REFERENCE;
}

/**
 * The canonical docs link for one product.
 *
 * @param product - Which SDK
 * @returns A public https URL
 */
export function docsUrlFor(product: ProductId): string {
  return PRODUCTS[product].docsUrl;
}
