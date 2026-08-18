/**
 * The recon pass: the JSON schema the agent answers with, a defensive
 * normalizer for what comes back, and the human-readable plan rendered from it.
 *
 * The agent's reply is validated against the schema by AnyAgent before it lands
 * on `RunResult.json`, but "validated" only means shape — every field is still
 * a claim about someone else's codebase. `normalizeRecon` therefore re-checks
 * everything and degrades to a usable default rather than throwing, so a
 * half-answered recon still produces a plan.
 */

import type { PackageManager, ProductId } from "./products";

export const FRAMEWORKS = ["next", "react-vite", "vue", "nuxt", "svelte", "plain-html", "other"] as const;
export type FrameworkName = (typeof FRAMEWORKS)[number];

export const PACKAGE_MANAGERS: PackageManager[] = ["npm", "yarn", "pnpm", "bun"];

export const WALLET_STACKS = [
  "wagmi",
  "rainbowkit",
  "connectkit",
  "web3modal",
  "viem-raw",
  "window.ethereum",
  "none",
] as const;
export type WalletStackName = (typeof WALLET_STACKS)[number];

export interface ReconFramework {
  name: FrameworkName;
  /** e.g. "app-router", "pages-router", "vite", "sveltekit". */
  variant?: string;
}

export interface ReconCmp {
  /** How sure the agent is, 0–1. */
  confidence: number;
  /** Product name, e.g. "Cookiebot", "OneTrust", "Osano", "custom banner". */
  name: string;
  /** File and callback where the consent decision becomes available. */
  wireLocation: string;
}

export interface ReconWalletStack {
  /** Where the app learns a wallet connected. */
  connectionLocation: string;
  name: WalletStackName;
}

export interface ReconEntryPoint {
  file: string;
  /** Why this file is the right place for the init call. */
  why: string;
}

export interface ReconSuggestedEvent {
  /** Must match /^[a-z0-9_]{1,64}$/. */
  name: string;
  where: string;
  why: string;
}

export interface Recon {
  cmp: ReconCmp | null;
  entryPoints: ReconEntryPoint[];
  framework: ReconFramework;
  gtmPresent: boolean;
  packageManager: PackageManager;
  /** Anything the agent could not answer, collected during normalization. */
  notes: string[];
  ssr: boolean;
  /** Advertiser only; empty for the publisher SDK. */
  suggestedEvents: ReconSuggestedEvent[];
  typescript: boolean;
  walletStack: ReconWalletStack;
}

/** Event names the advertiser SDK accepts. */
const EVENT_NAME_REGEX = /^[a-z0-9_]{1,64}$/;

/**
 * The JSON Schema the recon run is asked to answer with.
 *
 * `additionalProperties` is deliberately left open: on agents where structured
 * output is emulated, a strict schema turns a mostly-correct reply into a hard
 * parse failure, and the normalizer discards extras anyway.
 *
 * @param product - Which SDK, since only the advertiser asks for event ideas
 * @returns A plain JSON Schema object for `RunOptions.schema`
 */
