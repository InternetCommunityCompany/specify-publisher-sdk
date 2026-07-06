<div align="center">
  <h1>Specify Publisher SDK</h1>

  <p>
    JavaScript SDK for Specify Publishers to serve targeted content based on wallet addresses
  </p>

  <div>
  <a href="https://github.com/InternetCommunityCompany/specify-publisher-sdk">
     <img alt="Version JSON Badge" src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Finternetcommunitycompany%2Fspecify-publisher-sdk%2Fmain%2Fpackage.json&query=%24.version&label=Version">
    </a>
    <a href="https://github.com/InternetCommunityCompany/specify-publisher-sdk">
     <img alt="Release Workflow Status" src="https://img.shields.io/github/actions/workflow/status/internetcommunitycompany/specify-publisher-sdk/release.yml?style=flat&label=Release">
    </a>
  </div>
</div>

---

> Now in beta!

The Specify Publisher SDK enables publishers to serve targeted ad content to users based on their wallet addresses.

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

## Identity layer (v0.5+)

From v0.5 the SDK includes an optional identity layer that lets ad requests be
resolved against the Specify network identity graph, so wallet-targeted ads can
be served even to sessions that haven't passed a wallet explicitly.

Two things happen automatically in the browser:

1. **Passive wallet detection.** On init the SDK discovers injected wallets via
   [EIP-6963](https://eips.ethereum.org/EIPS/eip-6963) (with a legacy
   `window.ethereum` fallback) and makes a **silent** `eth_accounts` read. It
   **never** prompts the user or calls `eth_requestAccounts`. Detected addresses
   are merged into subsequent `serve()` calls. Turn this off with
   `privacy.disableWalletDetection: true`.
2. **Credentialed ad requests.** Each `serve()` is sent with credentials, so the
   server-only cross-site identifier cookie rides along and is set/refreshed on
   the ad response itself — no separate sync ping is needed on publisher pages.
   The cookie is `HttpOnly` and **server-set only** — the SDK never reads or
   handles its value, and it never appears in client code, logs, or the DOM. In
   browsers that block third-party cookies (Safari, Firefox, Brave) nothing is
   persisted and the SDK degrades gracefully to wallet-/click-only behaviour.

```js
const specify = new Specify({
  publisherKey: "spk_...",
  environment: "production",          // default
  privacy: { disableWalletDetection: false }, // default
});

// In the browser, serve() always fires — even with no wallet — so the ad server
// can resolve one from the identity cookie:
const ad = await specify.serve(undefined, { imageFormat: ImageFormat.LANDSCAPE });

// WalletConnect and other remote wallets don't inject a provider. There is no
// setWalletAddresses() here on purpose: just pass the address your dApp already
// holds straight to serve() — that targets the ad *and* seeds the graph:
await specify.serve("0xabc...", { imageFormat: ImageFormat.LANDSCAPE });

// Inspect what passive detection currently sees:
specify.getDetectedWallets();

// Release listeners when tearing down a view (SPA):
specify.destroy();
```

## API Reference

### `new Specify(config)`

Creates a new instance of the Specify client.

- `config.publisherKey` - Your publisher API key (required, format: `spk_` followed by 30 alphanumeric characters)
- `config.cacheMostRecentAddress` - Optional boolean, defaults to `false`. Set to `true` to enable caching the most recent wallet data across requests in supported environments (e.g., browser `localStorage`).
- `config.environment` - Optional `"production"` (default) or `"staging"`. Selects the identity edge endpoints.
- `config.privacy.disableWalletDetection` - Optional boolean, defaults to `false`. Set to `true` to disable automatic passive wallet detection. `setWalletAddresses()` still works.
- `config.edge` - Optional advanced overrides for the identity edge (`baseUrl`, or per-endpoint `endpoints`). Most integrators never need this.

### `specify.getDetectedWallets()`

Returns the wallet addresses currently seen by passive detection (lowercase hex). For wallets detection can't see (e.g. WalletConnect), pass the address directly to `serve()` — there is no `setWalletAddresses()` on the publisher SDK by design.

### `specify.destroy()`

Stops wallet detection and flushes/detaches the event transport. Call when tearing down a client in a single-page app.

### `specify.serve(addressOrAddresses, {imageFormat, adUnitId})`

Serves content based on the provided wallet address(es).

- `addressOrAddresses` - Optional. Single wallet address, array of wallet addresses (max 50), or `undefined` if relying solely on the cached wallet data. If `cacheMostRecentAddress` is `true`, the SDK will attempt to use the cached wallet data if available, either independently or in conjunction with provided addresses.
  - Format: Standard EVM address format: `0x123...`
  - Automatically deduplicated by the SDK
- `imageFormat` - Required image format from the `ImageFormat` enum
- `adUnitId` - Optional arbitrary string identifier to identify where the ad is being displayed
- Returns: Promise resolving to ad content object (returns `null` if no ad is found)

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

## Privacy & consent

The identity layer collects, on publisher properties: page URL and referrer, a
first-party session id, detected/provided wallet addresses, and (server-side) a
cross-site identifier cookie plus IP/user-agent for fraud filtering. Wallet
addresses are treated as personal data under GDPR.

**Consent is the integrator's responsibility.** Publishers must obtain any
consents required under applicable law (GDPR/ePrivacy, CCPA, etc.) before
loading the SDK, and should gate the SDK behind their consent management
platform where required:

```js
cmp.onConsent(["analytics", "advertising"], () => {
  const specify = new Specify({ publisherKey: "spk_..." });
  // ...render ads
});
```

To run without automatic wallet detection, set
`privacy.disableWalletDetection: true`. See the enhanced-targeting spec (§9) for
retention periods and the full disclosure model.

---

## Build from Source

### Requirements:

- [Bun](https://bun.sh)

```bash
# Clone the repository
git clone https://github.com/internetcommunitycompany/specify-publisher-sdk.git
cd specify-publisher-sdk

# Install dependencies
bun install

# Run tests
bun test

# Build the library (output to dist directory)
bun run build
```

## Examples

Check out our [examples repository](https://github.com/InternetCommunityCompany/specify-publisher-sdk-examples) for complete implementation examples in different frameworks and environments.

## License

MIT
