<div align="center">
  <h1>Specify Publisher SDK</h1>

  <p>
    JavaScript SDK for Specify Publishers to serve targeted content based on wallet addresses
  </p>

  <div>
    <img alt="Version JSON Badge" src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Finternetcommunitycompany%2Fspecify-publisher-sdk%2Fmain%2Fpackage.json&query=%24.version&label=Version">
    <img alt="Release Workflow Status" src="https://img.shields.io/github/actions/workflow/status/internetcommunitycompany/specify-publisher-sdk/release.yml?style=flat&label=Release">
  </div>
</div>

---

> Now in beta!

The Specify Publisher SDK enables publishers to serve targeted content to users based on their wallet addresses. It provides a simple and elegant API for web3-enabled applications.

## Installation

```bash
# Using bun
bun add @specify/sdk

# Using npm
npm install @specify/sdk

# Using yarn
yarn add @specify/sdk

```

## Basic Usage

```js
import Specify, { AuthenticationError, ValidationError } from "@specify/sdk";

// Initialize with your publisher key
const specify = new Specify({
  publisherKey: "your_publisher_key",
});

// Serve content based on wallet address
async function serveContent() {
  try {
    const walletAddress = "0x1234567890123456789012345678901234567890";
    const content = await specify.serve(walletAddress);
  } catch (error) {
    if (error instanceof AuthenticationError) {
      // Handle authentication errors
    } else if (error instanceof ValidationError) {
      // Handle validation errors
    } else {
        // Handle other errors
    }
  }
}

serveContent();
```

## API Reference

### `new Specify(config)`

Creates a new instance of the Specify client.

- `config.publisherKey` - Your publisher API key (required, format: `spk_` followed by 30 alphanumeric characters)

### `specify.serve(address)`

Serves content based on the provided wallet address.

- `address` - Ethereum or EVM-compatible wallet address (format: `0x` followed by 40 hexadecimal characters)
- Returns: Promise resolving to content object

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

## License

MIT 