export function reconSchema(product: ProductId): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    cmp: {
      description:
        "The site's consent management platform, or null if there is genuinely none. confidence is 0-1. wireLocation is the file and callback where the consent decision becomes available.",
      properties: {
        confidence: { maximum: 1, minimum: 0, type: "number" },
        name: { type: "string" },
        wireLocation: { type: "string" },
      },
      required: ["name", "confidence", "wireLocation"],
      type: ["object", "null"],
    },
    entryPoints: {
      description: "Files where the SDK should be created and initialised, best candidate first.",
      items: {
        properties: { file: { type: "string" }, why: { type: "string" } },
        required: ["file", "why"],
        type: "object",
      },
      type: "array",
    },
    framework: {
      properties: {
        name: { enum: [...FRAMEWORKS], type: "string" },
        variant: { description: "e.g. app-router, pages-router, vite, sveltekit", type: "string" },
      },
      required: ["name"],
      type: "object",
    },
    gtmPresent: { description: "Whether Google Tag Manager is already installed.", type: "boolean" },
    packageManager: { enum: [...PACKAGE_MANAGERS], type: "string" },
    ssr: { description: "Whether any of this code renders on the server.", type: "boolean" },
    typescript: { type: "boolean" },
    walletStack: {
      description:
        "How the app connects wallets. connectionLocation is the file and callback where a connection becomes known.",
      properties: {
        connectionLocation: { type: "string" },
        name: { enum: [...WALLET_STACKS], type: "string" },
      },
      required: ["name", "connectionLocation"],
      type: "object",
    },
  };

  const required = [
    "framework",
    "typescript",
    "packageManager",
    "ssr",
    "cmp",
    "walletStack",
    "gtmPresent",
    "entryPoints",
  ];

  if (product === "advertiser") {
    properties.suggestedEvents = {
      description:
        "Up to 5 real product milestones worth logging, taken from this codebase — not generic examples. name must match ^[a-z0-9_]{1,64}$.",
      items: {
        properties: {
          name: { pattern: "^[a-z0-9_]{1,64}$", type: "string" },
          where: { type: "string" },
          why: { type: "string" },
        },
        required: ["name", "where", "why"],
        type: "object",
      },
      maxItems: 5,
      type: "array",
    };
    required.push("suggestedEvents");
  }

  return { properties, required, type: "object" };
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/**
 * Turn whatever the agent returned into a `Recon` that the rest of the wizard
 * can use unconditionally.
 *
 * Nothing here throws. A missing or malformed field becomes a conservative
 * default and a line in `notes`, which the plan then shows to the user — being
 * honest about what the recon failed to establish is more useful than
 * pretending a default was a finding.
 *
 * @param raw - `RunResult.json` from the recon run
 * @param product - Which SDK, since suggested events are advertiser-only
 * @returns A fully-populated recon result
 */
export function normalizeRecon(raw: unknown, product: ProductId): Recon {
  const notes: string[] = [];
  const root = asRecord(raw);

  if (!root) {
    notes.push("The agent returned no structured findings; treating everything as unknown.");
  }

  const frameworkRaw = asRecord(root?.framework);
  const frameworkName = oneOf(frameworkRaw?.name, FRAMEWORKS, "other");
  if (!frameworkRaw) {
    notes.push("Framework was not reported.");
  }

  const packageManager = oneOf(root?.packageManager, PACKAGE_MANAGERS, "npm");
  if (root && !PACKAGE_MANAGERS.includes(root.packageManager as PackageManager)) {
    notes.push("Package manager was not reported; assuming npm.");
  }

  const cmpRaw = asRecord(root?.cmp);
  let cmp: ReconCmp | null = null;
  if (cmpRaw) {
    const confidence = typeof cmpRaw.confidence === "number" ? Math.min(1, Math.max(0, cmpRaw.confidence)) : 0;
    cmp = {
      confidence,
      name: asString(cmpRaw.name, "unnamed consent banner"),
      wireLocation: asString(cmpRaw.wireLocation, "not established"),
    };
  }

  const walletRaw = asRecord(root?.walletStack);
  const walletStack: ReconWalletStack = {
    connectionLocation: asString(walletRaw?.connectionLocation, "not established"),
    name: oneOf(walletRaw?.name, WALLET_STACKS, "none"),
  };

  const entryPoints: ReconEntryPoint[] = Array.isArray(root?.entryPoints)
    ? root.entryPoints
        .map((item) => asRecord(item))
        .filter((item): item is Record<string, unknown> => item !== null)
        .map((item) => ({ file: asString(item.file), why: asString(item.why) }))
        .filter((item) => item.file !== "")
    : [];
  if (entryPoints.length === 0) {
    notes.push("No entry point was identified; the agent will have to find one itself.");
  }

  let suggestedEvents: ReconSuggestedEvent[] = [];
  if (product === "advertiser") {
    suggestedEvents = (Array.isArray(root?.suggestedEvents) ? root.suggestedEvents : [])
      .map((item) => asRecord(item))
      .filter((item): item is Record<string, unknown> => item !== null)
      .map((item) => ({
        name: asString(item.name),
        where: asString(item.where),
        why: asString(item.why),
      }))
      .filter((item) => EVENT_NAME_REGEX.test(item.name))
      .slice(0, 5);
    if (suggestedEvents.length === 0) {
      notes.push("No conversion events were suggested; only the automatic ones will be captured.");
    }
  }

  return {
    cmp,
    entryPoints,
    framework: { name: frameworkName, variant: asString(frameworkRaw?.variant) || undefined },
    gtmPresent: asBoolean(root?.gtmPresent, false),
    notes,
    packageManager,
    ssr: asBoolean(root?.ssr, false),
    suggestedEvents,
    typescript: asBoolean(root?.typescript, false),
    walletStack,
  };
}

