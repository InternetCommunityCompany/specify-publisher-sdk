<div align="center">
  <h1>Specify Publisher SDK</h1>

  <p>
    JavaScript SDK for Specify Publishers to serve targeted content based on wallet addresses
  </p>

  <div>
  <a href="https://github.com/InternetCommunityCompany/specify-publisher-sdk">
     <img alt="Version JSON Badge" src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Finternetcommunitycompany%2Fspecify-publisher-sdk%2Fmain%2Fpackages%2Fsdk%2Fpackage.json&query=%24.version&label=Version">
    </a>
    <a href="https://github.com/InternetCommunityCompany/specify-publisher-sdk">
     <img alt="Release Workflow Status" src="https://img.shields.io/github/actions/workflow/status/internetcommunitycompany/specify-publisher-sdk/release.yml?style=flat&label=Release">
    </a>
  </div>
</div>

---

The Specify Publisher SDK enables publishers to serve targeted ad content to users based on their wallet addresses.

## What's new in 1.0

- **Serving moved to the Specify edge** at `https://spfsrv.com`. Same request and response contract, new host.
- **Wallet auto-detection.** The SDK passively discovers wallets already connected to the page (EIP-6963, with a `window.ethereum` fallback) and folds them into every request. It only ever calls `eth_accounts` — it never prompts, and never asks for permissions.
- **`identify()`** lets you register addresses your app already knows about once, instead of threading them down to every ad slot.
- **Enhanced tracking and consent.** With `consentForEnhancedTracking()`, ad requests are sent credentialed so the edge's server-only identity cookie is attached. That lets a wallet-targeted ad fill on a page where no wallet is connected. Ads serve with or without consent.
- **A GTM / CDN loader** for publishers who install tags rather than npm packages.

