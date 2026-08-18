/**
 * The wizard itself: the order of the questions, which turns run, and what
 * happens when each of them cannot.
 *
 * The agent is driven as a conversation, not a one-shot command: recon,
 * implementation and every follow-up the user asks for are turns of one
 * session, so the agent keeps everything it read and wrote between them. On an
 * agent that cannot hold a conversation the same turns run as independent runs,
 * which is exactly the flow this had before — minus the follow-ups, which need
 * the shared context to mean anything.
 *
 * Every capability this needs arrives as an injected dependency, so the whole
 * flow — including the no-agent fallback and the dry run — can be driven in a
 * test with a scripted IO and a fake gateway. Nothing here spawns a process or
 * reads a keystroke on its own.
 */

import type { AgentGateway, AgentOption, AgentRunner, WizardRun, WizardRunResult, WizardTurnOptions } from "./agent";
import { asSchemaFailure, describeEvent, isAuthFailure } from "./agent";
import type { WizardArgs } from "./args";
import { renderManualInstructions } from "./fallback";
import { type GitStatus, gitDiffStat, gitStatus } from "./git";
import { CANCELLED, type SelectChoice, type WizardIo } from "./io";
import { isPlaceholderKey, normalizeKey, placeholderKey, validateKey } from "./keys";
import { PRODUCTS, PRODUCT_IDS, type ProductId, isProductId } from "./products";
import {
  type FollowUpKind,
  type FollowUpPromptInput,
  SYSTEM_PROMPT,
  buildFollowUpPrompt,
  buildImplementationPrompt,
  buildReconPrompt,
} from "./prompts";
import { type Recon, normalizeRecon, reconSchema, renderPlan } from "./recon";
import { type TurnReport, normalizeTurnReport, renderQuestions, renderTurnReport, turnReportSchema } from "./report";
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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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
 * The wizard's view of the agent: a sequence of turns, however the agent
 * happens to deliver them.
 */
interface Conversation {
  /**
   * Whether turns share context. False on an agent that cannot hold a session,
   * where a follow-up would be a fresh agent with no memory of the diff it is
   * being asked to amend — worse than not offering one.
   */
  canFollowUp: boolean;
  close: () => Promise<void>;
  run: (label: string, prompt: string, options: WizardTurnOptions) => Promise<WizardRunResult>;
}

/**
 * Run one turn and return its result, streaming events to a spinner.
 *
 * @param io - Terminal interface
 * @param label - Spinner label
 * @param start - Starts the turn; called inside the spinner so a synchronous
 *   throw is reported like any other failure
 * @returns The turn result
 */
