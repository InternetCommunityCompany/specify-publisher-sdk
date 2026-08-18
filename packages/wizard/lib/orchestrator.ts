/**
 * The wizard itself: the order of the questions, which passes run, and what
 * happens when each of them cannot.
 *
 * Every capability this needs arrives as an injected dependency, so the whole
 * flow — including the no-agent fallback and the dry run — can be driven in a
 * test with a scripted IO and a fake gateway. Nothing here spawns a process or
 * reads a keystroke on its own.
 */

import type { AgentGateway, AgentOption, AgentRunner, WizardRunResult } from "./agent";
import { describeEvent } from "./agent";
import type { WizardArgs } from "./args";
import { renderManualInstructions } from "./fallback";
import { type GitStatus, gitDiffStat, gitStatus } from "./git";
import { CANCELLED, type WizardIo } from "./io";
import { isPlaceholderKey, normalizeKey, placeholderKey, validateKey } from "./keys";
import { PRODUCTS, PRODUCT_IDS, type ProductId, isProductId } from "./products";
import { SYSTEM_PROMPT, buildImplementationPrompt, buildReconPrompt } from "./prompts";
import { type Recon, normalizeRecon, reconSchema, renderPlan } from "./recon";
import { type VerificationResult, renderVerification, verifyIntegration } from "./verify";

export interface WizardDeps {
  gateway: AgentGateway;
  io: WizardIo;
  /** Working-tree diff summary, injected so tests need no repo. */
  readDiffStat?: (dir: string) => Promise<string | null>;
  /** Repository state, injected so tests need no repo. */
  readGitStatus?: (dir: string) => Promise<GitStatus>;
  /** Marker scan, injected so tests need no fixture tree. */
  verify?: (dir: string, product: ProductId) => Promise<VerificationResult>;
}

/** Process exit codes the CLI reports. */
export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
export const EXIT_CANCELLED = 130;

async function pickProduct(args: WizardArgs, io: WizardIo): Promise<ProductId | typeof CANCELLED> {
  if (args.product) {
    return args.product;
  }
  const answer = await io.select(
    "Which Specify SDK are you adding?",
    PRODUCT_IDS.map((id) => ({ hint: PRODUCTS[id].hint, label: PRODUCTS[id].label, value: id })),
  );
  if (answer === CANCELLED) {
    return CANCELLED;
  }
  return isProductId(answer) ? answer : "publisher";
}

interface KeyChoice {
  key: string;
  skipped: boolean;
}

async function pickKey(
  args: WizardArgs,
  product: ProductId,
  io: WizardIo,
): Promise<KeyChoice | typeof CANCELLED | null> {
  const spec = PRODUCTS[product];

  if (args.key) {
    const key = normalizeKey(args.key);
    const check = validateKey(product, key);
    if (!check.valid) {
      io.error(`That --key is not a valid ${spec.keyLabel}. ${check.reason}`);
      return null;
    }
    return { key, skipped: false };
  }

  if (args.yes) {
    return { key: placeholderKey(product), skipped: true };
  }

  const answer = await io.text({
    message: `Your Specify ${spec.keyLabel} (leave blank to fill it in later)`,
    placeholder: `${spec.keyPrefix}...`,
    validate: (value) => {
      const candidate = normalizeKey(value);
      if (candidate === "") {
        return undefined;
      }
      return validateKey(product, candidate).reason;
    },
  });

  if (answer === CANCELLED) {
    return CANCELLED;
  }

  const key = normalizeKey(answer);
  return key === "" ? { key: placeholderKey(product), skipped: true } : { key, skipped: false };
}