Upgrading is a version bump: see [Migrating from 0.4.x](#migrating-from-04x).

## Installation

```bash
# Using bun
bun add @specify-sh/sdk

# Using npm
npm install @specify-sh/sdk

# Using yarn
yarn add @specify-sh/sdk

```

## Basic Usage

```js
import Specify, { AuthenticationError, ValidationError, NotFoundError, APIError, ImageFormat } from "@specify-sh/sdk";

// Initialize with your publisher key and enable wallet caching
const specify = new Specify({
  publisherKey: "your_publisher_key",
  cacheMostRecentAddress: true // Do not enable this in server environments
});

// Serve content based on wallet address
async function serveContent() {
  try {
    const walletAddress = "0x1234567890123456789012345678901234567890";

    // Serve content with a provided wallet address. The SDK will also use the wallet cache if available.
    const content = await specify.serve(walletAddress, {imageFormat: ImageFormat.LANDSCAPE, adUnitId: "header-banner-1"});

    // Or; serve content solely relying on the addresses cache (Only works if you have cacheAddressesInLocalSession enabled.)
    const content = await specify.serve(undefined, {imageFormat: ImageFormat.SHORT_BANNER, adUnitId: "sidebar-ad-1"});
  } catch (error) {
    if (error instanceof AuthenticationError) {
      // Handle authentication errors
    } else if (error instanceof ValidationError) {
      // Handle validation errors
    } else if (error instanceof NotFoundError) {
      // Handle no ad found error
    } else if (error instanceof APIError) {
      // Handle API errors
    } else {
      // Handle other errors
    }
  }
}

serveContent();
```

In the browser you can also skip the address argument entirely. The SDK serves against the wallets it detected on the page, anything you passed to `identify()`, and the cached wallet data:

```js
const content = await specify.serve({ imageFormat: ImageFormat.LANDSCAPE, adUnitId: "header-banner-1" });
```

Both call shapes are supported and can be mixed freely.

## Advanced Usage

### Serving content matching across ads multiple addresses

You can provide a list of wallet addresses and we will find the best ad across all of them. This is useful if your users have multiple wallets connected at a given time for example.

```js
// Serve content matching across multiple wallet addresses (max 50).
const addresses = [
  "0x1234567890123456789012345678901234567890",
  "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
  "0x9876543210987654321098765432109876543210"
];

// Serve content with multiple provided addresses + SDK memory.
const content = await specify.serve(addresses, {imageFormat: ImageFormat.LONG_BANNER, adUnitId: "ad-unit-2"});
```

### Registering addresses with `identify()`

If your app learns the user's address outside of a render — a wallet connect callback, a restored session, a WalletConnect pairing that auto-detection cannot see — register it once and every later `serve()` picks it up:

```js
walletClient.on("connect", ({ account }) => {
  specify.identify(account.address);
});

// No address argument needed from here on.
const content = await specify.serve({ imageFormat: ImageFormat.LANDSCAPE });
```

Addresses accumulate across calls and are deduplicated.

### Consent and enhanced tracking

Ads serve with or without consent. Consent only enables the cross-site identity cookie, which lets the edge resolve an audience on pages where no wallet is connected.

Consent is **never persisted by the SDK**. It lives on the instance for the lifetime of the page, so your Consent Management Platform stays the single source of truth — call it from your CMP on **every page load** where the user has consented, and a withdrawal takes effect on the very next page view.

```js
cmp.onConsentReady((consent) => {
  if (consent.targetedAdvertising) {
    specify.consentForEnhancedTracking();
  } else {
    specify.revokeEnhancedTrackingConsent();
  }
});

specify.hasEnhancedTrackingConsent(); // -> boolean
```

The cookie is server-only: the SDK never reads, writes or sees its value. Consenting simply means the ad request is sent with `credentials: "include"` instead of `credentials: "omit"`.

### Disabling wallet auto-detection

```js
const specify = new Specify({
  publisherKey: "your_publisher_key",
  privacy: { disableWalletDetection: true }
});
```

Addresses passed to `serve()` and `identify()` still work with detection off.

## Google Tag Manager / CDN

For tag-managed sites, load the SDK from the edge instead of npm. Paste this into a **Custom HTML** tag (or directly into your page `<head>`):

```html
<script>window.specify=window.specify||function(){(window.specify.q=window.specify.q||[]).push(arguments)};</script>
<script async src="https://spfsrv.com/sdk/v1.js"></script>
```

The inline stub buffers commands while the script downloads, so you can call `specify(...)` immediately — nothing needs to wait for the SDK to arrive.

### Commands

| Command | Arguments | Notes |
| --- | --- | --- |
| `specify('init', config)` | Same config object as `new Specify(config)` | Creates the singleton. A repeat `init` warns and is ignored. |
| `specify('consent')` | — | Grants enhanced tracking consent. |
| `specify('revokeConsent')` | — | Withdraws it. |
| `specify('identify', addresses)` | Address or array of addresses | Merged into later serves. |
| `specify('serve', options, callback)` | `options` is `{ imageFormat, adUnitId? }` | `callback(ad, error)` — `ad` is the ad object or `null`. |

`serve`, `consent` and `identify` calls made before `init` are buffered and replayed once `init` runs. The class itself is also exposed as `window.Specify` if you would rather construct it yourself.

### Custom HTML tag example

```html
<script>window.specify=window.specify||function(){(window.specify.q=window.specify.q||[]).push(arguments)};</script>
<script async src="https://spfsrv.com/sdk/v1.js"></script>

<script>
  specify('init', { publisherKey: 'spk_your_publisher_key' });

  // Call this from your CMP whenever the user has consented, on every page load.
  specify('consent');

  // If your site already knows the connected wallet, hand it over.
  // specify('identify', '0x1234567890123456789012345678901234567890');

  specify('serve', { imageFormat: 'LANDSCAPE', adUnitId: 'header-banner-1' }, function (ad, error) {
    if (error || !ad) {
      return; // No fill, or a request error. Leave the slot as-is.
    }

    var slot = document.getElementById('specify-ad');
    if (!slot) {
      return;
    }

    var link = document.createElement('a');
    link.href = ad.ctaUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';

    if (ad.imageUrl) {
      var image = document.createElement('img');
      image.src = ad.imageUrl;
      image.alt = ad.headline;
      image.style.maxWidth = '100%';
      link.appendChild(image);
    }

    var headline = document.createElement('h4');
    headline.textContent = ad.headline;

    var body = document.createElement('p');
    body.textContent = ad.content;

    var cta = document.createElement('span');
    cta.textContent = ad.ctaLabel;

    link.appendChild(headline);
    link.appendChild(body);
    link.appendChild(cta);
    slot.appendChild(link);
  });
</script>

<div id="specify-ad"></div>
```

## Migrating from 0.4.x

**No API changes are required.** Every 0.4.x call still compiles and behaves the same way; everything in 1.0 is additive.

Requests now go to `https://spfsrv.com` instead of `https://app.specify.sh`. If you run a Content-Security-Policy, add `https://spfsrv.com` to `connect-src` — and to `script-src` as well if you load the SDK through GTM:

```
connect-src 'self' https://spfsrv.com;
script-src 'self' https://spfsrv.com;
```

## API Reference

### `new Specify(config)`

Creates a new instance of the Specify client.

- `config.publisherKey` - Your publisher API key (required, format: `spk_` followed by 30 alphanumeric characters)
- `config.cacheMostRecentAddress` - Optional boolean, defaults to `false`. Set to `true` to enable caching the most recent wallet data across requests in supported environments (e.g., browser `localStorage`).
- `config.privacy.disableWalletDetection` - Optional boolean, defaults to `false`. Turns off passive wallet auto-detection.
- `config.edge.baseUrl` - Optional string. Overrides the edge origin (e.g. `http://localhost:3000` for local development). Most integrations never need this.

### `specify.serve(addressOrAddresses, {imageFormat, adUnitId})`

Serves content based on the provided wallet address(es).

- `addressOrAddresses` - Optional. Single wallet address, array of wallet addresses (max 50), or `undefined` if relying solely on the cached wallet data. If `cacheMostRecentAddress` is `true`, the SDK will attempt to use the cached wallet data if available, either independently or in conjunction with provided addresses.
  - Format: Standard EVM address format: `0x123...`
  - Automatically deduplicated by the SDK
- `imageFormat` - Required image format from the `ImageFormat` enum
- `adUnitId` - Optional arbitrary string identifier to identify where the ad is being displayed
- Returns: Promise resolving to ad content object (returns `null` if no ad is found)

### `specify.serve({imageFormat, adUnitId})`

The same call without an address argument. The SDK serves against the wallets it already knows: those passed to `identify()`, those found by auto-detection, and the cached wallet data.

The wallet set sent to the edge is assembled in this order — addresses you pass to `serve()`, then `identify()`'d addresses, then auto-detected ones — deduplicated and capped at 50. Only passing more than 50 addresses yourself throws; inferred addresses beyond the cap are dropped instead.

### `specify.identify(addressOrAddresses)`

Registers wallet address(es) to merge into every later `serve()` call. Addresses accumulate and are stored lowercased. Throws `ValidationError` on a malformed address.

### `specify.consentForEnhancedTracking()`

Grants enhanced tracking consent on this instance, so ad requests are sent credentialed. Not persisted — call it from your CMP on every page load. No-op outside the browser.

### `specify.revokeEnhancedTrackingConsent()`

Withdraws consent. Later requests omit credentials.

### `specify.hasEnhancedTrackingConsent()`

Returns `true` when ad requests will be sent credentialed.

### `specify.getDetectedWallets()`

Returns the addresses found by passive auto-detection, lowercased. Empty when detection is disabled or outside the browser.

### `specify.destroy()`

Stops wallet detection and detaches its listeners. Call it when tearing down a single-page-app view that created a client.

#### Response Object

```typescript
interface SpecifyAd {
  walletAddress: string;
  campaignId: string;
  adId: string;
  headline: string;
  content: string;
  ctaUrl: string;
  ctaLabel: string;
  imageUrl: string;
  communityName: string;
  communityLogo: string;
  imageFormat: "LANDSCAPE" | "LONG_BANNER" | "SHORT_BANNER" | "NO_IMAGE";  
  adUnitId?: string;
}
```

### `ImageFormat` Enum

The `ImageFormat` enum defines the available image format options:

- `ImageFormat.LANDSCAPE` - 16:9 - Landscape-oriented images
- `ImageFormat.LONG_BANNER` - 8.09:1 - Long banner format
- `ImageFormat.SHORT_BANNER` - 16:5 - Short banner format
- `ImageFormat.NO_IMAGE` - No image, text-only ads

### `adUnitId` String
- Optional
- Arbitrary string identifier to identify where the ad is being displayed

### Error Types

- `AuthenticationError` - Invalid API key format or authentication failure
- `ValidationError` - Invalid wallet address format, or too many addresses (>50)
- `NotFoundError` - No ad found for the provided address(es)
- `APIError` - Network errors or other HTTP errors

---

## Build from Source

### Requirements:

- [Bun](https://bun.sh)

This repository is a Bun workspaces monorepo. `packages/sdk` is the published `@specify-sh/sdk` package; `packages/core` is private shared plumbing that is bundled into the SDK's output.

```bash
# Clone the repository
git clone https://github.com/internetcommunitycompany/specify-publisher-sdk.git
cd specify-publisher-sdk

# Install dependencies
bun install

# Run tests
bun test

# Typecheck
bun run types

# Lint and format
bun run check

# Build every package (outputs to packages/*/dist)
bun run build
```

The build produces `packages/sdk/dist/index.js` (ESM), `packages/sdk/dist/index.d.ts`, and `packages/sdk/dist/loader/v1.js` (the self-contained GTM/CDN loader, served at `https://spfsrv.com/sdk/v1.js`).

## Examples

Check out our [examples repository](https://github.com/InternetCommunityCompany/specify-publisher-sdk-examples) for complete implementation examples in different frameworks and environments.

## License

MIT