async function runTurn(io: WizardIo, label: string, start: () => WizardRun): Promise<WizardRunResult> {
  const spin = io.spinner();
  spin.start(label);

  try {
    const run = start();
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
 * Open a conversation with the chosen agent, falling back to one-shot runs.
 *
 * @param runner - The agent to drive
 * @param io - Terminal interface
 * @param cwd - The project every turn works in
 * @returns A conversation, multi-turn where the agent can manage it
 */
function openConversation(runner: AgentRunner, io: WizardIo, cwd: string): Conversation {
  try {
    const session = runner.session({ cwd });
    return {
      canFollowUp: true,
      close: () => session.close(),
      run: (label, prompt, options) =>
        runTurn(io, label, () => session.run(prompt, { ...options, systemPrompt: SYSTEM_PROMPT })),
    };
  } catch (error) {
    io.info(
      `${runner.name} cannot hold a multi-turn conversation (${messageOf(error)}), so each pass runs on its own and the wizard cannot take follow-up requests afterwards.`,
    );
    return {
      canFollowUp: false,
      close: async () => undefined,
      run: (label, prompt, options) =>
        runTurn(io, label, () => runner.run(prompt, { ...options, cwd, systemPrompt: SYSTEM_PROMPT })),
    };
  }
}

/**
 * Run a turn that edits the repository and return its report.
 *
 * The schema gets no retries: AnyAgent's default correction is a second full
 * agent run, which on an editing turn means acting on the codebase twice. A
 * reply that fails validation is therefore surfaced as it came back and the
 * conversation carries on — the work the turn did is already on disk either way.
 *
 * @param conversation - The open conversation
 * @param io - Terminal interface
 * @param label - Spinner label
 * @param prompt - The prompt for this turn
 * @param canSchema - Whether this agent can return structured output at all
 * @returns The turn's report
 */
async function editingTurn(
  conversation: Conversation,
  io: WizardIo,
  label: string,
  prompt: string,
  canSchema: boolean,
): Promise<TurnReport> {
  const options: WizardTurnOptions = canSchema ? { schema: turnReportSchema(), schemaRetries: 0 } : {};

  try {
    const result = await conversation.run(label, prompt, options);
    return normalizeTurnReport(result.json, result.text);
  } catch (error) {
    const failure = asSchemaFailure(error);
    if (!failure) {
      throw error;
    }
    io.warn(
      `The agent's report did not match the shape the wizard asked for (${failure.issues.join("; ") || "no detail given"}), so it is shown below exactly as it came back. Whatever the turn changed is still on disk.`,
    );
    return normalizeTurnReport(null, failure.raw);
  }
}

const FOLLOW_UP_LABELS: Record<FollowUpKind, string> = {
  answers: "Working from your answers",
  changes: "Applying your changes",
  verification: "Filling in what was missing",
};

/** Everything the conversation loop needs, gathered once. */
interface LoopContext {
  canSchema: boolean;
  conversation: Conversation;
  dir: string;
  io: WizardIo;
  product: ProductId;
  scan: (dir: string, product: ProductId) => Promise<VerificationResult>;
  /** Title for the block each report is rendered into. */
  title: string;
}

/**
 * Show a turn report.
 *
 * Questions get their own block: they are the one part of a report the user has
 * to act on, and burying them under a file list is how they get missed.
 *
 * @param io - Terminal interface
 * @param report - The report to show
 * @param title - Title for the summary block
 */
function showReport(io: WizardIo, report: TurnReport, title: string): void {
  const body = renderTurnReport(report);
  if (body) {
    io.note(body, title);
  }
  if (report.questions.length > 0) {
    io.note(renderQuestions(report.questions), "It needs you to decide");
  }
}

/** The missing required markers, phrased for the agent rather than the user. */
function gapsFor(verification: VerificationResult): string {
  return verification.markers
    .filter((marker) => marker.required && !marker.found)
    .map((marker) => `- ${marker.label} is missing. ${marker.hint}`)
    .join("\n");
}

/**
 * Take one follow-up turn, keeping the conversation alive if it fails.
 *
 * A failed turn is not the end of the session — AnyAgent resumes from the last
 * good point on the next call — so the user is told and put back in front of
 * the same menu rather than dropped out of the wizard.
 *
 * @param context - The loop's dependencies
 * @param input - What to ask for
 * @param previous - The report to keep if the turn does not complete
 * @returns The new report, or `previous` when the turn failed
 */
async function followUp(context: LoopContext, input: FollowUpPromptInput, previous: TurnReport): Promise<TurnReport> {
  try {
    return await editingTurn(
      context.conversation,
      context.io,
      FOLLOW_UP_LABELS[input.kind],
      buildFollowUpPrompt(input),
      context.canSchema,
    );
  } catch (error) {
    context.io.error(`That turn did not complete: ${messageOf(error)}`);
    context.io.warn("The conversation is still open — ask again, ask for something else, or finish here.");
    return previous;
  }
}

interface LoopOutcome {
  aborted: boolean;
  /** The scan taken when the user finished; null when they aborted. */
  verification: VerificationResult | null;
}

/**
 * The conversation loop: show what the agent did, then let the user reply.
 *
 * There is no turn limit. The user leaves the loop by finishing or aborting,
 * because only they know when the integration is right — a counter would only
 * ever cut them off mid-thought.
 *
 * @param context - The loop's dependencies
 * @param first - The report from the implementation turn
 * @returns Whether the user aborted, and the verification if they did not
 */
async function converse(context: LoopContext, first: TurnReport): Promise<LoopOutcome> {
  const { dir, io, product, scan, title } = context;
  let report = first;

  for (;;) {
    showReport(io, report, title);

    const choices: SelectChoice[] = [
      { hint: "check the tree and show the diff", label: "Looks good — verify & finish", value: "finish" },
      { hint: "tell it what to do differently", label: "Request changes", value: "changes" },
    ];
    if (report.questions.length > 0) {
      choices.push({ hint: "settle what it could not work out", label: "Answer its questions", value: "answers" });
    }
    choices.push({ hint: "stop here and keep whatever is already written", label: "Abort", value: "abort" });

    const choice = await io.select("What next?", choices);
    if (choice === CANCELLED || choice === "abort") {
      return { aborted: true, verification: null };
    }

    if (choice === "finish") {
      const verification = await scan(dir, product);
      io.note(renderVerification(verification, product), "Verification");
      if (verification.complete) {
        return { aborted: false, verification };
      }
      const retry = await io.confirm("Ask the agent to fix what is missing?", true);
      if (retry !== true) {
        return { aborted: false, verification };
      }
      report = await followUp(context, { kind: "verification", message: gapsFor(verification) }, report);
      continue;
    }

    const answering = choice === "answers";
    const reply = await io.text({
      message: answering ? "Your answer" : "What should it do differently?",
    });
    if (reply === CANCELLED) {
      return { aborted: true, verification: null };
    }
    if (reply.trim() === "") {
      io.info("Nothing to send — pick again.");
      continue;
    }

    report = await followUp(
      context,
      answering
        ? { kind: "answers", message: reply, questions: report.questions }
        : { kind: "changes", message: reply },
      report,
    );
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

  const conversation = openConversation(runner, io, args.dir);

  const canRecon = runner.canReadOnly && runner.canSchema;
  let recon: Recon | null = null;
  let reconFailed = false;

  if (canRecon) {
    try {
      // Turn one of the conversation, so every later turn inherits what the
      // agent read here instead of reading the codebase all over again.
      const result = await conversation.run(`Investigating ${args.dir}`, buildReconPrompt(product), {
        readOnly: true,
        schema: reconSchema(product),
      });
      recon = normalizeRecon(result.json, product);
    } catch (error) {
      // Every turn runs on the same login, so an auth failure here dooms the
      // fallback pass too. Stop now with the actual fix.
      if (isAuthFailure(error)) {
        await conversation.close();
        io.error(`${runner.name} is not logged in: ${messageOf(error)}`);
        io.outro(
          `Log in with ${runner.name}'s own CLI (for Claude Code: \`claude login\`) and run the wizard again. Nothing was changed.`,
        );
        return EXIT_FAILED;
      }
      reconFailed = true;
      io.warn(
        `The read-only investigation did not complete (${messageOf(error)}). Falling back to a single pass that investigates as it goes.`,
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
    await conversation.close();
    io.outro(
      recon
        ? "Dry run — nothing was changed. Re-run without --dry-run to apply this plan."
        : reconFailed
          ? "Dry run — nothing was changed. The investigation failed (see above), so there is no plan to show."
          : "Dry run — nothing was changed. This agent cannot investigate read-only, so there is no plan to show.",
    );
    return EXIT_OK;
  }

  if (recon && !args.yes) {
    const apply = await io.confirm("Apply this plan?", true);
    if (apply === CANCELLED || apply === false) {
      await conversation.close();
      io.cancel("Nothing was changed.");
      return EXIT_CANCELLED;
    }
  }

  let report: TurnReport;
  try {
    report = await editingTurn(
      conversation,
      io,
      `Integrating ${spec.packageName}`,
      buildImplementationPrompt({ dir: args.dir, key: keyChoice.key, product, recon, report: runner.canSchema }),
      runner.canSchema,
    );
  } catch (error) {
    await conversation.close();
    io.error(`${runner.name} failed: ${messageOf(error)}`);
    if (isAuthFailure(error)) {
      io.warn(`Log in with ${runner.name}'s own CLI (for Claude Code: \`claude login\`) and run the wizard again.`);
    }
    io.warn("Check `git status` — the run may have changed files before it stopped.");
    return EXIT_FAILED;
  }

  const title = `What ${runner.name} did`;
  let verification: VerificationResult | null = null;

  // --yes is for CI: there is nobody to hold a conversation with, so the run
  // ends after one implementation turn exactly as it always did.
  if (args.yes || !conversation.canFollowUp) {
    showReport(io, report, title);
    if (report.questions.length > 0) {
      io.warn(
        `${runner.name} asked ${report.questions.length === 1 ? "a question" : `${report.questions.length} questions`} that nobody was there to answer — see above, and check its choices in the diff.`,
      );
    }
  } else {
    const outcome = await converse(
      { canSchema: runner.canSchema, conversation, dir: args.dir, io, product, scan, title },
      report,
    );
    if (outcome.aborted) {
      await conversation.close();
      io.warn("Whatever the agent already wrote is still in your tree — check `git status` and `git diff`.");
      io.cancel("Stopped at your request.");
      return EXIT_CANCELLED;
    }
    verification = outcome.verification;
  }

  await conversation.close();

  if (verification === null) {
    verification = await scan(args.dir, product);
    io.note(renderVerification(verification, product), "Verification");
  }

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
