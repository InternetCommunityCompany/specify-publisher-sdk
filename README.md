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

// Initialize with your publisher key and enable wallet memory (true by default)
const specify = new Specify({
  publisherKey: "your_publisher_key",
});

// Serve content based on wallet address
async function serveContent() {
  try {
    const walletAddress = "0x1234567890123456789012345678901234567890";

    // Serve content with a provided wallet address + SDK memory.
    const content = await specify.serve([walletAddress], {imageFormat: ImageFormat.LANDSCAPE, adUnitId: "header-banner-1"});

    // Serve content solely relying on SDK memory for wallets.
    const contentFromMemory = await specify.serve(undefined, {imageFormat: ImageFormat.SQUARE, adUnitId: "sidebar-ad-1"});
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

### Serving content to multiple addresses

```js
// Serve content to multiple wallet addresses (max 50). The SDK will remember these by default.
const addresses = [
  "0x1234567890123456789012345678901234567890",
  "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
  "0x9876543210987654321098765432109876543210"
];

// Serve content with multiple provided addresses + SDK memory.
const content = await specify.serve(addresses, {imageFormat: ImageFormat.SQUARE, adUnitId: "ad-unit-2"});

// Serve content solely relying on SDK memory for wallets.
const contentFromMemoryMultiple = await specify.serve(undefined, {imageFormat: ImageFormat.LONG_BANNER, adUnitId: "ad-unit-3"});
```

## API Reference

### `new Specify(config)`

Creates a new instance of the Specify client.

- `config.publisherKey` - Your publisher API key (required, format: `spk_` followed by 30 alphanumeric characters)
- `config.memorizeWalletsAcrossRequests` - Optional boolean, defaults to `true`. Set to `false` to disable wallet address memory across requests.

### `specify.serve(addressOrAddresses, {imageFormat, adUnitId})`

Serves content based on the provided wallet address(es).

- `addressOrAddresses` - Optional. Single wallet address, array of wallet addresses (can be empty), or `undefined` if relying solely on SDK memory (max 50 addresses). If `memorizeWalletsAcrossRequests` is `true`, provided addresses will be merged with previously stored addresses.
  - Format: `0x` followed by 40 hexadecimal characters
  - Duplicate addresses are automatically removed
- `imageFormat` - Required image format from the `ImageFormat` enum
- `adUnitId` - Optional arbitrary string identifier to identify where the ad is being displayed
- Returns: Promise resolving to ad content object (throws `NotFoundError` if no ad is found)

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
  imageFormat: "LANDSCAPE" | "SQUARE" | "LONG_BANNER" | "SHORT_BANNER" | "NO_IMAGE";  
  adUnitId?: string;
}
```

### `ImageFormat` Enum

The `ImageFormat` enum defines the available image format options:

- `ImageFormat.LANDSCAPE` - 16:9 - Landscape-oriented images
- `ImageFormat.SQUARE` - 1:1 - Square images
- `ImageFormat.LONG_BANNER` - 8:1 - Long banner format
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