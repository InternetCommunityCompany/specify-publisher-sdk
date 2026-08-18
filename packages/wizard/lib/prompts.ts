/**
 * The prompts the wizard hands to the user's coding agent.
 *
 * These are the product: everything else in this package is plumbing around
 * them. They are built as plain strings from pure functions so the guardrails
 * can be asserted in tests instead of being trusted.
 */

import { isPlaceholderKey } from "./keys";
import { PRODUCTS, type ProductId, installCommand } from "./products";
import { type Recon, renderReconForPrompt } from "./recon";
import { referenceFor } from "./references";

/** Extra system instructions applied to every run the wizard starts. */
export const SYSTEM_PROMPT = `You are integrating a third-party SDK into someone else's working codebase on their behalf, from a setup wizard they ran.

Their trust budget is one reviewable diff. Change only what the integration needs, follow the conventions already in the files you touch, and never refactor, reformat or "improve" code that is not part of the integration. If something is ambiguous, choose the smaller change and say so in your final message rather than guessing large.`;

/** The guardrails repeated in every implementation prompt. */
export function implementationRules(product: ProductId, key: string): string[] {
  const spec = PRODUCTS[product];
  const rules = [
    "Touch only the files the integration actually requires. No refactors, no reformatting, no unrelated cleanups, no changes to lint or build config unless the integration cannot work without them.",
    "Use the documented API exactly as written in the reference above. Do not invent constructor options, method names or config fields — if the reference does not show it, it does not exist.",
    "Do not add any other analytics, tag manager, telemetry or tracking library. Do not send data anywhere except through this SDK.",
    `Use the key exactly as given: ${key}. Never invent, guess, edit or "correct" a key, and never generate a random one.`,
    "The consent gate must be wired to the site's real consent mechanism. Consent is not persisted by the SDK, so it must be granted on every page load where the user has consented — put the call where the consent state is read on load, not only where the banner is clicked.",
    "NEVER hardcode consent as granted, and never call the consent method unconditionally at module scope. If this codebase has no consent mechanism at all, add a small, clearly-named consent check stub with a TODO explaining that it must be wired to a real CMP, and say so explicitly in your final message.",
    `Put \`identify()\` in the codebase's real wallet-connect callback — the place where a connected address actually becomes known. If there is no wallet connection in this codebase, skip \`identify()\` entirely rather than fabricating a callback.`,
  ];

  if (product === "publisher") {
    rules.push(
      "Render the ad only when `serve()` resolves with an ad. On `null` or an error, render nothing at all — no empty container, no spinner, no error state.",
      'Include a visible "Sponsored" label, and link to `ad.ctaUrl` exactly as returned with `rel="noopener noreferrer sponsored"`.',
    );
  } else {
    rules.push(
      "Do not re-implement `page_view`, `wallet_detected` or `wallet_changed` — the SDK captures those itself. Only add `logEvent()` calls for real product milestones.",
      "Every `logEvent()` name must match /^[a-z0-9_]{1,64}$/ and its props must be a plain JSON object well under 8 KB.",
    );
  }

  rules.push(
    `Install with the project's own package manager. Do not switch package managers and do not edit the lockfile by hand.`,
    "In a single-page app, call `destroy()` from the teardown path of whatever created the client, where the framework has such a lifecycle.",
    "The SDK is browser-only. Keep the client and all of its calls out of server-rendered and build-time code paths.",
    "Finish by summarising, in your final message: every file you changed, where consent is wired, where `identify()` is wired, and anything you left for the developer to finish.",
  );

  if (isPlaceholderKey(key)) {
    rules.push(
      `The key above is a PLACEHOLDER, not a real ${spec.keyLabel}. Write it in exactly as given and leave an obvious TODO comment next to it telling the developer to replace it. Do not try to find a real key anywhere in the codebase or the environment.`,
    );
  }

  return rules;
}

function numbered(items: string[]): string {
  return items.map((item, index) => `${index + 1}. ${item}`).join("\n");
}

/**
 * The read-only investigation prompt.
 *
 * Asks for facts only. The agent cannot change anything on this pass, so the
 * prompt does not need to constrain edits — it needs to stop the agent guessing.
 *
 * @param product - Which SDK is being installed
 * @returns The recon prompt
 */