/**
 * Render the recon as the plan the user confirms before anything is written.
 *
 * @param recon - Normalized recon findings
 * @param product - Which SDK is being installed
 * @returns Plain text, one finding per line
 */
export function renderPlan(recon: Recon, product: ProductId): string {
  const lines: string[] = [];
  const framework = recon.framework.variant
    ? `${recon.framework.name} (${recon.framework.variant})`
    : recon.framework.name;

  lines.push(`Framework       ${framework}`);
  lines.push(`Language        ${recon.typescript ? "TypeScript" : "JavaScript"}`);
  lines.push(`Package manager ${recon.packageManager}`);
  lines.push(`Rendering       ${recon.ssr ? "server-side rendering in play" : "client only"}`);
  lines.push(`GTM installed   ${recon.gtmPresent ? "yes" : "no"}`);

  if (recon.cmp) {
    const confidence = `${Math.round(recon.cmp.confidence * 100)}% confident`;
    lines.push(`Consent         ${recon.cmp.name} (${confidence})`);
    lines.push(`                wire into ${recon.cmp.wireLocation}`);
  } else {
    lines.push("Consent         none found — a consent check stub will be added for you to wire up");
  }

  if (recon.walletStack.name === "none") {
    lines.push("Wallets         none found — identify() will not be wired");
  } else {
    lines.push(`Wallets         ${recon.walletStack.name}`);
    lines.push(`                identify() goes in ${recon.walletStack.connectionLocation}`);
  }

  if (recon.entryPoints.length > 0) {
    lines.push("");
    lines.push("Entry points");
    for (const entry of recon.entryPoints) {
      lines.push(`  ${entry.file}${entry.why ? ` — ${entry.why}` : ""}`);
    }
  }

  if (product === "advertiser" && recon.suggestedEvents.length > 0) {
    lines.push("");
    lines.push("Conversion events to log");
    for (const event of recon.suggestedEvents) {
      lines.push(`  ${event.name} — ${event.where}${event.why ? ` (${event.why})` : ""}`);
    }
  }

  if (recon.notes.length > 0) {
    lines.push("");
    lines.push("Unresolved");
    for (const note of recon.notes) {
      lines.push(`  ${note}`);
    }
  }

  return lines.join("\n");
}

/**
 * The recon findings as a compact block for the implementation prompt.
 *
 * @param recon - Normalized recon findings
 * @param product - Which SDK is being installed
 * @returns Plain text for embedding in a prompt
 */
export function renderReconForPrompt(recon: Recon, product: ProductId): string {
  const lines: string[] = [
    `- Framework: ${recon.framework.name}${recon.framework.variant ? ` / ${recon.framework.variant}` : ""}`,
    `- Language: ${recon.typescript ? "TypeScript" : "JavaScript"}`,
    `- Package manager: ${recon.packageManager} (use this one, do not switch)`,
    `- Server-side rendering: ${recon.ssr ? "yes — the SDK is browser-only, keep it out of server code paths" : "no"}`,
    `- Google Tag Manager already installed: ${recon.gtmPresent ? "yes" : "no"}`,
    recon.cmp
      ? `- Consent platform: ${recon.cmp.name} (confidence ${recon.cmp.confidence}); wire consent at ${recon.cmp.wireLocation}`
      : "- Consent platform: none found — add a minimal consent check stub and flag it, never hardcode consent",
    recon.walletStack.name === "none"
      ? "- Wallet stack: none found — skip identify() rather than inventing a connect callback"
      : `- Wallet stack: ${recon.walletStack.name}; the connection becomes known at ${recon.walletStack.connectionLocation}`,
  ];

  if (recon.entryPoints.length > 0) {
    lines.push("- Entry points:");
    for (const entry of recon.entryPoints) {
      lines.push(`  - ${entry.file}${entry.why ? `: ${entry.why}` : ""}`);
    }
  }

  if (product === "advertiser" && recon.suggestedEvents.length > 0) {
    lines.push("- Conversion events to log:");
    for (const event of recon.suggestedEvents) {
      lines.push(`  - ${event.name} at ${event.where}${event.why ? `: ${event.why}` : ""}`);
    }
  }

  if (recon.notes.length > 0) {
    lines.push("- Recon could not establish:");
    for (const note of recon.notes) {
      lines.push(`  - ${note}`);
    }
  }

  return lines.join("\n");
}
