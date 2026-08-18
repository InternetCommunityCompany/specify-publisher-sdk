/**
 * Post-run verification.
 *
 * The agent's own report of what it did is the least reliable thing in this
 * flow, so the wizard checks the tree itself: plain string scanning, no model
 * involved. It answers "is the thing that had to be there, there" — not "is
 * the integration correct", which only the diff can tell you.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import { PRODUCTS, type ProductId } from "./products";

/** Directories never worth walking. */
const SKIP_DIRS = new Set([
  ".cache",
  ".git",
  ".next",
  ".nuxt",
  ".output",
  ".svelte-kit",
  ".turbo",
  ".vercel",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "vendor",
]);

/** File extensions worth reading. */
const SOURCE_EXTENSIONS = new Set([
  ".astro",
  ".cjs",
  ".cts",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".mjs",
  ".mts",
  ".svelte",
  ".ts",
  ".tsx",
  ".vue",
]);

/** Guard against walking into something enormous. */
const MAX_FILES = 4000;
const MAX_FILE_BYTES = 512 * 1024;

export interface MarkerResult {
  /** Project-relative paths where the marker was found, capped for display. */
  files: string[];
  found: boolean;
  /** What is missing if it is missing, phrased for a human. */
  hint: string;
  /** Human name of what was looked for. */
  label: string;
  /** Whether the integration is incomplete without this. */
  required: boolean;
}

export interface VerificationResult {
  /** True when every required marker was found. */
  complete: boolean;
  /** True when the package appears in the project's package.json. */
  dependencyDeclared: boolean;
  markers: MarkerResult[];
}

interface MarkerSpec {
  hint: string;
  label: string;
  /** Any one of these substrings counts as a match. */
  needles: string[];
  required: boolean;
}

/**
 * What has to be present for each product's integration to be wired at all.
 *
 * Each marker accepts both the npm form and the GTM loader form, because either
 * is a legitimate integration.
 *
 * @param product - Which SDK was installed
 * @returns The marker specifications, in report order
 */
export function markerSpecs(product: ProductId): MarkerSpec[] {
  const spec = PRODUCTS[product];
  const isPublisher = product === "publisher";

  const specs: MarkerSpec[] = [
    {
      hint: `Nothing creates the client. Expected \`new ${isPublisher ? "Specify" : "SpecifyAnalytics"}({ ${spec.keyConfigField}: ... })\` or a \`${spec.loaderGlobal}('init', ...)\` tag.`,
      label: `${isPublisher ? "Specify" : "SpecifyAnalytics"} initialisation`,
      needles: isPublisher
        ? ["new Specify(", "specify('init'", 'specify("init"', spec.loaderUrl]
        : ["new SpecifyAnalytics(", "specifyAnalytics('init'", 'specifyAnalytics("init"', spec.loaderUrl],
      required: true,
    },
    {
      hint: "Consent is never granted, so the identity layer stays off. Wire `consentForEnhancedTracking()` to your consent mechanism, called on every page load where consent is granted.",
      label: "consentForEnhancedTracking",
      needles: ["consentForEnhancedTracking", `${spec.loaderGlobal}('consent'`, `${spec.loaderGlobal}("consent"`],
      required: true,
    },
    {
      hint: "No wallet address is ever handed to the SDK. If this project connects wallets, call `identify()` from the connect callback.",
      label: "identify",
      needles: [".identify(", `${spec.loaderGlobal}('identify'`, `${spec.loaderGlobal}("identify"`],
      required: false,
    },
  ];

  specs.push(
    isPublisher
      ? {
          hint: "No ad is ever requested. Call `serve({ imageFormat, adUnitId })` where the ad should appear.",
          label: "serve",
          needles: [".serve(", "specify('serve'", 'specify("serve"'],
          required: true,
        }
      : {
          hint: "No conversion event is logged, so only the automatic page_view and wallet events will be captured.",
          label: "logEvent",
          needles: [".logEvent(", "specifyAnalytics('event'", 'specifyAnalytics("event"'],
          required: false,
        },
  );

  return specs;
}

async function collectFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  const queue: string[] = [root];

  while (queue.length > 0 && found.length < MAX_FILES) {
    const dir = queue.shift();
    if (dir === undefined) {
      break;
    }

    let entries: Awaited<ReturnType<typeof readdir>>;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          queue.push(full);
        }
      } else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) {
        found.push(full);
        if (found.length >= MAX_FILES) {
          break;
        }
      }
    }
  }

  return found;
}

async function readIfSmall(path: string): Promise<string | null> {
  try {
    const info = await stat(path);
    if (info.size > MAX_FILE_BYTES) {
      return null;
    }
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

/**
 * Scan a project tree for the markers a finished integration leaves behind.
 *
 * @param dir - Absolute path to the project
 * @param product - Which SDK was installed
 * @returns Which markers were found, and where
 */
export async function verifyIntegration(dir: string, product: ProductId): Promise<VerificationResult> {
  const specs = markerSpecs(product);
  const hits = specs.map<string[]>(() => []);
  const packageName = PRODUCTS[product].packageName;
  let dependencyDeclared = false;

  for (const file of await collectFiles(dir)) {
    const contents = await readIfSmall(file);
    if (contents === null) {
      continue;
    }

    const rel = relative(dir, file) || file;

    // Any package.json in the tree counts: in a workspace monorepo the
    // dependency lands in the package that uses it, not at the root.
    if (basename(rel) === "package.json" && contents.includes(`"${packageName}"`)) {
      dependencyDeclared = true;
    }

    specs.forEach((spec, index) => {
      if (hits[index].length < 5 && spec.needles.some((needle) => contents.includes(needle))) {
        hits[index].push(rel);
      }
    });
  }

  const markers = specs.map<MarkerResult>((spec, index) => ({
    files: hits[index],
    found: hits[index].length > 0,
    hint: spec.hint,
    label: spec.label,
    required: spec.required,
  }));

  return {
    complete: markers.every((marker) => !marker.required || marker.found),
    dependencyDeclared,
    markers,
  };
}

/**
 * Render a verification result as terminal lines.
 *
 * @param result - What `verifyIntegration` found
 * @param product - Which SDK was installed
 * @returns Plain text, one marker per line plus hints for what is missing
 */
export function renderVerification(result: VerificationResult, product: ProductId): string {
  const lines: string[] = [];
  const packageName = PRODUCTS[product].packageName;

  lines.push(`${result.dependencyDeclared ? "found  " : "missing"}  ${packageName} in package.json`);

  for (const marker of result.markers) {
    const where = marker.files.length > 0 ? `  (${marker.files.join(", ")})` : "";
    lines.push(`${marker.found ? "found  " : "missing"}  ${marker.label}${where}`);
  }

  const gaps = result.markers.filter((marker) => !marker.found);
  if (gaps.length > 0) {
    lines.push("");
    for (const gap of gaps) {
      lines.push(`${gap.required ? "!" : "-"} ${gap.label}: ${gap.hint}`);
    }
  }

  return lines.join("\n");
}