export function buildReconPrompt(product: ProductId): string {
  const spec = PRODUCTS[product];
  const eventAsk =
    product === "advertiser"
      ? `
- suggestedEvents: up to 5 REAL product milestones from this codebase that are worth logging as conversions — a completed signup, a first deposit, a swap. Name each one in snake_case matching /^[a-z0-9_]{1,64}$/, say which file and function it happens in, and why it matters to a funnel. Take these from code you actually read. If you cannot find five real ones, return fewer. Never pad the list with generic examples.`
      : "";

  return `You are the reconnaissance pass of a setup wizard that is about to add ${spec.packageName} to this project. You are running READ-ONLY: you cannot change anything, and nothing you do here is applied.

Your only job is to establish facts about this codebase so the next pass can write a correct integration. Read the code. Do not guess, and do not answer from what projects like this usually look like.

Investigate and report:

- framework: which of next, react-vite, vue, nuxt, svelte, plain-html, other — plus a variant where it matters (app-router, pages-router, sveltekit, ...).
- typescript: whether this project is TypeScript.
- packageManager: npm, yarn, pnpm or bun. Decide from the lockfile actually present, and from packageManager in package.json.
- ssr: whether any of this code renders on a server or at build time.
- cmp: the consent management platform in use — Cookiebot, OneTrust, Osano, Klaro, a hand-rolled cookie banner, anything. Report its name, your confidence from 0 to 1, and wireLocation: the exact file and callback where the consent decision becomes readable on page load. Return null ONLY if you searched and there genuinely is none. Look for consent, cookie, gdpr, banner and privacy in file names, component names and dependencies.
- walletStack: wagmi, rainbowkit, connectkit, web3modal, viem-raw, window.ethereum, or none. In connectionLocation, name the exact file and callback where a newly connected address becomes known to the app — the wagmi \`onConnect\`, the \`useAccount\` consumer, the connect handler.
- gtmPresent: whether Google Tag Manager is already installed.
- entryPoints: the files where a shared client should be created and initialised, best candidate first, each with a one-line reason. Prefer wherever this project already puts shared singletons and app-wide providers.${eventAsk}

Answer with the JSON object only.`;
}

export interface ImplementationPromptInput {
  /** Absolute path to the project being modified. */
  dir: string;
  /** The key to write in, real or placeholder. */
  key: string;
  product: ProductId;
  /** Findings from the recon pass, or null when recon was skipped. */
  recon: Recon | null;
}

/**
 * The prompt for the pass that actually edits the codebase.
 *
 * When `recon` is null the agent has not investigated yet, so the prompt tells
 * it to do that first — that is the single conservative combined pass used on
 * agents that cannot run read-only or cannot return structured output.
 *
 * @param input - Product, key, target directory and recon findings
 * @returns The implementation prompt
 */
export function buildImplementationPrompt(input: ImplementationPromptInput): string {
  const { dir, key, product, recon } = input;
  const spec = PRODUCTS[product];
  const manager = recon?.packageManager ?? "npm";

  const findings = recon
    ? `## What the reconnaissance pass found

${renderReconForPrompt(recon, product)}

Treat these as strong hints from a previous read-only pass, not as gospel. Verify anything you are about to depend on, and prefer what the code actually says.`
    : `## Investigate before you edit

There was no separate reconnaissance pass, so start by reading this codebase: the framework and its version, TypeScript or not, which package manager the lockfile implies, whether anything renders server-side, whether a consent management platform or cookie banner exists and where its decision becomes readable, whether wallets are connected anywhere and in which callback, and where this project keeps shared singletons. Only then start editing.`;

  return `${referenceFor(product)}

---

# Your task

Integrate ${spec.packageName} into the project at ${dir}, using the reference above as the only authority on its API.

Install it with the project's package manager (for example: \`${installCommand(manager, spec.packageName)}\`), create one shared client, wire consent, wire wallet identification, and ${
    product === "publisher"
      ? "render an ad in a sensible placement"
      : "log the conversion events that matter in this product"
  }.

${findings}

## Rules

${numbered(implementationRules(product, key))}`;
}

/**
 * The prompt for a single combined pass on an agent that cannot run read-only
 * or cannot return structured output.
 *
 * @param input - Product, key and target directory; `recon` is ignored
 * @returns The combined prompt
 */
export function buildCombinedPrompt(input: Omit<ImplementationPromptInput, "recon">): string {
  return buildImplementationPrompt({ ...input, recon: null });
}
