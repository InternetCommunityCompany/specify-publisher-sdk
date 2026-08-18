/**
 * Flag parsing, on `node:util`'s `parseArgs` so the CLI carries no
 * argument-parsing dependency.
 *
 * Parsing is pure and returns a result object rather than throwing or exiting,
 * so every branch is testable without a process.
 */

import { isAbsolute, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { ProductId } from "./products";

export interface WizardArgs {
  /** Coding agent id to use, skipping the picker. */
  agent?: string;
  /** Absolute path to the project the SDK is being added to. */
  dir: string;
  /** Recon and plan only — never applies changes. */
  dryRun: boolean;
  help: boolean;
  /** The publisher or property key, when supplied on the command line. */
  key?: string;
  /** Which SDK to install; undefined means "ask". */
  product?: ProductId;
  /** Skip every confirmation prompt. */
  yes: boolean;
}

export type ParseResult = { args: WizardArgs; ok: true } | { error: string; ok: false };

export const USAGE = `specify-wizard — add a Specify SDK to your codebase

  npx @specify-sh/wizard [options]

The wizard drives whichever coding agent you already have installed (Claude
Code, Codex, Cursor, ...) to write the integration. It never asks for an API
key and never runs a model itself — your agent supplies both.

Options
  --publisher          Install the publisher SDK (@specify-sh/sdk)
  --advertiser         Install the advertiser analytics SDK (@specify-sh/advertiser)
  --key <key>          Your publisher key (spk_...) or property key (adv_...)
  --agent <id>         Coding agent to drive, e.g. claude-code, codex, cursor
  --dir <path>         Project to modify (default: the current directory)
  --dry-run            Investigate and print the plan; change nothing
  --yes                Skip confirmation prompts
  --help               Show this message

Examples
  npx @specify-sh/wizard
  npx @specify-sh/wizard --publisher --key spk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
  npx @specify-sh/wizard --advertiser --dry-run
`;

/**
 * Parse the wizard's flags.
 *
 * @param argv - Arguments after the node binary and script path
 * @param cwd - Directory to resolve a relative `--dir` against
 * @returns The parsed arguments, or a message explaining what was wrong
 */
export function parseWizardArgs(argv: string[], cwd: string): ParseResult {
  let values: {
    advertiser?: boolean;
    agent?: string;
    dir?: string;
    "dry-run"?: boolean;
    help?: boolean;
    key?: string;
    publisher?: boolean;
    yes?: boolean;
  };

  try {
    ({ values } = parseArgs({
      allowPositionals: false,
      args: argv,
      options: {
        advertiser: { type: "boolean" },
        agent: { type: "string" },
        dir: { type: "string" },
        "dry-run": { type: "boolean" },
        help: { short: "h", type: "boolean" },
        key: { type: "string" },
        publisher: { type: "boolean" },
        yes: { short: "y", type: "boolean" },
      },
      strict: true,
    }));
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not parse arguments.", ok: false };
  }

  if (values.publisher && values.advertiser) {
    return { error: "Pass either --publisher or --advertiser, not both.", ok: false };
  }

  let product: ProductId | undefined;
  if (values.publisher) {
    product = "publisher";
  } else if (values.advertiser) {
    product = "advertiser";
  }

  if (values.agent !== undefined && values.agent.trim() === "") {
    return { error: "--agent needs an agent id, e.g. --agent claude-code.", ok: false };
  }

  const rawDir = values.dir?.trim();
  if (values.dir !== undefined && !rawDir) {
    return { error: "--dir needs a path.", ok: false };
  }
  const dir = rawDir ? (isAbsolute(rawDir) ? rawDir : resolve(cwd, rawDir)) : cwd;

  return {
    args: {
      agent: values.agent?.trim(),
      dir,
      dryRun: values["dry-run"] === true,
      help: values.help === true,
      key: values.key?.trim() || undefined,
      product,
      yes: values.yes === true,
    },
    ok: true,
  };
}
