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

## API Reference

### `new Specify(config)`

Creates a new instance of the Specify client.

- `config.publisherKey` - Your publisher API key (required, format: `spk_` followed by 30 alphanumeric characters)
- `config.cacheMostRecentAddress` - Optional boolean, defaults to `false`. Set to `true` to enable caching the most recent wallet data across requests in supported environments (e.g., browser `localStorage`).

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