async function confirmDirtyTree(
  args: WizardArgs,
  io: WizardIo,
  status: GitStatus,
): Promise<boolean | typeof CANCELLED> {
  if (status.isRepo && !status.dirty) {
    return true;
  }

  if (status.isRepo) {
    const sample = status.dirtyFiles.slice(0, 5).join(", ");
    const more = status.dirtyFiles.length > 5 ? `, and ${status.dirtyFiles.length - 5} more` : "";
    io.warn(
      `This working tree already has uncommitted changes (${sample}${more}). The agent is about to edit files here, and a clean tree is what makes its diff reviewable. Committing or stashing first is strongly recommended.`,
    );
  } else {
    io.warn(
      `${args.dir} is not a git repository. The agent will edit files here and there will be no diff to review and nothing to undo the changes with.`,
    );
  }

  if (args.yes) {
    return true;
  }
  return io.confirm("Continue anyway?", false);
}

async function pickAgent(
  args: WizardArgs,
  io: WizardIo,
  agents: AgentOption[],
): Promise<AgentOption | typeof CANCELLED | null> {
  if (args.agent) {
    const match = agents.find((agent) => agent.id === args.agent);
    if (!match) {
      io.error(
        `No installed coding agent with id "${args.agent}". Found: ${agents.map((agent) => agent.id).join(", ")}.`,
      );
      return null;
    }
    return match;
  }

  if (agents.length === 1) {
    const only = agents[0];
    io.info(`Using ${only.name}${only.version ? ` ${only.version}` : ""}.`);
    return only;
  }

  const answer = await io.select(
    "Which coding agent should do the work?",
    agents.map((agent) => ({
      hint: [agent.version, agent.canReadOnly ? undefined : "no read-only mode"].filter(Boolean).join(" · "),
      label: agent.name,
      value: agent.id,
    })),
  );
  if (answer === CANCELLED) {
    return CANCELLED;
  }
  return agents.find((agent) => agent.id === answer) ?? agents[0];
}

/**
 * Run one pass and return its result, streaming events to a spinner.
 *
 * @param runner - The agent to run
 * @param io - Terminal interface
 * @param label - Spinner label
 * @param prompt - The prompt
 * @param options - Run options
 * @returns The run result
 */
async function runPass(
  runner: AgentRunner,
  io: WizardIo,
  label: string,
  prompt: string,
  options: { cwd: string; readOnly?: boolean; schema?: Record<string, unknown> },
): Promise<WizardRunResult> {
  const spin = io.spinner();
  spin.start(label);

  const run = runner.run(prompt, { ...options, systemPrompt: SYSTEM_PROMPT });

  try {
    for await (const event of run.events) {
      const message = describeEvent(event);
      if (message) {
        spin.message(`${label} — ${message}`);
      }
    }
    const result = await run.done;
    spin.stop(`${label} — done`);
    return result;
  } catch (error) {
    spin.stop(`${label} — failed`);
    throw error;
  }
}

/**
 * Run the setup wizard.
 *
 * @param args - Parsed command-line arguments
 * @param deps - Injected gateway, terminal and filesystem helpers
 * @returns The process exit code
 */
