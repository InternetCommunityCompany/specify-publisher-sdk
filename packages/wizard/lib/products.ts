/**
 * The two things this wizard can install, and every fact about them that the
 * rest of the package needs: key shape, package name, CDN loader, docs link.
 *
 * Everything here is ground truth copied from the SDK sources — the publisher
 * key check lives in `packages/sdk/lib/index.ts` and the advertiser one in
 * `packages/advertiser/lib/index.ts`. Keep the two in step.
 */

/** Which SDK the developer is integrating. */
export type ProductId = "publisher" | "advertiser";

/** Package managers the wizard knows how to write an install command for. */
export type PackageManager = "npm" | "yarn" | "pnpm" | "bun";

export interface ProductSpec {
  /** The npm package the integration installs. */
  packageName: string;
  /** Public documentation entry point for this SDK. */
  docsUrl: string;
  /** Human label used in prompts and summaries. */
  label: string;
  /** One-line description shown in the product picker. */
  hint: string;
  id: ProductId;
  /** Global the GTM/CDN loader installs itself on. */
  loaderGlobal: string;
  /** Self-contained GTM/CDN loader served by the Specify edge. */
  loaderUrl: string;
  /** Name of the constructor config field the key is passed as. */
  keyConfigField: string;
  /** Required key length, prefix included. */
  keyLength: number;
  /** Required key prefix. */
  keyPrefix: string;
  /** What the docs and this wizard call the key. */
  keyLabel: string;
  /** Stand-in written into the integration when the key is skipped. */
  placeholderKey: string;
}

/** The Specify edge origin every SDK talks to. */
export const EDGE_ORIGIN = "https://spfsrv.com";

export const PRODUCTS: Record<ProductId, ProductSpec> = {
  advertiser: {
    docsUrl: "https://docs.specify.sh/advertising/analytics-sdk",
    hint: "Funnel analytics for your campaign landing pages",
    id: "advertiser",
    keyConfigField: "propertyKey",
    keyLabel: "property key",
    keyLength: 34,
    keyPrefix: "adv_",
    label: "Advertiser analytics SDK (@specify-sh/advertiser)",
    loaderGlobal: "specifyAnalytics",
    loaderUrl: "https://spfsrv.com/sdk/advertiser/v1.js",
    packageName: "@specify-sh/advertiser",
    placeholderKey: "adv_YOUR_PROPERTY_KEY_HERE_0000000",
  },
  publisher: {
    docsUrl: "https://docs.specify.sh/publishing/sdk-reference",
    hint: "Serve Specify ads on your site and get paid",
    id: "publisher",
    keyConfigField: "publisherKey",
    keyLabel: "publisher key",
    keyLength: 34,
    keyPrefix: "spk_",
    label: "Publisher SDK (@specify-sh/sdk)",
    loaderGlobal: "specify",
    loaderUrl: "https://spfsrv.com/sdk/v1.js",
    packageName: "@specify-sh/sdk",
    placeholderKey: "spk_YOUR_PUBLISHER_KEY_HERE_000000",
  },
};

/** Stable order for the product picker and for tests that iterate products. */
export const PRODUCT_IDS: ProductId[] = ["publisher", "advertiser"];

/** Whether an arbitrary string names one of the products. */
export function isProductId(value: string): value is ProductId {
  return value === "publisher" || value === "advertiser";
}

/**
 * The install command for a package under a given package manager.
 *
 * @param manager - Package manager detected in the target project
 * @param packageName - Package to install
 * @returns A single shell command
 */
export function installCommand(manager: PackageManager, packageName: string): string {
  // Pinned to major 1: older published majors have a different, smaller API,
  // and an unpinned install would resolve to whatever is newest on npm.
  const pinned = `${packageName}@^1`;
  switch (manager) {
    case "bun":
      return `bun add ${pinned}`;
    case "pnpm":
      return `pnpm add ${pinned}`;
    case "yarn":
      return `yarn add ${pinned}`;
    default:
      return `npm install ${pinned}`;
  }
}