export async function runWizard(args: WizardArgs, deps: WizardDeps): Promise<number> {
  const { gateway, io } = deps;
  const readGit = deps.readGitStatus ?? gitStatus;
  const readDiff = deps.readDiffStat ?? gitDiffStat;
  const scan = deps.verify ?? verifyIntegration;

  io.intro("Specify setup wizard");

  const product = await pickProduct(args, io);
  if (product === CANCELLED) {
    io.cancel("Nothing was changed.");
    return EXIT_CANCELLED;
  }
  const spec = PRODUCTS[product];

  const keyChoice = await pickKey(args, product, io);
  if (keyChoice === CANCELLED) {
    io.cancel("Nothing was changed.");
    return EXIT_CANCELLED;
  }
  if (keyChoice === null) {
    return EXIT_FAILED;
  }
  if (keyChoice.skipped) {
    io.warn(`No ${spec.keyLabel} given — the integration will use a placeholder you must replace.`);
  }

  const agents = await gateway.list();

  if (agents.length === 0) {
    io.plain(renderManualInstructions({ key: keyChoice.key, product }));
    io.outro("No coding agent found — nothing was changed.");
    return EXIT_OK;
  }

  const git = await readGit(args.dir);

  // A dry run changes nothing, so a dirty tree does not matter.
  if (!args.dryRun) {
    const proceed = await confirmDirtyTree(args, io, git);
    if (proceed === CANCELLED || proceed === false) {
      io.cancel("Nothing was changed.");
      return EXIT_CANCELLED;
    }
  }

  const chosen = await pickAgent(args, io, agents);
  if (chosen === CANCELLED) {
    io.cancel("Nothing was changed.");
    return EXIT_CANCELLED;
  }
  if (chosen === null) {
    return EXIT_FAILED;
  }

  let runner: AgentRunner;
  try {
    runner = await gateway.open(chosen.id);
  } catch (error) {
    io.error(`Could not start ${chosen.name}: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT_FAILED;
  }

  const canRecon = runner.canReadOnly && runner.canSchema;
  let recon: Recon | null = null;

  if (canRecon) {
    try {
      const result = await runPass(runner, io, `Investigating ${args.dir}`, buildReconPrompt(product), {
        cwd: args.dir,
        readOnly: true,
        schema: reconSchema(product),
      });
      recon = normalizeRecon(result.json, product);
    } catch (error) {
      io.warn(
        `The read-only investigation did not complete (${error instanceof Error ? error.message : String(error)}). Falling back to a single pass that investigates as it goes.`,
      );
    }
  } else {
    io.info(
      `${runner.name} cannot ${runner.canReadOnly ? "return structured findings" : "run read-only"}, so the wizard will use a single pass that investigates before editing.`,
    );
  }

  if (recon) {
    io.note(renderPlan(recon, product), `Plan for ${spec.packageName}`);
  }

  if (args.dryRun) {
    io.outro(
      recon
        ? "Dry run — nothing was changed. Re-run without --dry-run to apply this plan."
        : "Dry run — nothing was changed. This agent cannot investigate read-only, so there is no plan to show.",
    );
    return EXIT_OK;
  }

  if (recon && !args.yes) {
    const apply = await io.confirm("Apply this plan?", true);
    if (apply === CANCELLED || apply === false) {
      io.cancel("Nothing was changed.");
      return EXIT_CANCELLED;
    }
  }

  let outcome: WizardRunResult;
  try {
    outcome = await runPass(
      runner,
      io,
      `Integrating ${spec.packageName}`,
      buildImplementationPrompt({ dir: args.dir, key: keyChoice.key, product, recon }),
      { cwd: args.dir },
    );
  } catch (error) {
    io.error(`${runner.name} failed: ${error instanceof Error ? error.message : String(error)}`);
    io.warn("Check `git status` — the run may have changed files before it stopped.");
    return EXIT_FAILED;
  }

  if (outcome.text.trim()) {
    io.note(outcome.text.trim(), `What ${runner.name} did`);
  }

  const verification = await scan(args.dir, product);
  io.note(renderVerification(verification, product), "Verification");

  const diff = await readDiff(args.dir);
  if (diff) {
    io.note(diff, "Changes");
    io.info("Review the diff before you commit — the wizard checked that the calls exist, not that they are right.");
  } else if (git.isRepo) {
    io.warn("git reports no changes in this tree. The integration may not have been applied.");
  }

  if (isPlaceholderKey(keyChoice.key)) {
    io.warn(
      `The integration contains the placeholder ${keyChoice.key}. Replace it with your real ${spec.keyLabel} — the SDK throws on a malformed key at construction.`,
    );
  }

  if (!verification.complete) {
    io.warn("Some required parts of the integration are missing — see Verification above.");
  }

  io.outro(`${verification.complete ? "Done" : "Finished with gaps"} — docs: ${spec.docsUrl}`);
  return verification.complete ? EXIT_OK : EXIT_FAILED;
}
